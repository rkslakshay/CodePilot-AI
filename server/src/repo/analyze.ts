/**
 * Repository static analysis: per-file metrics and rule checks on the shared Tree-sitter parsers
 * (engine/syntax.ts) plus line-based security patterns and cross-file checks.
 *
 * Every finding points at a real location found in the parsed tree or the matched line. Nothing
 * is executed. Secrets are redacted before they are stored as snippets.
 */
import type Parser from 'web-tree-sitter';
import { createHash } from 'node:crypto';
import { parseWith, type Grammar } from '../engine/syntax.js';
import { RULE_BY_ID, type Finding, type Severity, type Confidence } from './rules.js';
import { isTestPath } from './scan.js';

type Node = Parser.SyntaxNode;

export interface FunctionMetric {
  name: string;
  line: number;
  endLine: number;
  length: number;
  params: number;
  complexity: number;
  nesting: number;
}
export interface FileMetrics {
  grammar: Grammar | null;
  parsed: boolean;
  parseErrors: number;
  functions: FunctionMetric[];
  classes: number;
  maxComplexity: number;
  avgComplexity: number;
  maxNesting: number;
  todos: number;
}

const GRAMMAR_OF: Record<string, Grammar> = { c: 'c', cpp: 'cpp', java: 'java', python: 'python', javascript: 'javascript', typescript: 'typescript', tsx: 'tsx' };
export const grammarFor = (language: string | null): Grammar | null => (language ? GRAMMAR_OF[language] ?? null : null);
const isJs = (g: Grammar) => g === 'javascript' || g === 'typescript' || g === 'tsx';

const FN: Record<string, Set<string>> = {
  js: new Set(['function_declaration', 'generator_function_declaration', 'function_expression', 'function', 'arrow_function', 'method_definition', 'generator_function']),
  python: new Set(['function_definition']),
  java: new Set(['method_declaration', 'constructor_declaration']),
  c: new Set(['function_definition']),
};
const CLASS: Record<string, Set<string>> = {
  js: new Set(['class_declaration', 'class', 'abstract_class_declaration']),
  python: new Set(['class_definition']),
  java: new Set(['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration']),
  c: new Set(['class_specifier']),
};
const DECISION = new Set(['if_statement', 'elif_clause', 'for_statement', 'for_in_statement', 'enhanced_for_statement', 'for_range_loop', 'while_statement', 'do_statement', 'catch_clause', 'except_clause', 'ternary_expression', 'conditional_expression', 'case_clause', 'if_clause']);
const NESTING = new Set(['if_statement', 'for_statement', 'for_in_statement', 'enhanced_for_statement', 'for_range_loop', 'while_statement', 'do_statement', 'switch_statement', 'switch_expression', 'try_statement', 'with_statement', 'match_statement']);
const LOOPS = new Set(['for_statement', 'for_in_statement', 'enhanced_for_statement', 'for_range_loop', 'while_statement', 'do_statement']);
const JUMPS = new Set(['return_statement', 'throw_statement', 'raise_statement', 'break_statement', 'continue_statement']);
const BLOCKS = new Set(['statement_block', 'block', 'compound_statement']);
const fam = (g: Grammar) => (isJs(g) ? 'js' : g === 'cpp' ? 'c' : g);

const lineOf = (n: Node) => n.startPosition.row + 1;
const colOf = (n: Node) => n.startPosition.column + 1;

function walk(n: Node, visit: (n: Node) => boolean | void) {
  if (visit(n) === false) return;
  for (const c of n.namedChildren) walk(c, visit);
}
function ancestor(n: Node, pred: (a: Node) => boolean, stop?: (a: Node) => boolean): Node | null {
  for (let a = n.parent; a; a = a.parent) {
    if (pred(a)) return a;
    if (stop?.(a)) return null;
  }
  return null;
}

function functionName(n: Node, g: Grammar): string {
  const named = n.childForFieldName('name');
  if (named) return named.text;
  if (g === 'c' || g === 'cpp') {
    let d = n.childForFieldName('declarator');
    while (d && d.type !== 'function_declarator') d = d.childForFieldName('declarator');
    const id = d?.childForFieldName('declarator');
    if (id) return id.text;
  }
  const p = n.parent;
  if (p?.type === 'variable_declarator') return p.childForFieldName('name')?.text ?? '<anonymous>';
  if (p?.type === 'pair') return p.childForFieldName('key')?.text ?? '<anonymous>';
  if (p?.type === 'assignment_expression') return p.childForFieldName('left')?.text ?? '<anonymous>';
  return '<anonymous>';
}
function paramCount(n: Node, g: Grammar): number {
  let params = n.childForFieldName('parameters') ?? n.childForFieldName('parameter');
  if (!params && (g === 'c' || g === 'cpp')) {
    let d = n.childForFieldName('declarator');
    while (d && d.type !== 'function_declarator') d = d.childForFieldName('declarator');
    params = d?.childForFieldName('parameters') ?? null;
  }
  if (!params) return 0;
  if (params.type === 'identifier') return 1;
  return params.namedChildren.filter((c) => c.type !== 'comment' && !(c.type === 'parameter_declaration' && c.text === 'void')).length;
}

