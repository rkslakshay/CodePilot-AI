import type { BaseType, Expr, Func, Program, Stmt, TypeRef } from './ir.js';
import { calleeName } from './parser.js';
import { dynamicCollections } from './normalize.js';
import { walkExpr } from './walk.js';

export interface FuncInfo {
  params: TypeRef[];
  ret: TypeRef;
  locals: Map<string, TypeRef>;
  recursive: boolean;
}
export interface Analysis {
  lang: Program['lang'];
  funcs: Map<string, FuncInfo>;
  main: Map<string, TypeRef>;
  globals: Map<string, TypeRef>;
  dynamic: Set<string>;
  assumed: string[];
  /** field types per class */
  classes: Map<string, Map<string, TypeRef>>;
}

/** Key under which a method / constructor is stored in Analysis.funcs. */
export const methodKey = (cls: string, m: string) => `${cls}.${m}`;
export const CTOR = '__init__';
export const EXC_CLASS = '__exc__';

const RANK: Record<BaseType, number> = { unknown: 0, bool: 1, char: 2, int: 3, long: 4, double: 5, string: 6, void: 0, map: 7, set: 7, object: 7 };

export function mergeType(a: TypeRef | undefined, b: TypeRef | undefined): TypeRef {
  if (!a || a.base === 'unknown' && a.dims === 0) return b ? { ...b } : { base: 'unknown', dims: 0 };
  if (!b || (b.base === 'unknown' && b.dims === 0)) return { ...a };
  if (a.dims !== b.dims) return a.dims > b.dims ? { ...a } : { ...b };
  if (a.base === 'unknown') return { ...b, dynamic: a.dynamic || b.dynamic };
  if (b.base === 'unknown') return { ...a, dynamic: a.dynamic || b.dynamic };
  if ((a.base === 'map' || a.base === 'set') && a.base === b.base) return { ...a, key: a.base === 'map' ? mergeType(a.key, b.key) : undefined, val: mergeType(a.val, b.val), dynamic: a.dynamic || b.dynamic };
  if (a.base === 'object') return { ...a, cls: a.cls ?? b.cls };
  const numeric = (t: BaseType) => t === 'int' || t === 'long' || t === 'double' || t === 'char' || t === 'bool';
  if (numeric(a.base) && numeric(b.base)) return { base: RANK[a.base] >= RANK[b.base] ? a.base : b.base, dims: a.dims, dynamic: a.dynamic || b.dynamic };
  return { ...a, dynamic: a.dynamic || b.dynamic };
}

