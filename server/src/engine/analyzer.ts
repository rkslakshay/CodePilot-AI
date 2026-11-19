/**
 * Offline (rule-based) code analysis used by the Code Explainer, Algorithm Studio and Debugger.
 * Combines line-level pattern recognition with structural analysis of the IR.
 */
import type { Expr, Func, Lang, Program, Stmt } from './ir.js';
import { LANG_LABEL } from './ir.js';
import { parseProgram } from './parser.js';
import { analyze as inferTypes } from './infer.js';
import { calleeName } from './parser.js';
import { walkStmts, walkExpr, childBlocks } from './walk.js';
import { pexpr } from './views.js';
import { analyzeSyntax, type SyntaxInfo } from './syntax.js';

export type Mode = 'beginner' | 'advanced';

export interface LineNote {
  line: number;
  code: string;
  kind: string;
  text: string;
}
export interface Issue {
  line: number | null;
  severity: 'error' | 'warning' | 'info';
  category: 'bug' | 'style' | 'performance' | 'safety';
  message: string;
  suggestion: string;
}
export interface Complexity {
  time: string;
  space: string;
  reasons: string[];
  /** high = recognised algorithm; medium = all loop bounds understood; low = some bounds unknown */
  confidence?: 'high' | 'medium' | 'low';
  pattern?: string | null;
}
export interface CodeAnalysis {
  language: Lang;
  parsed: boolean;
  parseError?: string;
  summary: string;
  overview: string[];
  lines: LineNote[];
  functions: { name: string; params: string; returns: string; line: number | null; description: string; recursive: boolean; kind?: string; className?: string | null; complexity?: { time: string; space: string; confidence: string; pattern: string | null } }[];
  classes: { name: string; line: number; base: string | null; methods: string[]; fields: string[] }[];
  calls: { from: string; to: string[] }[];
  syntaxErrors: { line: number; column: number; message: string }[];
  analysisEngine: string;
  variables: { name: string; type: string; scope: string }[];
  loops: { line: number | null; kind: string; description: string; depth: number }[];
  conditions: { line: number | null; condition: string; description: string }[];
  dataStructures: { name: string; kind: string; description: string }[];
  concepts: { name: string; description: string }[];
  complexity: Complexity;
  issues: Issue[];
  stats: { lines: number; codeLines: number; comments: number; functions: number };
}

