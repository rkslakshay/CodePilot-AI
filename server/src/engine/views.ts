/**
 * Alternative views of a parsed program: structured pseudocode and Mermaid flowcharts.
 * Both are derived from the same IR as the converter (bidirectional transformation).
 */
import type { Expr, Func, PrintPart, Program, Stmt } from './ir.js';
import { calleeName } from './parser.js';

// ------------------------------------------------------------------ expressions
const OPS: Record<string, string> = {
  '&&': 'AND', '||': 'OR', '==': '=', '!=': '≠', '<=': '≤', '>=': '≥', '%': 'MOD', '//': 'DIV', 'in': 'IN', 'not in': 'NOT IN',
};

export function pexpr(e: Expr | undefined): string {
  if (!e) return '';
  switch (e.k) {
    case 'num':
      return e.raw;
    case 'str':
      return JSON.stringify(e.value);
    case 'char':
      return `'${e.value}'`;
    case 'bool':
      return e.value ? 'TRUE' : 'FALSE';
    case 'null':
      return 'NULL';
    case 'id':
      return e.name;
    case 'raw':
      return e.text;
    case 'bin':
      return `${wrap(e.left)} ${OPS[e.op] ?? e.op} ${wrap(e.right)}`;
    case 'un':
      return e.op === '!' ? `NOT ${wrap(e.arg)}` : `${e.op}${wrap(e.arg)}`;
    case 'upd':
      return `${pexpr(e.arg)} ← ${pexpr(e.arg)} ${e.op === '++' ? '+' : '-'} 1`;
    case 'assign':
      return e.op === '=' ? `${pexpr(e.target)} ← ${pexpr(e.value)}` : `${pexpr(e.target)} ← ${pexpr(e.target)} ${e.op.slice(0, -1)} ${wrap(e.value)}`;
    case 'tern':
      return `(${pexpr(e.then)} IF ${pexpr(e.cond)} ELSE ${pexpr(e.else)})`;
    case 'call':
      return `${calleeName(e.callee) || pexpr(e.callee)}(${e.args.map(pexpr).join(', ')})`;
    case 'intr': {
      const names: Record<string, string> = { len: 'length', push: 'append', pop: 'removeLast', tostr: 'toString', toint: 'toInteger', todouble: 'toReal' };
      return `${names[e.name] ?? e.name}(${e.args.map(pexpr).join(', ')})`;
    }
    case 'idx':
      return `${pexpr(e.obj)}[${pexpr(e.index)}]`;
    case 'mem':
      return `${pexpr(e.obj)}.${e.prop}`;
    case 'arr':
      return `[${e.items.map(pexpr).join(', ')}]`;
    case 'newarr':
      return `array of ${pexpr(e.size)} elements${e.fill ? ` (all ${pexpr(e.fill)})` : ''}`;
    case 'input':
      return 'input';
    case 'cast':
      return `${e.to.base}(${pexpr(e.arg)})`;
    case 'fstr':
      return partsText(e.parts);
    case 'this':
      return 'this';
    case 'new':
      return `new ${e.cls}(${e.args.map(pexpr).join(', ')})`;
    case 'maplit':
      return `map {${e.entries.map((x) => `${pexpr(x.key)}: ${pexpr(x.value)}`).join(', ')}}`;
    case 'setlit':
      return `set {${e.items.map(pexpr).join(', ')}}`;
    case 'slice':
      return `${pexpr(e.obj)}[${e.start ? pexpr(e.start) : ''}..${e.end ? pexpr(e.end) : ''})`;
  }
}

function wrap(e: Expr): string {
  return e.k === 'bin' || e.k === 'tern' ? `(${pexpr(e)})` : pexpr(e);
}

function partsText(parts: PrintPart[]): string {
  return parts.map((p) => (p.text !== undefined ? JSON.stringify(p.text) : pexpr(p.expr))).join(', ');
}