export function analyze(prog: Program): Analysis {
  const an: Analysis = { lang: prog.lang, funcs: new Map(), main: new Map(), globals: new Map(), dynamic: new Set(), assumed: [], classes: new Map() };
  for (const c of prog.classes) an.classes.set(c.name, new Map(c.fields.map((f) => [f.name, { ...f.type }])));
  for (const c of prog.classes) for (const f of c.fields) if (f.init) an.classes.get(c.name)!.set(f.name, mergeType(an.classes.get(c.name)!.get(f.name), typeOf(f.init, an, new Map())));
  for (const s of prog.globals) if (s.k === 'decl') an.globals.set(s.name, s.type.base !== 'unknown' || s.type.dims ? s.type : typeOf(s.init, an, new Map()));
  const units = programUnits(prog);
  for (const u of units) {
    const locals = new Map(u.f.params.map((p) => [p.name, { ...p.type }] as [string, TypeRef]));
    if (u.cls) locals.set('this', { base: 'object', dims: 0, cls: u.cls });
    an.funcs.set(u.key, { params: u.f.params.map((p) => ({ ...p.type })), ret: { ...u.f.ret }, locals, recursive: false });
  }
  const all = [...prog.globals, ...prog.main, ...units.flatMap((u) => u.f.body)];
  an.dynamic = dynamicCollections(all);

  for (let iter = 0; iter < 5; iter++) {
    for (const u of units) inferBody(u.f.body, an, an.funcs.get(u.key)!.locals, u.f, u.key);
    inferBody(prog.main, an, an.main);
    // propagate param types back into func info
    for (const u of units) {
      const info = an.funcs.get(u.key)!;
      u.f.params.forEach((p, i) => {
        info.params[i] = mergeType(info.params[i], info.locals.get(p.name));
        info.locals.set(p.name, info.params[i]);
      });
    }
  }
  // dynamic flags + defaults
  const finalize = (m: Map<string, TypeRef>, where: string) => {
    for (const [k, t] of m) {
      if (an.dynamic.has(k) && t.dims > 0) t.dynamic = true;
      if (k === 'this') continue;
      if (t.base === 'unknown') {
        t.base = 'int';
        an.assumed.push(`${where}: type of '${k}' could not be inferred; assumed int${t.dims ? ' array' : ''}.`);
      }
      deepDefault(t, an, `${where} '${k}'`);
    }
  };
  finalize(an.globals, 'global');
  finalize(an.main, 'main');
  for (const [cname, fields] of an.classes) finalize(fields, `class ${cname}`);
  for (const u of units) {
    const f = u.f;
    const info = an.funcs.get(u.key)!;
    finalize(info.locals, u.key);
    info.params = f.params.map((p) => info.locals.get(p.name)!);
    if (info.ret.base === 'unknown' && info.ret.dims === 0) {
      const hasValueReturn = containsReturnValue(f.body);
      info.ret = hasValueReturn ? { base: 'int', dims: 0 } : { base: 'void', dims: 0 };
      if (hasValueReturn) an.assumed.push(`${u.key}: return type could not be inferred; assumed int.`);
    }
    deepDefault(info.ret, an, `${u.key} return`);
    let rec = false;
    walkBodyExprs(f.body, (e) => {
      if (e.k === 'call' && calleeName(e.callee) === f.name) rec = true;
    });
    info.recursive = rec;
  }
  return an;
}

export function programUnits(prog: Program): { key: string; f: Func; cls?: string }[] {
  return [
    ...prog.funcs.map((f) => ({ key: f.name, f })),
    ...prog.classes.flatMap((c) => [...(c.ctor ? [{ key: methodKey(c.name, CTOR), f: c.ctor, cls: c.name }] : []), ...c.methods.map((m) => ({ key: methodKey(c.name, m.name), f: m, cls: c.name }))]),
  ];
}

/** Replace unknown element / key / value types with int (and record the assumption). */
function deepDefault(t: TypeRef, an: Analysis, where: string) {
  if (t.base === 'map') {
    if (!t.key || t.key.base === 'unknown') {
      t.key = { base: t.key?.base === 'unknown' || !t.key ? 'int' : t.key.base, dims: t.key?.dims ?? 0 };
      an.assumed.push(`${where}: map key type could not be inferred; assumed int.`);
    } else deepDefault(t.key, an, where);
    if (!t.val || t.val.base === 'unknown') {
      t.val = { base: 'int', dims: t.val?.dims ?? 0 };
      an.assumed.push(`${where}: map value type could not be inferred; assumed int.`);
    } else deepDefault(t.val, an, where);
  }
  if (t.base === 'set') {
    if (!t.val || t.val.base === 'unknown') {
      t.val = { base: 'int', dims: 0 };
      an.assumed.push(`${where}: set element type could not be inferred; assumed int.`);
    } else deepDefault(t.val, an, where);
  }
}

function containsReturnValue(body: Stmt[]): boolean {
  let found = false;
  const visit = (ss: Stmt[]) =>
    ss.forEach((s) => {
      if (s.k === 'return' && s.value) found = true;
      for (const b of blocks(s)) visit(b);
    });
  visit(body);
  return found;
}

function blocks(s: Stmt): Stmt[][] {
  switch (s.k) {
    case 'if':
      return [s.then, ...s.elifs.map((e) => e.body), ...(s.else ? [s.else] : [])];
    case 'while':
    case 'dowhile':
    case 'range':
    case 'foreach':
      return [s.body];
    case 'for':
      return [s.init, s.body];
    case 'try':
      return [s.body, ...s.catches.map((c) => c.body), ...(s.finally ? [s.finally] : [])];
    default:
      return [];
  }
}

