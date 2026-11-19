import type { ClassDef, Expr, Func, PrintPart, Program, Stmt } from './ir.js';
import { mapExpr, mapStmts, walkStmts } from './walk.js';
import { argParts, calleeName, mergeText } from './parser.js';

const INTR_BY_NAME: Record<string, string> = {
  len: 'len', strlen: 'len',
  abs: 'abs', fabs: 'abs', 'Math.abs': 'abs', llabs: 'abs',
  max: 'max', 'Math.max': 'max', fmax: 'max',
  min: 'min', 'Math.min': 'min', fmin: 'min',
  pow: 'pow', 'Math.pow': 'pow', 'math.pow': 'pow',
  sqrt: 'sqrt', 'Math.sqrt': 'sqrt', 'math.sqrt': 'sqrt',
  floor: 'floor', 'Math.floor': 'floor', 'math.floor': 'floor',
  ceil: 'ceil', 'Math.ceil': 'ceil', 'math.ceil': 'ceil',
  str: 'tostr', String: 'tostr', to_string: 'tostr', 'String.valueOf': 'tostr', 'Integer.toString': 'tostr',
  parseInt: 'toint', 'Integer.parseInt': 'toint', atoi: 'toint', stoi: 'toint', Number: 'tonum',
  parseFloat: 'todouble', 'Double.parseDouble': 'todouble', atof: 'todouble', stod: 'todouble',
  swap: 'swap',
};

/** Rewrites language-specific library calls to canonical intrinsics and lowers input expressions. */
export function normalizeProgram(prog: Program): Program {
  const fe = (e: Expr): Expr => normExpr(e, prog);
  const fs = (s: Stmt): Stmt[] => normStmt(s);
  prog.globals = mapStmts(prog.globals, fe, fs);
  prog.main = mapStmts(prog.main, fe, fs);
  prog.funcs = prog.funcs.map((f) => ({ ...f, body: mapStmts(f.body, fe, fs) }));
  prog.classes = prog.classes.map((c) => normalizeClass(c, prog, fe, fs));
  promoteGlobals(prog);
  return prog;
}

/** Make member access explicit (self./this.), then normalise library calls inside methods. */
function normalizeClass(c: ClassDef, prog: Program, fe: (e: Expr) => Expr, fs: (s: Stmt) => Stmt[]): ClassDef {
  const fields = new Set(c.fields.map((f) => f.name));
  const methods = new Set(c.methods.map((m) => m.name));
  const all = [...(c.ctor ? [c.ctor] : []), ...c.methods];
  for (const m of all)
    walkStmts(m.body, {
      expr: (e) => {
        if (e.k === 'assign' && e.target.k === 'mem' && (e.target.obj.k === 'this' || (e.target.obj.k === 'id' && e.target.obj.name === ((m as Func & { selfName?: string }).selfName ?? '\0')))) fields.add(e.target.prop);
      },
    });
  const fix = (m: Func): Func => {
    const selfName = (m as Func & { selfName?: string }).selfName;
    const locals = new Set(m.params.map((p) => p.name));
    walkStmts(m.body, {
      stmt: (st) => {
        if (st.k === 'decl') locals.add(st.name);
        if (st.k === 'range' || st.k === 'foreach') locals.add(st.var);
        if (prog.lang === 'python' && st.k === 'expr' && st.expr.k === 'assign' && st.expr.target.k === 'id') locals.add(st.expr.target.name);
      },
    });
    const implicit = prog.lang === 'java' || prog.lang === 'cpp';
    const body = mapStmts(m.body, (e) => {
      if (selfName && e.k === 'id' && e.name === selfName) return { k: 'this' };
      if (implicit && e.k === 'id' && fields.has(e.name) && !locals.has(e.name)) return { k: 'mem', obj: { k: 'this' }, prop: e.name };
      if (implicit && e.k === 'call' && e.callee.k === 'id' && methods.has(e.callee.name)) return { ...e, callee: { k: 'mem', obj: { k: 'this' }, prop: e.callee.name } };
      return e;
    });
    return { ...m, body: mapStmts(body, fe, fs) };
  };
  const declared = new Set(c.fields.map((f) => f.name));
  const extra = [...fields].filter((f) => !declared.has(f)).map((name) => ({ name, type: { base: 'unknown' as const, dims: 0 } }));
  return {
    ...c,
    fields: [...c.fields.map((f) => ({ ...f, init: f.init ? mapExpr(f.init, fe) : undefined })), ...extra],
    ctor: c.ctor ? fix(c.ctor) : null,
    methods: c.methods.map(fix),
  };
}