/** Cyclomatic complexity and max nesting of one function, excluding nested functions. */
function measure(fnNode: Node, g: Grammar) {
  const fns = FN[fam(g)];
  let cc = 1;
  let maxDepth = 0;
  const visit = (n: Node, depth: number) => {
    for (const c of n.namedChildren) {
      if (fns.has(c.type)) continue;
      let d = depth;
      if (DECISION.has(c.type)) cc++;
      if (c.type === 'switch_case' && c.childForFieldName('value')) cc++;
      if (c.type === 'case_statement' && c.childForFieldName('value')) cc++;
      if (c.type === 'switch_label' && !/^default/.test(c.text)) cc++;
      if (c.type === 'binary_expression' || c.type === 'boolean_operator') {
        const op = c.childForFieldName('operator')?.text ?? c.children.find((x) => ['&&', '||', '??', 'and', 'or'].includes(x.type))?.type;
        if (op === '&&' || op === '||' || op === '??' || op === 'and' || op === 'or') cc++;
      }
      if (NESTING.has(c.type) && !(c.type === 'if_statement' && c.parent?.type === 'else_clause')) {
        d = depth + 1;
        maxDepth = Math.max(maxDepth, d);
      }
      visit(c, d);
    }
  };
  visit(fnNode, 0);
  return { cc, maxDepth };
}

