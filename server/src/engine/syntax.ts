/**
 * Accurate, language-aware structural analysis using Tree-sitter (open-source incremental parser,
 * loaded as WebAssembly — no native build, works offline). Complements the IR parser: Tree-sitter
 * understands the full language (classes, maps, lambdas, exceptions…), so analysis also works for
 * code that the converter cannot translate.
 */
import Parser from 'web-tree-sitter';
import { createRequire } from 'node:module';
import type { Lang } from './ir.js';

type Node = Parser.SyntaxNode;
const require = createRequire(import.meta.url);
const parsers = new Map<Lang, Parser>();
let ready = false;

export async function initSyntax() {
  if (ready) return;
  await Parser.init();
  for (const l of ['c', 'cpp', 'java', 'python', 'javascript'] as Lang[]) {
    const lang = await Parser.Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${l}.wasm`));
    const p = new Parser();
    p.setLanguage(lang);
    parsers.set(l, p);
  }
  // TypeScript / TSX are used by the Repository Analyzer (same Tree-sitter runtime, extra grammars)
  for (const g of ['typescript', 'tsx'] as const) {
    const lang = await Parser.Language.load(require.resolve(`tree-sitter-wasms/out/tree-sitter-${g}.wasm`));
    const p = new Parser();
    p.setLanguage(lang);
    extraParsers.set(g, p);
  }
  ready = true;
}
const extraParsers = new Map<'typescript' | 'tsx', Parser>();
export type Grammar = Lang | 'typescript' | 'tsx';
export const GRAMMARS: Grammar[] = ['c', 'cpp', 'java', 'python', 'javascript', 'typescript', 'tsx'];
/** Parses source with the shared Tree-sitter parsers. Returns null for unsupported grammars. */
export function parseWith(code: string, grammar: Grammar): Parser.Tree | null {
  const p = (parsers.get(grammar as Lang) ?? extraParsers.get(grammar as 'typescript' | 'tsx')) || null;
  return p ? p.parse(code) : null;
}
await initSyntax();

// ------------------------------------------------------------------ result types
export type Bound = 'constant' | 'linear' | 'log' | 'sqrt' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';
export interface SyntaxError {
  line: number;
  column: number;
  message: string;
}
export interface FunctionInfo {
  name: string;
  params: string[];
  line: number;
  endLine: number;
  className: string | null;
  kind: 'function' | 'method' | 'constructor' | 'lambda';
  recursive: boolean;
  calls: string[];
  complexity: ComplexityInfo;
}
export interface ClassInfo {
  name: string;
  line: number;
  base: string | null;
  methods: string[];
  fields: string[];
}
export interface VariableInfo {
  name: string;
  line: number;
  type: string | null;
  scope: string;
  kind: 'declaration' | 'assignment' | 'parameter' | 'field' | 'loop';
}
export interface LoopInfo {
  kind: string;
  line: number;
  depth: number;
  bound: Bound;
  variable: string | null;
  header: string;
  scope: string;
}
export interface ConditionalInfo {
  kind: 'if' | 'else if' | 'else' | 'switch' | 'ternary' | 'case';
  line: number;
  condition: string;
  scope: string;
}
export interface DataStructureInfo {
  name: string;
  kind: 'array' | '2D array' | 'list' | 'map' | 'set' | 'stack' | 'queue' | 'deque' | 'heap' | 'string builder' | 'linked node' | 'tree node' | 'struct/object';
  line: number;
  evidence: string;
}
export interface ComplexityInfo {
  time: string;
  space: string;
  confidence: Confidence;
  reasons: string[];
  pattern: string | null;
}
export interface SyntaxInfo {
  language: Lang;
  errors: SyntaxError[];
  functions: FunctionInfo[];
  classes: ClassInfo[];
  variables: VariableInfo[];
  loops: LoopInfo[];
  conditionals: ConditionalInfo[];
  calls: { name: string; line: number; scope: string }[];
  dataStructures: DataStructureInfo[];
  complexity: ComplexityInfo;
  maxLoopDepth: number;
}

// ------------------------------------------------------------------ node-type tables
const FN_TYPES: Record<Lang, string[]> = {
  c: ['function_definition'],
  cpp: ['function_definition'],
  java: ['method_declaration', 'constructor_declaration'],
  python: ['function_definition'],
  javascript: ['function_declaration', 'method_definition', 'generator_function_declaration'],
};
const CLASS_TYPES = ['class_specifier', 'struct_specifier', 'class_declaration', 'interface_declaration', 'class_definition', 'enum_declaration'];
const LOOP_TYPES = ['for_statement', 'while_statement', 'do_statement', 'for_range_loop', 'enhanced_for_statement', 'for_in_statement', 'list_comprehension', 'dictionary_comprehension', 'set_comprehension', 'generator_expression'];
const CALL_TYPES = ['call_expression', 'method_invocation', 'call'];

const text = (n: Node | null | undefined) => (n ? n.text : '');
const lineOf = (n: Node) => n.startPosition.row + 1;
const short = (s: string, max = 80) => s.replace(/\s+/g, ' ').trim().slice(0, max);

function* walk(n: Node): Generator<Node> {
  yield n;
  for (const c of n.namedChildren) yield* walk(c);
}

function fnName(n: Node, lang: Lang): string {
  if (lang === 'c' || lang === 'cpp') {
    let d: Node | null = n.childForFieldName('declarator');
    while (d && d.type !== 'function_declarator') d = d.childForFieldName('declarator') ?? d.namedChildren.find((c) => c.type === 'function_declarator') ?? null;
    const id = d?.childForFieldName('declarator');
    return text(id).split('::').pop() || 'anonymous';
  }
  return text(n.childForFieldName('name')) || 'anonymous';
}

function fnParams(n: Node, lang: Lang): string[] {
  let p: Node | null = n.childForFieldName('parameters');
  if (!p && (lang === 'c' || lang === 'cpp')) {
    let d: Node | null = n.childForFieldName('declarator');
    while (d && d.type !== 'function_declarator') d = d.childForFieldName('declarator');
    p = d?.childForFieldName('parameters') ?? null;
  }
  if (!p) return [];
  return p.namedChildren
    .map((c) => {
      if (c.type === 'identifier') return c.text;
      const nm = c.childForFieldName('name') ?? c.childForFieldName('declarator') ?? c.childForFieldName('pattern');
      const t = text(nm).replace(/[*&[\]\s]/g, '');
      return t || c.text.split(/[\s=:]/).filter(Boolean).pop() || '';
    })
    .filter((x) => x && x !== 'self' && x !== 'void');
}

function calleeName(n: Node): string {
  const f = n.childForFieldName('function') ?? n.childForFieldName('name');
  if (!f) return '';
  const t = f.text;
  return t.split(/\.|->|::/).pop() ?? t;
}

/** Name of a call that can target a user-defined function (bare call or self./this. method call). */
function userCallee(n: Node): string | null {
  const f = n.childForFieldName('function') ?? n.childForFieldName('name');
  if (!f) return null;
  const obj = n.childForFieldName('object');
  if (n.type === 'method_invocation') return !obj || /^(this|super)$/.test(obj.text) ? text(n.childForFieldName('name')) : null;
  const t = f.text.replace(/\s+/g, '');
  const m = t.match(/^(?:(?:self|this)(?:\.|->))?([A-Za-z_]\w*)$/) ?? t.match(/^(?:\w+::)+([A-Za-z_]\w*)$/);
  return m ? m[1] : null;
}

function enclosing(n: Node, types: string[]): Node | null {
  let p = n.parent;
  while (p) {
    if (types.includes(p.type)) return p;
    p = p.parent;
  }
  return null;
}

function scopeName(n: Node, lang: Lang): string {
  const f = enclosing(n, FN_TYPES[lang]);
  return f ? fnName(f, lang) : 'global';
}

// ------------------------------------------------------------------ loop bounds
const HALVE = /(\b\w+\s*(\/=|>>=|\*=)\s*([2-9]|\d{2,})\b)|(\b(\w+)\s*=\s*\5\s*(\/\/|\/|\*|>>)\s*([2-9]|\d{2,})\b)/;
const BINSEARCH = /\b(lo|low|left|l|start|begin)\s*=\s*(mid|m)\s*\+\s*1|\b(hi|high|right|r|end)\s*=\s*(mid|m)\s*-?\s*1?\b/;

function classifyLoop(n: Node, lang: Lang): { bound: Bound; variable: string | null; header: string } {
  const body = n.childForFieldName('body');
  const bodyText = text(body);
  const header = short(body ? n.text.slice(0, Math.max(0, body.startIndex - n.startIndex)) : n.text.split('\n')[0], 90);
  // python: for x in range(...) / for x in iterable
  if (lang === 'python' && n.type === 'for_statement' && /\b(bucket|chain)\b|table\[/.test(text(n.childForFieldName('right')))) return { bound: 'constant', variable: null, header };
  if (lang === 'python' && n.type === 'for_statement') {
    const right = n.childForFieldName('right');
    const left = text(n.childForFieldName('left'));
    const r = text(right);
    const m = r.match(/^range\((.*)\)$/s);
    if (m) {
      const args = m[1].split(',').map((x) => x.trim());
      if (args.every((a) => /^-?\d+$/.test(a))) return { bound: 'constant', variable: left, header };
      return { bound: 'linear', variable: left, header };
    }
    return { bound: 'linear', variable: left, header };
  }
  if (/\b(bucket|chain|entries|slot)s?\b/.test(header) && /\b(bucket|chain|table\s*\[)/.test(header)) return { bound: 'constant', variable: null, header };
  const iterable = text(n.childForFieldName('right') ?? n.childForFieldName('value') ?? n.namedChildren.find((c) => c.type === 'for_in_clause')?.childForFieldName('right'));
  if (/^(new\s+\w+\s*\[\s*\]\s*)?[[{(]\s*[-\d'"\s,.]*[\]})]$/.test(iterable.trim())) return { bound: 'constant', variable: null, header };
  if (/\b(bucket|chain)\b|table\s*\[/.test(iterable)) return { bound: 'constant', variable: null, header };
  if (n.type === 'for_range_loop' || n.type === 'enhanced_for_statement' || n.type === 'for_in_statement' || /comprehension|generator_expression/.test(n.type)) {
    return { bound: 'linear', variable: null, header };
  }
  if (n.type === 'for_statement') {
    const cond = text(n.childForFieldName('condition'));
    const upd = text(n.childForFieldName('update') ?? n.childForFieldName('increment'));
    const init = text(n.childForFieldName('initializer') ?? n.childForFieldName('init'));
    const v = (upd.match(/[A-Za-z_]\w*/) ?? init.match(/([A-Za-z_]\w*)\s*=/))?.[0] ?? null;
    if (/(\w+)\s*\*\s*\1\s*<=?/.test(cond)) return { bound: 'sqrt', variable: v, header };
    if (/(\*=|\/=|>>=|<<=)\s*\d|=\s*\w+\s*[*/]\s*[2-9]/.test(upd)) return { bound: 'log', variable: v, header };
    const lim = cond.split(/<=?|>=?|!=/)[1]?.trim() ?? '';
    if (/^-?\d+$/.test(lim) && /^\s*\w+\s*=\s*-?\d+/.test(init.replace(/^\w+\s+/, ''))) return { bound: 'constant', variable: v, header };
    if (!cond) return { bound: 'unknown', variable: v, header };
    return { bound: 'linear', variable: v, header };
  }
  // while / do-while: look at how the condition variables change in the body
  const cond = text(n.childForFieldName('condition'));
  if (/(\w+)\s*\*\s*\1\s*<=?/.test(cond)) return { bound: 'sqrt', variable: null, header };
  if (BINSEARCH.test(bodyText) || HALVE.test(bodyText)) return { bound: 'log', variable: null, header };
  if (/^\(?\s*(true|1|True)\s*\)?$/.test(cond.trim())) return { bound: 'unknown', variable: null, header };
  const vars = [...new Set(cond.match(/[A-Za-z_]\w*/g) ?? [])].filter((x) => !['len', 'size', 'length', 'and', 'or', 'not', 'null', 'None', 'NULL', 'nullptr', 'true', 'false', 'isEmpty', 'empty'].includes(x));
  const changesLinearly = vars.some((v) => new RegExp(`\\b${v}\\s*(\\+\\+|--|\\+=\\s*\\d|-=\\s*\\d)|(\\+\\+|--)${v}\\b|\\b${v}\\s*=\\s*${v}\\s*[-+]\\s*\\d|\\b${v}\\s*=\\s*\\w+(\\.|->)next\\b`).test(bodyText));
  const consumes = /\.(pop|popleft|poll|remove|shift|dequeue|pop_front|pop_back)\s*\(|\bdequeue\s*\(/.test(bodyText) && /(empty|length|size|len\(|isEmpty|\w+\s*!=\s*(null|None|NULL|nullptr)|^\s*\w+\s*$)/.test(cond);
  if (changesLinearly || consumes) return { bound: 'linear', variable: vars[0] ?? null, header };
  if (/\b(\w+)\s*(\/\/=|\/=)\s*10\b|\b(\w+)\s*=\s*\3\s*(\/\/|\/)\s*10\b/.test(bodyText)) return { bound: 'log', variable: vars[0] ?? null, header };
  return { bound: 'unknown', variable: vars[0] ?? null, header };
}

// ------------------------------------------------------------------ complexity algebra
interface Cost {
  n: number; // polynomial degree (0.5 = sqrt)
  log: number;
  exp: boolean;
}
const ONE: Cost = { n: 0, log: 0, exp: false };
const mul = (a: Cost, b: Cost): Cost => ({ n: a.n + b.n, log: a.log + b.log, exp: a.exp || b.exp });
const max = (a: Cost, b: Cost): Cost => (a.exp !== b.exp ? (a.exp ? a : b) : a.n !== b.n ? (a.n > b.n ? a : b) : a.log >= b.log ? a : b);
const BOUND_COST: Record<Bound, Cost> = { constant: ONE, linear: { n: 1, log: 0, exp: false }, log: { n: 0, log: 1, exp: false }, sqrt: { n: 0.5, log: 0, exp: false }, unknown: { n: 1, log: 0, exp: false } };

export function fmt(c: Cost): string {
  if (c.exp) return 'O(2ⁿ)';
  if (!c.n && !c.log) return 'O(1)';
  const sup: Record<number, string> = { 2: '²', 3: '³', 4: '⁴' };
  const p = !c.n ? '' : c.n === 0.5 ? '√n' : c.n === 1 ? 'n' : c.n === 1.5 ? 'n√n' : `n${sup[c.n] ?? '^' + c.n}`;
  const l = !c.log ? '' : c.log === 1 ? 'log n' : `log${sup[c.log] ?? '^' + c.log} n`;
  return `O(${[p, l].filter(Boolean).join(' ')})`;
}

const LIB_COST: [RegExp, Cost, string][] = [
  [/^(sort|sorted|qsort|stable_sort)$/, { n: 1, log: 1, exp: false }, 'library sort is O(n log n)'],
  [/^(binary_search|bisect|bisect_left|bisect_right|binarySearch|lower_bound|upper_bound)$/, { n: 0, log: 1, exp: false }, 'library binary search is O(log n)'],
  [/^(indexOf|includes|contains|count|index|find|reverse|reversed|sum|max|min|copy|join|split|fill|toString|strlen|strcpy|strcmp|memcpy|memset|slice|splice|insert)$/, { n: 1, log: 0, exp: false }, 'linear-time library call'],
];

interface FnSummary {
  node: Node;
  name: string;
  cost: Cost;
  space: Cost;
  reasons: string[];
  unknown: boolean;
  pattern: string | null;
  patternCost: Cost | null;
}

// Recognise well-known algorithms from their structure + text. Gives high-confidence complexity.
function recognise(fnText: string, name: string, loops: { bound: Bound; depth: number }[], selfCalls: number): { pattern: string; time: Cost; space: Cost } | null {
  const t = fnText;
  const nm = name.toLowerCase();
  const nested = loops.some((l) => l.depth >= 1);
  const swapsAdj = /\[\s*(\w+)\s*\+\s*1\s*\]/.test(t) && /(temp|tmp|swap)/i.test(t);
  if (/bubble/.test(nm) || (nested && swapsAdj && /\[\s*\w+\s*\]\s*>\s*\w+\s*\[\s*\w+\s*\+\s*1\s*\]/.test(t))) return { pattern: 'Bubble sort', time: { n: 2, log: 0, exp: false }, space: ONE };
  if (/selection/.test(nm) || (nested && /(min_?idx|min_?index|minIndex|minIdx|smallest)/i.test(t))) return { pattern: 'Selection sort', time: { n: 2, log: 0, exp: false }, space: ONE };
  if (/insertion/.test(nm) || (nested && /\bkey\b/.test(t) && /\[\s*\w+\s*\+\s*1\s*\]\s*=\s*\w+\s*\[\s*\w+\s*\]/.test(t))) return { pattern: 'Insertion sort', time: { n: 2, log: 0, exp: false }, space: ONE };
  if ((/merge_?sort|mergesort/i.test(nm) || (selfCalls >= 2 && /\bmerge\s*\(/.test(t))) && /mid/.test(t)) return { pattern: 'Merge sort', time: { n: 1, log: 1, exp: false }, space: { n: 1, log: 0, exp: false } };
  if (/quick_?sort|quicksort/i.test(nm) || (selfCalls >= 2 && /partition\s*\(/.test(t))) return { pattern: 'Quick sort (average case; worst case O(n²))', time: { n: 1, log: 1, exp: false }, space: { n: 0, log: 1, exp: false } };
  if (/heap_?sort/i.test(nm)) return { pattern: 'Heap sort', time: { n: 1, log: 1, exp: false }, space: ONE };
  if (/heapify|sift_?down|siftdown/i.test(nm)) return { pattern: 'Heapify (sift-down)', time: { n: 0, log: 1, exp: false }, space: selfCalls ? { n: 0, log: 1, exp: false } : ONE };
  if (/binary_?search|binarysearch/i.test(nm) || (/\bmid\b/.test(t) && BINSEARCH.test(t))) return { pattern: 'Binary search', time: { n: 0, log: 1, exp: false }, space: selfCalls ? { n: 0, log: 1, exp: false } : ONE };
  if (/\bfib/i.test(nm) && selfCalls >= 2) return { pattern: 'Naive recursive Fibonacci', time: { n: 0, log: 0, exp: true }, space: { n: 1, log: 0, exp: false } };
  if (/hanoi/i.test(nm) && selfCalls >= 2) return { pattern: 'Tower of Hanoi', time: { n: 0, log: 0, exp: true }, space: { n: 1, log: 0, exp: false } };
  if (/\bfact/i.test(nm) && selfCalls === 1) return { pattern: 'Recursive factorial', time: { n: 1, log: 0, exp: false }, space: { n: 1, log: 0, exp: false } };
  if (/\bgcd|\bhcf/i.test(nm)) return { pattern: "Euclid's GCD", time: { n: 0, log: 1, exp: false }, space: ONE };
  if (/\bbfs\b|breadth/i.test(nm) || (/queue|deque/i.test(t) && /visited/i.test(t) && !selfCalls)) return { pattern: 'Breadth-first search', time: { n: 1, log: 0, exp: false }, space: { n: 1, log: 0, exp: false } };
  if (/\bdfs\b|depth_?first/i.test(nm) || (selfCalls >= 1 && /visited/i.test(t))) return { pattern: 'Depth-first search', time: { n: 1, log: 0, exp: false }, space: { n: 1, log: 0, exp: false } };
  if (/dijkstra/i.test(nm)) return { pattern: "Dijkstra's algorithm", time: /heap|priority/i.test(t) ? { n: 1, log: 1, exp: false } : { n: 2, log: 0, exp: false }, space: { n: 1, log: 0, exp: false } };
  if (/kadane|max_?sub/i.test(nm)) return { pattern: "Kadane's algorithm", time: { n: 1, log: 0, exp: false }, space: ONE };
  if (/linear_?search|linearsearch/i.test(nm)) return { pattern: 'Linear search', time: { n: 1, log: 0, exp: false }, space: ONE };
  return null;
}

// ------------------------------------------------------------------ main analysis
export function analyzeSyntax(code: string, lang: Lang): SyntaxInfo | null {
  const parser = parsers.get(lang);
  if (!parser) return null;
  const tree = parser.parse(code);
  const root = tree.rootNode;
  const info: SyntaxInfo = { language: lang, errors: [], functions: [], classes: [], variables: [], loops: [], conditionals: [], calls: [], dataStructures: [], complexity: { time: 'O(1)', space: 'O(1)', confidence: 'high', reasons: [], pattern: null }, maxLoopDepth: 0 };
  const fnTypes = FN_TYPES[lang];
  const seenDs = new Set<string>();
  const addDs = (name: string, kind: DataStructureInfo['kind'], line: number, evidence: string) => {
    const key = `${name}:${kind}`;
    if (!name || seenDs.has(key)) return;
    seenDs.add(key);
    info.dataStructures.push({ name, kind, line, evidence: short(evidence, 70) });
  };

  for (const n of walk(root)) {
    // ---- syntax errors
    if (n.type === 'ERROR' || n.isMissing) {
      if (info.errors.length < 10) {
        const near = short(n.text, 30);
        info.errors.push({ line: lineOf(n), column: n.startPosition.column + 1, message: n.isMissing ? `Missing ${n.type}` : near ? `Unexpected syntax near "${near}"` : 'Syntax error' });
      }
      continue;
    }
    // ---- classes
    if (CLASS_TYPES.includes(n.type) && (n.childForFieldName('body') || lang !== 'c')) {
      const name = text(n.childForFieldName('name'));
      if (name) {
        const body = n.childForFieldName('body');
        const methods: string[] = [];
        const fields: string[] = [];
        for (const c of body ? walk(body) : []) {
          if (fnTypes.includes(c.type) && enclosing(c, CLASS_TYPES) === n) methods.push(fnName(c, lang));
          if ((c.type === 'field_declaration' || c.type === 'public_field_definition') && enclosing(c, CLASS_TYPES) === n) fields.push(short(c.text, 40));
          if (lang === 'python' && c.type === 'assignment' && /^self\.\w+/.test(text(c.childForFieldName('left')))) fields.push(text(c.childForFieldName('left')).slice(5));
        }
        const base = text(n.childForFieldName('superclass') ?? n.childForFieldName('superclasses') ?? n.namedChildren.find((c) => c.type === 'base_class_clause' || c.type === 'class_heritage') ?? null).replace(/^[:(\s]*(extends|public)?\s*|[)\s]*$/g, '') || null;
        info.classes.push({ name, line: lineOf(n), base, methods, fields: [...new Set(fields)].slice(0, 20) });
        if (/node/i.test(name) && /\b(next|prev)\b/.test(n.text)) addDs(name, 'linked node', lineOf(n), `${name} has a next pointer`);
        else if (/node/i.test(name) && /\b(left|right)\b/.test(n.text)) addDs(name, 'tree node', lineOf(n), `${name} has left/right children`);
        else addDs(name, 'struct/object', lineOf(n), `user-defined type ${name}`);
      }
    }
    // ---- loops
    if (LOOP_TYPES.includes(n.type)) {
      let depth = 0;
      let p = n.parent;
      const fn = enclosing(n, fnTypes);
      while (p && p !== fn) {
        if (LOOP_TYPES.includes(p.type)) depth++;
        p = p.parent;
      }
      const c = classifyLoop(n, lang);
      const kind = { for_statement: lang === 'python' ? 'for-in loop' : 'for loop', while_statement: 'while loop', do_statement: 'do-while loop', for_range_loop: 'range-based for', enhanced_for_statement: 'for-each loop', for_in_statement: 'for-of/in loop' }[n.type as string] ?? 'comprehension';
      info.loops.push({ kind, line: lineOf(n), depth, bound: c.bound, variable: c.variable, header: c.header, scope: scopeName(n, lang) });
      info.maxLoopDepth = Math.max(info.maxLoopDepth, depth + 1);
    }
    // ---- conditionals
    if (n.type === 'if_statement') {
      const parentIsElse = n.parent?.type === 'else_clause' || (n.parent?.type === 'if_statement' && n.parent.childForFieldName('alternative')?.id === n.id);
      info.conditionals.push({ kind: parentIsElse ? 'else if' : 'if', line: lineOf(n), condition: short(text(n.childForFieldName('condition')).replace(/^\((.*)\)$/s, '$1')), scope: scopeName(n, lang) });
    }
    if (n.type === 'elif_clause') info.conditionals.push({ kind: 'else if', line: lineOf(n), condition: short(text(n.childForFieldName('condition'))), scope: scopeName(n, lang) });
    if (n.type === 'switch_statement' || n.type === 'switch_expression' || n.type === 'match_statement') info.conditionals.push({ kind: 'switch', line: lineOf(n), condition: short(text(n.childForFieldName('condition') ?? n.childForFieldName('value') ?? n.childForFieldName('subject'))), scope: scopeName(n, lang) });
    if (n.type === 'conditional_expression' || n.type === 'ternary_expression') info.conditionals.push({ kind: 'ternary', line: lineOf(n), condition: short(text(n.childForFieldName('condition') ?? n.namedChildren[lang === 'python' ? 1 : 0])), scope: scopeName(n, lang) });
    // ---- calls
    if (CALL_TYPES.includes(n.type)) {
      const name = calleeName(n);
      if (name) info.calls.push({ name, line: lineOf(n), scope: scopeName(n, lang) });
      const full = text(n.childForFieldName('function') ?? n);
      const target = full.split(/\.|->/)[0];
      if (/\.(append|push_back|push|add|offer|addLast|emplace_back)$/.test(full)) {
        if (/\.(pop|pop_back)\b|\.pop\(\)/.test(root.text.slice(n.endIndex)) && new RegExp(`\\b${target}\\s*\\.\\s*(pop|pop_back|removeLast)\\b`).test(root.text)) addDs(target, 'stack', lineOf(n), 'push/append with pop from the end');
        else if (new RegExp(`\\b${target}\\s*\\.\\s*(popleft|poll|pop\\(0\\)|shift|front|removeFirst|pop_front)`).test(root.text)) addDs(target, 'queue', lineOf(n), 'append at back, remove from front');
      }
    }
    // ---- variables & data structures
    const decl = varDeclaration(n, lang);
    if (decl) {
      for (const v of decl) {
        info.variables.push({ ...v, scope: scopeName(n, lang) });
        const ds = classifyDs(v.type ?? '', v.init ?? '', lang);
        if (ds) addDs(v.name, ds, v.line, `${v.type ?? ''} ${v.init ?? ''}`.trim());
      }
    }
  }
  // parameters
  for (const n of walk(root)) {
    if (!fnTypes.includes(n.type)) continue;
    const name = fnName(n, lang);
    for (const p of fnParams(n, lang)) info.variables.push({ name: p, line: lineOf(n), type: null, scope: name, kind: 'parameter' });
  }
  computeFunctions(root, lang, info);
  info.variables = dedupeVars(info.variables);
  return info;
}

interface Decl {
  name: string;
  line: number;
  type: string | null;
  kind: VariableInfo['kind'];
  init?: string;
}

function varDeclaration(n: Node, lang: Lang): Decl[] | null {
  const line = lineOf(n);
  if ((lang === 'c' || lang === 'cpp') && (n.type === 'declaration' || n.type === 'field_declaration')) {
    const type = text(n.childForFieldName('type'));
    return n.namedChildren
      .filter((c) => ['init_declarator', 'identifier', 'array_declarator', 'pointer_declarator', 'field_identifier'].includes(c.type))
      .map((c) => {
        const d = c.type === 'init_declarator' ? c.childForFieldName('declarator')! : c;
        const isArr = d.type === 'array_declarator' || /\[/.test(d.text);
        const nm = d.text.replace(/[*&\s]|\[.*$/g, '');
        return { name: nm, line, type: `${type}${isArr ? '[]'.repeat((d.text.match(/\[/g) ?? []).length) : ''}`, kind: n.type === 'field_declaration' ? 'field' : 'declaration', init: text(c.childForFieldName('value')) } as Decl;
      })
      .filter((d) => /^[A-Za-z_]\w*$/.test(d.name));
  }
  if (lang === 'java' && (n.type === 'local_variable_declaration' || n.type === 'field_declaration')) {
    const type = text(n.childForFieldName('type'));
    return n.namedChildren.filter((c) => c.type === 'variable_declarator').map((c) => ({ name: text(c.childForFieldName('name')), line, type: type + (c.text.includes('[') ? '[]' : ''), kind: n.type === 'field_declaration' ? 'field' : 'declaration', init: text(c.childForFieldName('value')) }));
  }
  if (lang === 'javascript' && (n.type === 'lexical_declaration' || n.type === 'variable_declaration')) {
    return n.namedChildren
      .filter((c) => c.type === 'variable_declarator' && c.childForFieldName('name')?.type === 'identifier')
      .map((c) => ({ name: text(c.childForFieldName('name')), line, type: null, kind: 'declaration', init: text(c.childForFieldName('value')) }));
  }
  if (lang === 'python' && n.type === 'assignment' && n.parent?.type === 'expression_statement') {
    const left = n.childForFieldName('left');
    if (left?.type === 'identifier') return [{ name: left.text, line, type: text(n.childForFieldName('type')) || null, kind: 'assignment', init: text(n.childForFieldName('right')) }];
    if (left?.type === 'pattern_list' || left?.type === 'tuple_pattern') return left.namedChildren.filter((c) => c.type === 'identifier').map((c) => ({ name: c.text, line, type: null, kind: 'assignment' }));
  }
  if ((lang === 'python' && n.type === 'for_statement') || n.type === 'for_range_loop' || n.type === 'enhanced_for_statement' || n.type === 'for_in_statement') {
    const l = n.childForFieldName('left') ?? n.childForFieldName('name') ?? n.childForFieldName('declarator');
    if (l && /^[A-Za-z_]\w*$/.test(l.text)) return [{ name: l.text, line, type: null, kind: 'loop' }];
  }
  return null;
}

function classifyDs(type: string, init: string, lang: Lang): DataStructureInfo['kind'] | null {
  const t = `${type} ${init}`;
  if (/(unordered_)?map\s*<|HashMap|TreeMap|LinkedHashMap|\bMap\s*<|new\s+Map\s*\(|^\s*\{\s*$|^\s*\{[^}]*:|\bdict\s*\(|defaultdict|Counter\(/.test(t) && !(lang === 'c' || (lang === 'cpp' && /^\s*\{/.test(init) && !/map/.test(type)) || (lang === 'java' && /^\s*\{/.test(init)))) return 'map';
  if (/(unordered_)?set\s*<|HashSet|TreeSet|\bSet\s*<|new\s+Set\s*\(|\bset\s*\(|^\s*\{[^:}]+\}\s*$/.test(t) && lang !== 'c' && !(lang === 'java' && /^\s*\{/.test(init)) && !(lang === 'cpp' && !/set/.test(type))) return 'set';
  if (/\bstack\s*<|\bStack\s*</.test(t)) return 'stack';
  if (/\bdeque\b|ArrayDeque|\bDeque\s*</.test(t)) return 'deque';
  if (/\bqueue\s*<|\bQueue\s*<|LinkedList\s*<|\bQueue\(/.test(t)) return 'queue';
  if (/priority_queue|PriorityQueue|heapq/.test(t)) return 'heap';
  if (/StringBuilder|StringBuffer|stringstream/.test(t)) return 'string builder';
  if (/vector\s*<\s*vector|\[\]\s*\[\]|\[\s*\[|\]\s*\[/.test(t)) return '2D array';
  if (/vector\s*<|ArrayList|\bList\s*</.test(t)) return 'list';
  if (/\[\]|\bnew\s+\w+\s*\[|^\s*\[|\[\s*\d*\s*\]\s*\*|Array\(/.test(t)) return lang === 'python' || lang === 'javascript' ? 'list' : 'array';
  return null;
}

function dedupeVars(v: VariableInfo[]): VariableInfo[] {
  const seen = new Map<string, VariableInfo>();
  for (const x of v) {
    const k = `${x.scope}:${x.name}`;
    const cur = seen.get(k);
    if (!cur || (!cur.type && x.type)) seen.set(k, cur ? { ...cur, type: x.type } : x);
  }
  return [...seen.values()];
}

function computeFunctions(root: Node, lang: Lang, info: SyntaxInfo) {
  const fnNodes = [...walk(root)].filter((n) => FN_TYPES[lang].includes(n.type));
  const byName = new Map<string, Node>();
  for (const f of fnNodes) byName.set(fnName(f, lang), f);
  const memo = new Map<string, FnSummary>();

  const summarize = (f: Node, stack: Set<string>): FnSummary => {
    const name = fnName(f, lang);
    if (memo.has(name)) return memo.get(name)!;
    const st = new Set(stack).add(name);
    const body = f.childForFieldName('body') ?? f;
    const reasons: string[] = [];
    let unknown = false;
    const loops = info.loops.filter((l) => l.line >= lineOf(f) && l.line <= f.endPosition.row + 1);
    // recursion shape
    const selfCalls = [...walk(body)].filter((n) => CALL_TYPES.includes(n.type) && userCallee(n) === name);
    const rec = recognise(f.text, name, loops, selfCalls.length);
    const cost = blockCost(body, f, st, reasons, (u) => (unknown ||= u));
    let total = cost;
    let space: Cost = allocSpace(body.text);
    // calls that sit in different branches of one if/else (or each in a return) never run together
    // calls in different branches of one if/else chain never run in the same invocation
    const branchOf = (c: Node) => {
      let p: Node | null = c;
      while (p && p !== f) {
        const par: Node | null = p.parent;
        if (par && ['if_statement', 'elif_clause', 'else_clause', 'conditional_expression', 'ternary_expression'].includes(par.type) && p !== par.childForFieldName('condition')) return `${par.id}:${p.id}`;
        p = par;
      }
      return null;
    };
    // a call inside its own return statement ends the invocation, so it cannot run together with another such call
    const keyOf = (c: Node) => branchOf(c) ?? (enclosing(c, ['return_statement']) ? `ret:${enclosing(c, ['return_statement'])!.id}` : null);
    const branches = selfCalls.map(keyOf);
    const exclusive = selfCalls.length > 1 && branches.every((b) => b !== null) && new Set(branches).size === branches.length;
    const treeWalk = selfCalls.length >= 1 && selfCalls.every((c) => /(\.|->)(left|right|children|child|next)\b|\b(left|right)\b/.test(text(c.childForFieldName('arguments'))));
    if (treeWalk && !exclusive && selfCalls.length >= 2) {
      total = mul({ n: 1, log: 0, exp: false }, cost);
      space = max(space, { n: 1, log: 0, exp: false });
      reasons.push(`${name}() visits each node of a tree/linked structure once → linear in the number of nodes.`);
      selfCalls.length = 0;
    } else if (exclusive) {
      reasons.push(`${name}()'s recursive calls are in mutually exclusive branches, so only one runs per call.`);
      selfCalls.splice(1);
    }
    if (selfCalls.length && treeWalk) {
      total = mul({ n: 0, log: 1, exp: false }, cost);
      space = max(space, { n: 0, log: 1, exp: false });
      reasons.push(`${name}() follows one child per call → proportional to the tree height (O(log n) when balanced, O(n) in the worst case).`);
      selfCalls.length = 0;
    }
    if (selfCalls.length) {
      const args = selfCalls.map((c) => text(c.childForFieldName('arguments')));
      const halves = args.some((a) => /\/\s*2|\/\/\s*2|>>\s*1|\bmid\b|\bm\b|half|len\(\w+\)\s*\/\//.test(a));
      const minus = args.every((a) => /[-+]\s*\d|\.next|\.left|\.right|\[1:\]|\[:-1\]|\bmid\b/.test(a) || halves);
      if (selfCalls.length === 1 && halves) {
        total = mul({ n: 0, log: 1, exp: false }, cost);
        space = max(space, { n: 0, log: 1, exp: false });
        reasons.push(`${name}() recurses once on half the input → logarithmic depth.`);
      } else if (selfCalls.length === 1) {
        total = mul({ n: 1, log: 0, exp: false }, cost);
        space = max(space, { n: 1, log: 0, exp: false });
        reasons.push(`${name}() recurses once per step → linear recursion depth.`);
        if (!minus) unknown = true;
      } else if (halves) {
        total = cost.n >= 1 ? { n: 1, log: 1, exp: false } : { n: 1, log: 0, exp: false };
        space = max(space, { n: 0, log: 1, exp: false });
        reasons.push(`${name}() splits the input in halves and recurses ${selfCalls.length}×${cost.n >= 1 ? ' with linear work per level' : ''} (divide and conquer).`);
      } else {
        total = { n: 0, log: 0, exp: true };
        space = max(space, { n: 1, log: 0, exp: false });
        reasons.push(`${name}() makes ${selfCalls.length} recursive calls without shrinking the input by half → exponential growth.`);
      }
    }
    let pattern: string | null = null;
    let patternCost: Cost | null = null;
    if (rec) {
      pattern = rec.pattern;
      patternCost = rec.time;
      total = rec.time;
      space = max(space, rec.space);
      unknown = false;
      reasons.unshift(`Recognised pattern: ${rec.pattern} (well-known complexity ${fmt(rec.time)}).`);
    }
    const s: FnSummary = { node: f, name, cost: total, space, reasons, unknown, pattern, patternCost };
    memo.set(name, s);
    return s;
  };

  /** Cost of the statements inside `scope` (loops multiply, siblings take the max, calls inline). */
  function blockCost(scope: Node, fn: Node | null, stack: Set<string>, reasons: string[], markUnknown: (u: boolean) => void): Cost {
    const visit = (n: Node): Cost => {
      let c = ONE;
      for (const child of n.namedChildren) {
        if (FN_TYPES[lang].includes(child.type) && child !== fn) continue; // nested function definitions are analysed separately
        if (LOOP_TYPES.includes(child.type)) {
          const cl = classifyLoop(child, lang);
          if (cl.bound === 'unknown') {
            markUnknown(true);
            reasons.push(`Line ${lineOf(child)}: the number of iterations of "${cl.header}" could not be determined (treated as up to n).`);
          }
          const inner = visit(child);
          c = max(c, mul(BOUND_COST[cl.bound], inner));
          continue;
        }
        if (CALL_TYPES.includes(child.type)) {
          const nm = calleeName(child);
          const user = userCallee(child);
          const target = user ? byName.get(user) : undefined;
          const receiver = text(child.childForFieldName('function') ?? child.childForFieldName('object')).split(/\.|->/)[0];
          const onHashed = info.dataStructures.some((d) => d.name === receiver && (d.kind === 'map' || d.kind === 'set'));
          if (target && !stack.has(nm)) {
            const s = summarize(target, stack);
            c = max(c, s.cost);
            if (s.unknown) markUnknown(true);
          } else if (!target && !onHashed) {
            for (const [re, lc, why] of LIB_COST) {
              if (re.test(nm) && !(nm === 'max' || nm === 'min' ? (child.childForFieldName('arguments')?.namedChildren.length ?? 0) > 1 : false)) {
                c = max(c, lc);
                if (!reasons.includes(`${nm}(): ${why}.`)) reasons.push(`${nm}(): ${why}.`);
                break;
              }
            }
          }
        }
        if (lang === 'python' && child.type === 'comparison_operator' && /\bin\b/.test(child.text) && /\[|list/.test(child.text)) c = max(c, { n: 1, log: 0, exp: false });
        c = max(c, visit(child));
      }
      return c;
    };
    return visit(scope);
  }

  for (const f of fnNodes) {
    const s = summarize(f, new Set());
    const name = fnName(f, lang);
    const cls = enclosing(f, CLASS_TYPES);
    const isCtor = f.type === 'constructor_declaration' || (lang === 'python' && name === '__init__') || (lang === 'javascript' && name === 'constructor') || (cls && name === text(cls.childForFieldName('name')));
    info.functions.push({
      name,
      params: fnParams(f, lang),
      line: lineOf(f),
      endLine: f.endPosition.row + 1,
      className: cls ? text(cls.childForFieldName('name')) : null,
      kind: isCtor ? 'constructor' : cls ? 'method' : 'function',
      recursive: [...walk(f.childForFieldName('body') ?? f)].some((n) => CALL_TYPES.includes(n.type) && userCallee(n) === name),
      calls: [...new Set([...walk(f)].filter((n) => CALL_TYPES.includes(n.type)).map(calleeName).filter(Boolean))],
      complexity: { time: fmt(s.cost), space: fmt(s.space), confidence: s.pattern ? 'high' : s.unknown ? 'low' : 'medium', reasons: s.reasons.length ? s.reasons : [describeLoops(info.loops.filter((l) => l.scope === name))], pattern: s.pattern },
    });
  }

  // whole-program: top-level code plus the worst function actually used
  const topReasons: string[] = [];
  let unknown = false;
  const top = blockCost(root, null, new Set(), topReasons, (u) => (unknown ||= u));
  let total = top;
  let space = allocSpace(root.text);
  let pattern: string | null = null;
  let anyPattern = false;
  for (const s of memo.values()) {
    total = max(total, s.cost);
    space = max(space, s.space);
    if (s.unknown) unknown = true;
    if (s.pattern) anyPattern = true;
    if (s.pattern && fmt(s.cost) === fmt(total)) pattern = s.pattern;
  }
  const reasons = [...new Set([...memo.values()].flatMap((s) => s.reasons).concat(topReasons))];
  if (info.maxLoopDepth >= 2) reasons.push(`Deepest loop nesting: ${info.maxLoopDepth} levels.`);
  if (!reasons.length) reasons.push(info.loops.length ? describeLoops(info.loops) : 'No loops or recursion depend on the input size.');
  reasons.push(space.n || space.log ? `Extra memory grows as ${fmt(space)} (allocations proportional to the input or recursion depth).` : 'Only a fixed number of variables are allocated (input storage not counted).');
  const confidence: Confidence = unknown ? 'low' : anyPattern || (!info.loops.some((l) => l.bound === 'unknown') && !info.errors.length) ? (anyPattern ? 'high' : 'medium') : 'low';
  info.complexity = { time: fmt(total), space: fmt(space), confidence: info.errors.length ? 'low' : confidence, reasons, pattern };
}

function describeLoops(loops: LoopInfo[]): string {
  if (!loops.length) return 'No loops: constant work.';
  const kinds = loops.map((l) => `${l.kind} (${l.bound === 'linear' ? 'runs ~n times' : l.bound === 'log' ? 'halves/doubles each step' : l.bound === 'sqrt' ? 'runs ~√n times' : l.bound === 'constant' ? 'fixed number of iterations' : 'unknown iteration count'})`);
  return `Loops: ${kinds.slice(0, 4).join('; ')}.`;
}

function allocSpace(t: string): Cost {
  if (/new\s+\w+\s*\[\s*\w+\s*\]\s*\[\s*\w+\s*\]|vector\s*<\s*vector[^>]*>>?\s*\w+\s*\(\s*\w+|\[\s*\[.*for .* in range\(\s*\w+|\[\[0\]\s*\*\s*\w+\s*for/.test(t)) return { n: 2, log: 0, exp: false };
  if (/new\s+\w+\s*\[\s*[A-Za-z_]\w*|\[\s*\w+\s*\]\s*\*\s*[A-Za-z_]|\*\s*\(\s*len|vector\s*<[^>]+>\s*\w+\s*\(\s*[A-Za-z_]|malloc\s*\(|new\s+(ArrayList|HashMap|HashSet|ArrayDeque|LinkedList)|=\s*\[\]|=\s*\{\}|\bset\(\)|new\s+(Map|Set)\(|\.append\(|\.push\(|push_back|\.add\(/.test(t)) return { n: 1, log: 0, exp: false };
  return ONE;
}