/**
 * Script-style programs (Python / JavaScript) often define data at top level and read it inside
 * functions. Static targets need those names to be real globals, so simple top-level definitions
 * that functions reference (without assigning them) are moved into prog.globals.
 */
function promoteGlobals(prog: Program) {
  if (prog.lang !== 'python' && prog.lang !== 'javascript') return;
  const free = new Set<string>();
  for (const f of prog.funcs) {
    const local = new Set(f.params.map((p) => p.name));
    walkStmts(f.body, {
      stmt: (s) => {
        if (s.k === 'decl') local.add(s.name);
        if (s.k === 'expr' && s.expr.k === 'assign' && s.expr.target.k === 'id') local.add(s.expr.target.name);
        if (s.k === 'range' || s.k === 'foreach') local.add(s.var);
        if (s.k === 'read') s.targets.forEach((t) => t.k === 'id' && local.add(t.name));
      },
    });
    walkStmts(f.body, { expr: (e) => e.k === 'id' && !local.has(e.name) && free.add(e.name) });
  }
  if (!free.size) return;
  const keep: Stmt[] = [];
  const moved = new Set<string>();
  for (const s of prog.main) {
    let name: string | undefined;
    let init: Expr | undefined;
    if (s.k === 'expr' && s.expr.k === 'assign' && s.expr.op === '=' && s.expr.target.k === 'id') {
      name = s.expr.target.name;
      init = s.expr.value;
    } else if (s.k === 'decl') {
      name = s.name;
      init = s.init;
    }
    if (name && free.has(name) && !moved.has(name) && init && isLiteralish(init)) {
      moved.add(name);
      prog.globals.push({ k: 'decl', name, type: s.k === 'decl' ? s.type : { base: 'unknown', dims: 0 }, init, line: s.line });
      continue;
    }
    keep.push(s);
  }
  prog.main = keep;
}

function isLiteralish(e: Expr): boolean {
  if (e.k === 'num' || e.k === 'str' || e.k === 'bool' || e.k === 'char') return true;
  if (e.k === 'arr') return e.items.every(isLiteralish);
  if (e.k === 'newarr') return e.size.k === 'num' && (!e.fill || isLiteralish(e.fill));
  if (e.k === 'un') return isLiteralish(e.arg);
  if (e.k === 'bin') return isLiteralish(e.left) && isLiteralish(e.right);
  return false;
}