// ------------------------------------------------------------------ pseudocode
export function toPseudocode(prog: Program): string {
  const out: string[] = [];
  let ind = 0;
  const L = (s: string) => out.push('    '.repeat(ind) + s);
  const block = (ss: Stmt[]) => {
    ind++;
    ss.forEach(stmt);
    ind--;
  };
  function stmt(s: Stmt) {
    switch (s.k) {
      case 'comment':
        L(`// ${s.text}`);
        break;
      case 'raw':
        L(`// (not analysed) ${s.text.split('\n')[0]}`);
        break;
      case 'decl':
        if (s.init) L(`SET ${s.name} ← ${pexpr(s.init)}`);
        else L(`DECLARE ${s.name}${s.type.dims ? ' AS ARRAY' : ''}`);
        break;
      case 'expr':
        if (s.expr.k === 'assign' || s.expr.k === 'upd') L(`SET ${pexpr(s.expr)}`);
        else if (s.expr.k === 'intr' && s.expr.name === 'push') L(`APPEND ${pexpr(s.expr.args[1])} TO ${pexpr(s.expr.args[0])}`);
        else L(`CALL ${pexpr(s.expr)}`);
        break;
      case 'if':
        L(`IF ${pexpr(s.cond)} THEN`);
        block(s.then);
        s.elifs.forEach((e) => {
          L(`ELSE IF ${pexpr(e.cond)} THEN`);
          block(e.body);
        });
        if (s.else) {
          L('ELSE');
          block(s.else);
        }
        L('END IF');
        break;
      case 'while':
        L(`WHILE ${pexpr(s.cond)} DO`);
        block(s.body);
        L('END WHILE');
        break;
      case 'dowhile':
        L('REPEAT');
        block(s.body);
        L(`UNTIL NOT (${pexpr(s.cond)})`);
        break;
      case 'range': {
        const last = s.step > 0 ? lastOf(s.end, -1) : lastOf(s.end, 1);
        L(`FOR ${s.var} ← ${pexpr(s.start)} TO ${last}${Math.abs(s.step) !== 1 || s.step < 0 ? ` STEP ${s.step}` : ''} DO`);
        block(s.body);
        L('END FOR');
        break;
      }
      case 'for':
        s.init.forEach(stmt);
        L(`WHILE ${s.cond ? pexpr(s.cond) : 'TRUE'} DO`);
        ind++;
        s.body.forEach(stmt);
        s.update.forEach((u) => L(`SET ${pexpr(u)}`));
        ind--;
        L('END WHILE');
        break;
      case 'foreach':
        L(`FOR EACH ${s.var} IN ${pexpr(s.iter)} DO`);
        block(s.body);
        L('END FOR');
        break;
      case 'return':
        L(s.value ? `RETURN ${pexpr(s.value)}` : 'RETURN');
        break;
      case 'break':
        L('EXIT LOOP');
        break;
      case 'continue':
        L('CONTINUE');
        break;
      case 'print':
        L(`PRINT ${partsText(s.parts)}`);
        break;
      case 'read':
        L(`READ ${s.targets.map(pexpr).join(', ')}`);
        break;
      case 'try':
        L('TRY');
        block(s.body);
        for (const c of s.catches) {
          L(`ON ERROR ${c.kind}${c.var ? ` AS ${c.var}` : ''}`);
          block(c.body);
        }
        if (s.finally) {
          L('FINALLY');
          block(s.finally);
        }
        L('END TRY');
        break;
      case 'throw':
        L(`RAISE ${s.kind}${s.message ? `(${pexpr(s.message)})` : ''}`);
        break;
    }
  }
  for (const g of prog.globals) stmt(g);
  if (prog.globals.length) out.push('');
  for (const c of prog.classes) {
    L(`CLASS ${c.name}`);
    ind++;
    if (c.fields.length) L(`FIELDS ${c.fields.map((f) => f.name).join(', ')}`);
    for (const m of [...(c.ctor ? [c.ctor] : []), ...c.methods]) {
      L(`${m === c.ctor ? 'CONSTRUCTOR' : 'METHOD'} ${m === c.ctor ? c.name : m.name}(${m.params.map((p) => p.name).join(', ')})`);
      block(m.body);
      L(`END ${m === c.ctor ? 'CONSTRUCTOR' : 'METHOD'}`);
    }
    ind--;
    L('END CLASS');
    out.push('');
  }
  for (const f of prog.funcs) {
    L(`FUNCTION ${f.name}(${f.params.map((p) => p.name).join(', ')})`);
    block(f.body);
    L('END FUNCTION');
    out.push('');
  }
  if (prog.main.length) {
    L('BEGIN');
    block(prog.main);
    L('END');
  }
  return out.join('\n').trim();
}

function lastOf(end: Expr, k: number): string {
  if (end.k === 'num' && !end.float) return String(end.value + k);
  if (end.k === 'bin' && (end.op === '+' || end.op === '-') && end.right.k === 'num' && !end.right.float) {
    const off = (end.op === '+' ? end.right.value : -end.right.value) + k;
    if (off === 0) return pexpr(end.left);
    return `${pexpr(end.left)} ${off > 0 ? '+' : '-'} ${Math.abs(off)}`;
  }
  return `${pexpr(end)} ${k < 0 ? '-' : '+'} 1`;
}

// ------------------------------------------------------------------ flowchart
interface Exit {
  from: string;
  label?: string;
}
interface Built {
  entry: string | null;
  exits: Exit[];
}

export interface FlowchartOptions {
  /** 'main' or a function name */
  target?: string;
  maxNodes?: number;
}

