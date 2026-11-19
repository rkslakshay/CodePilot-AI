import type { Expr, Stmt } from './ir.js';

export interface Visitor {
  expr?: (e: Expr) => void;
  stmt?: (s: Stmt, depth: number) => void;
}

/** Child statement lists of a statement. */
export function childBlocks(s: Stmt): Stmt[][] {
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

/** Direct expressions of a statement (not recursing into child blocks). */
export function stmtExprs(s: Stmt): Expr[] {
  switch (s.k) {
    case 'decl':
      return s.init ? [s.init] : [];
    case 'expr':
      return [s.expr];
    case 'if':
      return [s.cond, ...s.elifs.map((e) => e.cond)];
    case 'while':
    case 'dowhile':
      return [s.cond];
    case 'range':
      return [s.start, s.end];
    case 'for':
      return [...(s.cond ? [s.cond] : []), ...s.update];
    case 'foreach':
      return [s.iter];
    case 'return':
      return s.value ? [s.value] : [];
    case 'print':
      return s.parts.filter((p) => p.expr).map((p) => p.expr!);
    case 'read':
      return s.targets;
    case 'throw':
      return s.message ? [s.message] : [];
    default:
      return [];
  }
}

export function exprChildren(e: Expr): Expr[] {
  switch (e.k) {
    case 'bin':
      return [e.left, e.right];
    case 'un':
    case 'upd':
    case 'cast':
      return [e.arg];
    case 'assign':
      return [e.target, e.value];
    case 'tern':
      return [e.cond, e.then, e.else];
    case 'call':
      return [e.callee, ...e.args];
    case 'intr':
      return e.args;
    case 'idx':
      return [e.obj, e.index];
    case 'mem':
      return [e.obj];
    case 'arr':
      return e.items;
    case 'newarr':
      return [e.size, ...(e.fill ? [e.fill] : [])];
    case 'fstr':
      return e.parts.filter((p) => p.expr).map((p) => p.expr!);
    case 'maplit':
      return e.entries.flatMap((x) => [x.key, x.value]);
    case 'setlit':
      return e.items;
    case 'new':
      return e.args;
    case 'slice':
      return [e.obj, ...(e.start ? [e.start] : []), ...(e.end ? [e.end] : [])];
    default:
      return [];
  }
}

export function walkExpr(e: Expr, fn: (e: Expr) => void) {
  fn(e);
  for (const c of exprChildren(e)) walkExpr(c, fn);
}

export function walkStmts(stmts: Stmt[], v: Visitor, depth = 0) {
  for (const s of stmts) {
    v.stmt?.(s, depth);
    if (v.expr) for (const e of stmtExprs(s)) walkExpr(e, v.expr);
    for (const b of childBlocks(s)) walkStmts(b, v, depth + 1);
  }
}

/** Bottom-up expression transform. */
export function mapExpr(e: Expr, fn: (e: Expr) => Expr): Expr {
  let n: Expr;
  switch (e.k) {
    case 'bin':
      n = { ...e, left: mapExpr(e.left, fn), right: mapExpr(e.right, fn) };
      break;
    case 'un':
    case 'upd':
    case 'cast':
      n = { ...e, arg: mapExpr(e.arg, fn) } as Expr;
      break;
    case 'assign':
      n = { ...e, target: mapExpr(e.target, fn), value: mapExpr(e.value, fn) };
      break;
    case 'tern':
      n = { ...e, cond: mapExpr(e.cond, fn), then: mapExpr(e.then, fn), else: mapExpr(e.else, fn) };
      break;
    case 'call':
      n = { ...e, callee: mapExpr(e.callee, fn), args: e.args.map((a) => mapExpr(a, fn)) };
      break;
    case 'intr':
      n = { ...e, args: e.args.map((a) => mapExpr(a, fn)) };
      break;
    case 'idx':
      n = { ...e, obj: mapExpr(e.obj, fn), index: mapExpr(e.index, fn) };
      break;
    case 'mem':
      n = { ...e, obj: mapExpr(e.obj, fn) };
      break;
    case 'arr':
      n = { ...e, items: e.items.map((a) => mapExpr(a, fn)) };
      break;
    case 'newarr':
      n = { ...e, size: mapExpr(e.size, fn), fill: e.fill ? mapExpr(e.fill, fn) : undefined };
      break;
    case 'fstr':
      n = { ...e, parts: e.parts.map((p) => (p.expr ? { ...p, expr: mapExpr(p.expr, fn) } : p)) };
      break;
    case 'maplit':
      n = { ...e, entries: e.entries.map((x) => ({ key: mapExpr(x.key, fn), value: mapExpr(x.value, fn) })) };
      break;
    case 'setlit':
      n = { ...e, items: e.items.map((a) => mapExpr(a, fn)) };
      break;
    case 'new':
      n = { ...e, args: e.args.map((a) => mapExpr(a, fn)) };
      break;
    case 'slice':
      n = { ...e, obj: mapExpr(e.obj, fn), start: e.start ? mapExpr(e.start, fn) : undefined, end: e.end ? mapExpr(e.end, fn) : undefined };
      break;
    default:
      n = e;
  }
  return fn(n);
}

/** Map every expression in a statement list (recursively), allowing statement replacement. */
export function mapStmts(stmts: Stmt[], fe: (e: Expr) => Expr, fs?: (s: Stmt) => Stmt[]): Stmt[] {
  const out: Stmt[] = [];
  for (const s0 of stmts) {
    const m = (e: Expr) => mapExpr(e, fe);
    let s: Stmt;
    switch (s0.k) {
      case 'decl':
        s = { ...s0, init: s0.init ? m(s0.init) : undefined };
        break;
      case 'expr':
        s = { ...s0, expr: m(s0.expr) };
        break;
      case 'if':
        s = {
          ...s0,
          cond: m(s0.cond),
          then: mapStmts(s0.then, fe, fs),
          elifs: s0.elifs.map((x) => ({ cond: m(x.cond), body: mapStmts(x.body, fe, fs) })),
          else: s0.else ? mapStmts(s0.else, fe, fs) : undefined,
        };
        break;
      case 'while':
      case 'dowhile':
        s = { ...s0, cond: m(s0.cond), body: mapStmts(s0.body, fe, fs) };
        break;
      case 'range':
        s = { ...s0, start: m(s0.start), end: m(s0.end), body: mapStmts(s0.body, fe, fs) };
        break;
      case 'for':
        s = { ...s0, init: mapStmts(s0.init, fe, fs), cond: s0.cond ? m(s0.cond) : undefined, update: s0.update.map(m), body: mapStmts(s0.body, fe, fs) };
        break;
      case 'foreach':
        s = { ...s0, iter: m(s0.iter), body: mapStmts(s0.body, fe, fs) };
        break;
      case 'return':
        s = { ...s0, value: s0.value ? m(s0.value) : undefined };
        break;
      case 'print':
        s = { ...s0, parts: s0.parts.map((p) => (p.expr ? { ...p, expr: m(p.expr) } : p)) };
        break;
      case 'read':
        s = { ...s0, targets: s0.targets.map(m) };
        break;
      case 'try':
        s = { ...s0, body: mapStmts(s0.body, fe, fs), catches: s0.catches.map((c) => ({ ...c, body: mapStmts(c.body, fe, fs) })), finally: s0.finally ? mapStmts(s0.finally, fe, fs) : undefined };
        break;
      case 'throw':
        s = { ...s0, message: s0.message ? m(s0.message) : undefined };
        break;
      default:
        s = s0;
    }
    if (fs) out.push(...fs(s));
    else out.push(s);
  }
  return out;
}