function normExpr(e: Expr, prog: Program): Expr {
  if (e.k === 'mem' && e.prop === 'length') return { k: 'intr', name: 'len', args: [e.obj] };
  if (e.k === 'mem' && e.prop === 'size' && prog.lang === 'javascript') return { k: 'intr', name: 'len', args: [e.obj] };
  if (e.k === 'mem' && e.prop === 'message' && prog.lang === 'javascript') return { k: 'intr', name: 'errmsg', args: [e.obj] };
  // C++: m.find(k) != m.end()  ->  has(m, k)
  if (e.k === 'bin' && (e.op === '!=' || e.op === '==') && e.left.k === 'call' && e.left.callee.k === 'mem' && e.left.callee.prop === 'find' && e.right.k === 'call' && e.right.callee.k === 'mem' && e.right.callee.prop === 'end') {
    const has: Expr = { k: 'intr', name: 'has', args: [e.left.callee.obj, e.left.args[0]] };
    return e.op === '!=' ? has : { k: 'un', op: '!', arg: has };
  }
  if (e.k === 'bin' && e.op === '/' && isSizeof(e.left) && isSizeof(e.right)) {
    const l = e.left as Extract<Expr, { k: 'call' }>;
    return { k: 'intr', name: 'len', args: [l.args[0]] };
  }
  // Python [0] * n
  if (e.k === 'bin' && e.op === '*' && e.left.k === 'arr' && e.left.items.length === 1 && prog.lang === 'python')
    return { k: 'newarr', elem: { base: 'unknown', dims: 0 }, size: e.right, fill: e.left.items[0] };
  // JS new Array(n).fill(x)
  if (e.k === 'call' && e.callee.k === 'mem' && e.callee.prop === 'fill' && e.callee.obj.k === 'newarr')
    return { ...e.callee.obj, fill: e.args[0] };
  if (e.k === 'call' && e.callee.k === 'intr' && e.callee.name === 'len' && e.args.length === 0) return e.callee; // s.length()
  if (e.k === 'call') {
    const name = calleeName(e.callee);
    if (name === 'input' && e.args.length <= 1) return { k: 'input', kind: 'line' };
    if (e.callee.k === 'id' && prog.classes.some((c) => c.name === name)) return { k: 'new', cls: name, args: e.args };
    if (name === 'dict' && e.args.length === 0) return { k: 'maplit', entries: [] };
    if (name === 'set' && e.args.length <= 1) return { k: 'setlit', items: e.args[0]?.k === 'arr' ? e.args[0].items : e.args[0]?.k === 'setlit' ? e.args[0].items : [] };
    if (name === 'sorted' && e.args.length === 1) return { k: 'intr', name: 'sorted', args: e.args };
    if (name === 'list' && e.args.length === 1 && e.args[0].k === 'intr' && ['keys', 'values', 'sorted'].includes(e.args[0].name)) return e.args[0];
    if (name === 'String.join' && e.args.length === 2) return { k: 'intr', name: 'join', args: [e.args[1], e.args[0]] };
    if ((name === 'int' || name === 'float') && e.args.length === 1) {
      const a = e.args[0];
      if (a.k === 'input') return { k: 'input', kind: name === 'int' ? 'int' : 'double' };
      if (name === 'int') return { k: 'intr', name: 'toint', args: [a] };
      return { k: 'intr', name: 'todouble', args: [a] };
    }
    if (e.callee.k === 'mem') {
      const r = normMethod(e as Extract<Expr, { k: 'call' }> & { callee: Extract<Expr, { k: 'mem' }> }, prog);
      if (r !== e) return r.k === 'intr' ? { ...r, orig: e.callee.prop } : r;
    }
  }
  return normRest(e, prog);
}