const NOT_PLACEHOLDER = /^(?!.*(example|changeme|change_me|your[_-]|xxx+|dummy|placeholder|sample|<|\$\{|process\.env|os\.environ|getenv|redacted|\*{3,}|test|fake|todo)).*/i;
const SECRET_PATTERNS: { re: RegExp; label: string; severity: Severity; confidence: Confidence; key?: boolean }[] = [
  { re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/, label: 'Private key', severity: 'critical', confidence: 'high', key: true },
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key ID', severity: 'high', confidence: 'high' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, label: 'GitHub token', severity: 'high', confidence: 'high' },
  { re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/, label: 'GitHub fine-grained token', severity: 'high', confidence: 'high' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: 'Slack token', severity: 'high', confidence: 'high' },
  { re: /\bAIza[0-9A-Za-z_\-]{35}\b/, label: 'Google API key', severity: 'high', confidence: 'high' },
  { re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/, label: 'Stripe live key', severity: 'critical', confidence: 'high' },
  { re: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_\-]{32,}\b/, label: 'AI service API key', severity: 'high', confidence: 'medium' },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, label: 'JSON Web Token', severity: 'medium', confidence: 'medium' },
  { re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:([^\s@'"]{4,})@[^\s'"]+/i, label: 'Credentials in a connection URL', severity: 'high', confidence: 'medium' },
];
const GENERIC_SECRET = /\b((?:[A-Za-z_][A-Za-z0-9_]*)?(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)[A-Za-z0-9_]*)\b["']?\s*[:=]\s*(["'`])([^"'`\s]{6,})\2/i;

/** Replaces anything that looks like a secret with «REDACTED» (used for snippets, AI prompts and reports). */
export function redactSecrets(text: string): string {
  let out = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY[A-Z ]*-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY[A-Z ]*-----|$)/g, '«REDACTED PRIVATE KEY»');
  for (const p of SECRET_PATTERNS.slice(1)) out = out.replace(new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : p.re.flags + 'g'), (m, g1) => (g1 && p.label.startsWith('Credentials') ? m.replace(g1, '«REDACTED»') : '«REDACTED»'));
  out = out.replace(new RegExp(GENERIC_SECRET.source, 'gi'), (m, _name, q, val) => m.replace(`${q}${val}${q}`, `${q}«REDACTED»${q}`));
  return out;
}

interface Ctx {
  path: string;
  lines: string[];
  out: Finding[];
  test: boolean;
}
function add(ctx: Ctx, ruleId: string, line: number | null, col: number | null, extra: Partial<Finding> & { description: string }) {
  const r = RULE_BY_ID.get(ruleId)!;
  const snippet = line ? redactSecrets(ctx.lines.slice(Math.max(0, line - 2), line + 1).join('\n')).slice(0, 600) : '';
  ctx.out.push({
    path: ctx.path,
    line,
    col,
    endLine: extra.endLine ?? line,
    severity: extra.severity ?? r.severity,
    category: r.category,
    ruleId,
    title: extra.title ?? r.title,
    description: extra.description,
    why: r.why,
    fix: extra.fix ?? r.fix,
    confidence: extra.confidence ?? r.confidence,
    source: 'static',
    tool: 'codepilot',
    snippet,
    anchor: line ? redactSecrets((ctx.lines[line - 1] ?? '').trim()).slice(0, 300) : '',
  });
}

// ------------------------------------------------------------------ Tree-sitter rules + metrics
function treeAnalysis(ctx: Ctx, tree: Parser.Tree, g: Grammar): FileMetrics {
  const f = fam(g);
  const fns = FN[f];
  const functions: FunctionMetric[] = [];
  let classes = 0;
  const root = tree.rootNode;
  let parseErrors = 0;
  walk(root, (n) => {
    if (n.type === 'ERROR' || (typeof n.isMissing === 'function' ? (n.isMissing as unknown as () => boolean)() : n.isMissing)) {
      parseErrors++;
      return false;
    }
    if (CLASS[f].has(n.type) || (g === 'cpp' && n.type === 'struct_specifier' && n.childForFieldName('body'))) {
      classes++;
      const name = n.childForFieldName('name')?.text;
      if (name && (g === 'python' || g === 'java' || isJs(g)) && /^[a-z]/.test(name) && n.type !== 'class')
        add(ctx, 'CP-STY-001', lineOf(n), colOf(n), { description: `Class "${name}" does not start with an upper-case letter (PascalCase is conventional).` });
    }
    if (fns.has(n.type)) {
      const name = functionName(n, g);
      const { cc, maxDepth } = measure(n, g);
      const fm: FunctionMetric = { name, line: lineOf(n), endLine: n.endPosition.row + 1, length: n.endPosition.row - n.startPosition.row + 1, params: paramCount(n, g), complexity: cc, nesting: maxDepth };
      functions.push(fm);
      const where = `${name}() (lines ${fm.line}–${fm.endLine})`;
      if (cc > 15) add(ctx, 'CP-CPX-001', fm.line, colOf(n), { severity: cc > 25 ? 'high' : 'medium', description: `${where} has a cyclomatic complexity of ${cc}.`, endLine: fm.endLine });
      if (maxDepth > 4) add(ctx, 'CP-CPX-002', fm.line, colOf(n), { description: `${where} nests control blocks ${maxDepth} levels deep.`, endLine: fm.endLine });
      if (fm.length > 80) add(ctx, 'CP-CPX-003', fm.line, colOf(n), { severity: fm.length > 150 ? 'medium' : 'low', description: `${where} is ${fm.length} lines long.`, endLine: fm.endLine });
      if (fm.params > 6) add(ctx, 'CP-CPX-005', fm.line, colOf(n), { description: `${name}() takes ${fm.params} parameters.` });
      if (g === 'python' && /[a-z][A-Z]/.test(name) && !/^test/.test(name) && !/^(setUp|tearDown|setUpClass|tearDownClass)$/.test(name) && !ancestor(n, (a) => a.type === 'class_definition' && /TestCase|Handler|Visitor/.test(a.text.slice(0, 200))))
        add(ctx, 'CP-STY-001', fm.line, colOf(n), { description: `Python function "${name}" uses camelCase; PEP 8 recommends snake_case.` });
      functionRules(ctx, n, g, name);
    }
    statementRules(ctx, n, g);
  });
  const cx = functions.map((x) => x.complexity);
  return {
    grammar: g,
    parsed: true,
    parseErrors,
    functions,
    classes,
    maxComplexity: cx.length ? Math.max(...cx) : 0,
    avgComplexity: cx.length ? Math.round((cx.reduce((a, b) => a + b, 0) / cx.length) * 10) / 10 : 0,
    maxNesting: functions.length ? Math.max(...functions.map((x) => x.nesting)) : 0,
    todos: 0,
  };
}

/** Rules that need a whole function body: unused locals, resources, repeated computation. */
function functionRules(ctx: Ctx, fn: Node, g: Grammar, fname: string) {
  const fns = FN[fam(g)];
  const body = fn.childForFieldName('body');
  if (!body) return;
  const idCount = new Map<string, number>();
  const decls: { name: string; node: Node }[] = [];
  const calls = new Map<string, Node[]>();
  const inner = (n: Node, visit: (x: Node) => void) => {
    for (const c of n.namedChildren) {
      if (fns.has(c.type)) {
        // identifiers used inside nested functions still count as uses (closures)
        walk(c, (x) => {
          if (x.type === 'identifier' || x.type === 'shorthand_property_identifier') idCount.set(x.text, (idCount.get(x.text) ?? 0) + 1);
        });
        continue;
      }
      visit(c);
      inner(c, visit);
    }
  };
  inner(body, (n) => {
    if (n.type === 'identifier' || n.type === 'shorthand_property_identifier') idCount.set(n.text, (idCount.get(n.text) ?? 0) + 1);
    // declarations
    if (isJs(g) && n.type === 'variable_declarator') {
      const nm = n.childForFieldName('name');
      if (nm?.type === 'identifier' && n.parent?.parent?.type !== 'for_in_statement' && n.parent?.parent?.type !== 'export_statement') decls.push({ name: nm.text, node: nm });
    }
    if (g === 'java' && n.type === 'variable_declarator' && n.parent?.type === 'local_variable_declaration') {
      const nm = n.childForFieldName('name');
      if (nm) decls.push({ name: nm.text, node: nm });
    }
    if ((g === 'c' || g === 'cpp') && n.type === 'init_declarator') {
      const nm = n.childForFieldName('declarator');
      if (nm?.type === 'identifier') decls.push({ name: nm.text, node: nm });
    }
    if (g === 'python' && n.type === 'assignment' && n.parent?.type === 'expression_statement') {
      const left = n.childForFieldName('left');
      if (left?.type === 'identifier') decls.push({ name: left.text, node: left });
    }
    if (n.type === 'call_expression' || n.type === 'call') {
      const fnText = n.childForFieldName('function')?.text ?? '';
      const args = n.childForFieldName('arguments');
      if (args && args.namedChildCount > 0 && !/(print|log|append|push|write|add|put|emit|info|warn|error|debug|assert|expect|send|set|insert|remove|pop|next|random|now|time|read|input|scanf|printf|fetch|get)\w*$/i.test(fnText)) {
        const key = n.text.replace(/\s+/g, '');
        if (key.length >= 6 && key.length <= 120) calls.set(key, [...(calls.get(key) ?? []), n]);
      }
    }
  });
  const pyGlobal = g === 'python' ? new Set([...body.text.matchAll(/^\s*(?:global|nonlocal)\s+([\w, ]+)/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim()))) : new Set<string>();
  const seen = new Set<string>();
  for (const d of decls) {
    if (seen.has(d.name) || d.name.startsWith('_') || pyGlobal.has(d.name)) continue;
    seen.add(d.name);
    const assignments = decls.filter((x) => x.name === d.name).length;
    if ((idCount.get(d.name) ?? 0) <= assignments)
      add(ctx, 'CP-BUG-009', lineOf(d.node), colOf(d.node), { description: `"${d.name}" in ${fname}() is assigned but never read.` });
  }
  for (const [key, nodes] of calls) {
    if (nodes.length >= 3) add(ctx, 'CP-PERF-003', lineOf(nodes[0]), colOf(nodes[0]), { description: `${key.slice(0, 80)} is evaluated ${nodes.length} times in ${fname}() (lines ${nodes.map(lineOf).join(', ')}).` });
  }
  // resource leaks
  const text = body.text;
  if (g === 'python') {
    walk(body, (n) => {
      if (n.type === 'call' && n.childForFieldName('function')?.text === 'open' && !ancestor(n, (a) => a.type === 'with_item' || a.type === 'with_clause', (a) => fns.has(a.type)) && !/\.close\(\)/.test(text))
        add(ctx, 'CP-BUG-012', lineOf(n), colOf(n), { description: `open() in ${fname}() is not used in a "with" block and the function never calls close().` });
    });
  }
  if (g === 'java') {
    walk(body, (n) => {
      if (n.type === 'object_creation_expression') {
        const t = n.childForFieldName('type')?.text ?? '';
        if (/^(FileInputStream|FileOutputStream|FileReader|FileWriter|BufferedReader|BufferedWriter|PrintWriter|RandomAccessFile|Socket|ServerSocket|ZipFile|Scanner)$/.test(t) && !/System\.in/.test(n.text) && !ancestor(n, (a) => a.type === 'resource_specification' || a.type === 'resource') && !/\.close\(\)/.test(text))
          add(ctx, 'CP-BUG-012', lineOf(n), colOf(n), { description: `new ${t}(…) in ${fname}() is not in try-with-resources and nothing is closed.` });
      }
    });
  }
  if ((g === 'c' || g === 'cpp') && /\bfopen\s*\(/.test(text) && !/\bfclose\s*\(/.test(text)) {
    walk(body, (n) => {
      if (n.type === 'call_expression' && n.childForFieldName('function')?.text === 'fopen') add(ctx, 'CP-BUG-012', lineOf(n), colOf(n), { description: `fopen() in ${fname}() has no matching fclose() in the same function.`, confidence: 'medium' });
    });
  }
  // Java: String += in a loop
  if (g === 'java') {
    const strings = new Set([...text.matchAll(/\bString\s+(\w+)\s*(=|;)/g)].map((m) => m[1]));
    walk(body, (n) => {
      if (n.type === 'assignment_expression' && /^\+=$/.test(n.childForFieldName('operator')?.text ?? n.children[1]?.text ?? '') && strings.has(n.childForFieldName('left')?.text ?? '') && ancestor(n, (a) => LOOPS.has(a.type), (a) => fns.has(a.type)))
        add(ctx, 'CP-PERF-002', lineOf(n), colOf(n), { description: `String "${n.childForFieldName('left')!.text}" is concatenated with += inside a loop in ${fname}().` });
    });
  }
}

const isLiteralConst = (n: Node | null) => !!n && /^(true|false|True|False|number|integer|number_literal|decimal_integer_literal)$/.test(n.type);
const unwrap = (n: Node | null): Node | null => {
  let x = n;
  while (x && (x.type === 'parenthesized_expression' || x.type === 'condition_clause') && x.namedChildCount === 1) x = x.namedChildren[0];
  return x;
};

/** Rules evaluated on individual nodes anywhere in the file. */
function statementRules(ctx: Ctx, n: Node, g: Grammar) {
  // unreachable code: statements after a jump in the same block
  if (BLOCKS.has(n.type)) {
    const kids = n.namedChildren.filter((c) => c.type !== 'comment');
    const j = kids.findIndex((c) => JUMPS.has(c.type) || (c.type === 'expression_statement' && JUMPS.has(c.namedChildren[0]?.type ?? '')));
    if (j >= 0 && j < kids.length - 1) {
      const next = kids[j + 1];
      const isLabel = /^(case_statement|switch_label|labeled_statement|function_declaration|function_definition|class_declaration)$/.test(next.type);
      if (!isLabel) add(ctx, 'CP-BUG-001', lineOf(next), colOf(next), { description: `This statement follows a ${kids[j].text.split(/[\s;(]/)[0]} on line ${lineOf(kids[j])} and can never run.` });
    }
  }
  // empty catch / except
  if (n.type === 'catch_clause') {
    const body = n.childForFieldName('body') ?? n.namedChildren.find((c) => BLOCKS.has(c.type));
    if (body && body.namedChildCount === 0) add(ctx, 'CP-BUG-002', lineOf(n), colOf(n), { description: 'The catch block is empty, so the exception is silently ignored.' });
  }
  if (n.type === 'except_clause') {
    const block = n.namedChildren.find((c) => c.type === 'block');
    const stmts = block?.namedChildren.filter((c) => c.type !== 'comment') ?? [];
    if (stmts.length === 1 && stmts[0].type === 'pass_statement' && !block!.namedChildren.some((c) => c.type === 'comment')) add(ctx, 'CP-BUG-002', lineOf(n), colOf(n), { description: 'The except block only contains "pass", so the exception is silently ignored.' });
    if (n.namedChildren.filter((c) => c.type !== 'block' && c.type !== 'comment').length === 0) add(ctx, 'CP-BUG-008', lineOf(n), colOf(n), { description: 'A bare "except:" catches every exception, including KeyboardInterrupt and SystemExit.' });
  }
  // conditions
  if (n.type === 'if_statement' || n.type === 'while_statement' || n.type === 'do_statement') {
    const cond = n.childForFieldName('condition');
    if (cond) {
      const raw = cond.type === 'parenthesized_expression' || cond.type === 'condition_clause' ? cond.namedChildren[0] : cond;
      if (raw && raw.type === 'assignment_expression' && g !== 'python') add(ctx, 'CP-BUG-003', lineOf(raw), colOf(raw), { description: `"${raw.text.slice(0, 60)}" assigns a value inside the condition; did you mean a comparison?` });
      const c = unwrap(cond);
      if (isLiteralConst(c)) {
        const truthy = !/^(false|False|0)$/.test(c!.text);
        if (!(n.type !== 'if_statement' && truthy)) add(ctx, 'CP-BUG-004', lineOf(c!), colOf(c!), { description: `The condition is always ${truthy ? 'true' : 'false'} (${c!.text}).` });
      }
    }
  }
  if (n.type === 'binary_expression' || n.type === 'comparison_operator') {
    const ops = n.children.filter((c) => !c.isNamed).map((c) => c.type);
    const l = n.childForFieldName('left') ?? n.namedChildren[0];
    const r = n.childForFieldName('right') ?? n.namedChildren[1];
    if (l && r && n.namedChildCount === 2 && ops.some((o) => ['==', '===', '!=', '!==', '<', '>', '<=', '>='].includes(o)) && l.text === r.text && /^[\w.\[\]]+$/.test(l.text) && !/^\d/.test(l.text))
      add(ctx, 'CP-BUG-005', lineOf(n), colOf(n), { description: `"${n.text.slice(0, 60)}" compares a value with itself.` });
    if (isJs(g) && (ops.includes('==') || ops.includes('!=')) && l && r && ![l.type, r.type].includes('null') && l.text !== 'undefined' && r.text !== 'undefined')
      add(ctx, 'CP-BUG-007', lineOf(n), colOf(n), { description: `"${n.text.slice(0, 60)}" uses loose equality.` });
  }
  if (isJs(g) && n.type === 'variable_declaration') add(ctx, 'CP-STY-002', lineOf(n), colOf(n), { description: `"${n.text.split('\n')[0].slice(0, 60)}" uses var.` });
  // possible null / undefined access
  if (isJs(g) && n.type === 'member_expression') {
    const obj = n.childForFieldName('object');
    const optional = n.children.some((c) => c.type === 'optional_chain' || c.text === '?.');
    if (!optional && obj?.type === 'call_expression') {
      const callee = obj.childForFieldName('function');
      const prop = callee?.type === 'member_expression' ? callee.childForFieldName('property')?.text : null;
      if (prop && /^(find|querySelector|getElementById|match|exec|closest|findLast)$/.test(prop) && n.parent?.type !== 'call_expression' + 'x')
        add(ctx, 'CP-BUG-006', lineOf(n), colOf(n), { description: `${prop}() can return ${prop === 'find' || prop === 'findLast' ? 'undefined' : 'null'}, but its result is used directly: "${n.text.slice(0, 70)}".` });
    }
  }
  if (g === 'python' && n.type === 'attribute') {
    const obj = n.childForFieldName('object');
    if (obj?.type === 'call') {
      const callee = obj.childForFieldName('function')?.text ?? '';
      if (/^re\.(match|search|fullmatch)$/.test(callee) || /\.get$/.test(callee) && obj.childForFieldName('arguments')?.namedChildCount === 1)
        add(ctx, 'CP-BUG-006', lineOf(n), colOf(n), { description: `${callee}() can return None, but its result is used directly: "${n.text.slice(0, 70)}".` });
    }
  }
  // missing error handling
  if ((n.type === 'call_expression' || n.type === 'method_invocation') && !ancestor(n, (a) => a.type === 'try_statement' || a.type === 'catch_clause')) {
    const callee = n.type === 'method_invocation' ? `${n.childForFieldName('object')?.text ?? ''}.${n.childForFieldName('name')?.text ?? ''}` : n.childForFieldName('function')?.text ?? '';
    if ((isJs(g) && callee === 'JSON.parse') || (g === 'java' && /^(Integer\.parseInt|Long\.parseLong|Double\.parseDouble|Integer\.valueOf)$/.test(callee)))
      add(ctx, 'CP-BUG-011', lineOf(n), colOf(n), { description: `${callee}() throws on invalid input and is not inside a try block.`, confidence: 'medium' });
    if (isJs(g) && /\.then$/.test(callee) && n.parent?.type !== 'member_expression' && n.parent?.type !== 'await_expression' && n.parent?.type !== 'return_statement' && !/\.catch\(|\.finally\(/.test(n.text))
      add(ctx, 'CP-BUG-011', lineOf(n), colOf(n), { description: 'A promise chain ends with .then() without .catch(); a rejection would be unhandled.', confidence: 'low' });
    if (isJs(g) && callee === 'parseInt' && (n.childForFieldName('arguments')?.namedChildCount ?? 0) === 1) add(ctx, 'CP-BUG-013', lineOf(n), colOf(n), { description: 'parseInt() is called without a radix.' });
  }
  if ((g === 'c' || g === 'cpp') && n.type === 'call_expression') {
    const callee = n.childForFieldName('function')?.text ?? '';
    if (/^(atoi|atol|atof)$/.test(callee)) add(ctx, 'CP-BUG-013', lineOf(n), colOf(n), { description: `${callee}() cannot report invalid input or overflow.` });
  }
  if ((g === 'c' || g === 'cpp') && n.type === 'for_statement') {
    const cond = n.childForFieldName('condition');
    if (cond && /\bstrlen\s*\(/.test(cond.text)) add(ctx, 'CP-PERF-001', lineOf(cond), colOf(cond), { description: `strlen() is called in the loop condition "${cond.text.slice(0, 60)}".` });
  }
}

// ------------------------------------------------------------------ pattern rules (security, TODOs)
const COMMENT_LINE = /^\s*(\/\/|#|\*|\/\*|<!--|--)/;
const isLocalUrl = (u: string) => /^http:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|[^/]*\.local\b|[^/]*\.test\b|example\.(com|org)|www\.w3\.org|schemas\.|xmlns|json-schema\.org|maven\.apache\.org|java\.sun\.com|ns\.adobe|purl\.org|www\.apache\.org\/licenses)/i.test(u);

function patternRules(ctx: Ctx, language: string | null, kind: string) {
  const code = kind === 'source' || kind === 'test' || kind === 'config' || kind === 'markup';
  const lang = language ?? '';
  const lock = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.min\.(js|css)|\.map)$/.test(ctx.path);
  ctx.lines.forEach((text, i) => {
    const ln = i + 1;
    if (text.length > 600 || lock) return;
    const comment = COMMENT_LINE.test(text);
    // TODO / FIXME
    const todo = /\b(TODO|FIXME|HACK|XXX)\b[:\s]/.exec(text);
    if (todo && (comment || /(\/\/|#|\/\*)\s*(TODO|FIXME|HACK|XXX)/.test(text))) add(ctx, 'CP-DEBT-001', ln, todo.index + 1, { description: text.trim().slice(0, 140) });
    // secrets (also in comments and docs)
    let secretHit = false;
    for (const p of SECRET_PATTERNS) {
      const m = p.re.exec(text);
      if (m && (p.key || NOT_PLACEHOLDER.test(m[0]))) {
        add(ctx, p.key ? 'SEC-002' : 'SEC-001', ln, m.index + 1, { title: p.key ? undefined : `Hard-coded ${p.label}`, severity: ctx.test && !p.key ? 'medium' : p.severity, confidence: ctx.test ? 'low' : p.confidence, description: `${p.label} found${ctx.test ? ' in a test file (may be a fake value)' : ''}. The value is redacted here.` });
        secretHit = true;
      }
    }
    if (secretHit) return;
    const gs = GENERIC_SECRET.exec(text);
    if (gs && code && NOT_PLACEHOLDER.test(gs[3]) && !/^(true|false|null|none|undefined|string|password|secret|\*+)$/i.test(gs[3]) && !/(_URL|_PATH|_FILE|_NAME|_FIELD|_KEY_NAME|_LABEL|label|placeholder|prompt|message|_HEADER)\b/i.test(gs[1]))
      add(ctx, 'SEC-001', ln, gs.index + 1, { title: 'Hard-coded password / secret', severity: ctx.test ? 'low' : 'high', confidence: ctx.test ? 'low' : 'medium', description: `"${gs[1]}" is assigned a literal value. The value is redacted here.` });
    if (comment || !code) {
      if (/\bhttp:\/\/[^\s'"<>)]+/.test(text) && kind !== 'doc') {
        const u = /\bhttp:\/\/[^\s'"<>)]+/.exec(text)!;
        if (!isLocalUrl(u[0]) && !comment) add(ctx, 'SEC-012', ln, u.index + 1, { description: `Plain HTTP URL: ${u[0].slice(0, 80)}` });
      }
      return;
    }
    const py = lang === 'python';
    const js = /^(javascript|typescript|tsx|vue|svelte)$/.test(lang);
    const java = lang === 'java';
    const c = lang === 'c' || lang === 'cpp';
    const dynamic = /(\+\s*\w|\w\s*\+|\$\{|%\s*[\w(]|\.format\(|\bf["'])/;
    // SQL injection
    if (/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(text) && /\b(execute|executemany|executeQuery|executeUpdate|query|raw|prepareStatement|createQuery|exec)\s*\(/.test(text) && (dynamic.test(text) || /"\s*\+|`[^`]*\$\{/.test(text)))
      add(ctx, 'SEC-004', ln, null, { description: 'An SQL statement is built from dynamic values and passed to a query function.' });
    else if (/\b(cursor|db|conn|connection|knex|sequelize|pool|client)\.(execute|query|raw)\s*\(\s*(f["']|["'][^"']*["']\s*(%|\+)|`[^`]*\$\{)/.test(text))
      add(ctx, 'SEC-004', ln, null, { description: 'A query string is formatted / concatenated before execution.' });
    // command execution
    const shell =
      (py && /\b(os\.system|os\.popen|subprocess\.(call|run|Popen|check_output|check_call|getoutput|getstatusoutput))\s*\(/.test(text) && (/shell\s*=\s*True/.test(text) || /os\.(system|popen)|getoutput|getstatusoutput/.test(text))) ||
      (js && /\b(child_process\.)?(exec|execSync)\s*\(/.test(text) && /require\(['"]child_process['"]\)|child_process|\bexecSync\(|\bexec\(\s*[`'"]/.test(ctx.lines.join('\n').slice(0, 20000)) && !/\.exec\(/.test(text.replace(/\bchild_process\.exec/, ''))) ||
      (java && /Runtime\.getRuntime\(\)\.exec\s*\(/.test(text)) ||
      (c && /\b(system|popen|_popen|execl|execlp|execv|execvp)\s*\(/.test(text));
    if (shell) add(ctx, 'SEC-005', ln, null, { severity: dynamic.test(text) ? 'high' : 'medium', confidence: dynamic.test(text) ? 'medium' : 'low', description: dynamic.test(text) ? 'A shell command is built from dynamic values.' : 'A shell command is executed (currently with a fixed string).' });
    // eval
    if ((js && /(^|[^.\w])(eval|new\s+Function)\s*\(/.test(text)) || (js && /\bset(Timeout|Interval)\s*\(\s*["'`]/.test(text)) || (py && /(^|[^.\w])(eval|exec)\s*\(/.test(text) && !/literal_eval/.test(text)))
      add(ctx, 'SEC-006', ln, null, { confidence: /\(\s*["'][^"']*["']\s*\)/.test(text) ? 'low' : 'high', description: 'Code is evaluated from a string at runtime.' });
    // deserialization
    if ((py && (/\bpickle\.loads?\s*\(|\bcPickle\.loads?\s*\(|\bmarshal\.loads?\s*\(|\bshelve\.open\s*\(/.test(text) || (/\byaml\.load\s*\(/.test(text) && !/SafeLoader|safe_load|CSafeLoader/.test(text)))) || (java && /\bnew\s+ObjectInputStream\s*\(|\.readObject\s*\(\s*\)/.test(text)) || (js && /\bunserialize\s*\(/.test(text)))
      add(ctx, 'SEC-007', ln, null, { description: 'Data is deserialised with a format that can execute code.' });
    // path traversal
    if (/\b(req|request)\.(params|query|body|args|form|files|GET|POST|getParameter)\b|\brequest\.(args|form|values|files)\b|getParameter\(/.test(text) && /\b(open|readFile|readFileSync|createReadStream|sendFile|writeFile|writeFileSync|unlink|path\.join|path\.resolve|send_file|send_from_directory|new\s+File|Files\.(read|write|newInputStream))\s*\(/.test(text))
      add(ctx, 'SEC-008', ln, null, { description: 'A file path appears to be built from request input.' });
    // weak crypto
    const weak = /hashlib\.(md5|sha1)\s*\(|createHash\(\s*['"](md5|sha1)['"]|MessageDigest\.getInstance\(\s*"(MD5|SHA-?1)"|Cipher\.getInstance\(\s*"(DES|RC4|[^"]*\/ECB\/)|\bDES\.new\(|ARC4\.new\(|AES\.MODE_ECB|createCipher(iv)?\(\s*['"](des|rc4|[a-z0-9-]*-ecb)/i.exec(text);
    if (weak) add(ctx, 'SEC-009', ln, weak.index + 1, { description: `Weak algorithm: ${weak[0].slice(0, 50)}. Acceptable only for non-security checksums.` });
    // insecure randomness for secrets
    if (/(Math\.random\(\)|\brandom\.(random|randint|choice|choices|randrange|getrandbits)\(|new\s+Random\s*\(|\brand\s*\(\s*\))/.test(text) && /(token|password|passwd|secret|salt|nonce|otp|session|api_?key|uuid|csrf)/i.test(text))
      add(ctx, 'SEC-010', ln, null, { description: 'A non-cryptographic random generator seems to produce a security-sensitive value.' });
    // XSS
    const xss = /\.(innerHTML|outerHTML)\s*\+?=|document\.write(ln)?\s*\(|dangerouslySetInnerHTML|\bv-html\s*=|\binsertAdjacentHTML\s*\(|\bmark_safe\s*\(|\|\s*safe\b|\bMarkup\s*\(/.exec(text);
    if (xss && !/\.(innerHTML|outerHTML)\s*=\s*(['"`])[^'"`$]*\2\s*;?\s*$/.test(text)) add(ctx, 'SEC-011', ln, xss.index + 1, { description: `Raw HTML is inserted (${xss[0].trim()}).` });
    // TLS
    const tls = /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED['"]?\]?\s*=\s*['"]?0|InsecureSkipVerify\s*:\s*true|CERT_NONE|check_hostname\s*=\s*False|TrustAllCerts|ALLOW_ALL_HOSTNAME_VERIFIER/.exec(text);
    if (tls) add(ctx, 'SEC-013', ln, tls.index + 1, { description: `Certificate verification is disabled (${tls[0]}).` });
    // config defaults
    const cfg = /\bapp\.run\([^)]*debug\s*=\s*True|^\s*DEBUG\s*=\s*True\b|ALLOWED_HOSTS\s*=\s*\[\s*['"]\*['"]|Access-Control-Allow-Origin['"]?\s*,\s*['"]\*['"]|\borigin\s*:\s*['"]\*['"]|CORS_ORIGIN_ALLOW_ALL\s*=\s*True|CORS_ALLOW_ALL_ORIGINS\s*=\s*True|\.listen\([^)]*['"]0\.0\.0\.0['"]|host\s*=\s*['"]0\.0\.0\.0['"]/.exec(text);
    if (cfg) add(ctx, 'SEC-014', ln, cfg.index + 1, { severity: /0\.0\.0\.0/.test(cfg[0]) ? 'low' : 'medium', description: `Permissive setting: ${cfg[0].trim().slice(0, 70)}` });
    // C unsafe functions
    if (c) {
      const uf = /\b(gets|strcpy|strcat|sprintf|vsprintf)\s*\(/.exec(text);
      if (uf) add(ctx, 'SEC-015', ln, uf.index + 1, { severity: uf[1] === 'gets' ? 'high' : 'medium', confidence: uf[1] === 'gets' ? 'high' : 'medium', description: `${uf[1]}() does not check the destination buffer size.` });
    }
    // permissions / temp files
    const perm = /chmod\s*\(?[^)\n]*\b0?o?777\b|\bchmod\s+(-R\s+)?777\b|tempfile\.mktemp\s*\(|os\.chmod\([^)]*0o?7[0-7]7\)/.exec(text);
    if (perm) add(ctx, 'SEC-016', ln, perm.index + 1, { description: `Unsafe permission / temp-file usage: ${perm[0].slice(0, 50)}` });
    // insecure HTTP
    const u = /\bhttp:\/\/[^\s'"<>)`]+/.exec(text);
    if (u && !isLocalUrl(u[0])) add(ctx, 'SEC-012', ln, u.index + 1, { description: `Plain HTTP URL: ${u[0].slice(0, 80)}` });
  });
}

export interface FileInput {
  path: string;
  language: string | null;
  kind: string;
  content: string;
}

/** Analyses one file. Returns metrics (null grammar for non-code files) and its findings. */
export function analyzeFile(f: FileInput): { metrics: FileMetrics; findings: Finding[] } {
  const ctx: Ctx = { path: f.path, lines: f.content.split(/\r?\n/), out: [], test: isTestPath(f.path) };
  const g = grammarFor(f.language);
  let metrics: FileMetrics = { grammar: g, parsed: false, parseErrors: 0, functions: [], classes: 0, maxComplexity: 0, avgComplexity: 0, maxNesting: 0, todos: 0 };
  if (g && f.content.trim()) {
    const tree = parseWith(f.content, g);
    if (tree) {
      try {
        metrics = treeAnalysis(ctx, tree, g);
      } finally {
        tree.delete();
      }
    }
    if ((f.kind === 'source') && ctx.lines.length > 800) add(ctx, 'CP-CPX-004', 1, 1, { description: `${f.path} has ${ctx.lines.length} lines.`, severity: ctx.lines.length > 1500 ? 'medium' : 'low' });
  }
  patternRules(ctx, f.language, f.kind);
  metrics.todos = ctx.out.filter((x) => x.ruleId === 'CP-DEBT-001').length;
  // de-duplicate identical rule hits on the same line
  const seen = new Set<string>();
  const findings = ctx.out.filter((x) => {
    const k = `${x.ruleId}:${x.line}:${x.col}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { metrics, findings };
}

// ------------------------------------------------------------------ cross-file rules
const TRIVIAL = /^([{}()\[\];,]*|else:?|try:?|finally:?|pass|break;?|continue;?|return;?|end|\}\s*else\s*\{|\}\s*\)?;?|#.*|\/\/.*|\*.*|\/\*.*|import .*|from .* import .*|#include.*|using .*|package .*)$/;

/** Exact duplicates of 8+ consecutive non-trivial normalised lines across source files. */
export function findDuplicates(files: { path: string; content: string }[], window = 8): Finding[] {
  const index = new Map<string, { path: string; line: number }>();
  const out: Finding[] = [];
  for (const f of files) {
    const norm: { text: string; line: number }[] = [];
    f.content.split(/\r?\n/).forEach((l, i) => {
      const t = l.trim().replace(/\s+/g, ' ');
      if (t.length >= 4 && !TRIVIAL.test(t)) norm.push({ text: t, line: i + 1 });
    });
    let lastReported = -1;
    for (let i = 0; i + window <= norm.length; i++) {
      const h = createHash('sha1').update(norm.slice(i, i + window).map((x) => x.text).join('\n')).digest('hex');
      const prev = index.get(h);
      if (!prev) {
        index.set(h, { path: f.path, line: norm[i].line });
        continue;
      }
      if (prev.path === f.path && Math.abs(prev.line - norm[i].line) < window) continue;
      if (i <= lastReported) continue;
      // extend the run as far as it keeps matching
      let end = i + window;
      while (end < norm.length && index.has(createHash('sha1').update(norm.slice(end - window + 1, end + 1).map((x) => x.text).join('\n')).digest('hex'))) end++;
      lastReported = end - 1;
      const r = RULE_BY_ID.get('CP-DUP-001')!;
      out.push({
        path: f.path, line: norm[i].line, col: 1, endLine: norm[end - 1].line, severity: end - i >= 25 ? 'medium' : 'low', category: r.category, ruleId: r.id, title: r.title,
        description: `${end - i} non-trivial lines (${norm[i].line}–${norm[end - 1].line}) are identical to ${prev.path}:${prev.line}.`,
        why: r.why, fix: r.fix, confidence: 'high', source: 'static', tool: 'codepilot', snippet: redactSecrets(norm.slice(i, Math.min(end, i + 4)).map((x) => x.text).join('\n')),
      });
    }
  }
  return out.slice(0, 300);
}

/** Top-level functions whose name never appears anywhere else in the repository. */
export function findUnusedFunctions(files: { path: string; content: string; metrics: FileMetrics; language: string | null }[]): Finding[] {
  const corpus = files.map((f) => f.content).join('\n');
  const counts = new Map<string, number>();
  const want = new Set<string>();
  for (const f of files) for (const fn of f.metrics.functions) if (/^[A-Za-z_]\w{2,}$/.test(fn.name)) want.add(fn.name);
  for (const m of corpus.matchAll(/[A-Za-z_]\w*/g)) if (want.has(m[0])) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
  const out: Finding[] = [];
  const r = RULE_BY_ID.get('CP-BUG-010')!;
  for (const f of files) {
    if (isTestPath(f.path)) continue;
    const lines = f.content.split(/\r?\n/);
    for (const fn of f.metrics.functions) {
      if ((counts.get(fn.name) ?? 0) !== 1) continue;
      const decl = lines[fn.line - 1] ?? '';
      const before = lines[fn.line - 2] ?? '';
      if (/^(main|constructor|render|setup|teardown|init|__\w+__|test\w*|handle\w*|on[A-Z]\w*|get|post|put|delete|patch)$/.test(fn.name)) continue;
      if (/\bexport\b|\bpublic\b|\b@Override\b|^\s{2,}\S|\bstatic\b.*\bmain\b/.test(decl) || /^\s*@/.test(before) || /export\s+default/.test(decl)) continue;
      out.push({ path: f.path, line: fn.line, col: 1, endLine: fn.endLine, severity: 'info', category: r.category, ruleId: r.id, title: r.title, description: `${fn.name}() is never referenced elsewhere in the repository.`, why: r.why, fix: r.fix, confidence: 'low', source: 'static', tool: 'codepilot', snippet: decl.trim().slice(0, 200) });
    }
  }
  return out.slice(0, 200);
}

/** Stable identity of a finding across re-analysis (independent of line shifts). */
export function fingerprint(f: Pick<Finding, 'ruleId' | 'path' | 'snippet' | 'description' | 'line' | 'anchor'>, occurrence = 0): string {
  const anchor = f.anchor || (f.snippet ? f.snippet.split('\n').map((l) => l.trim()).join('|') : f.description);
  return createHash('sha1').update(`${f.ruleId}\n${f.path}\n${anchor}\n${occurrence}`).digest('hex').slice(0, 24);
}