function walkBodyExprs(body: Stmt[], fn: (e: Expr) => void) {
  const visitS = (s: Stmt) => {
    const exprs: Expr[] = [];
    if (s.k === 'decl' && s.init) exprs.push(s.init);
    if (s.k === 'expr') exprs.push(s.expr);
    if (s.k === 'if') exprs.push(s.cond, ...s.elifs.map((e) => e.cond));
    if (s.k === 'while' || s.k === 'dowhile') exprs.push(s.cond);
    if (s.k === 'range') exprs.push(s.start, s.end);
    if (s.k === 'for') {
      if (s.cond) exprs.push(s.cond);
      exprs.push(...s.update);
    }
    if (s.k === 'foreach') exprs.push(s.iter);
    if (s.k === 'return' && s.value) exprs.push(s.value);
    if (s.k === 'print') s.parts.forEach((p) => p.expr && exprs.push(p.expr));
    if (s.k === 'read') exprs.push(...s.targets);
    if (s.k === 'throw' && s.message) exprs.push(s.message);
    exprs.forEach((e) => walkExpr(e, fn));
    blocks(s).forEach((b) => b.forEach(visitS));
  };
  body.forEach(visitS);
}

function inferBody(body: Stmt[], an: Analysis, locals: Map<string, TypeRef>, fn?: Func, fnKey?: string) {
  const set = (name: string, t: TypeRef) => {
    if (!locals.has(name) && an.globals.has(name)) {
      an.globals.set(name, mergeType(an.globals.get(name), t));
      return;
    }
    locals.set(name, mergeType(locals.get(name), t));
  };
  const setField = (m: Extract<Expr, { k: 'mem' }>, t: TypeRef) => {
    const ot = typeOf(m.obj, an, locals);
    if (ot.base === 'object' && ot.cls && an.classes.has(ot.cls)) an.classes.get(ot.cls)!.set(m.prop, mergeType(an.classes.get(ot.cls)!.get(m.prop), t));
  };
  // constructor / method call sites type the parameters
  const site = (key: string, args: Expr[]) => {
    const info = an.funcs.get(key);
    if (!info) return;
    args.forEach((a, i) => {
      if (i >= info.params.length) return;
      const at = typeOf(a, an, locals);
      info.params[i] = mergeType(info.params[i], at);
      const target = [...info.locals.keys()].filter((k) => k !== 'this')[i];
      if (target) info.locals.set(target, mergeType(info.locals.get(target), at));
    });
  };
  const visitE = (e: Expr) =>
    walkExpr(e, (x) => {
      if (x.k === 'assign' && x.target.k === 'id') {
        // running products (factorial, power) overflow 32-bit quickly: widen to long
        const name = x.target.name;
        const isProduct = x.op === '*=' || (x.op === '=' && x.value.k === 'bin' && x.value.op === '*' && ((x.value.left.k === 'id' && x.value.left.name === name) || (x.value.right.k === 'id' && x.value.right.name === name)));
        if (isProduct && an.lang !== 'c' && an.lang !== 'cpp' && an.lang !== 'java') {
          const cur = lookup(name, an, locals);
          if (cur && cur.base === 'int' && cur.dims === 0) set(name, { base: 'long', dims: 0 });
        }
        const vt = typeOf(x.value, an, locals);
        if (x.op === '=' || !locals.has(x.target.name)) set(x.target.name, vt);
        else if (x.op === '/=' && an.lang === 'python') set(x.target.name, { base: 'double', dims: 0 });
        else if (x.op !== '=') set(x.target.name, mergeType(locals.get(x.target.name), vt.base === 'string' ? vt : { ...vt, dims: 0 }));
      }
      // field assignment: this.f = v / obj.f = v
      if (x.k === 'assign' && x.target.k === 'mem') {
        const ot = typeOf(x.target.obj, an, locals);
        if (ot.base === 'object' && ot.dims === 0 && ot.cls && an.classes.has(ot.cls)) {
          const fields = an.classes.get(ot.cls)!;
          const vt = typeOf(x.value, an, locals);
          fields.set(x.target.prop, mergeType(fields.get(x.target.prop), x.op === '=' ? vt : { ...vt, dims: 0 }));
        }
      }
      if (x.k === 'assign' && x.target.k === 'idx') {
        const obj = x.target.obj;
        const cur = typeOf(obj, an, locals);
        const vt = typeOf(x.value, an, locals);
        if (cur.base === 'map' && cur.dims === 0) {
          const refined: TypeRef = { ...cur, key: mergeType(cur.key, typeOf(x.target.index, an, locals)), val: x.op === '=' ? mergeType(cur.val, vt) : cur.val };
          if (obj.k === 'id') set(obj.name, refined);
          else if (obj.k === 'mem') setField(obj, refined);
        } else if (obj.k === 'id' && cur.base === 'unknown' && lookup(obj.name, an, locals)) set(obj.name, { base: vt.base, dims: Math.max(1, cur.dims), cls: vt.cls });
      }
      if (x.k === 'intr' && x.orig && typeOf(x.args[0], an, locals).base === 'object') {
        // user method that happens to share a library name (e.g. Stack.push)
        const ot = typeOf(x.args[0], an, locals);
        if (ot.cls) site(methodKey(ot.cls, x.orig), x.args.slice(1));
        return;
      }
      if (x.k === 'intr' && x.name === 'push' && (x.args[0]?.k === 'id' || x.args[0]?.k === 'mem')) {
        const vt = typeOf(x.args[1], an, locals);
        const cur = typeOf(x.args[0], an, locals);
        const t: TypeRef = cur.base === 'set' && cur.dims === 0 ? { ...cur, val: mergeType(cur.val, vt) } : { ...vt, dims: vt.dims + 1, dynamic: true };
        if (x.args[0].k === 'id') set(x.args[0].name, t);
        else setField(x.args[0], t);
      }
      if (x.k === 'new') site(methodKey(x.cls, CTOR), x.args);
      if (x.k === 'call' && x.callee.k === 'mem') {
        const ot = typeOf(x.callee.obj, an, locals);
        if (ot.base === 'object' && ot.cls) site(methodKey(ot.cls, x.callee.prop), x.args);
      }
      if (x.k === 'call') {
        const name = calleeName(x.callee);
        const info = x.callee.k === 'id' ? an.funcs.get(name) : undefined;
        if (info) {
          x.args.forEach((a, i) => {
            if (i < info.params.length) {
              const at = typeOf(a, an, locals);
              info.params[i] = mergeType(info.params[i], at);
              const target = [...info.locals.keys()][i];
              if (target) info.locals.set(target, mergeType(info.locals.get(target), at));
            }
          });
        }
      }
    });
  const visit = (ss: Stmt[]) => {
    for (const s of ss) {
      switch (s.k) {
        case 'decl': {
          let t = s.type;
          if (t.base === 'unknown') {
            const it = s.init ? typeOf(s.init, an, locals) : { base: 'unknown' as BaseType, dims: 0 };
            t = mergeType({ ...t, base: 'unknown' }, it.dims >= t.dims ? it : { ...it, dims: t.dims });
          }
          set(s.name, t);
          if (s.init) visitE(s.init);
          break;
        }
        case 'range':
          set(s.var, mergeType(typeOf(s.start, an, locals), { base: 'int', dims: 0 }));
          visitE(s.start);
          visitE(s.end);
          visit(s.body);
          break;
        case 'foreach': {
          const it = typeOf(s.iter, an, locals);
          const el =
            s.varType ??
            (it.dims > 0
              ? { ...it, dims: it.dims - 1 }
              : it.base === 'map'
                ? { ...(it.key ?? { base: 'unknown' as BaseType, dims: 0 }) }
                : it.base === 'set'
                  ? { ...(it.val ?? { base: 'unknown' as BaseType, dims: 0 }) }
                  : it.base === 'string'
                    ? { base: 'char' as BaseType, dims: 0 }
                    : { base: 'unknown' as BaseType, dims: 0 });
          set(s.var, el);
          visitE(s.iter);
          visit(s.body);
          break;
        }
        case 'read':
          s.targets.forEach((t, i) => {
            const k = s.kinds[i] ?? 'word';
            if (t.k === 'id') {
              const cur = lookup(t.name, an, locals);
              if (!cur || cur.base === 'unknown') set(t.name, { base: k === 'int' ? 'int' : k === 'double' ? 'double' : 'string', dims: 0 });
            }
          });
          break;
        case 'return':
          if (s.value) {
            visitE(s.value);
            if (fn) {
              const info = an.funcs.get(fnKey ?? fn.name)!;
              if (fn.ret.base === 'unknown' && fn.ret.dims === 0) info.ret = mergeType(info.ret, typeOf(s.value, an, locals));
            }
          }
          break;
        case 'expr':
          visitE(s.expr);
          break;
        case 'if':
          visitE(s.cond);
          visit(s.then);
          s.elifs.forEach((e) => {
            visitE(e.cond);
            visit(e.body);
          });
          if (s.else) visit(s.else);
          break;
        case 'while':
        case 'dowhile':
          visitE(s.cond);
          visit(s.body);
          break;
        case 'for':
          visit(s.init);
          if (s.cond) visitE(s.cond);
          s.update.forEach(visitE);
          visit(s.body);
          break;
        case 'print':
          s.parts.forEach((p) => p.expr && visitE(p.expr));
          break;
        case 'try':
          visit(s.body);
          for (const c of s.catches) {
            if (c.var) set(c.var, { base: 'object', dims: 0, cls: EXC_CLASS });
            visit(c.body);
          }
          if (s.finally) visit(s.finally);
          break;
        case 'throw':
          if (s.message) visitE(s.message);
          break;
      }
    }
  };
  visit(body);
}