function normMethod(e: Extract<Expr, { k: 'call' }> & { callee: Extract<Expr, { k: 'mem' }> }, prog: Program): Expr {
  {
    {
      const obj = e.callee.obj;
      const prop = e.callee.prop;
      const objName = calleeName(obj);
      if (['nextInt', 'nextLong', 'nextDouble', 'next', 'nextLine'].includes(prop) && objName && !['Math'].includes(objName)) {
        const kind = prop === 'nextDouble' ? 'double' : prop === 'nextLine' ? 'line' : prop === 'next' ? 'word' : 'int';
        return { k: 'input', kind };
      }
      if (['length', 'size'].includes(prop) && e.args.length === 0) return { k: 'intr', name: 'len', args: [obj] };
      // maps / sets
      if (prop === 'put' && e.args.length === 2) return { k: 'assign', op: '=', target: { k: 'idx', obj, index: e.args[0] }, value: e.args[1] };
      if ((prop === 'containsKey' || prop === 'has' || prop === 'contains' || prop === 'includes' || (prop === 'count' && prog.lang === 'cpp')) && e.args.length === 1) return { k: 'intr', name: 'has', args: [obj, e.args[0]] };
      if ((prop === 'getOrDefault' || (prop === 'get' && prog.lang === 'python')) && e.args.length === 2) return { k: 'intr', name: 'getor', args: [obj, e.args[0], e.args[1]] };
      if ((prop === 'remove' || prop === 'delete' || prop === 'erase' || prop === 'discard') && e.args.length === 1) return { k: 'intr', name: 'remove', args: [obj, e.args[0]] };
      if (prop === 'pop' && e.args.length === 1 && prog.lang === 'python') return { k: 'intr', name: 'popkey', args: [obj, e.args[0]] };
      if ((prop === 'keySet' || prop === 'keys') && e.args.length === 0) return { k: 'intr', name: 'keys', args: [obj] };
      if (prop === 'values' && e.args.length === 0) return { k: 'intr', name: 'values', args: [obj] };
      if (prop === 'insert' && e.args.length === 1 && prog.lang === 'cpp') return { k: 'intr', name: 'push', args: [obj, e.args[0]] };
      // strings
      if ((prop === 'upper' || prop === 'toUpperCase') && e.args.length === 0) return { k: 'intr', name: 'upper', args: [obj] };
      if ((prop === 'lower' || prop === 'toLowerCase') && e.args.length === 0) return { k: 'intr', name: 'lower', args: [obj] };
      if ((prop === 'strip' || prop === 'trim') && e.args.length === 0) return { k: 'intr', name: 'strip', args: [obj] };
      if ((prop === 'replace' || prop === 'replaceAll') && e.args.length === 2) return { k: 'intr', name: 'replace', args: [obj, e.args[0], e.args[1]] };
      if ((prop === 'find' || prop === 'indexOf') && e.args.length === 1) return { k: 'intr', name: 'find', args: [obj, e.args[0]] };
      if ((prop === 'startswith' || prop === 'startsWith') && e.args.length === 1) return { k: 'intr', name: 'startswith', args: [obj, e.args[0]] };
      if ((prop === 'endswith' || prop === 'endsWith') && e.args.length === 1) return { k: 'intr', name: 'endswith', args: [obj, e.args[0]] };
      if (prop === 'split' && e.args.length <= 1) return { k: 'intr', name: 'split', args: [obj, ...e.args] };
      if (prop === 'join' && e.args.length === 1) return prog.lang === 'python' ? { k: 'intr', name: 'join', args: [e.args[0], obj] } : { k: 'intr', name: 'join', args: [obj, e.args[0]] };
      if ((prop === 'substring' || (prop === 'slice' && prog.lang === 'javascript')) && e.args.length >= 1 && e.args.length <= 2) return { k: 'slice', obj, start: e.args[0], end: e.args[1] };
      if (prop === 'substr' && e.args.length >= 1 && e.args.length <= 2 && prog.lang === 'cpp')
        return { k: 'slice', obj, start: e.args[0], end: e.args[1] ? { k: 'bin', op: '+', left: e.args[0], right: e.args[1] } : undefined };
      // exceptions
      if ((prop === 'getMessage' || prop === 'what') && e.args.length === 0) return { k: 'intr', name: 'errmsg', args: [obj] };
      if (['push_back', 'add', 'push', 'append'].includes(prop) && e.args.length === 1) return { k: 'intr', name: 'push', args: [obj, e.args[0]] };
      if (['pop_back', 'pop'].includes(prop) && e.args.length === 0) return { k: 'intr', name: 'pop', args: [obj] };
      if (['charAt', 'get', 'at'].includes(prop) && e.args.length === 1) return { k: 'idx', obj, index: e.args[0] };
      if (prop === 'set' && e.args.length === 2) return { k: 'assign', op: '=', target: { k: 'idx', obj, index: e.args[0] }, value: e.args[1] };
      if (prop === 'toString' && e.args.length === 0) return { k: 'intr', name: 'tostr', args: [obj] };
      if (prop === 'empty' || prop === 'isEmpty') return { k: 'bin', op: '==', left: { k: 'intr', name: 'len', args: [obj] }, right: { k: 'num', value: 0, raw: '0', float: false } };
    }
  }
  return e;
}