// ------------------------------------------------------------------ english helpers
export function english(cond: string): string {
  return cond
    .replace(/\s*&&\s*|\s+and\s+/g, ' and ')
    .replace(/\s*\|\|\s*|\s+or\s+/g, ' or ')
    .replace(/!==|!=/g, ' is not equal to ')
    .replace(/===|==/g, ' equals ')
    .replace(/<=/g, ' is at most ')
    .replace(/>=/g, ' is at least ')
    .replace(/(?<![<-])<(?![<=])/g, ' is less than ')
    .replace(/(?<![>-])>(?![>=])/g, ' is greater than ')
    .replace(/\s%\s/g, ' mod ')
    .replace(/^!\s*|\bnot\s+/g, 'not ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const HEADER_INFO: Record<string, string> = {
  'stdio.h': 'standard input/output functions such as printf() and scanf()',
  'stdlib.h': 'general utilities such as malloc(), free(), abs() and rand()',
  'string.h': 'string functions such as strlen(), strcpy() and strcmp()',
  'math.h': 'mathematical functions such as sqrt() and pow()',
  'stdbool.h': 'the bool type with true/false',
  iostream: 'console input/output streams cin and cout',
  vector: 'the dynamic array container std::vector',
  string: 'the std::string class',
  algorithm: 'algorithms such as sort(), max(), min() and swap()',
  cmath: 'mathematical functions such as sqrt() and pow()',
  iomanip: 'output formatting helpers like setprecision()',
  'bits/stdc++.h': 'almost the whole C++ standard library (a GCC-specific shortcut)',
  map: 'the ordered key-value container std::map',
  unordered_map: 'the hash table container std::unordered_map',
  queue: 'std::queue and std::priority_queue',
  stack: 'the LIFO container std::stack',
};

const TYPE_WORDS: Record<string, string> = {
  int: 'integer', long: 'long integer', 'long long': '64-bit integer', float: 'floating-point', double: 'double-precision floating-point',
  char: 'character', bool: 'boolean', boolean: 'boolean', String: 'string', string: 'string', 'std::string': 'string', auto: 'automatically-typed',
  let: 'block-scoped', const: 'constant', var: 'function-scoped',
};

function cIOText(line: string, mode: Mode): string | null {
  if (/\bprintf\s*\(|\bputs\s*\(|\bcout\s*<<|System\.out\.print|console\.log|^print\s*\(|process\.stdout\.write/.test(line)) {
    const m = line.match(/"([^"]*)"/);
    const lit = m ? ` the text "${m[1].replace(/\\n/g, '↵').slice(0, 40)}"` : '';
    return mode === 'beginner'
      ? `Shows output on the screen${lit ? ':' + lit : ''}${/[,+<]{1,2}\s*\w/.test(line.replace(/"[^"]*"/g, '')) ? ' together with the values of the listed variables' : ''}.`
      : `Writes${lit || ' formatted output'} to standard output.`;
  }
  if (/\bscanf\s*\(|\bcin\s*>>|\.next(Int|Line|Double|Long)?\s*\(|\binput\s*\(|readFileSync\(0|getline\s*\(/.test(line)) {
    const vars = (line.match(/&?\b([a-zA-Z_]\w*)\b(?=\s*[,);]|\s*>>|\s*$)/g) || []).filter((v) => !['scanf', 'cin', 'input', 'int', 'float'].includes(v));
    return mode === 'beginner'
      ? `Waits for the user to type a value and stores it${vars.length ? ` in ${[...new Set(vars.map((v) => v.replace('&', '')))].slice(0, 3).join(', ')}` : ''}. When running in CodePilot, the value comes from the STDIN panel.`
      : `Reads from standard input${vars.length ? ` into ${[...new Set(vars.map((v) => v.replace('&', '')))].slice(0, 3).join(', ')}` : ''}.`;
  }
  return null;
}

// ------------------------------------------------------------------ line by line
export function explainLines(code: string, lang: Lang, mode: Mode): LineNote[] {
  const out: LineNote[] = [];
  const src = code.split(/\r?\n/);
  const py = lang === 'python';
  let inBlockComment = false;
  src.forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    const push = (kind: string, text: string) => out.push({ line: n, code: raw, kind, text });
    if (!line) return;
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      return push('comment', 'Part of a multi-line comment (ignored by the compiler).');
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true;
      return push('comment', 'Comment block — documentation for human readers, ignored when the program runs.');
    }
    if ((!py && line.startsWith('//')) || (py && line.startsWith('#'))) return push('comment', `Comment: "${line.replace(/^(\/\/|#)\s*/, '').slice(0, 80)}". Comments are ignored when the program runs.`);
    if (/^[{}]+;?$/.test(line)) return push('brace', line.includes('}') ? 'Closes the current block of code.' : 'Opens a new block of code.');
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^#\s*include\s*[<"]([^>"]+)[>"]/))) return push('include', `Includes the ${m[1]} header${HEADER_INFO[m[1]] ? `, which provides ${HEADER_INFO[m[1]]}` : ''}.`);
    if (/^#\s*define/.test(line)) return push('macro', 'Defines a preprocessor macro — the name is replaced by its value before compilation.');
    if (/^using\s+namespace\s+std/.test(line)) return push('namespace', mode === 'beginner' ? 'Lets the program write cout, cin, vector… without the std:: prefix.' : 'Brings the std namespace into scope (convenient, but avoid in headers).');
    if ((m = line.match(/^import\s+([\w.*]+)/)) && !py) return push('import', `Imports ${m[1]} so it can be used in this file.`);
    if ((m = line.match(/^(?:from\s+(\w+)\s+)?import\s+([\w, ]+)/)) && py) return push('import', `Imports ${m[1] ? `${m[2]} from the ${m[1]} module` : `the ${m[2]} module`}.`);
    if ((m = line.match(/^(?:public\s+)?(?:final\s+)?class\s+(\w+)/))) return push('class', lang === 'java' ? `Declares the class ${m[1]}. In Java all code lives inside a class.` : `Declares the class ${m[1]}.`);
    if (/public\s+static\s+void\s+main\s*\(/.test(line)) return push('function', mode === 'beginner' ? 'The main method — Java starts running the program here.' : 'Program entry point: public static void main(String[] args).');
    if (/^(int|void)\s+main\s*\(/.test(line)) return push('function', mode === 'beginner' ? 'The main function — every C/C++ program starts running here.' : 'Program entry point; returns an int exit status to the OS.');
    if (/^if\s+__name__\s*==\s*['"]__main__['"]/.test(line)) return push('entry', 'Runs the following block only when this file is executed directly (not when imported).');
    if ((m = line.match(/^def\s+(\w+)\s*\(([^)]*)\)/))) return push('function', `Defines a function named ${m[1]}${m[2].trim() ? ` that takes ${m[2].split(',').length} parameter(s): ${m[2]}` : ' with no parameters'}.`);
    if ((m = line.match(/^(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/))) return push('function', `Defines a function named ${m[1]}${m[2].trim() ? ` with parameter(s) ${m[2]}` : ''}.`);
    if (!py && (m = line.match(/^(?:(?:public|private|protected|static|final|inline)\s+)*([\w<>\[\]:*&]+(?:\s+[\w<>\[\]:*&]+)?)\s+(\w+)\s*\(([^;]*)\)\s*(?:throws\s+[\w, ]+)?\s*\{?$/)) && !/^(if|for|while|switch|return|else)\b/.test(line)) {
      const ret = m[1].replace(/^(static|public|private)\s+/, '');
      return push('function', `Defines the function ${m[2]}(${m[3]}) which ${ret === 'void' ? 'does not return a value' : `returns a ${TYPE_WORDS[ret] ?? ret} value`}.`);
    }
    if (/^for\b/.test(line)) {
      if ((m = line.match(/^for\s*\(\s*(?:[\w<>]+\s+)?(\w+)\s*=\s*([^;]+);\s*([^;]+);\s*([^)]+)\)/))) {
        return push('loop', mode === 'beginner'
          ? `A counting loop: ${m[1]} starts at ${m[2].trim()} and the body repeats while ${english(m[3].trim())}; after each repetition it runs ${m[4].trim()}.`
          : `for-loop over ${m[1]} ∈ [${m[2].trim()}, …) while ${m[3].trim()}, step ${m[4].trim()}.`);
      }
      if ((m = line.match(/^for\s*\(\s*(?:const|let|var|auto&?|[\w<>]+)\s+(\w+)\s*(?::|of)\s*([^)]+)\)/))) return push('loop', `Visits every element of ${m[2].trim()} one by one, calling the current element ${m[1]}.`);
      if ((m = line.match(/^for\s+(\w+)\s+in\s+range\(([^)]*)\)/))) {
        const a = m[2].split(',').map((x) => x.trim());
        const desc = a.length === 1 ? `0 up to ${a[0]} - 1` : `${a[0]} up to ${a[1]} - 1${a[2] ? ` in steps of ${a[2]}` : ''}`;
        return push('loop', mode === 'beginner' ? `Repeats the indented block with ${m[1]} taking the values ${desc}.` : `Iterates ${m[1]} over range(${m[2]}).`);
      }
      if ((m = line.match(/^for\s+(\w+(?:\s*,\s*\w+)?)\s+in\s+(.+):/))) return push('loop', `Repeats the indented block for every item in ${m[2]}, storing it in ${m[1]}.`);
      return push('loop', 'Starts a loop that repeats the following block.');
    }
    if ((m = line.match(/^while\s*\(?(.+?)\)?\s*[:{]?$/))) {
      if (/^(true|1|True)$/.test(m[1].trim())) return push('loop', 'An infinite loop — it only stops when a break or return is reached.');
      return push('loop', mode === 'beginner' ? `Keeps repeating the block as long as ${english(m[1])}.` : `while-loop guarded by (${m[1].trim()}).`);
    }
    if (/^do\b/.test(line)) return push('loop', 'Starts a do-while loop: the body runs once before the condition is checked.');
    if ((m = line.match(/^\}?\s*while\s*\((.+)\)\s*;/))) return push('loop', `Repeats the do-block again if ${english(m[1])}.`);
    if ((m = line.match(/^(?:\}\s*)?else\s+if\s*\(?(.+?)\)?\s*\{?$/)) || (m = line.match(/^elif\s+(.+):$/))) return push('condition', `Otherwise, checks whether ${english(m[1])}.`);
    if (/^(?:\}\s*)?else\b/.test(line)) return push('condition', 'Runs when none of the previous conditions were true.');
    if ((m = line.match(/^if\s*\(?(.+?)\)?\s*[:{]?$/))) return push('condition', mode === 'beginner' ? `Checks whether ${english(m[1])}. If so, the block below runs.` : `Branch on (${m[1].trim()}).`);
    if ((m = line.match(/^switch\s*\((.+)\)/))) return push('condition', `Chooses a branch based on the value of ${m[1]}.`);
    if ((m = line.match(/^case\s+(.+):/))) return push('condition', `Branch taken when the value equals ${m[1]}.`);
    if (/^default\s*:/.test(line)) return push('condition', 'Branch taken when no case matches.');
    if (/^break\b/.test(line)) return push('jump', 'Exits the nearest loop or switch immediately.');
    if (/^continue\b/.test(line)) return push('jump', 'Skips the rest of this loop iteration and continues with the next one.');
    if ((m = line.match(/^return\s*(.*?);?$/))) {
      if (/^0$/.test(m[1]) && out.some((o) => /main/.test(o.code) && o.kind === 'function') && lang !== 'python' && lang !== 'javascript') return push('return', 'Ends main and reports success (exit code 0) to the operating system.');
      return push('return', m[1] ? `Sends the value ${m[1]} back to the caller and leaves the function.` : 'Leaves the function.');
    }
    const io = cIOText(line, mode);
    if (io) return push(/scanf|cin|next|input|getline|readFile/.test(line) ? 'input' : 'output', io);
    if ((m = line.match(/^(?:const\s+|static\s+|final\s+)*(int|long long|long|float|double|char|bool|boolean|String|string|std::string|auto|let|const|var)\s+(\w+)\s*(\[[^\]]*\])?\s*(?:=\s*(.+?))?;?$/))) {
      const kind = TYPE_WORDS[m[1]] ?? m[1];
      if (m[3] || (m[4] && /^[\[{]|new\s+\w+\[/.test(m[4]))) return push('declaration', `Creates an array named ${m[2]}${m[3] && m[3] !== '[]' ? ` with ${m[3].slice(1, -1)} elements` : ''}${m[4] ? ` initialised to ${m[4].slice(0, 50)}` : ''}.`);
      return push('declaration', m[4]
        ? mode === 'beginner' ? `Creates a ${kind} variable called ${m[2]} and stores ${m[4].slice(0, 60)} in it.` : `Declares ${kind} ${m[2]} = ${m[4].slice(0, 60)}.`
        : `Declares a ${kind} variable ${m[2]} (no initial value yet).`);
    }
    if ((m = line.match(/^(?:vector|ArrayList|List)<.+?>\s+(\w+)/))) return push('declaration', `Creates a dynamic list ${m[1]} that can grow as elements are added.`);
    if ((m = line.match(/^Scanner\s+(\w+)/))) return push('input', `Creates a Scanner named ${m[1]} that reads input typed by the user.`);
    if ((m = line.match(/^([\w.\[\]]+)\s*(\+\+|--);?$/)) || (m = line.match(/^(\+\+|--)([\w.\[\]]+);?$/))) {
      const v = m[1].startsWith('+') || m[1].startsWith('-') ? m[2] : m[1];
      const inc = line.includes('++');
      return push('assignment', `${inc ? 'Increases' : 'Decreases'} ${v} by 1.`);
    }
    if ((m = line.match(/^([\w.\[\]]+)\s*([+\-*/%]|\/\/)=\s*(.+?);?$/))) {
      const verbs: Record<string, string> = { '+': 'Adds', '-': 'Subtracts', '*': 'Multiplies', '/': 'Divides', '%': 'Takes the remainder of', '//': 'Floor-divides' };
      return push('assignment', `${verbs[m[2]]} ${m[2] === '+' || m[2] === '-' ? `${m[3]} ${m[2] === '+' ? 'to' : 'from'} ${m[1]}` : `${m[1]} by ${m[3]}`} and stores the result back in ${m[1]}.`);
    }
    if ((m = line.match(/^([\w.]+(?:\[[^\]]+\])*)\s*,\s*([\w.]+(?:\[[^\]]+\])*)\s*=\s*(.+)$/)) && py) return push('assignment', `Assigns several values at once (tuple assignment): ${m[1]}, ${m[2]} = ${m[3]}.`);
    if ((m = line.match(/^([\w.]+(?:\[[^\]]+\])*)\s*=\s*(.+?);?$/))) return push('assignment', mode === 'beginner' ? `Stores the value of ${m[2].slice(0, 60)} in ${m[1]}.` : `Assigns ${m[1]} ← ${m[2].slice(0, 60)}.`);
    if ((m = line.match(/^([\w.]+)\s*\((.*)\)\s*;?$/))) return push('call', `Calls ${m[1]}(${m[2].slice(0, 40)})${/^[A-Z_]/.test(m[1]) ? '' : ''}.`);
    if (/^(public|private|protected|static)\b/.test(line)) return push('declaration', 'Declares a class member.');
    push('statement', 'Executes this statement.');
  });
  return out;
}

// ------------------------------------------------------------------ complexity
interface Cost {
  poly: number;
  log: number;
  exp: boolean;
}
const ONE: Cost = { poly: 0, log: 0, exp: false };
const mul = (a: Cost, b: Cost): Cost => ({ poly: a.poly + b.poly, log: a.log + b.log, exp: a.exp || b.exp });
const max = (a: Cost, b: Cost): Cost => {
  if (a.exp !== b.exp) return a.exp ? a : b;
  if (a.poly !== b.poly) return a.poly > b.poly ? a : b;
  return a.log >= b.log ? a : b;
};
export function fmtCost(c: Cost): string {
  if (c.exp) return 'O(2ⁿ)';
  if (c.poly === 0 && c.log === 0) return 'O(1)';
  const p = c.poly === 0 ? '' : c.poly === 0.5 ? '√n' : c.poly === 1.5 ? 'n√n' : c.poly === 1 ? 'n' : `n${['', '', '²', '³', '⁴'][c.poly] ?? '^' + c.poly}`;
  const l = c.log === 0 ? '' : c.log === 1 ? 'log n' : `log${c.log === 2 ? '²' : '^' + c.log} n`;
  return `O(${[p, l].filter(Boolean).join(' ')})`;
}

function isConst(e: Expr): boolean {
  if (e.k === 'num') return true;
  if (e.k === 'bin') return isConst(e.left) && isConst(e.right);
  return false;
}

function halving(body: Stmt[], cond?: Expr): boolean {
  let found = false;
  walkStmts(body, {
    expr: (e) => {
      if (e.k === 'assign' && ['/=', '>>=', '//=', '*='].includes(e.op) && e.value.k === 'num' && e.value.value >= 2) found = true;
      if (e.k === 'assign' && e.op === '=' && e.value.k === 'bin' && ['/', '//', '>>', '*'].includes(e.value.op) && e.value.right.k === 'num' && e.value.right.value >= 2 && e.target.k === 'id' && e.value.left.k === 'id' && e.value.left.name === e.target.name) found = true;
      // binary-search style: low = mid + 1 / high = mid - 1
      if (e.k === 'assign' && e.target.k === 'id' && /^(lo|low|left|l|hi|high|right|r|start|end)$/i.test(e.target.name) && e.value.k === 'bin' && e.value.left.k === 'id' && /mid/i.test(e.value.left.name)) found = true;
    },
  });
  if (cond && cond.k === 'bin' && cond.left.k === 'id' && /^(lo|low|left|l|start)$/i.test(cond.left.name) && found) return true;
  return found;
}

export function estimateComplexity(prog: Program): Complexity {
  const reasons: string[] = [];
  const funcs = new Map(prog.funcs.map((f) => [f.name, f]));
  const memo = new Map<string, Cost>();
  const space: { n: boolean; logRec: boolean; linRec: boolean } = { n: false, logRec: false, linRec: false };

  function recursion(f: Func): Cost | null {
    let calls = 0;
    let halves = false;
    let loopInside = false;
    walkStmts(f.body, {
      stmt: (s) => {
        if (['range', 'while', 'for', 'foreach'].includes(s.k)) loopInside = true;
      },
      expr: (e) => {
        if (e.k === 'call' && calleeName(e.callee) === f.name) {
          calls++;
          const txt = e.args.map(pexpr).join(' ');
          if (/\/\s*2|DIV 2|mid|>>\s*1/.test(txt)) halves = true;
        }
      },
    });
    if (!calls) return null;
    if (calls === 1) {
      if (halves) {
        space.logRec = true;
        reasons.push(`${f.name}() calls itself once on half of the input → logarithmic recursion depth.`);
        return { poly: 0, log: 1, exp: false };
      }
      space.linRec = true;
      reasons.push(`${f.name}() calls itself once per step, so the recursion depth grows linearly.`);
      return { poly: 1, log: 0, exp: false };
    }
    if (halves) {
      space.logRec = true;
      reasons.push(`${f.name}() splits the input in half and recurses on both halves${loopInside ? ' with a linear merge/partition step' : ''} → divide and conquer.`);
      return loopInside ? { poly: 1, log: 1, exp: false } : { poly: 1, log: 0, exp: false };
    }
    space.linRec = true;
    reasons.push(`${f.name}() makes ${calls} recursive calls per invocation without halving → exponential growth (consider memoization).`);
    return { poly: 0, log: 0, exp: true };
  }

  function blockCost(ss: Stmt[], stack: Set<string>): Cost {
    let c = ONE;
    for (const s of ss) c = max(c, stmtCost(s, stack));
    return c;
  }
  function exprCost(e: Expr | undefined, stack: Set<string>): Cost {
    let c = ONE;
    if (!e) return c;
    walkExpr(e, (x) => {
      if (x.k === 'call') {
        const name = calleeName(x.callee);
        const f = funcs.get(name);
        if (f && !stack.has(name)) c = max(c, fnCost(f, stack));
      }
      if (x.k === 'intr' && x.name === 'sum') c = max(c, { poly: 1, log: 0, exp: false });
      if (x.k === 'bin' && (x.op === 'in' || x.op === 'not in')) c = max(c, { poly: 1, log: 0, exp: false });
    });
    return c;
  }
  function stmtCost(s: Stmt, stack: Set<string>): Cost {
    let own: Cost = ONE;
    const exprs: Expr[] = [];
    if (s.k === 'decl' && s.init) {
      exprs.push(s.init);
      if (s.init.k === 'newarr' && !isConst(s.init.size)) space.n = true;
    }
    if (s.k === 'expr') {
      exprs.push(s.expr);
      if (s.expr.k === 'intr' && s.expr.name === 'push') space.n = true;
    }
    if (s.k === 'return' && s.value) exprs.push(s.value);
    if (s.k === 'print') s.parts.forEach((p) => p.expr && exprs.push(p.expr));
    if (s.k === 'if') exprs.push(s.cond);
    for (const e of exprs) own = max(own, exprCost(e, stack));
    switch (s.k) {
      case 'if':
        return max(own, [s.then, ...s.elifs.map((x) => x.body), s.else ?? []].reduce((a, b) => max(a, blockCost(b, stack)), ONE));
      case 'range': {
        const constant = isConst(s.start) && isConst(s.end);
        const iter: Cost = constant ? ONE : Math.abs(s.step) > 1 && false ? ONE : { poly: 1, log: 0, exp: false };
        return mul(iter, blockCost(s.body, stack));
      }
      case 'foreach':
        return mul({ poly: 1, log: 0, exp: false }, blockCost(s.body, stack));
      case 'while':
      case 'dowhile':
      case 'for': {
        const body = s.body;
        const cond = s.k === 'for' ? s.cond : s.cond;
        const log = halving(s.k === 'for' ? [...body, ...s.update.map((u) => ({ k: 'expr', expr: u }) as Stmt)] : body, cond);
        const constBound = cond && cond.k === 'bin' && isConst(cond.right) && !(cond.right.k === 'num' && cond.right.value > 1000);
        const sqrtBound = !!cond && cond.k === 'bin' && ['<', '<='].includes(cond.op) && cond.left.k === 'bin' && cond.left.op === '*' && pexpr(cond.left.left) === pexpr(cond.left.right);
        if (sqrtBound) reasons.push('The loop stops once i·i exceeds n, so it runs about √n times.');
        const iter: Cost = log ? { poly: 0, log: 1, exp: false } : sqrtBound ? { poly: 0.5, log: 0, exp: false } : constBound && s.k === 'for' ? ONE : { poly: 1, log: 0, exp: false };
        return mul(iter, blockCost(body, stack));
      }
      default:
        return own;
    }
  }
  function fnCost(f: Func, stack: Set<string>): Cost {
    if (memo.has(f.name)) return memo.get(f.name)!;
    const st = new Set(stack);
    st.add(f.name);
    const rec = recursion(f);
    let c = blockCost(f.body, st);
    if (rec) {
      if (rec.exp) c = rec;
      else if (rec.poly === 1 && rec.log === 1) c = rec; // divide & conquer already includes the merge loop
      else c = mul(rec, c.poly === 0 && c.log === 0 ? ONE : c);
    }
    memo.set(f.name, c);
    return c;
  }

  let total = blockCost(prog.main, new Set());
  if (!prog.main.length) for (const f of prog.funcs) total = max(total, fnCost(f, new Set()));
  else for (const f of prog.funcs) fnCost(f, new Set());

  // loop description reasons
  let maxDepth = 0;
  walkStmts([...prog.main, ...prog.funcs.flatMap((f) => f.body)], {
    stmt: (s, d) => {
      if (['range', 'while', 'for', 'foreach', 'dowhile'].includes(s.k)) maxDepth = Math.max(maxDepth, loopDepth(s));
      void d;
    },
  });
  if (maxDepth >= 2) reasons.push(`Loops are nested ${maxDepth} levels deep, so the work multiplies.`);
  else if (maxDepth === 1 && !reasons.length) reasons.push('A single loop visits the input once.');
  if (total.log && !reasons.some((r) => r.includes('half'))) reasons.push('The search range or counter is halved on each step, which gives a logarithmic factor.');
  if (!reasons.length) reasons.push('No loops or recursion depend on the input size, so running time is constant.');

  const spaceStr = space.n && (space.linRec || space.logRec) ? 'O(n)' : space.n ? 'O(n)' : space.linRec ? 'O(n)' : space.logRec ? 'O(log n)' : 'O(1)';
  const spaceReason = space.n ? 'Additional arrays/lists proportional to the input are allocated.' : space.linRec ? 'Recursion keeps up to n stack frames.' : space.logRec ? 'Recursion keeps O(log n) stack frames.' : 'Only a fixed number of scalar variables are used (input storage not counted).';
  reasons.push(spaceReason);
  return { time: fmtCost(total), space: spaceStr, reasons };
}

function loopDepth(s: Stmt): number {
  const isLoop = ['range', 'while', 'for', 'foreach', 'dowhile'].includes(s.k);
  let d = 0;
  for (const b of childBlocks(s)) for (const c of b) d = Math.max(d, loopDepth(c));
  return d + (isLoop ? 1 : 0);
}

// ------------------------------------------------------------------ issues (common mistakes)
export function findIssues(code: string, lang: Lang, prog?: Program | null): Issue[] {
  const issues: Issue[] = [];
  const lines = code.split(/\r?\n/);
  const cfam = lang !== 'python';
  const add = (line: number | null, severity: Issue['severity'], category: Issue['category'], message: string, suggestion: string) => {
    if (!issues.some((i) => i.line === line && i.message === message)) issues.push({ line, severity, category, message, suggestion });
  };
  // bracket balance
  const stripped = code.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""').replace(cfam ? /\/\/.*$|\/\*[\s\S]*?\*\//gm : /#.*$/gm, '');
  for (const [o, c, name] of [['{', '}', 'braces'], ['(', ')', 'parentheses'], ['[', ']', 'square brackets']] as const) {
    const diff = stripped.split(o).length - stripped.split(c).length;
    if (diff !== 0) add(null, 'error', 'bug', `Unbalanced ${name}: ${Math.abs(diff)} ${diff > 0 ? `missing '${c}'` : `extra '${c}'`}.`, `Check that every '${o}' has a matching '${c}'.`);
  }
  lines.forEach((raw, i) => {
    const n = i + 1;
    const l = raw.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(cfam ? /\/\/.*$/ : /#.*$/, '').trim();
    if (!l) return;
    if (cfam) {
      if (/^(if|while)\s*\(.*[^=!<>]=[^=].*\)/.test(l) && !/[=!<>]==?/.test(l.replace(/[^=!<>]=[^=]/, '')) && /\(\s*\w+\s*=\s*[^=]/.test(l))
        add(n, 'warning', 'bug', 'Assignment (=) used inside a condition.', 'Use == to compare values. An assignment makes the condition depend on the assigned value.');
      if (/^(if|for|while)\s*\(.*\)\s*;$/.test(l)) add(n, 'warning', 'bug', 'Semicolon directly after the condition makes the body empty.', 'Remove the ";" after the closing parenthesis.');
      if (/\bgets\s*\(/.test(l)) add(n, 'error', 'safety', 'gets() is unsafe and removed from modern C (buffer overflow).', 'Use fgets(buffer, size, stdin) instead.');
      if ((lang === 'c' || lang === 'cpp') && /scanf\s*\(\s*"[^"]*%[dfl]/.test(raw)) {
        const args = raw.slice(raw.indexOf('"', raw.indexOf('"') + 1) + 1).split(',').slice(1).map((a) => a.replace(/\).*$/, '').trim());
        if (args.some((a) => a && !a.startsWith('&') && !/\[/.test(a) && /^[A-Za-z_]\w*$/.test(a))) add(n, 'error', 'bug', 'scanf() needs the address of the variable (missing &).', 'Write &variable for int/float/char arguments, e.g. scanf("%d", &n).');
      }
      if (/^(while)\s*\(\s*(1|true)\s*\)/.test(l)) {
        const rest = lines.slice(i + 1, i + 40).join('\n');
        if (!/\b(break|return|exit)\b/.test(rest)) add(n, 'warning', 'bug', 'Infinite loop without break or return.', 'Add a condition that eventually becomes false or a break statement.');
      }
      if (lang === 'java' && /\w+\s*==\s*"|"\s*==\s*\w+/.test(raw)) add(n, 'warning', 'bug', 'Strings compared with == in Java compare references, not text.', 'Use a.equals(b) to compare string contents.');
      // possible missing semicolon
      const next = (lines[i + 1] ?? '').trim();
      if (/^(int|long|float|double|char|bool|boolean|String|string|auto|let|const|var|return\b)[^;{}]*[\w)\]"']$/.test(l) && !/^(return)\s*$/.test(l) && !/\)\s*$/.test(l.split('=')[0] + '') && !/^[.+\-*/&|?:]/.test(next) && !/^\w+\s+\w+\s*\([^)]*\)\s*$/.test(l))
        add(n, 'error', 'bug', 'Possible missing semicolon at the end of this statement.', 'Add ";" at the end of the line.');
      else if (/^[A-Za-z_][\w.\[\]]*\s*(=|\+=|-=|\*=|\/=|\+\+|--)[^;{}]*[\w)\]"']$/.test(l) && !/^[.+\-*/&|?:]/.test(next) && lang !== 'javascript')
        add(n, 'error', 'bug', 'Possible missing semicolon at the end of this statement.', 'Add ";" at the end of the line.');
      if (lang === 'c' && /strlen\s*\(/.test(l) && /^for\s*\(/.test(l)) add(n, 'info', 'performance', 'strlen() inside the loop condition is re-evaluated every iteration (O(n²)).', 'Store the length in a variable before the loop.');
    } else {
      if (/^(if|elif|else|for|while|def|class|try|except|finally|with)\b/.test(l) && !l.endsWith(':') && !/\\$/.test(l) && !/[(\[,]$/.test(l))
        add(n, 'error', 'bug', `Missing colon at the end of the '${l.split(/[\s(:]/)[0]}' line.`, 'Python blocks start with a colon, e.g. "if x > 0:".');
      if (/^print\s+[^(=]/.test(l)) add(n, 'error', 'bug', 'print is a function in Python 3.', 'Use print(...) with parentheses.');
      if (/^(if|while|elif)\s+.*[^=!<>]=[^=]/.test(l) && !/[=!<>]=/.test(l)) add(n, 'error', 'bug', 'Assignment (=) used inside a condition.', 'Use == to compare values.');
      if (/\t/.test(raw) && lines.some((x) => /^ +\S/.test(x))) add(n, 'warning', 'style', 'Mixed tabs and spaces in indentation.', 'Use 4 spaces for every indentation level.');
      if (/\.insert\(\s*0\s*,/.test(l)) add(n, 'info', 'performance', 'list.insert(0, x) shifts every element (O(n)).', 'Use collections.deque and appendleft() for frequent front insertions.');
    }
  });

  if (prog) {
    const an = (() => {
      try {
        return inferTypes(prog);
      } catch {
        return null;
      }
    })();
    const all = [...prog.main, ...prog.funcs.flatMap((f) => f.body)];
    // off-by-one: for (i = 0; i <= n; i++) arr[i]
    walkStmts(all, {
      stmt: (s) => {
        if (s.k === 'range' && s.step > 0 && s.end.k === 'bin' && s.end.op === '+' && s.end.right.k === 'num' && s.end.right.value === 1) {
          let indexes = false;
          walkStmts(s.body, { expr: (e) => e.k === 'idx' && e.index.k === 'id' && e.index.name === s.var && (indexes = true) });
          const bound = s.end.left;
          if (indexes && (bound.k === 'intr' && bound.name === 'len'))
            add(s.line ?? null, 'error', 'bug', `Loop runs while ${s.var} <= length, so the last iteration reads past the end of the array.`, `Use ${s.var} < length instead of <=.`);
          else if (indexes && bound.k === 'id' && /^(n|size|len|length|count)$/i.test(bound.name))
            add(s.line ?? null, 'warning', 'bug', `Loop condition uses <= ${bound.name} while indexing with ${s.var}; this may access one element past the end.`, `If the array has ${bound.name} elements, use ${s.var} < ${bound.name}.`);
        }
        if (s.k === 'decl' && an && (s.type.base === 'double') && s.init?.k === 'bin' && s.init.op === '/' && lang !== 'python' && lang !== 'javascript') {
          const locals = new Map([...an.main, ...[...an.funcs.values()].flatMap((f) => [...f.locals])]);
          const lt = locals.get(s.init.left.k === 'id' ? s.init.left.name : '');
          const rt = locals.get(s.init.right.k === 'id' ? s.init.right.name : '') ?? (s.init.right.k === 'num' && !s.init.right.float ? { base: 'int' } : undefined);
          if (lt?.base === 'int' && rt?.base === 'int') add(s.line ?? null, 'warning', 'bug', `Integer division: ${pexpr(s.init)} discards the fractional part before it is stored in a double.`, 'Cast one operand, e.g. (double) sum / n.');
        }
      },
    });
    // function level checks
    for (const f of prog.funcs) {
      const info = an?.funcs.get(f.name);
      if (info?.recursive) {
        let hasBase = false;
        walkStmts(f.body, { stmt: (s) => s.k === 'if' && (hasBase = true) });
        if (!hasBase) add(f.line ?? null, 'error', 'bug', `Recursive function ${f.name}() has no base case (no if-statement that stops the recursion).`, 'Add a condition that returns without recursing, e.g. if (n <= 1) return 1.');
        let calls = 0;
        walkStmts(f.body, { expr: (e) => e.k === 'call' && calleeName(e.callee) === f.name && calls++ });
        if (calls >= 2 && !/memo|cache|dp/i.test(code)) add(f.line ?? null, 'info', 'performance', `${f.name}() recomputes the same sub-problems (multiple recursive calls).`, 'Store already computed results (memoization) or use an iterative dynamic-programming loop.');
      }
      const ret = f.ret.base;
      if (cfam && lang !== 'javascript' && ret !== 'void' && ret !== 'unknown' && !alwaysReturns(f.body))
        add(f.line ?? null, 'warning', 'bug', `Function ${f.name}() may reach the end without returning a value.`, 'Make sure every path ends with a return statement.');
    }
    // nested loops hint
    walkStmts(all, {
      stmt: (s) => {
        if (['range', 'for', 'foreach', 'while'].includes(s.k) && loopDepth(s) >= 3) add(s.line ?? null, 'info', 'performance', 'Three or more nested loops — this grows very quickly (O(n³)).', 'Check whether sorting, hashing or prefix sums can remove a loop level.');
      },
    });
    // string concatenation in loop (Java)
    if (lang === 'java')
      walkStmts(all, {
        stmt: (s) => {
          if (['range', 'for', 'foreach', 'while'].includes(s.k)) {
            walkStmts(childBlocks(s).flat(), {
              expr: (e) => {
                if (e.k === 'assign' && (e.op === '+=' || (e.op === '=' && e.value.k === 'bin' && e.value.op === '+')) && an && e.target.k === 'id' && an.main.get(e.target.name)?.base === 'string')
                  add(s.line ?? null, 'info', 'performance', 'String concatenation inside a loop creates a new String every iteration.', 'Use a StringBuilder and append().');
              },
            });
          }
        },
      });
    // unused / uninitialised variables (C-family declared)
    const declared = new Map<string, number | undefined>();
    const usedNames = new Set<string>();
    walkStmts(all, {
      stmt: (s) => {
        if (s.k === 'decl') declared.set(s.name, s.line);
      },
      expr: (e) => {
        if (e.k === 'id') usedNames.add(e.name);
      },
    });
    for (const [name, line] of declared) if (!usedNames.has(name)) add(line ?? null, 'info', 'style', `Variable '${name}' is declared but never used.`, 'Remove it or use it.');
    for (const body of [prog.main, ...prog.funcs.map((f) => f.body)]) checkUninitialised(body, add, lang);
  }
  return issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

function alwaysReturns(body: Stmt[]): boolean {
  const last = body[body.length - 1];
  if (!last) return false;
  if (last.k === 'return') return true;
  if (last.k === 'raw') return true;
  if (last.k === 'if') return !!last.else && alwaysReturns(last.then) && last.elifs.every((e) => alwaysReturns(e.body)) && alwaysReturns(last.else);
  if (last.k === 'while' && last.cond.k === 'bool' && last.cond.value) return true;
  if (last.k === 'while' && last.cond.k === 'num' && last.cond.value === 1) return true;
  return false;
}

function checkUninitialised(body: Stmt[], add: (line: number | null, sev: Issue['severity'], cat: Issue['category'], m: string, s: string) => void, lang: Lang) {
  if (lang === 'python' || lang === 'javascript') return;
  const uninit = new Set<string>();
  for (const s of body) {
    if (s.k === 'decl' && !s.init && s.type.dims === 0) uninit.add(s.name);
    if (s.k === 'read') s.targets.forEach((t) => t.k === 'id' && uninit.delete(t.name));
    if (s.k === 'expr' && s.expr.k === 'assign' && s.expr.target.k === 'id') {
      if (s.expr.op !== '=' && uninit.has(s.expr.target.name))
        add(s.line ?? null, 'warning', 'bug', `'${s.expr.target.name}' is updated with ${s.expr.op} before it was given a starting value.`, `Initialise it when declaring, e.g. ${s.expr.target.name} = 0.`);
      uninit.delete(s.expr.target.name);
    }
    if (['range', 'for', 'while', 'foreach'].includes(s.k)) {
      walkStmts(childBlocks(s).flat(), {
        expr: (e) => {
          if (e.k === 'assign' && e.op !== '=' && e.target.k === 'id' && uninit.has(e.target.name)) {
            add(s.line ?? null, 'warning', 'bug', `'${e.target.name}' is accumulated inside a loop but never initialised.`, `Initialise it before the loop, e.g. ${e.target.name} = 0.`);
            uninit.delete(e.target.name);
          }
        },
      });
    }
  }
}

// ------------------------------------------------------------------ full analysis
export function analyzeCode(code: string, lang: Lang, mode: Mode = 'beginner'): CodeAnalysis {
  let prog: Program | null = null;
  let parseError: string | undefined;
  try {
    prog = parseProgram(code, lang);
  } catch (e) {
    parseError = (e as Error).message + ((e as any).line ? ` (line ${(e as any).line})` : '');
  }
  const lines = explainLines(code, lang, mode);
  const srcLines = code.split(/\r?\n/);
  const res: CodeAnalysis = {
    language: lang,
    parsed: !!prog,
    parseError,
    summary: '',
    overview: [],
    lines,
    functions: [],
    variables: [],
    loops: [],
    conditions: [],
    dataStructures: [],
    concepts: [],
    complexity: { time: 'unknown', space: 'unknown', reasons: ['The code could not be parsed for structural analysis.'] },
    issues: [],
    classes: [],
    calls: [],
    syntaxErrors: [],
    analysisEngine: 'IR parser',
    stats: {
      lines: srcLines.length,
      codeLines: lines.filter((l) => l.kind !== 'comment' && l.kind !== 'brace').length,
      comments: lines.filter((l) => l.kind === 'comment').length,
      functions: 0,
    },
  };
  const concepts = new Map<string, string>();
  const addConcept = (k: string, d: string) => concepts.set(k, d);

  if (prog) {
    let an: ReturnType<typeof inferTypes> | null = null;
    try {
      an = inferTypes(prog);
    } catch {
      an = null;
    }
    const tn = (t: { base: string; dims: number; dynamic?: boolean } | undefined) => (t ? `${t.base === 'unknown' ? 'value' : t.base}${t.dims ? (t.dynamic ? ' list' : ' array') + (t.dims > 1 ? ` (${t.dims}D)` : '') : ''}` : 'value');
    res.functions = prog.funcs.map((f) => {
      const info = an?.funcs.get(f.name);
      const params = f.params.map((p, i) => `${p.name}: ${tn(info?.params[i] ?? p.type)}`).join(', ');
      const returns = tn(info?.ret ?? f.ret);
      const bodyKinds = new Set<string>();
      walkStmts(f.body, { stmt: (s) => bodyKinds.add(s.k) });
      const what = [
        bodyKinds.has('range') || bodyKinds.has('for') || bodyKinds.has('while') || bodyKinds.has('foreach') ? 'loops over data' : '',
        bodyKinds.has('if') ? 'makes decisions' : '',
        bodyKinds.has('print') ? 'prints output' : '',
        info?.recursive ? 'calls itself recursively' : '',
      ].filter(Boolean);
      return {
        name: f.name,
        params,
        returns,
        line: f.line ?? null,
        recursive: !!info?.recursive,
        description: `${f.name}(${f.params.map((p) => p.name).join(', ')}) ${what.length ? what.join(', ') : 'performs a computation'} and ${returns === 'void' ? 'returns nothing' : `returns a ${returns}`}.`,
      };
    });
    res.stats.functions = res.functions.length + (prog.hasMain ? 1 : 0);
    if (an) {
      const seen = new Set<string>();
      const pushVars = (m: Map<string, any>, scope: string) => {
        for (const [k, t] of m) {
          if (k.startsWith('_')) continue;
          const key = scope + k;
          if (seen.has(key)) continue;
          seen.add(key);
          res.variables.push({ name: k, type: tn(t), scope });
        }
      };
      pushVars(an.globals, 'global');
      for (const [fname, info] of an.funcs) pushVars(info.locals, fname + '()');
      pushVars(an.main, prog.hasMain ? 'main' : 'script');
    }
    // loops & conditions
    const walkAll = (body: Stmt[], where: string) =>
      walkStmts(body, {
        stmt: (s, depth) => {
          const loopNesting = (() => depth)();
          switch (s.k) {
            case 'range':
              res.loops.push({ line: s.line ?? null, kind: 'counting for-loop', depth: loopNesting, description: `${s.var} goes from ${pexpr(s.start)} ${s.step > 0 ? 'up' : 'down'} to (but not including) ${pexpr(s.end)}${Math.abs(s.step) !== 1 ? ` in steps of ${Math.abs(s.step)}` : ''} in ${where}.` });
              addConcept('Loops', 'Repeat a block of code; a counting loop runs a known number of times.');
              break;
            case 'foreach':
              res.loops.push({ line: s.line ?? null, kind: 'for-each loop', depth: loopNesting, description: `Visits each element of ${pexpr(s.iter)} as ${s.var} in ${where}.` });
              addConcept('Iteration', 'Processing every element of a collection one at a time.');
              break;
            case 'while':
              res.loops.push({ line: s.line ?? null, kind: 'while loop', depth: loopNesting, description: `Repeats while ${english(pexpr(s.cond))} in ${where}.` });
              addConcept('Loops', 'Repeat a block of code while a condition holds.');
              break;
            case 'dowhile':
              res.loops.push({ line: s.line ?? null, kind: 'do-while loop', depth: loopNesting, description: `Runs at least once, then repeats while ${english(pexpr(s.cond))}.` });
              break;
            case 'for':
              res.loops.push({ line: s.line ?? null, kind: 'for loop', depth: loopNesting, description: `General for-loop with condition ${s.cond ? pexpr(s.cond) : 'none'} in ${where}.` });
              break;
            case 'if':
              res.conditions.push({ line: s.line ?? null, condition: pexpr(s.cond), description: `Checks whether ${english(pexpr(s.cond))}${s.elifs.length ? `, with ${s.elifs.length} additional else-if branch(es)` : ''}${s.else ? ' and an else branch' : ''}.` });
              addConcept('Conditionals', 'if/else statements choose which code runs based on a boolean condition.');
              break;
            case 'read':
              addConcept('Standard input', 'Reading values typed by the user (or supplied via STDIN).');
              break;
          }
        },
      });
    walkAll(prog.main, prog.hasMain ? 'main' : 'the script');
    for (const f of prog.funcs) walkAll(f.body, `${f.name}()`);
    // data structures
    const dsSeen = new Set<string>();
    for (const v of res.variables) {
      if (/array|list/.test(v.type) && !dsSeen.has(v.name)) {
        dsSeen.add(v.name);
        res.dataStructures.push({ name: v.name, kind: v.type.includes('list') ? 'Dynamic list' : v.type.includes('2D') ? '2D array (matrix)' : 'Array', description: v.type.includes('list') ? 'Grows as elements are appended; elements are accessed by index.' : 'Fixed-size sequence of elements stored contiguously, accessed by index in O(1).' });
      }
    }
    if (/\bstack\b|Stack<|push\(|\.pop\(\)/.test(code) && /stack/i.test(code)) res.dataStructures.push({ name: 'stack', kind: 'Stack', description: 'Last-in, first-out (LIFO) structure.' });
    if (/queue|deque|Queue</i.test(code)) res.dataStructures.push({ name: 'queue', kind: 'Queue', description: 'First-in, first-out (FIFO) structure.' });
    if (/HashMap|unordered_map|\bdict\b|\{\s*\}|new Map\(|map</.test(code)) res.dataStructures.push({ name: 'map', kind: 'Hash map / dictionary', description: 'Key → value lookup in O(1) average time.' });
    if (/struct\s+Node|class\s+Node|->next|\.next\b/.test(code)) res.dataStructures.push({ name: 'Node', kind: 'Linked structure', description: 'Nodes connected by references/pointers (linked list or tree).' });
    if (res.functions.some((f) => f.recursive)) addConcept('Recursion', 'A function that calls itself on a smaller input until it reaches a base case.');
    if (res.functions.length) addConcept('Functions', 'Named, reusable blocks of code with parameters and a return value.');
    if (res.dataStructures.some((d) => /Array|list/.test(d.kind))) addConcept('Arrays', 'Indexed collections of values (index starts at 0).');
    if (/\bmid\b/.test(code) && /(low|lo|left)/.test(code)) addConcept('Binary search', 'Repeatedly halves a sorted search range.');
    if (/swap|temp\s*=/.test(code)) addConcept('Swapping', 'Exchanging two values using a temporary variable.');
    if (/%\s*2\s*==\s*0|% 2 == 0/.test(code)) addConcept('Modulo arithmetic', 'x % 2 == 0 tests whether a number is even.');
    try {
      res.complexity = estimateComplexity(prog);
    } catch {
      /* keep default */
    }
  } else {
    addConcept('Syntax', 'The code currently has syntax the offline analyser could not parse; line explanations are still provided.');
  }
  res.issues = findIssues(code, lang, prog);
  // Tree-sitter structural analysis: accurate for the full language (classes, maps, lambdas...)
  let syn: SyntaxInfo | null = null;
  try {
    syn = analyzeSyntax(code, lang);
  } catch {
    syn = null;
  }
  if (syn) mergeSyntax(res, syn, prog);
  res.concepts = [...concepts].map(([name, description]) => ({ name, description }));
  // summary
  const parts: string[] = [];
  parts.push(`This ${LANG_LABEL[lang]} program has ${res.stats.codeLines} lines of code`);
  if (res.functions.length) parts.push(`defines ${res.functions.length} helper function${res.functions.length > 1 ? 's' : ''} (${res.functions.map((f) => f.name).join(', ')})`);
  if (res.loops.length) parts.push(`uses ${res.loops.length} loop${res.loops.length > 1 ? 's' : ''}`);
  if (res.conditions.length) parts.push(`makes ${res.conditions.length} decision${res.conditions.length > 1 ? 's' : ''}`);
  res.summary = parts.join(', ') + '.';
  const io = { input: lines.some((l) => l.kind === 'input'), output: lines.some((l) => l.kind === 'output') };
  res.overview = [
    io.input ? 'It reads input values from the user (standard input).' : 'It does not read any user input; all data is defined in the code.',
    ...res.functions.map((f) => f.description),
    io.output ? 'It prints its results to the console.' : 'It does not print anything.',
    `Estimated running time: ${res.complexity.time}; extra memory: ${res.complexity.space}.`,
  ];
  if (res.issues.length) res.overview.push(`${res.issues.length} potential issue${res.issues.length > 1 ? 's were' : ' was'} detected — see the Issues section.`);
  return res;
}


/** Prefer Tree-sitter results for structure and complexity; keep IR-inferred types where richer. */
function mergeSyntax(res: CodeAnalysis, syn: SyntaxInfo, prog: Program | null) {
  res.analysisEngine = prog ? 'Tree-sitter syntax tree + CodePilot IR' : 'Tree-sitter syntax tree';
  res.syntaxErrors = syn.errors;
  for (const e of syn.errors.slice(0, 5))
    if (!res.issues.some((i) => i.line === e.line && i.severity === 'error'))
      res.issues.unshift({ line: e.line, severity: 'error', category: 'bug', message: `Syntax error: ${e.message}.`, suggestion: 'Check for a missing semicolon, colon, bracket or quote on this line or the line above.' });
  res.issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
  res.classes = syn.classes;
  res.calls = syn.functions.map((f) => ({ from: f.name, to: f.calls.filter((c) => syn.functions.some((g) => g.name === c)) })).filter((c) => c.to.length);
  const irFns = new Map(res.functions.map((f) => [f.name, f]));
  const isCMain = (f: { name: string; className: string | null }) => f.name === 'main' && !f.className;
  res.functions = syn.functions
    .filter((f) => !isCMain(f) || syn.functions.length === 1)
    .map((f) => {
      const ir = irFns.get(f.name);
      const where = f.className ? `${f.kind === 'constructor' ? 'Constructor' : 'Method'} of class ${f.className}` : 'Function';
      return {
        name: f.className ? `${f.className}.${f.name}` : f.name,
        params: ir?.params ?? f.params.join(', '),
        returns: ir?.returns ?? '—',
        line: f.line,
        recursive: f.recursive,
        kind: f.kind,
        className: f.className,
        description: ir?.description ?? `${where} ${f.name}(${f.params.join(', ')})${f.recursive ? ', calls itself recursively' : ''}${f.calls.length ? `, calls ${f.calls.slice(0, 4).join(', ')}` : ''}.`,
        complexity: { time: f.complexity.time, space: f.complexity.space, confidence: f.complexity.confidence, pattern: f.complexity.pattern },
      };
    });
  // variables: keep IR (typed) entries, add the ones only Tree-sitter saw
  for (const v of syn.variables) {
    const scope = v.scope === 'global' ? (res.language === 'python' || res.language === 'javascript' ? 'script' : 'global') : v.scope === 'main' ? 'main' : `${v.scope}()`;
    if (res.variables.some((x) => x.name === v.name && (x.scope === scope || x.scope.startsWith(v.scope)))) continue;
    res.variables.push({ name: v.name, type: v.type ?? (v.kind === 'parameter' ? 'parameter' : 'value'), scope });
  }
  const boundText = { linear: 'runs about n times', log: 'the range halves/doubles each step (about log n iterations)', sqrt: 'stops at √n', constant: 'fixed number of iterations', unknown: 'iteration count could not be determined' } as const;
  res.loops = syn.loops.map((l) => ({
    line: l.line,
    kind: l.kind,
    depth: l.depth,
    description: `${l.header || l.kind} in ${l.scope === 'global' ? 'the script' : `${l.scope}()`}: ${boundText[l.bound]}${l.depth ? ` (nested ${l.depth} level${l.depth > 1 ? 's' : ''} deep)` : ''}.`,
  }));
  res.conditions = syn.conditionals
    .filter((c) => c.kind !== 'else')
    .map((c) => ({
      line: c.line,
      condition: c.condition,
      description: `${c.kind === 'switch' ? 'Chooses a branch based on' : c.kind === 'ternary' ? 'Inline choice depending on whether' : c.kind === 'else if' ? 'Otherwise checks whether' : 'Checks whether'} ${english(c.condition)}.`,
    }));
  const dsDesc: Record<string, string> = {
    array: 'Fixed-size indexed sequence; O(1) access by index.',
    '2D array': 'Grid / matrix of rows and columns.',
    list: 'Growable list; O(1) amortised append, O(1) index access.',
    map: 'Key → value lookup, O(1) average (hash) or O(log n) (tree).',
    set: 'Collection of unique values with fast membership tests.',
    stack: 'Last-in, first-out (LIFO).',
    queue: 'First-in, first-out (FIFO).',
    deque: 'Double-ended queue: O(1) at both ends.',
    heap: 'Priority queue: O(log n) insert / remove-min.',
    'string builder': 'Mutable string for efficient concatenation.',
    'linked node': 'Node of a linked list (value + next pointer).',
    'tree node': 'Node of a binary tree (value + left/right children).',
    'struct/object': 'User-defined type grouping related fields.',
  };
  const ds: { name: string; kind: string; description: string }[] = syn.dataStructures.map((d) => ({ name: d.name, kind: d.kind as string, description: `${dsDesc[d.kind] ?? ''} Detected from: ${d.evidence}`.trim() }));
  for (const d of res.dataStructures) if (!ds.some((x) => x.name === d.name)) ds.push(d);
  res.dataStructures = ds;
  if (syn.classes.length) res.concepts.unshift({ name: 'Classes & objects', description: 'Classes bundle data (fields) with behaviour (methods); objects are instances created from them.' });
  if (syn.dataStructures.some((d) => d.kind === 'map')) res.concepts.push({ name: 'Hashing', description: 'Maps/dictionaries find values by key in average O(1) time.' });
  res.complexity = { time: syn.complexity.time, space: syn.complexity.space, reasons: syn.complexity.reasons, confidence: syn.complexity.confidence, pattern: syn.complexity.pattern };
  res.stats.functions = syn.functions.length;
  const conf = res.complexity.confidence === 'high' ? 'high confidence' : res.complexity.confidence === 'medium' ? 'medium confidence' : 'low confidence, treat as a rough estimate';
  res.overview = res.overview.map((o) => (o.startsWith('Estimated running time') ? `Estimated running time: ${res.complexity.time}; extra memory: ${res.complexity.space} (${conf}).` : o));
  if (syn.classes.length) res.overview.unshift(`Defines ${syn.classes.length} class${syn.classes.length > 1 ? 'es' : ''}: ${syn.classes.map((c) => c.name).join(', ')}.`);
  if (syn.errors.length) res.overview.unshift(`The code contains ${syn.errors.length} syntax error${syn.errors.length > 1 ? 's' : ''} (first on line ${syn.errors[0].line}).`);
}