/** Build a Mermaid flowchart for main (or a given function). */
export function toFlowchart(prog: Program, opts: FlowchartOptions = {}): { mermaid: string; targets: string[] } {
  const targets = [...(prog.main.length ? ['main'] : []), ...prog.funcs.map((f) => f.name)];
  const target = opts.target && targets.includes(opts.target) ? opts.target : targets[0] ?? 'main';
  const fn: Func | undefined = prog.funcs.find((f) => f.name === target);
  const body = target === 'main' ? prog.main : fn?.body ?? [];
  return { mermaid: buildFlow(body, target === 'main' ? 'Start' : `Start: ${target}(${fn?.params.map((p) => p.name).join(', ')})`, opts.maxNodes ?? 80), targets };
}

export function buildFlow(body: Stmt[], startLabel: string, maxNodes = 80): string {
  const lines: string[] = ['flowchart TD'];
  let n = 0;
  const id = () => `N${++n}`;
  const esc = (s: string) => s.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;').replace(/\n/g, '<br/>').slice(0, 120);
  const node = (shape: 'proc' | 'dec' | 'io' | 'term' | 'call', text: string) => {
    const i = id();
    const t = esc(text);
    const s = { proc: `${i}["${t}"]`, dec: `${i}{"${t}"}`, io: `${i}[/"${t}"/]`, term: `${i}(["${t}"])`, call: `${i}[["${t}"]]` }[shape];
    lines.push(`    ${s}`);
    if (shape === 'dec') classes.dec.push(i);
    if (shape === 'io') classes.io.push(i);
    if (shape === 'term') classes.term.push(i);
    return i;
  };
  const classes = { dec: [] as string[], io: [] as string[], term: [] as string[] };
  const edge = (a: string, b: string, label?: string) => lines.push(`    ${a} -->${label ? `|${esc(label)}|` : ''} ${b}`);
  const connect = (exits: Exit[], to: string) => exits.forEach((x) => edge(x.from, to, x.label));

  const start = node('term', startLabel);
  const end = node('term', 'End');
  let truncated = false;

  interface Ctx {
    breaks: Exit[];
    cont: string | null;
  }

  function seq(ss: Stmt[], ctx: Ctx): Built {
    let entry: string | null = null;
    let exits: Exit[] = [];
    let i = 0;
    while (i < ss.length) {
      if (n > maxNodes) {
        truncated = true;
        break;
      }
      // group consecutive simple statements into one process box
      const group: string[] = [];
      while (i < ss.length && isSimple(ss[i]) && group.length < 3) {
        const t = simpleText(ss[i]);
        if (t) group.push(t);
        i++;
      }
      let b: Built;
      if (group.length) {
        const nid = node('proc', group.join('\n'));
        b = { entry: nid, exits: [{ from: nid }] };
      } else if (i < ss.length) {
        b = one(ss[i], ctx);
        i++;
      } else break;
      if (!b.entry) continue;
      if (!entry) entry = b.entry;
      else connect(exits, b.entry);
      exits = b.exits;
    }
    return { entry, exits };
  }

  function one(s: Stmt, ctx: Ctx): Built {
    switch (s.k) {
      case 'print': {
        const i = node('io', `Output ${partsText(s.parts)}`);
        return { entry: i, exits: [{ from: i }] };
      }
      case 'read': {
        const i = node('io', `Input ${s.targets.map(pexpr).join(', ')}`);
        return { entry: i, exits: [{ from: i }] };
      }
      case 'return': {
        const i = node('proc', s.value ? `return ${pexpr(s.value)}` : 'return');
        edge(i, end);
        return { entry: i, exits: [] };
      }
      case 'break': {
        const i = node('proc', 'break');
        ctx.breaks.push({ from: i });
        return { entry: i, exits: [] };
      }
      case 'continue': {
        const i = node('proc', 'continue');
        if (ctx.cont) edge(i, ctx.cont);
        return { entry: i, exits: [] };
      }
      case 'if': {
        const d = node('dec', `${pexpr(s.cond)}?`);
        const t = seq(s.then, ctx);
        const exits: Exit[] = [];
        if (t.entry) {
          edge(d, t.entry, 'Yes');
          exits.push(...t.exits);
        } else exits.push({ from: d, label: 'Yes' });
        let elseFrom: Exit = { from: d, label: 'No' };
        for (const el of s.elifs) {
          const d2 = node('dec', `${pexpr(el.cond)}?`);
          edge(elseFrom.from, d2, elseFrom.label);
          const b = seq(el.body, ctx);
          if (b.entry) {
            edge(d2, b.entry, 'Yes');
            exits.push(...b.exits);
          } else exits.push({ from: d2, label: 'Yes' });
          elseFrom = { from: d2, label: 'No' };
        }
        if (s.else) {
          const e = seq(s.else, ctx);
          if (e.entry) {
            edge(elseFrom.from, e.entry, elseFrom.label);
            exits.push(...e.exits);
          } else exits.push(elseFrom);
        } else exits.push(elseFrom);
        return { entry: d, exits };
      }
      case 'while':
      case 'range':
      case 'foreach':
      case 'for': {
        let init: string | null = null;
        let cond: string;
        let update: string | null = null;
        if (s.k === 'while') cond = `${pexpr(s.cond)}?`;
        else if (s.k === 'foreach') cond = `More items in ${pexpr(s.iter)}?`;
        else if (s.k === 'range') {
          init = `${s.var} = ${pexpr(s.start)}`;
          cond = `${s.var} ${s.step > 0 ? '<' : '>'} ${pexpr(s.end)}?`;
          update = s.step === 1 ? `${s.var} = ${s.var} + 1` : s.step === -1 ? `${s.var} = ${s.var} - 1` : `${s.var} = ${s.var} + ${s.step}`;
        } else {
          init = s.init.map(simpleText).filter(Boolean).join('\n') || null;
          cond = `${s.cond ? pexpr(s.cond) : 'true'}?`;
          update = s.update.map(pexpr).join('\n') || null;
        }
        const initId = init ? node('proc', init) : null;
        const d = node('dec', cond);
        if (initId) edge(initId, d);
        const upd = update ? node('proc', update) : null;
        const inner: Ctx = { breaks: [], cont: upd ?? d };
        const prefix = s.k === 'foreach' ? node('proc', `${s.var} = next item`) : null;
        const b = seq(s.body, inner);
        const bodyEntry = prefix ?? b.entry;
        if (prefix && b.entry) edge(prefix, b.entry);
        const bodyExits = prefix && !b.entry ? [{ from: prefix }] : b.exits;
        if (bodyEntry) edge(d, bodyEntry, 'Yes');
        if (upd) {
          if (bodyEntry) connect(bodyExits, upd);
          else edge(d, upd, 'Yes');
          edge(upd, d);
        } else {
          if (bodyEntry) connect(bodyExits, d);
        }
        return { entry: initId ?? d, exits: [{ from: d, label: 'No' }, ...inner.breaks] };
      }
      case 'dowhile': {
        const inner: Ctx = { breaks: [], cont: null };
        const b = seq(s.body, inner);
        const d = node('dec', `${pexpr(s.cond)}?`);
        inner.cont = d;
        if (b.entry) {
          connect(b.exits, d);
          edge(d, b.entry, 'Yes');
        }
        return { entry: b.entry ?? d, exits: [{ from: d, label: 'No' }, ...inner.breaks] };
      }
      default: {
        const t = simpleText(s);
        const i = node(s.k === 'expr' && s.expr.k === 'call' ? 'call' : 'proc', t || s.k);
        return { entry: i, exits: [{ from: i }] };
      }
    }
  }

  const b = seq(body, { breaks: [], cont: null });
  if (b.entry) {
    edge(start, b.entry);
    connect(b.exits, end);
  } else edge(start, end);
  if (truncated) {
    const t = node('proc', '… flowchart truncated (program too large)');
    edge(t, end);
  }
  lines.push('    classDef dec fill:#2a2350,stroke:#8B7CFF,color:#F1F3F8');
  lines.push('    classDef io fill:#123a33,stroke:#35C9A5,color:#F1F3F8');
  lines.push('    classDef term fill:#1d2433,stroke:#929BAD,color:#F1F3F8');
  if (classes.dec.length) lines.push(`    class ${classes.dec.join(',')} dec`);
  if (classes.io.length) lines.push(`    class ${classes.io.join(',')} io`);
  lines.push(`    class ${classes.term.join(',')} term`);
  return lines.join('\n');
}

function isSimple(s: Stmt) {
  return s.k === 'decl' || (s.k === 'expr' && s.expr.k !== 'call') || s.k === 'comment';
}
function simpleText(s: Stmt): string {
  if (s.k === 'decl') return s.init ? `${s.name} = ${pexpr(s.init)}` : `declare ${s.name}`;
  if (s.k === 'expr') {
    const e = s.expr;
    if (e.k === 'assign') return e.op === '=' ? `${pexpr(e.target)} = ${pexpr(e.value)}` : `${pexpr(e.target)} ${e.op} ${pexpr(e.value)}`;
    if (e.k === 'upd') return `${pexpr(e.arg)}${e.op}`;
    if (e.k === 'intr' && e.name === 'push') return `append ${pexpr(e.args[1])} to ${pexpr(e.args[0])}`;
    return pexpr(e);
  }
  if (s.k === 'raw') return s.text.split('\n')[0];
  return '';
}