function normRest(e: Expr, prog: Program): Expr {
  void prog;
  if (e.k === 'call') {
    const name = calleeName(e.callee);
    if (name in INTR_BY_NAME) {
      const intr = INTR_BY_NAME[name];
      if ((intr === 'max' || intr === 'min') && e.args.length === 1) return e; // max(list) - not normalised
      if (intr === 'tonum') return { k: 'intr', name: 'todouble', args: e.args };
      return { k: 'intr', name: intr, args: e.args };
    }
    if (name === 'ord' && e.args.length === 1) return { k: 'cast', to: { base: 'int', dims: 0 }, arg: e.args[0] };
    if (name === 'chr' && e.args.length === 1) return { k: 'cast', to: { base: 'char', dims: 0 }, arg: e.args[0] };
    if (name === 'sum' && e.args.length === 1) return { k: 'intr', name: 'sum', args: e.args };
  }
  if (e.k === 'bin' && e.op === '**') return { k: 'intr', name: 'pow', args: [e.left, e.right] };
  return e;
}

function isSizeof(e: Expr) {
  return e.k === 'call' && e.callee.k === 'id' && e.callee.name === 'sizeof';
}

function normStmt(s: Stmt): Stmt[] {
  // x = input()  ->  read x
  if (s.k === 'expr' && s.expr.k === 'assign' && s.expr.op === '=' && s.expr.value.k === 'input')
    return [{ k: 'read', targets: [s.expr.target], kinds: [s.expr.value.kind], line: s.line }];
  if (s.k === 'decl' && s.init?.k === 'input') {
    const kind = s.init.kind;
    return [
      { ...s, init: undefined, type: s.type.base === 'unknown' ? { base: kind === 'int' ? 'int' : kind === 'double' ? 'double' : 'string', dims: 0 } : s.type },
      { k: 'read', targets: [{ k: 'id', name: s.name }], kinds: [kind], line: s.line },
    ];
  }
  if (s.k === 'expr' && s.expr.k === 'intr' && s.expr.name === 'swap' && s.expr.args.length === 2) {
    const [a, b] = s.expr.args;
    return [
      { k: 'expr', expr: { k: 'assign', op: '=', target: { k: 'id', name: '_tmp' }, value: a }, line: s.line },
      { k: 'expr', expr: { k: 'assign', op: '=', target: a, value: b }, line: s.line },
      { k: 'expr', expr: { k: 'assign', op: '=', target: b, value: { k: 'id', name: '_tmp' } }, line: s.line },
    ];
  }
  if (s.k === 'print') {
    // re-flatten string concatenation that normalisation may have exposed
    const fixed = (p: PrintPart): PrintPart =>
      p.expr && p.expr.k === 'call' && p.expr.callee.k === 'mem' && p.expr.callee.prop === 'toFixed' && p.expr.args[0]?.k === 'num'
        ? { expr: p.expr.callee.obj, precision: p.expr.args[0].value }
        : p;
    const parts = s.parts.map(fixed).flatMap((p) => (p.expr && p.expr.k === 'fstr' ? p.expr.parts : p.expr && p.expr.k === 'bin' && p.expr.op === '+' ? argParts(p.expr).map((x) => (x.expr && p.precision ? { ...x, precision: p.precision } : x)) : [p]));
    return [{ ...s, parts: mergeText(parts) }];
  }
  return [s];
}

/** Library operations that produce growable lists. */
const LIST_RESULTS = new Set(['split', 'keys', 'values', 'sorted']);

/** Names of variables that are used as growable collections (push / pop / list-returning operations). */
export function dynamicCollections(stmts: Stmt[]): Set<string> {
  const out = new Set<string>();
  walkStmts(stmts, {
    expr: (e) => {
      if (e.k === 'intr' && (e.name === 'push' || e.name === 'pop') && e.args[0]?.k === 'id') out.add(e.args[0].name);
      if (e.k === 'assign' && e.target.k === 'id' && e.value.k === 'intr' && LIST_RESULTS.has(e.value.name)) out.add(e.target.name);
    },
    stmt: (st) => {
      if (st.k === 'decl' && st.init?.k === 'intr' && LIST_RESULTS.has(st.init.name)) out.add(st.name);
    },
  });
  return out;
}