export function lookup(name: string, an: Analysis, locals: Map<string, TypeRef>): TypeRef | undefined {
  return locals.get(name) ?? an.globals.get(name);
}

export function typeOf(e: Expr | undefined, an: Analysis, locals: Map<string, TypeRef>): TypeRef {
  const U: TypeRef = { base: 'unknown', dims: 0 };
  if (!e) return U;
  const sc = (base: BaseType): TypeRef => ({ base, dims: 0 });
  switch (e.k) {
    case 'num':
      return e.float ? sc('double') : Math.abs(e.value) > 2147483647 ? sc('long') : sc('int');
    case 'str':
    case 'fstr':
      return sc('string');
    case 'char':
      return sc('char');
    case 'bool':
      return sc('bool');
    case 'null':
      return U;
    case 'id':
      return lookup(e.name, an, locals) ?? U;
    case 'bin': {
      if (['==', '!=', '<', '>', '<=', '>=', '&&', '||', 'in', 'not in', 'is', 'is not', 'instanceof'].includes(e.op)) return sc('bool');
      const l = typeOf(e.left, an, locals);
      const r = typeOf(e.right, an, locals);
      if (e.op === '+' && (l.base === 'string' || r.base === 'string') && l.dims === 0 && r.dims === 0) return sc('string');
      if (e.op === '/' && (an.lang === 'python' || an.lang === 'javascript')) return sc('double');
      if (e.op === '//') return mergeType(l, r).base === 'double' ? sc('double') : sc('int');
      if (['&', '|', '^', '<<', '>>', '>>>'].includes(e.op)) return mergeType(l, r).base === 'long' ? sc('long') : sc('int');
      if (l.base === 'char' && r.base === 'char') return sc('int');
      const m = mergeType({ ...l, dims: 0 }, { ...r, dims: 0 });
      if (m.base === 'char' || m.base === 'bool') return sc('int');
      return m;
    }
    case 'un':
      if (e.op === '!') return sc('bool');
      return typeOf(e.arg, an, locals);
    case 'upd':
      return typeOf(e.arg, an, locals);
    case 'assign':
      return typeOf(e.target, an, locals);
    case 'tern':
      return mergeType(typeOf(e.then, an, locals), typeOf(e.else, an, locals));
    case 'call': {
      if (e.callee.k === 'mem') {
        const ot = typeOf(e.callee.obj, an, locals);
        if (ot.base === 'object' && ot.cls) return an.funcs.get(methodKey(ot.cls, e.callee.prop))?.ret ?? U;
        return U;
      }
      const info = an.funcs.get(calleeName(e.callee));
      return info ? info.ret : U;
    }
    case 'this':
      return locals.get('this') ?? U;
    case 'new':
      return { base: 'object', dims: 0, cls: e.cls };
    case 'mem': {
      const ot = typeOf(e.obj, an, locals);
      if (ot.base === 'object' && ot.dims === 0 && ot.cls) return an.classes.get(ot.cls)?.get(e.prop) ?? U;
      return U;
    }
    case 'maplit': {
      let k: TypeRef = U;
      let v: TypeRef = U;
      for (const x of e.entries) {
        k = mergeType(k, typeOf(x.key, an, locals));
        v = mergeType(v, typeOf(x.value, an, locals));
      }
      return { base: 'map', dims: 0, key: k, val: v };
    }
    case 'setlit': {
      let v: TypeRef = U;
      for (const x of e.items) v = mergeType(v, typeOf(x, an, locals));
      return { base: 'set', dims: 0, val: v };
    }
    case 'slice':
      return typeOf(e.obj, an, locals);
    case 'intr': {
      const a0 = typeOf(e.args[0], an, locals);
      if (e.orig && a0.base === 'object' && a0.cls) return an.funcs.get(methodKey(a0.cls, e.orig))?.ret ?? U;
      switch (e.name) {
        case 'len':
          return sc('int');
        case 'abs':
          return a0;
        case 'max':
        case 'min':
          return mergeType(a0, typeOf(e.args[1], an, locals));
        case 'pow': {
          const a1 = typeOf(e.args[1], an, locals);
          if (an.lang === 'python' && a0.base === 'int' && a1.base === 'int') return sc('int');
          return sc('double');
        }
        case 'sqrt':
          return sc('double');
        case 'floor':
        case 'ceil':
          return sc('int');
        case 'tostr':
          return sc('string');
        case 'toint':
          return sc('int');
        case 'todouble':
          return sc('double');
        case 'sum':
          return { base: a0.base, dims: 0 };
        case 'pop':
          return { base: a0.base, dims: Math.max(0, a0.dims - 1) };
        case 'push':
          return sc('void');
        case 'has':
        case 'startswith':
        case 'endswith':
          return sc('bool');
        case 'getor':
        case 'popkey':
          return a0.base === 'map' ? { ...(a0.val ?? U) } : a0.dims > 0 ? { ...a0, dims: a0.dims - 1 } : U;
        case 'remove':
          return sc('void');
        case 'keys':
          return a0.base === 'map' && a0.key ? { ...a0.key, dims: a0.key.dims + 1, dynamic: true } : U;
        case 'values':
          return a0.base === 'map' && a0.val ? { ...a0.val, dims: a0.val.dims + 1, dynamic: true } : U;
        case 'sorted':
          if (a0.base === 'map' && a0.key) return { ...a0.key, dims: a0.key.dims + 1, dynamic: true };
          if (a0.base === 'set' && a0.val) return { ...a0.val, dims: a0.val.dims + 1, dynamic: true };
          return a0;
        case 'upper':
        case 'lower':
        case 'strip':
        case 'replace':
        case 'join':
        case 'errmsg':
          return sc('string');
        case 'find':
          return sc('int');
        case 'split':
          return { base: 'string', dims: 1, dynamic: true };
      }
      return U;
    }
    case 'idx': {
      const o = typeOf(e.obj, an, locals);
      if (o.dims > 0) return { ...o, dims: o.dims - 1, dynamic: o.dims - 1 > 0 ? o.dynamic : undefined };
      if (o.base === 'map') return { ...(o.val ?? U) };
      if (o.base === 'string') return sc('char');
      return U;
    }
    case 'arr': {
      let t: TypeRef = U;
      for (const it of e.items) t = mergeType(t, typeOf(it, an, locals));
      return { ...t, dims: t.dims + 1 };
    }
    case 'newarr': {
      let el = e.elem;
      if (el.base === 'unknown' && e.fill) el = typeOf(e.fill, an, locals);
      return { base: el.base, dims: el.dims + 1 };
    }
    case 'input':
      return sc(e.kind === 'int' ? 'int' : e.kind === 'double' ? 'double' : 'string');
    case 'cast':
      return e.to;
    default:
      return U;
  }
}
