import type { BaseType, ClassDef, ExcKind, Expr, Func, Lang, PrintPart, Program, Stmt, TypeRef } from './ir.js';
import { LANG_LABEL } from './ir.js';
import { analyze, typeOf, methodKey, CTOR, EXC_CLASS, type Analysis } from './infer.js';
import { calleeName } from './parser.js';
import { walkStmts } from './walk.js';

export interface EmitResult {
  code: string;
  warnings: string[];
  notes: string[];
}

const STATIC: Lang[] = ['c', 'cpp', 'java'];
const NEEDS_DECL: Lang[] = ['c', 'cpp', 'java', 'javascript'];

// output precedence (higher binds tighter)
const PREC: Record<string, number> = {
  '||': 3, '&&': 4, '|': 5, '^': 6, '&': 7, '==': 8, '!=': 8, '===': 8, '!==': 8, '<': 9, '>': 9, '<=': 9, '>=': 9,
  '<<': 10, '>>': 10, '>>>': 10, '+': 11, '-': 11, '*': 12, '/': 12, '%': 12, '//': 12, '**': 14,
};

export function emitProgram(prog: Program, target: Lang): EmitResult {
  if ((target === 'java' || target === 'javascript') && prog.lang === 'python') prog = camelCaseNames(prog);
  const an = analyze(prog);
  const em = new Emitter(prog, an, target);
  return em.run();
}

class Emitter {
  out: string[] = [];
  ind = 0;
  warnings: string[] = [];
  notes: string[] = [];
  uses = new Set<string>();
  locals: Map<string, TypeRef> = new Map();
  scopes: Set<string>[] = [];
  arraySizes = new Map<string, string>();
  lenParams = new Map<string, number[]>(); // C target: function -> indices of array params needing _len
  curFunc: Func | null = null;
  /** class currently being emitted (methods / constructor) */
  curClass: ClassDef | null = null;
  /** JS: exception classes that need helper definitions */
  jsExc = new Set<ExcKind>();
  usesInput = false;
  src: Lang;
  className: string;

  constructor(private prog: Program, private an: Analysis, private t: Lang) {
    this.src = prog.lang;
    this.className = prog.className && /^[A-Z]/.test(prog.className) ? prog.className : 'Main';
    for (const w of prog.warnings) this.warn(w);
    for (const w of an.assumed) this.warn(w);
  }

  warn(w: string) {
    if (!this.warnings.includes(w)) this.warnings.push(w);
  }
  line(s = '') {
    this.out.push(s ? '    '.repeat(this.ind) + s : '');
  }
  semi() {
    return this.t === 'python' ? '' : ';';
  }
  declared(name: string) {
    return this.scopes.some((s) => s.has(name)) || this.an.globals.has(name) && this.scopes.length === 0;
  }
  declare(name: string) {
    this.scopes[this.scopes.length - 1]?.add(name);
  }
  needsDecl() {
    return NEEDS_DECL.includes(this.t) && !NEEDS_DECL.includes(this.src) || (this.src === 'javascript' && STATIC.includes(this.t)) || (this.src === 'python' && this.t === 'javascript');
  }

  run(): EmitResult {
    this.computeDynParams();
    // C target: decide which array params need explicit length parameters
    if (this.t === 'c') {
      for (const f of this.prog.funcs) {
        const info = this.an.funcs.get(f.name)!;
        const idx: number[] = [];
        f.params.forEach((p, i) => {
          if (info.params[i]?.dims > 0 && usesLenOf(f.body, p.name)) idx.push(i);
        });
        if (idx.length) this.lenParams.set(f.name, idx);
      }
    }
    const body: string[] = [];
    const swapOut = (fn: () => void) => {
      const saved = this.out;
      this.out = [];
      fn();
      const r = this.out;
      this.out = saved;
      return r;
    };

    // globals
    const globals = swapOut(() => {
      this.scopes = [new Set()];
      this.locals = new Map(this.an.globals);
      for (const s of this.prog.globals) {
        if (s.k === 'decl' && this.t === 'java') {
          this.line('static ' + this.declString(s.name, s.type.base === 'unknown' ? this.an.globals.get(s.name)! : s.type, s.init) + ';');
        } else this.stmt(s);
      }
    });

    const classes = this.prog.classes.map((c) => swapOut(() => this.emitClass(c)));
    const funcs = this.prog.funcs.map((f) => swapOut(() => this.func(f)));
    const main = swapOut(() => this.mainBody());

    if (this.prog.classes.length && (this.t === 'cpp' || this.t === 'c')) {
      for (const c of this.prog.classes) body.push(this.t === 'cpp' ? `class ${c.name};` : `typedef struct ${c.name} ${c.name};`);
      body.push('');
    }
    if (this.t === 'c' && this.prog.classes.length) {
      // struct definitions first, then prototypes of their functions
      for (const c of classes) body.push(...c.filter((l) => !l.startsWith('//FN')), '');
    }
    body.push(...globals);
    if (globals.length) body.push('');
    if (this.t !== 'c') for (const c of classes) body.push(...c, '');
    // prototypes for C/C++
    if ((this.t === 'c' || this.t === 'cpp') && this.prog.funcs.length > 1) {
      for (const f of this.prog.funcs) body.push(this.signature(f) + ';');
      body.push('');
    }
    if (this.t === 'c' && this.prog.classes.length) {
      for (const c of this.prog.classes) {
        body.push(`${c.name}* ${c.name}_new(${this.cParams(c.ctor, c.name)});`);
        for (const m of c.methods) body.push(`${this.ctype(this.an.funcs.get(methodKey(c.name, m.name))!.ret, 'ret')} ${c.name}_${m.name}(${[`${c.name}* self`, this.cParams(m, c.name)].filter(Boolean).join(', ')});`);
      }
      body.push('');
      for (const c of this.cClassFns) body.push(...c, '');
    }
    for (const f of funcs) body.push(...f, '');
    body.push(...main);
    if (this.t === 'java' && this.needScanner) body.unshift('static Scanner sc = new Scanner(System.in);', '');
    if (this.t === 'javascript' && this.jsExc.size) body.unshift(...[...this.jsExc].map((k) => `class ${k} extends Error {}`), '');

    const header = this.header();
    let code = [...header, ...body].join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
    if (this.t === 'java') {
      const imports = header.length ? header.join('\n') + '\n\n' : '';
      code = imports + `public class ${this.className} {\n` + body.map((l) => (l ? '    ' + l : l)).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n}\n';
    }
    return { code, warnings: this.warnings, notes: this.notes };
  }

  header(): string[] {
    const h: string[] = [];
    const u = this.uses;
    switch (this.t) {
      case 'c':
        h.push('#include <stdio.h>');
        if (u.has('stdlib')) h.push('#include <stdlib.h>');
        if (u.has('math')) h.push('#include <math.h>');
        if (u.has('string')) h.push('#include <string.h>');
        if (u.has('bool')) h.push('#include <stdbool.h>');
        h.push('');
        break;
      case 'cpp':
        h.push('#include <iostream>');
        if (u.has('vector')) h.push('#include <vector>');
        if (u.has('string')) h.push('#include <string>');
        if (u.has('math')) h.push('#include <cmath>');
        if (u.has('algorithm')) h.push('#include <algorithm>');
        if (u.has('iomanip')) h.push('#include <iomanip>');
        if (u.has('numeric')) h.push('#include <numeric>');
        if (u.has('map')) h.push('#include <map>');
        if (u.has('set')) h.push('#include <set>');
        if (u.has('stdexcept')) h.push('#include <stdexcept>');
        if (u.has('sstream')) h.push('#include <sstream>');
        if (u.has('cctype')) h.push('#include <cctype>');
        h.push('using namespace std;', '');
        break;
      case 'java':
        if (u.has('util')) h.push('import java.util.*;');
        if (u.has('stream')) h.push('import java.util.stream.*;');
        break;
      case 'python':
        if (u.has('math')) h.push('import math');
        if (this.usesInput) h.push('import sys', '', '_tokens = iter(sys.stdin.read().split())');
        if (h.length) h.push('');
        break;
      case 'javascript':
        if (this.usesInput) h.push("const _in = require('fs').readFileSync(0, 'utf8').split(/\\s+/).filter(Boolean);", 'let _p = 0;', '');
        break;
    }
    return h;
  }

  // ---------- types ----------
  ctype(t: TypeRef, ctx: 'decl' | 'param' | 'ret' = 'decl'): string {
    const b = t.base === 'unknown' ? 'int' : t.base;
    if (b === 'object' || b === 'map' || b === 'set') return this.ctypeRich(t);
    switch (this.t) {
      case 'c': {
        if (b === 'bool') this.uses.add('bool');
        const m: Record<string, string> = { int: 'int', long: 'long long', double: 'double', char: 'char', bool: 'bool', string: 'char*', void: 'void', unknown: 'int' };
        if (t.dims > 0 && ctx === 'ret') return m[b] + '*';
        return m[b];
      }
      case 'cpp': {
        const m: Record<string, string> = { int: 'int', long: 'long long', double: 'double', char: 'char', bool: 'bool', string: 'string', void: 'void', unknown: 'int' };
        if (b === 'string') this.uses.add('string');
        let s = m[b];
        for (let i = 0; i < t.dims; i++) {
          s = `vector<${s}>`;
          this.uses.add('vector');
        }
        return s;
      }
      case 'java': {
        const m: Record<string, string> = { int: 'int', long: 'long', double: 'double', char: 'char', bool: 'boolean', string: 'String', void: 'void', unknown: 'int' };
        const boxed: Record<string, string> = { int: 'Integer', long: 'Long', double: 'Double', char: 'Character', bool: 'Boolean', string: 'String', void: 'Void', unknown: 'Integer' };
        if (t.dims > 0 && t.dynamic) {
          this.uses.add('util');
          let s = boxed[b];
          for (let i = 0; i < t.dims; i++) s = `ArrayList<${s}>`;
          return s;
        }
        return m[b] + '[]'.repeat(t.dims);
      }
      default:
        return '';
    }
  }

  /** Types for objects, maps and sets (and arrays of them). */
  ctypeRich(t: TypeRef): string {
    const one = { ...t, dims: 0 };
    let base: string;
    if (t.base === 'object') {
      if (t.cls === EXC_CLASS) base = this.t === 'java' ? 'Exception' : 'exception';
      else base = this.t === 'cpp' || this.t === 'c' ? `${t.cls}*` : t.cls ?? 'Object';
    } else if (this.t === 'cpp') {
      this.uses.add(t.base === 'map' ? 'map' : 'set');
      base = t.base === 'map' ? `map<${this.ctype(one.key ?? { base: 'int', dims: 0 })}, ${this.ctype(one.val ?? { base: 'int', dims: 0 })}>` : `set<${this.ctype(one.val ?? { base: 'int', dims: 0 })}>`;
    } else if (this.t === 'java') {
      this.uses.add('util');
      base = t.base === 'map' ? `LinkedHashMap<${this.jbox(one.key)}, ${this.jbox(one.val)}>` : `LinkedHashSet<${this.jbox(one.val)}>`;
    } else {
      this.warn('C target: maps and sets have no standard C equivalent and were not converted. Choose C++ for these programs.');
      base = 'void*';
    }
    if (!t.dims) return base;
    if (this.t === 'cpp') {
      this.uses.add('vector');
      let s2 = base;
      for (let i = 0; i < t.dims; i++) s2 = `vector<${s2}>`;
      return s2;
    }
    if (this.t === 'java') {
      if (t.dynamic) {
        this.uses.add('util');
        let s2 = base;
        for (let i = 0; i < t.dims; i++) s2 = `ArrayList<${s2}>`;
        return s2;
      }
      return base + '[]'.repeat(t.dims);
    }
    return base;
  }

  /** Java boxed type name for generics. */
  jbox(t?: TypeRef): string {
    if (!t) return 'Integer';
    if (t.dims > 0 || t.base === 'map' || t.base === 'set' || t.base === 'object') return this.ctype(t.dims > 0 ? { ...t, dynamic: true } : t);
    return ({ int: 'Integer', long: 'Long', double: 'Double', char: 'Character', bool: 'Boolean', string: 'String', void: 'Void', unknown: 'Integer' } as Record<string, string>)[t.base] ?? 'Integer';
  }

  defaultValue(t: TypeRef): string {
    if (t.dims === 0 && t.base === 'object') return { python: 'None', c: 'NULL', cpp: 'nullptr', java: 'null', javascript: 'null' }[this.t];
    if (t.dims === 0 && t.base === 'map') return { python: '{}', c: 'NULL', cpp: '{}', java: 'new LinkedHashMap<>()', javascript: 'new Map()' }[this.t];
    if (t.dims === 0 && t.base === 'set') return { python: 'set()', c: 'NULL', cpp: '{}', java: 'new LinkedHashSet<>()', javascript: 'new Set()' }[this.t];
    if (t.dims > 0 && t.dynamic && this.t === 'java') return 'new ArrayList<>()';
    if (t.dims > 0) return this.t === 'python' || this.t === 'javascript' ? '[]' : this.t === 'java' ? 'null' : '{}';
    switch (t.base) {
      case 'double':
        return '0.0';
      case 'bool':
        return this.t === 'python' ? 'False' : 'false';
      case 'string':
        return '""';
      case 'char':
        return this.t === 'python' || this.t === 'javascript' ? '""' : "' '";
      default:
        return '0';
    }
  }

  /** Build a typed declaration string for static targets (without trailing semicolon). */
  declString(name: string, type: TypeRef, init?: Expr): string {
    const t = this.t;
    const ty = type.base === 'unknown' && init ? { ...typeOf(init, this.an, this.locals), dims: Math.max(type.dims, typeOf(init, this.an, this.locals).dims) } : type;
    if (t === 'c') {
      if (ty.base === 'string' && ty.dims === 0) {
        this.uses.add('string');
        if (!init) return `char ${name}[256]`;
        if (init.k === 'str') return `char ${name}[256] = ${this.ex(init)}`;
        this.warn(`C target: string variable '${name}' is copied with strcpy; check buffer sizes.`);
        this.pendingAfterDecl = `strcpy(${name}, ${this.ex(init)});`;
        return `char ${name}[256]`;
      }
      if (ty.dims > 0) {
        const base = this.ctype({ ...ty, dims: 0 });
        if (this.isDyn(name)) {
          this.arraySizes.set(name, `${name}_len`);
          this.warn(`C target: growable list '${name}' is emulated with a fixed array of 1000 elements and a length counter.`);
          const items = init?.k === 'arr' ? init.items : [];
          const lit = items.length ? ` = {${items.map((i) => this.ex(i)).join(', ')}}` : '';
          this.pendingAfterDecl = `int ${name}_len = ${items.length};`;
          return `${base} ${name}[1000]${lit}`;
        }
        if (init?.k === 'arr') {
          if (ty.dims === 2) {
            const inner = init.items[0]?.k === 'arr' ? init.items[0].items.length : 0;
            this.arraySizes.set(name, String(init.items.length));
            return `${base} ${name}[${init.items.length}][${inner}] = ${this.arrLit(init)}`;
          }
          this.arraySizes.set(name, String(init.items.length));
          return `${base} ${name}[] = ${this.arrLit(init)}`;
        }
        if (init?.k === 'newarr') {
          const size = this.ex(init.size);
          this.arraySizes.set(name, size);
          const fill = init.fill ? this.ex(init.fill) : null;
          if (init.size.k === 'num' && (!fill || fill === '0')) return `${base} ${name}[${size}]${fill === '0' ? ' = {0}' : ''}`;
          if (fill) this.pendingAfterDecl = `for (int _i = 0; _i < ${size}; _i++) ${name}[_i] = ${fill};`;
          return `${base} ${name}[${size}]`;
        }
        if (!init) {
          this.warn(`C target: array '${name}' had no known size; allocated 1000 elements.`);
          this.arraySizes.set(name, '1000');
          return `${base} ${name}[1000]`;
        }
        this.warn(`C target: array '${name}' is assigned from an expression; arrays cannot be copied in C.`);
        return `${base} *${name} = ${this.ex(init)}`;
      }
      return `${this.ctype(ty)} ${name}${init ? ' = ' + this.ex(init, 1, ty) : ''}`;
    }
    if (t === 'cpp') {
      const ct = this.ctype(ty);
      if (init?.k === 'newarr') {
        const fill = init.fill ? `, ${this.ex(init.fill)}` : '';
        return `${ct} ${name}(${this.ex(init.size)}${fill})`;
      }
      if (init?.k === 'arr') return `${ct} ${name} = ${this.arrLit(init)}`;
      return `${ct} ${name}${init ? ' = ' + this.ex(init, 1, ty) : ''}`;
    }
    if (t === 'java') {
      const dyn = ty.dims > 0 && (this.isDyn(name) || (init?.k === 'arr' && init.items.length === 0));
      const jt = this.ctype({ ...ty, dynamic: dyn });
      if (dyn) {
        this.uses.add('util');
        if (init?.k === 'arr' && init.items.length) return `${jt} ${name} = new ArrayList<>(Arrays.asList(${init.items.map((i) => this.ex(i)).join(', ')}))`;
        if (init?.k === 'newarr') {
          return `${jt} ${name} = new ArrayList<>(Collections.nCopies(${this.ex(init.size)}, ${init.fill ? this.ex(init.fill) : this.defaultValue({ ...ty, dims: 0 })}))`;
        }
        if (!init || init.k === 'arr') return `${jt} ${name} = new ArrayList<>()`;
      }
      if (init?.k === 'arr') return `${jt} ${name} = ${this.arrLit(init)}`;
      if (init?.k === 'newarr') {
        const base = this.ctype({ ...ty, dims: 0, dynamic: false });
        const decl = `${jt} ${name} = new ${base}[${this.ex(init.size)}]`;
        if (init.fill && !(init.fill.k === 'num' && init.fill.value === 0)) {
          this.uses.add('util');
          this.pendingAfterDecl = `Arrays.fill(${name}, ${this.ex(init.fill)});`;
        }
        return decl;
      }
      return `${jt} ${name}${init ? ' = ' + this.ex(init, 1, ty) : ''}`;
    }
    if (t === 'javascript') return `let ${name}${init ? ' = ' + this.ex(init) : ''}`;
    return `${name} = ${init ? this.ex(init) : this.defaultValue(ty)}`;
  }
  pendingAfterDecl: string | null = null;

  arrLit(e: Extract<Expr, { k: 'arr' }>): string {
    const items = e.items.map((i) => (i.k === 'arr' ? this.arrLit(i) : this.ex(i))).join(', ');
    if (this.t === 'python' || this.t === 'javascript') return `[${items}]`;
    return `{${items}}`;
  }

  // ---------- functions ----------
  signature(f: Func): string {
    const info = this.an.funcs.get(f.name)!;
    const ret = info.ret;
    const params = f.params.map((p, i) => {
      const pt = info.params[i];
      if (this.t === 'c') {
        if (pt.dims > 0) {
          const base = this.ctype({ ...pt, dims: 0 });
          const extra = this.lenParams.get(f.name)?.includes(i) ? `, int ${p.name}_len` : '';
          return `${base} ${p.name}[]${extra}`;
        }
        if (pt.base === 'string') return `char ${p.name}[]`;
        return `${this.ctype(pt, 'param')} ${p.name}`;
      }
      if (this.t === 'cpp') {
        const ct = this.ctype(pt, 'param');
        return pt.dims > 0 || pt.base === 'map' || pt.base === 'set' ? `${ct}& ${p.name}` : `${ct} ${p.name}`;
      }
      return `${this.ctype({ ...pt, dynamic: this.dynParams.get(f.name)?.has(p.name) ?? false }, 'param')} ${p.name}`;
    });
    if (this.t === 'c' && ret.dims > 0) this.warn(`C target: function '${f.name}' returns an array; returning arrays from C functions needs manual memory management.`);
    const pre = this.t === 'java' ? 'static ' : '';
    return `${pre}${this.ctype(ret, 'ret')} ${f.name}(${params.join(', ')})`;
  }

  /** C parameter list for a constructor / method (without self). */
  cParams(f: Func | null, cls: string): string {
    if (!f) return '';
    const info = this.an.funcs.get(methodKey(cls, f === this.prog.classes.find((c) => c.name === cls)?.ctor ? CTOR : f.name));
    return f.params.map((p, i) => `${this.ctype(info?.params[i] ?? p.type, 'param')} ${p.name}`).join(', ');
  }
  cClassFns: string[][] = [];

  /** Emit one method body with the right analysis context. */
  methodBody(c: ClassDef, f: Func, key: string, prologue: string[] = [], epilogue: string[] = []) {
    const info = this.an.funcs.get(key)!;
    const savedLocals = this.locals;
    this.curFunc = f;
    this.curClass = c;
    this.locals = info.locals;
    this.scopes = [new Set(f.params.map((p) => p.name))];
    this.ind++;
    for (const l of prologue) this.line(l);
    this.ind--;
    this.block(f.body, true);
    this.ind++;
    for (const l of epilogue) this.line(l);
    this.ind--;
    this.curFunc = null;
    this.curClass = null;
    this.locals = savedLocals;
  }

  emitClass(c: ClassDef) {
    const fields = this.an.classes.get(c.name) ?? new Map<string, TypeRef>();
    const t = this.t;
    const initOf = (name: string): string | null => {
      const f = c.fields.find((x) => x.name === name);
      if (f?.init) {
        const saved = this.locals;
        this.locals = new Map();
        const v = this.ex(f.init, 1, fields.get(name));
        this.locals = saved;
        return v;
      }
      return null;
    };
    const ctor = c.ctor ?? { name: CTOR, params: [], ret: { base: 'void', dims: 0 } as TypeRef, body: [] };
    const key = methodKey(c.name, CTOR);
    if (!this.an.funcs.get(key)) this.an.funcs.set(key, { params: [], ret: { base: 'void', dims: 0 }, locals: new Map([['this', { base: 'object', dims: 0, cls: c.name }]]), recursive: false });
    const sig = (f: Func, k: string) => {
      const info = this.an.funcs.get(k)!;
      return f.params.map((p, i) => {
        const pt = info.params[i] ?? p.type;
        if (t === 'cpp') return pt.dims > 0 || pt.base === 'map' || pt.base === 'set' ? `${this.ctype(pt, 'param')}& ${p.name}` : `${this.ctype(pt, 'param')} ${p.name}`;
        if (t === 'java') return `${this.ctype(pt.dims > 0 ? { ...pt, dynamic: pt.dynamic ?? false } : pt, 'param')} ${p.name}`;
        return p.name;
      });
    };
    const fieldInits = [...fields.entries()].map(([name, ty]) => ({ name, ty, init: initOf(name) }));
    if (t === 'python') {
      this.line(`class ${c.name}:`);
      this.ind++;
      this.line(`def __init__(${['self', ...sig(ctor, key)].join(', ')}):`);
      this.methodBody(c, ctor, key, fieldInits.map((f) => `self.${f.name} = ${f.init ?? this.defaultValue(f.ty)}`));
      for (const m of c.methods) {
        this.line('');
        this.line(`def ${m.name}(${['self', ...sig(m, methodKey(c.name, m.name))].join(', ')}):`);
        this.methodBody(c, m, methodKey(c.name, m.name));
      }
      this.ind--;
      return;
    }
    if (t === 'javascript') {
      this.line(`class ${c.name} {`);
      this.ind++;
      this.line(`constructor(${sig(ctor, key).join(', ')}) {`);
      this.methodBody(c, ctor, key, fieldInits.map((f) => `this.${f.name} = ${f.init ?? this.defaultValue(f.ty)};`));
      this.line('}');
      for (const m of c.methods) {
        this.line('');
        this.line(`${m.name}(${sig(m, methodKey(c.name, m.name)).join(', ')}) {`);
        this.methodBody(c, m, methodKey(c.name, m.name));
        this.line('}');
      }
      this.ind--;
      this.line('}');
      return;
    }
    if (t === 'java' || t === 'cpp') {
      this.line(t === 'java' ? `static class ${c.name} {` : `class ${c.name} {`);
      if (t === 'cpp') this.line('public:');
      this.ind++;
      for (const f of fieldInits) {
        const ty = f.ty.dims > 0 && t === 'java' ? { ...f.ty, dynamic: f.ty.dynamic ?? false } : f.ty;
        const dv = f.init ?? (t === 'cpp' ? (f.ty.base === 'object' && !f.ty.dims ? 'nullptr' : f.ty.dims || f.ty.base === 'map' || f.ty.base === 'set' ? '{}' : this.defaultValue(f.ty)) : ty.dims && ty.dynamic ? 'new ArrayList<>()' : ty.base === 'map' || ty.base === 'set' ? this.defaultValue(ty) : null);
        this.line(`${this.ctype(ty)} ${f.name}${dv !== null && dv !== undefined ? ` = ${dv}` : ''};`);
      }
      if (fieldInits.length) this.line('');
      this.line(`${c.name}(${sig(ctor, key).join(', ')}) {`);
      this.methodBody(c, ctor, key);
      this.line('}');
      for (const m of c.methods) {
        const mk = methodKey(c.name, m.name);
        this.line('');
        this.line(`${this.ctype(this.an.funcs.get(mk)!.ret, 'ret')} ${m.name}(${sig(m, mk).join(', ')}) {`);
        this.methodBody(c, m, mk);
        this.line('}');
      }
      this.ind--;
      this.line(t === 'java' ? '}' : '};');
      return;
    }
    // C: struct + constructor function + method functions (emitted separately after prototypes)
    this.uses.add('stdlib');
    this.warn(`C target: class ${c.name} became a struct with ${c.name}_new() and ${c.name}_method(self, ...) functions; allocated memory is never freed.`);
    this.line(`struct ${c.name} {`);
    this.ind++;
    for (const f of fieldInits) this.line(`${f.ty.base === 'string' && !f.ty.dims ? 'char*' : this.ctype(f.ty)} ${f.name};`);
    if (!fieldInits.length) this.line('char _unused;');
    this.ind--;
    this.line('};');
    const saved = this.out;
    this.out = [];
    this.line(`${c.name}* ${c.name}_new(${this.cParams(c.ctor, c.name)}) {`);
    this.methodBody(c, ctor, key, [`${c.name}* self = (${c.name}*)malloc(sizeof(${c.name}));`, ...fieldInits.map((f) => `self->${f.name} = ${f.init ?? (f.ty.base === 'string' ? '""' : this.defaultValue(f.ty))};`)], ['return self;']);
    this.line('}');
    for (const m of c.methods) {
      const mk = methodKey(c.name, m.name);
      this.line('');
      this.line(`${this.ctype(this.an.funcs.get(mk)!.ret, 'ret')} ${c.name}_${m.name}(${[`${c.name}* self`, this.cParams(m, c.name)].filter(Boolean).join(', ')}) {`);
      this.methodBody(c, m, mk);
      this.line('}');
    }
    this.cClassFns.push(this.out);
    this.out = saved;
  }

  func(f: Func) {
    this.curFunc = f;
    const info = this.an.funcs.get(f.name)!;
    this.locals = info.locals;
    this.scopes = [new Set(f.params.map((p) => p.name))];
    f.params.forEach((p) => {
      if (this.t === 'c' && this.lenParams.get(f.name)?.includes(f.params.indexOf(p))) this.arraySizes.set(p.name, `${p.name}_len`);
    });
    if (this.t === 'python') {
      this.line(`def ${f.name}(${f.params.map((p) => p.name).join(', ')}):`);
      this.block(f.body, true);
    } else if (this.t === 'javascript') {
      this.line(`function ${f.name}(${f.params.map((p) => p.name).join(', ')}) {`);
      this.block(f.body, true);
      this.line('}');
    } else {
      this.line(this.signature(f) + ' {');
      this.block(f.body, true);
      this.line('}');
    }
    this.curFunc = null;
  }

  mainBody() {
    this.locals = this.an.main;
    this.scopes = [new Set()];
    const body = this.prog.main;
    switch (this.t) {
      case 'c':
      case 'cpp':
        this.line('int main() {');
        this.block(body, true);
        this.ind++;
        this.line('return 0;');
        this.ind--;
        this.line('}');
        break;
      case 'java':
        this.line('public static void main(String[] args) {');
        this.block(body, true);
        this.line('}');
        break;
      case 'python':
        if (this.prog.hasMain || this.prog.funcs.length) {
          this.line('def main():');
          this.block(body, true);
          this.line('');
          this.line('');
          this.line('if __name__ == "__main__":');
          this.ind++;
          this.line('main()');
          this.ind--;
        } else this.stmts(body);
        break;
      case 'javascript':
        if (this.prog.hasMain) {
          this.line('function main() {');
          this.block(body, true);
          this.line('}');
          this.line('');
          this.line('main();');
        } else {
          this.hoist(body);
          this.stmts(body);
        }
        break;
    }
  }

  /** Emit a block with indentation; top=true for function bodies (hoisting declarations). */
  block(body: Stmt[], top = false) {
    this.ind++;
    this.scopes.push(new Set());
    if (top) this.hoist(body);
    const before = this.out.length;
    this.stmts(body);
    if (this.t === 'python' && this.out.slice(before).every((l) => !l.trim() || l.trim().startsWith('#'))) this.line('pass');
    this.scopes.pop();
    this.ind--;
  }

  /** For dynamic sources -> declaring targets: hoist variables first assigned in nested blocks. */
  hoist(body: Stmt[]) {
    if (!this.needsDecl()) return;
    const firstDepth = new Map<string, number>();
    const params = new Set(this.curFunc?.params.map((p) => p.name) ?? []);
    walkStmts(body, { stmt: (s) => s.k === 'decl' && params.add(s.name) });
    walkStmts(body, {
      stmt: (s, depth) => {
        const names: string[] = [];
        if (s.k === 'expr' && s.expr.k === 'assign' && s.expr.target.k === 'id') names.push(s.expr.target.name);
        if (s.k === 'read') s.targets.forEach((t) => t.k === 'id' && names.push(t.name));
        if (s.k === 'range' && !s.declared) names.push(s.var);
        if (s.k === 'foreach') names.push(s.var);
        for (const n of names) if (!firstDepth.has(n)) firstDepth.set(n, s.k === 'range' || s.k === 'foreach' ? 99 : depth);
      },
    });
    for (const [name, depth] of firstDepth) {
      if (params.has(name) || this.declared(name) || (this.an.globals.has(name) && !this.locals.has(name))) continue;
      if (depth > 0 && depth !== 99) {
        const ty = this.locals.get(name) ?? { base: 'int' as BaseType, dims: 0 };
        if (this.t === 'javascript') this.line(`let ${name};`);
        else this.line(this.declString(name, ty, ty.dims || (this.t === 'c' && ty.base === 'string') ? undefined : { k: 'raw', text: this.defaultValue(ty) }) + ';');
        this.flushPending();
        this.declare(name);
      }
    }
  }

  flushPending() {
    if (this.pendingAfterDecl) {
      this.line(this.pendingAfterDecl);
      this.pendingAfterDecl = null;
    }
  }

  stmts(ss: Stmt[]) {
    ss.forEach((s, i) => {
      // Python: `int n; scanf(n)` -> skip the placeholder assignment before a read
      const nx = ss[i + 1];
      if (this.t === 'python' && s.k === 'decl' && !s.init && s.type.dims === 0 && nx?.k === 'read' && nx.targets.some((t) => t.k === 'id' && t.name === s.name)) {
        this.declare(s.name);
        return;
      }
      this.stmt(s);
    });
  }

  stmt(s: Stmt) {
    const t = this.t;
    const sc = this.semi();
    switch (s.k) {
      case 'comment':
        for (const l of s.text.split('\n')) this.line((t === 'python' ? '# ' : '// ') + l.trim());
        return;
      case 'raw': {
        this.warn(`Line ${s.line ?? '?'}: ${s.reason}`);
        const c = t === 'python' ? '#' : '//';
        this.line(`${c} [Not converted: ${s.reason}]`);
        for (const l of s.text.split('\n')) this.line(`${c}   ${l}`);
        return;
      }
      case 'decl': {
        this.declare(s.name);
        if (!this.locals.has(s.name) && !this.an.globals.has(s.name)) this.locals.set(s.name, s.type);
        const ty = this.locals.get(s.name) ?? s.type;
        if (t === 'python') {
          this.line(`${s.name} = ${s.init ? this.declInitPy(s.init) : this.defaultValue(ty)}`);
          return;
        }
        if (t === 'javascript') {
          this.line(`${s.isConst ? 'const' : 'let'} ${s.name}${s.init ? ' = ' + this.declInitJs(s.init) : ty.dims ? ' = []' : ''};`);
          return;
        }
        this.line(this.declString(s.name, ty, s.init) + ';');
        this.flushPending();
        return;
      }
      case 'expr': {
        const e = s.expr;
        // first assignment of an undeclared variable in declaring targets
        if (e.k === 'assign' && e.op === '=' && e.target.k === 'id' && this.needsDecl() && !this.declared(e.target.name) && !(this.an.globals.has(e.target.name) && !this.locals.has(e.target.name))) {
          const name = e.target.name;
          this.declare(name);
          const ty = this.locals.get(name) ?? typeOf(e.value, this.an, this.locals);
          if (t === 'javascript') this.line(`let ${name} = ${this.declInitJs(e.value)};`);
          else {
            this.line(this.declString(name, ty, e.value) + ';');
            this.flushPending();
          }
          return;
        }
        if (e.k === 'intr' && e.name === 'pop' && t === 'cpp' && !(e.orig && this.isObj(e.args[0]))) {
          this.line(`${this.ex(e.args[0])}.pop_back();`);
          return;
        }
        if (e.k === 'assign' && e.target.k === 'idx' && t === 'java' && this.isJavaList(e.target.obj)) {
          const val = e.op === '=' ? this.ex(e.value) : `${this.ex(e.target)} ${e.op.slice(0, -1)} ${this.ex(e.value, PREC[e.op.slice(0, -1)] + 1)}`;
          this.line(`${this.ex(e.target.obj)}.set(${this.ex(e.target.index)}, ${val});`);
          return;
        }
        if (e.k === 'upd' && t === 'python') {
          this.line(`${this.ex(e.arg)} ${e.op === '++' ? '+=' : '-='} 1`);
          return;
        }
        this.line(this.ex(e) + sc);
        return;
      }
      case 'return':
        if (!this.curFunc && s.value && this.t !== 'c' && this.t !== 'cpp') {
          this.line(this.t === 'python' ? 'return' : 'return;');
          return;
        }
        this.line(s.value ? `return ${this.ex(s.value, 0, this.curFunc ? this.an.funcs.get(this.curFunc.name)?.ret : undefined)}${sc}` : `return${sc}`);
        return;
      case 'break':
      case 'continue':
        this.line(s.k + sc);
        return;
      case 'if':
        return this.ifStmt(s);
      case 'while':
        if (t === 'python') {
          this.line(`while ${this.ex(s.cond)}:`);
          this.block(s.body);
        } else {
          this.line(`while (${this.ex(s.cond)}) {`);
          this.block(s.body);
          this.line('}');
        }
        return;
      case 'dowhile':
        if (t === 'python') {
          this.line('while True:');
          this.ind++;
          this.scopes.push(new Set());
          this.stmts(s.body);
          this.line(`if not (${this.ex(s.cond)}):`);
          this.ind++;
          this.line('break');
          this.ind -= 2;
          this.scopes.pop();
          this.notes.push('do-while loop converted to while True with a break, since Python has no do-while.');
        } else {
          this.line('do {');
          this.block(s.body);
          this.line(`} while (${this.ex(s.cond)});`);
        }
        return;
      case 'range':
        return this.rangeStmt(s);
      case 'for': {
        if (t === 'python') {
          this.stmts(s.init);
          this.line(`while ${s.cond ? this.ex(s.cond) : 'True'}:`);
          this.ind++;
          this.scopes.push(new Set());
          this.stmts(s.body);
          for (const u of s.update) this.stmt({ k: 'expr', expr: u });
          this.scopes.pop();
          this.ind--;
          if (hasContinue(s.body)) this.warn(`Line ${s.line}: 'continue' inside converted for-loop skips the update step; review the loop.`);
          this.notes.push('A C-style for loop without a simple counter was converted to a while loop.');
          return;
        }
        this.scopes.push(new Set());
        const saved = this.out;
        this.out = [];
        this.stmts(s.init);
        const initLines = this.out.map((l) => l.trim().replace(/;$/, ''));
        this.out = saved;
        this.line(`for (${initLines.join(', ')}; ${s.cond ? this.ex(s.cond) : ''}; ${s.update.map((u) => this.ex(u)).join(', ')}) {`);
        this.block(s.body);
        this.line('}');
        this.scopes.pop();
        return;
      }
      case 'foreach':
        return this.foreachStmt(s);
      case 'print':
        return this.printStmt(s);
      case 'read':
        return this.readStmt(s);
      case 'try':
        return this.tryStmt(s);
      case 'throw':
        return this.throwStmt(s);
    }
  }

  excName(k: ExcKind, forCatch: boolean): string {
    switch (this.t) {
      case 'python':
        return k;
      case 'java':
        this.uses.add('util');
        return { ValueError: 'IllegalArgumentException', IndexError: 'IndexOutOfBoundsException', KeyError: 'NoSuchElementException', ZeroDivisionError: 'ArithmeticException', RuntimeError: 'RuntimeException', Exception: forCatch ? 'Exception' : 'RuntimeException' }[k];
      case 'cpp':
        this.uses.add('stdexcept');
        return { ValueError: 'invalid_argument', IndexError: 'out_of_range', KeyError: 'out_of_range', ZeroDivisionError: 'domain_error', RuntimeError: 'runtime_error', Exception: forCatch ? 'exception' : 'runtime_error' }[k];
      case 'javascript':
        if (k !== 'Exception') this.jsExc.add(k);
        return k === 'Exception' ? 'Error' : k;
      default:
        return k;
    }
  }

  tryStmt(s: Extract<Stmt, { k: 'try' }>) {
    const t = this.t;
    if (s.catches.some((c) => c.kind === 'ZeroDivisionError') && (t === 'cpp' || t === 'javascript' || t === 'c'))
      this.warn(`${LANG_LABEL[t]} does not raise an exception on division by zero (C/C++: undefined behaviour, JavaScript: Infinity). Add an explicit check before dividing.`);
    if (t === 'c') {
      this.warn('C target: C has no exceptions; the try block is kept and the error handlers were removed.');
      this.line('/* try */ {');
      this.block(s.body);
      this.line('}');
      if (s.finally) this.stmts(s.finally);
      return;
    }
    const withVar = (v: string | null, fn: () => void) => {
      if (v) {
        this.scopes.push(new Set([v]));
        this.locals.set(v, { base: 'object', dims: 0, cls: EXC_CLASS });
      }
      fn();
      if (v) this.scopes.pop();
    };
    if (t === 'python') {
      this.line('try:');
      this.block(s.body);
      for (const c of s.catches) {
        this.line(`except ${c.kind}${c.var ? ` as ${c.var}` : ''}:`);
        withVar(c.var, () => this.block(c.body));
      }
      if (s.finally) {
        this.line('finally:');
        this.block(s.finally);
      }
      if (!s.catches.length && !s.finally) this.line('except Exception:\n' + '    '.repeat(this.ind + 1) + 'raise');
      return;
    }
    if (t === 'javascript') {
      this.line('try {');
      this.block(s.body);
      if (s.catches.length) {
        this.line('} catch (_e) {');
        this.ind++;
        let first = true;
        let hasCatchAll = false;
        for (const c of s.catches) {
          if (c.kind === 'Exception') {
            hasCatchAll = true;
            this.line(first ? '{' : '} else {');
          } else this.line(`${first ? '' : '} else '}if (_e instanceof ${this.excName(c.kind, true)}) {`);
          first = false;
          withVar(c.var, () => {
            this.ind++;
            if (c.var) this.line(`const ${c.var} = _e;`);
            this.ind--;
            this.block(c.body);
          });
          if (hasCatchAll) break;
        }
        if (!hasCatchAll) {
          this.line('} else {');
          this.ind++;
          this.line('throw _e;');
          this.ind--;
        }
        this.line('}');
        this.ind--;
      }
      if (s.finally) {
        this.line('} finally {');
        this.block(s.finally);
      }
      this.line('}');
      return;
    }
    // Java / C++
    this.line('try {');
    this.block(s.body);
    for (const c of s.catches) {
      const v = c.var ?? (t === 'java' ? '_e' : null);
      if (t === 'cpp') {
        if (c.kind === 'Exception' && !c.var) this.line('} catch (...) {');
        else this.line(`} catch (const ${this.excName(c.kind, true)}& ${c.var ?? '_e'}) {`);
      } else this.line(`} catch (${this.excName(c.kind, true)} ${v}) {`);
      withVar(c.var, () => this.block(c.body));
    }
    if (s.finally && t === 'java') {
      this.line('} finally {');
      this.block(s.finally);
    }
    this.line('}');
    if (s.finally && t === 'cpp') {
      this.warn('C++ has no finally block; its statements were placed after the try/catch and do not run if an exception escapes.');
      this.stmts(s.finally);
    }
  }

  throwStmt(s: Extract<Stmt, { k: 'throw' }>) {
    const t = this.t;
    const msg = s.message ? this.ex(s.message) : null;
    const msgStr = s.message && typeOf(s.message, this.an, this.locals).base !== 'string' && (t === 'cpp' || t === 'java') ? (t === 'cpp' ? `to_string(${msg})` : `String.valueOf(${msg})`) : msg;
    switch (t) {
      case 'python':
        this.line(s.message ? `raise ${s.kind}(${msg})` : 'raise');
        return;
      case 'javascript':
        this.line(`throw new ${this.excName(s.kind, false)}(${msg ?? ''});`);
        return;
      case 'java':
        this.line(`throw new ${this.excName(s.kind, false)}(${msgStr ?? ''});`);
        return;
      case 'cpp':
        this.line(s.message || s.kind !== 'Exception' ? `throw ${this.excName(s.kind, false)}(${msgStr ?? '""'});` : 'throw;');
        return;
      default:
        this.uses.add('stdlib');
        this.warn('C target: a thrown exception became an error message followed by exit(1).');
        this.line(`fprintf(stderr, "%s\\n", ${msg ?? '"error"'});`);
        this.line('exit(1);');
    }
  }

  declInitPy(e: Expr): string {
    return this.ex(e);
  }
  declInitJs(e: Expr): string {
    return this.ex(e);
  }

  ifStmt(s: Extract<Stmt, { k: 'if' }>) {
    if (this.t === 'python') {
      this.line(`if ${this.ex(s.cond)}:`);
      this.block(s.then);
      for (const e of s.elifs) {
        this.line(`elif ${this.ex(e.cond)}:`);
        this.block(e.body);
      }
      if (s.else) {
        this.line('else:');
        this.block(s.else);
      }
      return;
    }
    this.line(`if (${this.ex(s.cond)}) {`);
    this.block(s.then);
    for (const e of s.elifs) {
      this.line(`} else if (${this.ex(e.cond)}) {`);
      this.block(e.body);
    }
    if (s.else) {
      this.line('} else {');
      this.block(s.else);
    }
    this.line('}');
  }

  rangeStmt(s: Extract<Stmt, { k: 'range' }>) {
    const v = s.var;
    if (this.t === 'python') {
      const start = this.ex(s.start);
      const end = this.ex(s.end);
      let r: string;
      if (s.step === 1) r = start === '0' ? `range(${end})` : `range(${start}, ${end})`;
      else r = `range(${start}, ${end}, ${s.step})`;
      this.line(`for ${v} in ${r}:`);
      this.scopes.push(new Set([v]));
      this.block(s.body);
      this.scopes.pop();
      return;
    }
    const cmp = s.step > 0 ? '<' : '>';
    const upd = s.step === 1 ? `${v}++` : s.step === -1 ? `${v}--` : s.step > 0 ? `${v} += ${s.step}` : `${v} -= ${-s.step}`;
    let decl = '';
    if (!this.declared(v)) decl = this.t === 'javascript' ? 'let ' : `${this.ctype(this.locals.get(v) ?? { base: 'int', dims: 0 })} `;
    // nicer bounds: i < n + 1  ->  i <= n ;  i > -1 -> i >= 0
    let endS = this.ex(s.end, 10);
    let op = cmp;
    if (s.end.k === 'bin' && s.end.op === '+' && s.end.right.k === 'num' && s.end.right.value === 1 && cmp === '<') {
      endS = this.ex(s.end.left, 10);
      op = '<=';
    } else if (s.end.k === 'bin' && s.end.op === '-' && s.end.right.k === 'num' && s.end.right.value === 1 && cmp === '>') {
      endS = this.ex(s.end.left, 10);
      op = '>=';
    } else if (s.end.k === 'num' && s.end.value === -1 && cmp === '>') {
      endS = '0';
      op = '>=';
    }
    this.scopes.push(new Set([v]));
    this.line(`for (${decl}${v} = ${this.ex(s.start)}; ${v} ${op} ${endS}; ${upd}) {`);
    this.block(s.body);
    this.line('}');
    this.scopes.pop();
  }

  foreachStmt(s: Extract<Stmt, { k: 'foreach' }>) {
    const it = typeOf(s.iter, this.an, this.locals);
    if ((it.base === 'map' || it.base === 'set') && it.dims === 0 && this.t !== 'python' && this.t !== 'c') {
      const el = this.locals.get(s.var) ?? (it.base === 'map' ? it.key : it.val) ?? { base: 'int' as BaseType, dims: 0 };
      if (it.base === 'map' && this.t === 'cpp') this.warn('C++ std::map iterates its keys in sorted order, which can differ from insertion order in Python / Java / JavaScript.');
      if (it.base === 'set' && this.t === 'cpp') this.warn('C++ std::set iterates in sorted order.');
      this.scopes.push(new Set([s.var]));
      const iter = this.ex(s.iter, 15);
      if (this.t === 'javascript') this.line(`for (const ${s.var} of ${iter}${it.base === 'map' ? '.keys()' : ''}) {`);
      else if (this.t === 'java') this.line(`for (${this.jbox(el)} ${s.var} : ${iter}${it.base === 'map' ? '.keySet()' : ''}) {`);
      else if (it.base === 'map') {
        this.line(`for (auto& _kv_${s.var} : ${iter}) {`);
        this.ind++;
        this.line(`${this.ctype(el)} ${s.var} = _kv_${s.var}.first;`);
        this.ind--;
      } else this.line(`for (${this.ctype(el)} ${s.var} : ${iter}) {`);
      this.block(s.body);
      this.line('}');
      this.scopes.pop();
      return;
    }
    const el = this.locals.get(s.var) ?? (it.dims > 0 ? { base: it.base, dims: it.dims - 1 } : { base: 'char' as BaseType, dims: 0 });
    this.scopes.push(new Set([s.var]));
    switch (this.t) {
      case 'python':
        this.line(`for ${s.var} in ${this.ex(s.iter)}:`);
        this.block(s.body);
        break;
      case 'javascript':
        this.line(`for (const ${s.var} of ${this.ex(s.iter)}) {`);
        this.block(s.body);
        this.line('}');
        break;
      case 'java':
        this.line(`for (${this.ctype(el)} ${s.var} : ${it.base === 'string' && it.dims === 0 ? this.ex(s.iter, 15) + '.toCharArray()' : this.ex(s.iter)}) {`);
        this.block(s.body);
        this.line('}');
        break;
      case 'cpp':
        this.line(`for (${this.ctype(el)} ${s.var} : ${this.ex(s.iter)}) {`);
        this.block(s.body);
        this.line('}');
        break;
      case 'c': {
        const len = this.lenOf(s.iter);
        const idx = `_i_${s.var}`;
        this.line(`for (int ${idx} = 0; ${idx} < ${len}; ${idx}++) {`);
        this.ind++;
        this.line(`${this.ctype(el)} ${s.var} = ${this.ex(s.iter, 15)}[${idx}];`);
        this.ind--;
        this.block(s.body);
        this.line('}');
        break;
      }
    }
    this.scopes.pop();
  }

  // ---------- printing ----------
  printStmt(s0: Extract<Stmt, { k: 'print' }>) {
    const isExc = (e: Expr) => {
      const tt = typeOf(e, this.an, this.locals);
      return tt.base === 'object' && tt.cls === EXC_CLASS;
    };
    const unwrapStr = (e: Expr): Expr => (e.k === 'intr' && e.name === 'tostr' && isExc(e.args[0]) ? e.args[0] : e);
    const s = { ...s0, parts: s0.parts.map((p) => (p.expr && isExc(unwrapStr(p.expr)) ? { ...p, expr: { k: 'intr', name: 'errmsg', args: [unwrapStr(p.expr)] } as Expr } : p)) };
    const parts = s.parts;
    const t = this.t;
    const ty = (e: Expr) => typeOf(e, this.an, this.locals);
    for (const p of parts) {
      const pt = p.expr ? ty(p.expr) : null;
      if (pt && !pt.dims && (pt.base === 'map' || pt.base === 'set' || (pt.base === 'object' && pt.cls !== EXC_CLASS)) && t !== this.src)
        this.warn(`Printing a whole ${pt.base === 'object' ? 'object' : pt.base} produces different text in ${LANG_LABEL[t]}; print its fields or elements instead.`);
    }
    const boolStr = (v: string) => (this.src === 'python' ? `${v} ? "True" : "False"` : `${v} ? "true" : "false"`);
    if (parts.some((p) => p.expr && ty(p.expr).base === 'double' && p.precision === undefined) && (this.src === 'python' || t === 'python'))
      this.warn('Floating-point values may print with different formatting (e.g. 2.0 vs 2) across languages.');
    if (t === 'python') {
      if (parts.length === 0) {
        this.line(s.newline ? 'print()' : '');
        return;
      }
      const end = s.newline ? '' : ', end=""';
      if (parts.length === 1 && parts[0].expr && parts[0].precision === undefined) {
        this.line(`print(${this.pyPrintExpr(parts[0].expr)}${end})`);
        return;
      }
      if (parts.length === 1 && parts[0].text !== undefined) {
        this.line(`print(${pyStr(parts[0].text)}${end})`);
        return;
      }
      const exprTexts = parts.map((p) => (p.expr ? this.pyPrintExpr(p.expr) : ''));
      const q = exprTexts.some((x) => x.includes('"')) ? "'" : '"';
      const body = parts
        .map((p, i) => {
          if (p.text !== undefined) return escapeFStr(p.text, q);
          return `{${exprTexts[i]}${p.precision !== undefined ? `:.${p.precision}f` : ''}}`;
        })
        .join('');
      this.line(`print(f${q}${body}${q}${end})`);
      return;
    }
    if (t === 'javascript') {
      const body = parts
        .map((p) => {
          if (p.text !== undefined) return p.text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
          const e = p.expr!;
          const tt = ty(e);
          let x = this.ex(e);
          if (p.precision !== undefined) x = `(${x}).toFixed(${p.precision})`;
          else if (tt.base === 'bool' && this.src === 'python') x = `${x} ? "True" : "False"`;
          else if (tt.dims > 0 && this.src === 'python') x = `"[" + ${this.ex(e, 15)}.join(", ") + "]"`;
          return '${' + x + '}';
        })
        .join('');
      if (s.newline) this.line(parts.length ? `console.log(\`${body}\`);` : 'console.log();');
      else this.line(`process.stdout.write(\`${body}\`);`);
      return;
    }
    if (t === 'java') {
      const segs = parts.map((p) => {
        if (p.text !== undefined) return javaStr(p.text);
        const e = p.expr!;
        const tt = ty(e);
        if (p.precision !== undefined) return `String.format("%.${p.precision}f", ${this.ex(e)})`;
        if (tt.base === 'bool' && this.src === 'python') return `(${boolStr(this.ex(e, 2))})`;
        if (tt.dims > 0) {
          this.uses.add('util');
          return this.isJavaList(e) ? this.ex(e) : `Arrays.toString(${this.ex(e)})`;
        }
        return this.ex(e, 12);
      });
      let joined = segs.join(' + ');
      if (parts.length >= 2 && parts[0].expr && parts[1].expr) joined = '"" + ' + joined;
      if (parts.length === 1 && parts[0].expr && ty(parts[0].expr).base === 'char' && false) joined = '"" + ' + joined;
      this.line(`System.out.${s.newline ? 'println' : 'print'}(${joined});`);
      return;
    }
    if (t === 'cpp') {
      const segs: string[] = [];
      for (const p of parts) {
        if (p.text !== undefined) {
          segs.push(cStr(p.text));
          continue;
        }
        const e = p.expr!;
        const tt = ty(e);
        if (p.precision !== undefined) {
          this.uses.add('iomanip');
          segs.push(`fixed << setprecision(${p.precision}) << ${this.ex(e, 11)}`);
        } else if (tt.base === 'bool') segs.push(`(${boolStr(this.ex(e, 2))})`);
        else if (tt.dims > 0) {
          this.warn('C++ target: printing a whole vector is not supported by cout; printed element by element is required.');
          segs.push(`/* vector */ ${this.ex(e)}.size()`);
        } else segs.push(this.ex(e, 11));
      }
      if (s.newline) segs.push('endl');
      this.line(segs.length ? `cout << ${segs.join(' << ')};` : '');
      return;
    }
    // C
    let fmt = '';
    const args: string[] = [];
    for (const p of parts) {
      if (p.text !== undefined) {
        fmt += p.text.replace(/%/g, '%%');
        continue;
      }
      const e = p.expr!;
      const tt = ty(e);
      if (tt.dims > 0) {
        this.warn('C target: printing a whole array requires a loop; review the printf call.');
      }
      switch (tt.base) {
        case 'double':
          fmt += p.precision !== undefined ? `%.${p.precision}f` : '%g';
          args.push(this.ex(e));
          break;
        case 'long':
          fmt += '%lld';
          args.push(this.ex(e));
          break;
        case 'char':
          fmt += '%c';
          args.push(this.ex(e));
          break;
        case 'string':
          fmt += '%s';
          args.push(this.ex(e));
          break;
        case 'bool':
          fmt += '%s';
          args.push(boolStr(this.ex(e, 2)));
          break;
        default:
          if (p.precision !== undefined) {
            fmt += `%.${p.precision}f`;
            args.push(`(double)(${this.ex(e)})`);
          } else {
            fmt += '%d';
            args.push(this.ex(e));
          }
      }
    }
    if (s.newline) fmt += '\n';
    if (!fmt) return;
    this.line(`printf(${cStr(fmt)}${args.length ? ', ' + args.join(', ') : ''});`);
  }

  pyPrintExpr(e: Expr): string {
    const tt = typeOf(e, this.an, this.locals);
    if (tt.base === 'bool' && this.src !== 'python') return `str(${this.ex(e)}).lower()`;
    return this.ex(e);
  }

  // ---------- input ----------
  readStmt(s: Extract<Stmt, { k: 'read' }>) {
    this.usesInput = true;
    const t = this.t;
    const kindOf = (e: Expr, i: number): 'int' | 'double' | 'word' | 'line' | 'long' | 'char' => {
      const tt = typeOf(e, this.an, this.locals);
      if (tt.base === 'int') return 'int';
      if (tt.base === 'long') return 'long';
      if (tt.base === 'double') return 'double';
      if (tt.base === 'char') return 'char';
      if (tt.base === 'string') return s.kinds[i] === 'line' ? 'line' : 'word';
      return s.kinds[i] ?? 'int';
    };
    // declare undeclared targets first (dynamic -> static)
    if (this.needsDecl()) {
      for (const tg of s.targets) {
        if (tg.k === 'id' && !this.declared(tg.name) && !(this.an.globals.has(tg.name) && !this.locals.has(tg.name))) {
          this.declare(tg.name);
          const ty = this.locals.get(tg.name) ?? { base: 'int' as BaseType, dims: 0 };
          if (t === 'javascript') this.line(`let ${tg.name};`);
          else this.line(this.declString(tg.name, ty) + ';');
          this.flushPending();
        }
      }
    }
    if (t === 'c') {
      const specs = s.targets.map((tg, i) => ({ int: '%d', long: '%lld', double: '%lf', char: ' %c', word: '%s', line: ' %[^\\n]' })[kindOf(tg, i)]);
      const args = s.targets.map((tg, i) => (['word', 'line'].includes(kindOf(tg, i)) ? this.ex(tg) : '&' + this.ex(tg, 15)));
      this.line(`scanf("${specs.join(' ').replace(/ {2,}/g, ' ')}", ${args.join(', ')});`);
      return;
    }
    if (t === 'cpp') {
      if (s.targets.length === 1 && kindOf(s.targets[0], 0) === 'line') {
        this.line(`getline(cin >> ws, ${this.ex(s.targets[0])});`);
        return;
      }
      this.line(`cin >> ${s.targets.map((x) => this.ex(x, 11)).join(' >> ')};`);
      return;
    }
    for (const [i, tg] of s.targets.entries()) {
      const k = kindOf(tg, i);
      if (t === 'java') {
        this.uses.add('util');
        this.needScanner = true;
        const m = { int: 'nextInt()', long: 'nextLong()', double: 'nextDouble()', char: 'next().charAt(0)', word: 'next()', line: 'nextLine()' }[k];
        if (tg.k === 'idx' && this.isJavaList(tg.obj)) this.line(`${this.ex(tg.obj)}.set(${this.ex(tg.index)}, sc.${m});`);
        else this.line(`${this.ex(tg)} = sc.${m};`);
      } else if (t === 'python') {
        const conv = k === 'int' || k === 'long' ? 'int(next(_tokens))' : k === 'double' ? 'float(next(_tokens))' : 'next(_tokens)';
        if (k === 'line') this.warn('Python target: line input is read as a single whitespace-separated token.');
        this.line(`${this.ex(tg)} = ${conv}`);
      } else {
        const conv = k === 'int' || k === 'long' || k === 'double' ? 'Number(_in[_p++])' : '_in[_p++]';
        this.line(`${this.ex(tg)} = ${conv};`);
      }
    }
  }
  needScanner = false;

  // ---------- expressions ----------
  isJavaList(e: Expr): boolean {
    if (this.t !== 'java') return false;
    if (e.k === 'mem') {
      const mt = typeOf(e, this.an, this.locals);
      return mt.dims > 0 && !!mt.dynamic;
    }
    if (e.k !== 'id') return false;
    const ty = this.locals.get(e.name) ?? this.an.globals.get(e.name);
    return !!ty && ty.dims > 0 && this.isDyn(e.name);
  }

  /** Is this variable a growable collection in the current scope? */
  isDyn(name: string): boolean {
    if (this.curFunc && this.curFunc.params.some((p) => p.name === name)) return this.dynParams.get(this.curFunc.name)?.has(name) ?? false;
    return this.an.dynamic.has(name);
  }
  dynParams = new Map<string, Set<string>>();

  computeDynParams() {
    const fnames = new Set(this.prog.funcs.map((f) => f.name));
    const scan = (body: Stmt[], callerParams: Set<string> | null) =>
      walkStmts(body, {
        expr: (e) => {
          if (e.k !== 'call') return;
          const name = calleeName(e.callee);
          if (!fnames.has(name)) return;
          const f = this.prog.funcs.find((x) => x.name === name)!;
          e.args.forEach((a, i) => {
            const p = f.params[i];
            if (!p || a.k !== 'id') return;
            const dyn = callerParams?.has(a.name) ? true : this.an.dynamic.has(a.name);
            if (dyn) {
              if (!this.dynParams.has(name)) this.dynParams.set(name, new Set());
              this.dynParams.get(name)!.add(p.name);
            }
          });
        },
      });
    for (let i = 0; i < 3; i++) {
      scan(this.prog.main, null);
      for (const f of this.prog.funcs) scan(f.body, this.dynParams.get(f.name) ?? new Set());
    }
    // a parameter that is itself pushed to must be growable
    for (const f of this.prog.funcs) {
      const local = new Set<string>();
      walkStmts(f.body, { expr: (e) => e.k === 'intr' && (e.name === 'push' || e.name === 'pop') && e.args[0]?.k === 'id' && local.add(e.args[0].name) });
      for (const p of f.params) if (local.has(p.name)) {
        if (!this.dynParams.has(f.name)) this.dynParams.set(f.name, new Set());
        this.dynParams.get(f.name)!.add(p.name);
      }
    }
  }

  lenOf(e: Expr): string {
    const tt = typeOf(e, this.an, this.locals);
    if ((tt.base === 'map' || tt.base === 'set') && !tt.dims) {
      if (this.t === 'python') return `len(${this.ex(e)})`;
      if (this.t === 'javascript') return `${this.ex(e, 15)}.size`;
      if (this.t === 'java') return `${this.ex(e, 15)}.size()`;
      if (this.t === 'cpp') return `(int)${this.ex(e, 15)}.size()`;
    }
    switch (this.t) {
      case 'python':
        return `len(${this.ex(e)})`;
      case 'javascript':
        return `${this.ex(e, 15)}.length`;
      case 'java':
        if (tt.dims > 0 && this.isJavaList(e)) return `${this.ex(e, 15)}.size()`;
        if (tt.base === 'string' && tt.dims === 0) return `${this.ex(e, 15)}.length()`;
        return `${this.ex(e, 15)}.length`;
      case 'cpp':
        return `(int)${this.ex(e, 15)}.size()`;
      case 'c': {
        if (tt.base === 'string' && tt.dims === 0) {
          this.uses.add('string');
          return `(int)strlen(${this.ex(e)})`;
        }
        if (e.k === 'id' && this.arraySizes.has(e.name)) return this.arraySizes.get(e.name)!;
        if (e.k === 'id') return `(int)(sizeof(${e.name}) / sizeof(${e.name}[0]))`;
        this.warn('C target: could not determine an array length; review len() conversions.');
        return `/* length of ${this.ex(e)} */ 0`;
      }
    }
  }

  ex(e: Expr, parent = 0, expected?: TypeRef): string {
    const s = this.ex0(e, expected);
    const p = this.precOf(e);
    return p < parent ? `(${s})` : s;
  }

  precOf(e: Expr): number {
    switch (e.k) {
      case 'assign':
        return 1;
      case 'tern':
        return 2;
      case 'bin': {
        if (e.op === '/' && (this.divMode(e) === 'floor' || this.divMode(e) === 'trunc')) return 15;
        const op = this.mapOp(e.op);
        if (this.t === 'python' && (op === 'and')) return 4;
        if (this.t === 'python' && (op === 'or')) return 3;
        return PREC[e.op] ?? 11;
      }
      case 'un':
        return this.t === 'python' && e.op === '!' ? 5 : 13;
      case 'upd':
      case 'cast':
        return 13;
      default:
        return 15;
    }
  }

  mapOp(op: string): string {
    const t = this.t;
    if (t === 'python') {
      if (op === '&&') return 'and';
      if (op === '||') return 'or';
      if (op === 'is') return 'is';
    } else {
      if (op === 'is') return '==';
      if (op === 'is not') return '!=';
    }
    if (t === 'javascript') {
      if (op === '==') return '===';
      if (op === '!=') return '!==';
    }
    return op;
  }

  /** How should '/' be emitted: 'plain' | 'floor' (python //) | 'trunc' (JS int division) | 'true' (python true division) */
  divMode(e: Extract<Expr, { k: 'bin' }>): 'plain' | 'floor' | 'trunc' | 'true' {
    const l = typeOf(e.left, this.an, this.locals);
    const r = typeOf(e.right, this.an, this.locals);
    const ints = isIntish(l) && isIntish(r);
    if (this.src === 'python' || this.src === 'javascript') return ints && STATIC.includes(this.t) ? 'true' : 'plain';
    if (!ints) return 'plain';
    if (this.t === 'python') return 'floor';
    if (this.t === 'javascript') return 'trunc';
    return 'plain';
  }

  charCode(e: Expr, prec: number): string {
    const tt = typeOf(e, this.an, this.locals);
    if (tt.base !== 'char' || tt.dims) return this.ex(e, prec);
    if (this.t === 'python') return e.k === 'char' ? String(e.value.charCodeAt(0)) : `ord(${this.ex(e)})`;
    if (this.t === 'javascript') return e.k === 'char' ? String(e.value.charCodeAt(0)) : `${this.ex(e, 15)}.charCodeAt(0)`;
    return this.ex(e, prec);
  }

  /** Is `e` an object reference (needs -> in C/C++)? */
  isObj(e: Expr): boolean {
    if (e.k === 'this') return true;
    const tt = typeOf(e, this.an, this.locals);
    return tt.base === 'object' && tt.dims === 0 && tt.cls !== EXC_CLASS;
  }

  /** Membership test x in coll, dispatched on the collection type. */
  contains(coll: Expr, x: Expr, negate: boolean): string {
    const ct = typeOf(coll, this.an, this.locals);
    const t = this.t;
    const c = this.ex(coll, 15);
    const v = this.ex(x, 1);
    const not = negate ? '!' : '';
    if (t === 'python') return `${this.ex(x, 9)} ${negate ? 'not in' : 'in'} ${this.ex(coll, 9)}`;
    if ((ct.base === 'map' || ct.base === 'set') && !ct.dims) {
      if (t === 'javascript') return `${not}${c}.has(${v})`;
      if (t === 'java') return `${not}${c}.${ct.base === 'map' ? 'containsKey' : 'contains'}(${v})`;
      if (t === 'cpp') return `${negate ? '!' : ''}${c}.count(${v})`;
    }
    if (ct.base === 'string' && !ct.dims) {
      if (t === 'javascript') return `${not}${c}.includes(${v})`;
      if (t === 'java') return `${not}${c}.contains(${typeOf(x, this.an, this.locals).base === 'char' ? `String.valueOf(${v})` : v})`;
      if (t === 'cpp') return `(${c}.find(${v}) ${negate ? '==' : '!='} string::npos)`;
    }
    if (ct.dims > 0) {
      if (t === 'javascript') return `${not}${c}.includes(${v})`;
      if (t === 'java') {
        if (this.isJavaList(coll)) return `${not}${c}.contains(${v})`;
        this.uses.add('util');
        return `${not}Arrays.stream(${this.ex(coll)}).anyMatch(_v -> _v == ${v})`;
      }
      if (t === 'cpp') {
        this.uses.add('algorithm');
        return `(find(${c}.begin(), ${c}.end(), ${v}) ${negate ? '==' : '!='} ${c}.end())`;
      }
    }
    this.warn(`Membership test has no direct equivalent in ${LANG_LABEL[t]}; replace with a search loop.`);
    return `/* ${v} in ${c} */ false`;
  }

  ex0(e: Expr, expected?: TypeRef): string {
    const t = this.t;
    switch (e.k) {
      case 'this':
        return t === 'python' || t === 'c' ? 'self' : 'this';
      case 'new': {
        const args = e.args.map((a) => this.ex(a, 1)).join(', ');
        if (t === 'python') return `${e.cls}(${args})`;
        if (t === 'c') return `${e.cls}_new(${args})`;
        return `new ${e.cls}(${args})`;
      }
      case 'maplit': {
        const mt = expected && expected.base === 'map' ? expected : typeOf(e, this.an, this.locals);
        const ents = e.entries.map((x) => [this.ex(x.key, 1), this.ex(x.value, 1)]);
        if (t === 'python') return `{${ents.map(([k, v]) => `${k}: ${v}`).join(', ')}}`;
        if (t === 'javascript') return ents.length ? `new Map([${ents.map(([k, v]) => `[${k}, ${v}]`).join(', ')}])` : 'new Map()';
        if (t === 'java') {
          this.uses.add('util');
          if (!ents.length) return 'new LinkedHashMap<>()';
          return `new LinkedHashMap<${this.jbox(mt.key)}, ${this.jbox(mt.val)}>() {{ ${ents.map(([k, v]) => `put(${k}, ${v});`).join(' ')} }}`;
        }
        if (t === 'cpp') {
          this.uses.add('map');
          return `{${ents.map(([k, v]) => `{${k}, ${v}}`).join(', ')}}`;
        }
        this.warn('C target: maps are not supported in C.');
        return 'NULL /* map */';
      }
      case 'setlit': {
        const items = e.items.map((x) => this.ex(x, 1));
        if (t === 'python') return items.length ? `{${items.join(', ')}}` : 'set()';
        if (t === 'javascript') return `new Set(${items.length ? `[${items.join(', ')}]` : ''})`;
        if (t === 'java') {
          this.uses.add('util');
          return items.length ? `new LinkedHashSet<>(Arrays.asList(${items.join(', ')}))` : 'new LinkedHashSet<>()';
        }
        if (t === 'cpp') {
          this.uses.add('set');
          return `{${items.join(', ')}}`;
        }
        this.warn('C target: sets are not supported in C.');
        return 'NULL /* set */';
      }
      case 'slice': {
        const ot = typeOf(e.obj, this.an, this.locals);
        const o = this.ex(e.obj, 15);
        const a = e.start ? this.ex(e.start) : '0';
        const b = e.end ? this.ex(e.end) : null;
        if (t === 'python') return `${o}[${e.start ? this.ex(e.start) : ''}:${b ?? ''}]`;
        if (t === 'javascript') return `${o}.slice(${a}${b ? `, ${b}` : ''})`;
        if (ot.base === 'string' && !ot.dims) {
          if (t === 'java') return `${o}.substring(${a}${b ? `, ${b}` : ''})`;
          if (t === 'cpp') return b ? `${o}.substr(${a}, ${b} - ${this.ex(e.start ?? { k: 'num', value: 0, raw: '0', float: false }, 12)})` : `${o}.substr(${a})`;
        } else if (ot.dims > 0) {
          if (t === 'java') {
            this.uses.add('util');
            return this.isJavaList(e.obj) ? `new ArrayList<>(${o}.subList(${a}, ${b ?? `${o}.size()`}))` : `Arrays.copyOfRange(${o}, ${a}, ${b ?? `${o}.length`})`;
          }
          if (t === 'cpp') return `${this.ctype(ot)}(${o}.begin() + ${a}, ${b ? `${o}.begin() + ${b}` : `${o}.end()`})`;
        }
        this.warn(`Slicing is not supported for this value in ${LANG_LABEL[t]}.`);
        return `/* slice of ${o} */ ${o}`;
      }
      case 'num':
        if (t === 'java' && !e.float && Math.abs(e.value) > 2147483647) return e.raw + 'L';
        if (t === 'cpp' || t === 'c') if (!e.float && Math.abs(e.value) > 2147483647) return e.raw + 'LL';
        return e.raw;
      case 'str':
        return t === 'python' ? pyStr(e.value) : cStr(e.value);
      case 'char':
        if (t === 'python') return pyStr(e.value);
        if (t === 'javascript') return `'${e.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
        return `'${e.value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\0/g, '\\0')}'`;
      case 'bool':
        if (t === 'c') this.uses.add('bool');
        return t === 'python' ? (e.value ? 'True' : 'False') : String(e.value);
      case 'null':
        return { python: 'None', c: 'NULL', cpp: 'nullptr', java: 'null', javascript: 'null' }[t];
      case 'id':
        return e.name;
      case 'raw':
        return e.text;
      case 'fstr': {
        const parts = e.parts;
        if (t === 'python') return `f"${parts.map((p) => (p.text !== undefined ? escapeFStr(p.text, '"') : `{${this.ex(p.expr!)}}`)).join('')}"`;
        if (t === 'javascript') return '`' + parts.map((p) => (p.text !== undefined ? p.text.replace(/`/g, '\\`').replace(/\n/g, '\\n') : '${' + this.ex(p.expr!) + '}')).join('') + '`';
        if (t === 'java' || t === 'cpp') {
          const segs = parts.map((p) => (p.text !== undefined ? cStr(p.text) : t === 'cpp' && typeOf(p.expr!, this.an, this.locals).base !== 'string' ? `to_string(${this.ex(p.expr!)})` : this.ex(p.expr!, 12)));
          if (t === 'cpp') this.uses.add('string');
          return (t === 'java' && parts[0]?.expr ? '"" + ' : '') + segs.join(' + ');
        }
        this.warn('C target: formatted strings are not supported outside printf.');
        return cStr(parts.map((p) => p.text ?? '%d').join(''));
      }
      case 'bin': {
        let op = this.mapOp(e.op);
        const pr = PREC[e.op] ?? 11;
        if (e.op === 'in' || e.op === 'not in') return this.contains(e.right, e.left, e.op === 'not in');
        if (e.op === '/') {
          const mode = this.divMode(e);
          if (mode === 'floor') {
            this.notes.push('Integer division converted to // (floor division). Results differ from C-style truncation for negative numbers.');
            return `${this.ex(e.left, 12)} // ${this.ex(e.right, 13)}`;
          }
          if (mode === 'trunc') return `Math.trunc(${this.ex(e.left, 12)} / ${this.ex(e.right, 13)})`;
          if (mode === 'true') {
            this.notes.push("Python '/' always produces a float, so a (double) cast was added.");
            return `(double) ${this.ex(e.left, 13)} / ${this.ex(e.right, 13)}`;
          }
        }
        if (e.op === '//') {
          if (t === 'python') return `${this.ex(e.left, 12)} // ${this.ex(e.right, 13)}`;
          if (t === 'javascript') return `Math.floor(${this.ex(e.left, 12)} / ${this.ex(e.right, 13)})`;
          this.notes.push("Python floor division '//' became integer division '/', which truncates toward zero for negative values.");
          op = '/';
        }
        // char arithmetic in python / js
        if ((t === 'python' || t === 'javascript') && ['+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '!='].includes(e.op)) {
          const lt = typeOf(e.left, this.an, this.locals);
          const rt = typeOf(e.right, this.an, this.locals);
          const lc = lt.base === 'char' && !lt.dims;
          const rc = rt.base === 'char' && !rt.dims;
          const arith = ['+', '-', '*', '/', '%'].includes(e.op);
          if ((lc || rc) && (arith || lc !== rc) && !(e.op === '+' && (lt.base === 'string' || rt.base === 'string'))) {
            return `${this.charCode(e.left, pr)} ${op} ${this.charCode(e.right, pr + 1)}`;
          }
        }
        if (t === 'java' && e.op === '==' && typeOf(e.left, this.an, this.locals).base === 'string' && typeOf(e.right, this.an, this.locals).base === 'string')
          return `${this.ex(e.left, 15)}.equals(${this.ex(e.right)})`;
        if (t === 'cpp' && e.op === '+' && e.left.k === 'str' && e.right.k !== 'str') return `string(${this.ex(e.left)}) + ${this.ex(e.right, pr + 1)}`;
        const right = e.op === '**' ? this.ex(e.right, pr) : this.ex(e.right, pr + 1);
        return `${this.ex(e.left, e.op === '**' ? pr + 1 : pr)} ${op} ${right}`;
      }
      case 'un':
        if (e.op === '!') return t === 'python' ? `not ${this.ex(e.arg, 5)}` : `!${this.ex(e.arg, 13)}`;
        if (e.op === '&') return this.ex(e.arg, 13);
        return `${e.op}${this.ex(e.arg, 13)}`;
      case 'upd':
        if (t === 'python') {
          this.warn('Increment/decrement inside an expression is not valid Python; rewritten as += / -=, review evaluation order.');
          return `${this.ex(e.arg)} ${e.op === '++' ? '+=' : '-='} 1`;
        }
        return e.prefix ? `${e.op}${this.ex(e.arg, 13)}` : `${this.ex(e.arg, 14)}${e.op}`;
      case 'assign': {
        if (e.target.k === 'idx' && (t === 'java' || t === 'javascript')) {
          const mt = typeOf(e.target.obj, this.an, this.locals);
          if (mt.base === 'map' && !mt.dims) {
            const m = this.ex(e.target.obj, 15);
            const k = this.ex(e.target.index);
            const v = e.op === '=' ? this.ex(e.value) : `${m}.get(${k}) ${e.op.slice(0, -1)} ${this.ex(e.value, (PREC[e.op.slice(0, -1)] ?? 11) + 1)}`;
            return `${m}.${t === 'java' ? 'put' : 'set'}(${k}, ${v})`;
          }
        }
        if (t === 'python' && (e.op === '/=' ) && this.src !== 'python') {
          const tt = typeOf(e.target, this.an, this.locals);
          if (isIntish(tt)) return `${this.ex(e.target)} //= ${this.ex(e.value)}`;
        }
        if (t !== 'python' && e.op === '//=') return `${this.ex(e.target)} /= ${this.ex(e.value)}`;
        if (t !== 'python' && t !== 'javascript' && e.op === '**=') return `${this.ex(e.target)} = ${this.intrinsic({ k: 'intr', name: 'pow', args: [e.target, e.value] })}`;
        if (t === 'java' && e.target.k === 'idx' && this.isJavaList(e.target.obj)) return `${this.ex(e.target.obj)}.set(${this.ex(e.target.index)}, ${this.ex(e.value)})`;
        const tt = typeOf(e.target, this.an, this.locals);
        return `${this.ex(e.target, 14)} ${e.op} ${this.ex(e.value, 1, tt)}`;
      }
      case 'tern':
        if (t === 'python') return `${this.ex(e.then, 3)} if ${this.ex(e.cond, 3)} else ${this.ex(e.else, 2)}`;
        return `${this.ex(e.cond, 3)} ? ${this.ex(e.then, 3)} : ${this.ex(e.else, 2)}`;
      case 'call': {
        if (e.callee.k === 'mem' && this.isObj(e.callee.obj)) {
          const ot = e.callee.obj.k === 'this' ? { cls: this.curClass?.name } : typeOf(e.callee.obj, this.an, this.locals);
          const args = e.args.map((a) => this.ex(a, 1));
          if (t === 'c') return `${ot.cls}_${e.callee.prop}(${[this.ex(e.callee.obj, 1), ...args].join(', ')})`;
          return `${this.ex(e.callee.obj, 15)}${t === 'cpp' ? '->' : '.'}${e.callee.prop}(${args.join(', ')})`;
        }
        const name = calleeName(e.callee);
        const info = e.callee.k === 'id' ? this.an.funcs.get(name) : undefined;
        let args = e.args.map((a) => this.ex(a, 1));
        if (info && t === 'c' && this.lenParams.has(name)) {
          const idx = this.lenParams.get(name)!;
          const out: string[] = [];
          e.args.forEach((a, i) => {
            out.push(args[i]);
            if (idx.includes(i)) out.push(this.lenOf(a));
          });
          args = out;
        }
        if (!info && e.callee.k === 'mem') this.warn(`Method call '${name}()' was copied as-is; verify it exists in ${LANG_LABEL[t]}.`);
        else if (!info && !['printf'].includes(name)) this.warn(`Call to '${name}()' was copied as-is; it may not exist in ${LANG_LABEL[t]}.`);
        return `${this.ex(e.callee, 15)}(${args.join(', ')})`;
      }
      case 'intr':
        return this.intrinsic(e);
      case 'idx': {
        const mt = typeOf(e.obj, this.an, this.locals);
        if (mt.base === 'map' && !mt.dims) {
          if (t !== this.src) this.notes.push('Reading a missing map key raises KeyError in Python but returns null / undefined / a default value in Java, JavaScript and C++.');
          if (t === 'javascript' || t === 'java') return `${this.ex(e.obj, 15)}.get(${this.ex(e.index)})`;
          if (t === 'python' || t === 'cpp') return `${this.ex(e.obj, 15)}[${this.ex(e.index)}]`;
        }
        let index = e.index;
        if (t !== 'python' && index.k === 'num' && index.value < 0) {
          index = { k: 'bin', op: '-', left: { k: 'intr', name: 'len', args: [e.obj] }, right: { k: 'num', value: -index.value, raw: String(-index.value), float: false } };
        }
        if (t === 'java') {
          const ot = typeOf(e.obj, this.an, this.locals);
          if (ot.base === 'string' && ot.dims === 0) return `${this.ex(e.obj, 15)}.charAt(${this.ex(index)})`;
          if (this.isJavaList(e.obj)) return `${this.ex(e.obj, 15)}.get(${this.ex(index)})`;
        }
        return `${this.ex(e.obj, 15)}[${this.ex(index)}]`;
      }
      case 'mem':
        if (t !== 'python' && this.src === 'python' && e.obj.k === 'id' && e.obj.name === 'math') {
          const m: Record<string, string> = { pi: t === 'java' || t === 'javascript' ? 'Math.PI' : 'M_PI', e: t === 'java' || t === 'javascript' ? 'Math.E' : 'M_E' };
          if (m[e.prop]) {
            if (t === 'c' || t === 'cpp') this.uses.add('math');
            return m[e.prop];
          }
        }
        if (t === 'python' && e.obj.k === 'id' && e.obj.name === 'Math' && e.prop === 'PI') {
          this.uses.add('math');
          return 'math.pi';
        }
        if ((t === 'cpp' || t === 'c') && this.isObj(e.obj)) return `${this.ex(e.obj, 15)}->${e.prop}`;
        return `${this.ex(e.obj, 15)}.${e.prop}`;
      case 'arr':
        if (t === 'python' || t === 'javascript') return this.arrLit(e);
        if (t === 'java') {
          const tt = expected && expected.dims ? expected : typeOf(e, this.an, this.locals);
          if (expected?.dims && expected.dynamic) {
            this.uses.add('util');
            return e.items.length ? `new ArrayList<>(Arrays.asList(${e.items.map((i) => this.ex(i, 1)).join(', ')}))` : 'new ArrayList<>()';
          }
          return `new ${this.ctype({ ...tt, dynamic: false })}${this.arrLit(e)}`;
        }
        return this.arrLit(e);
      case 'newarr': {
        const fill = e.fill ? this.ex(e.fill) : '0';
        if (t === 'python') return `[${fill}] * ${this.ex(e.size, 12)}`;
        if (t === 'javascript') return `new Array(${this.ex(e.size)}).fill(${fill})`;
        if (t === 'java') {
          const el = e.elem.base === 'unknown' && e.fill ? typeOf(e.fill, this.an, this.locals) : e.elem;
          return `new ${this.ctype({ ...el, dims: 0 })}[${this.ex(e.size)}]`;
        }
        if (t === 'cpp') {
          const el = e.elem.base === 'unknown' && e.fill ? typeOf(e.fill, this.an, this.locals) : e.elem;
          return `${this.ctype({ ...el, dims: el.dims + 1 })}(${this.ex(e.size)}${e.fill ? ', ' + fill : ''})`;
        }
        this.warn('C target: arrays created inside expressions need malloc; review the generated code.');
        this.uses.add('stdlib');
        return `malloc(sizeof(int) * (${this.ex(e.size)}))`;
      }
      case 'input':
        this.usesInput = true;
        if (t === 'python') return e.kind === 'int' ? 'int(next(_tokens))' : e.kind === 'double' ? 'float(next(_tokens))' : 'next(_tokens)';
        if (t === 'javascript') return e.kind === 'int' || e.kind === 'double' ? 'Number(_in[_p++])' : '_in[_p++]';
        if (t === 'java') {
          this.uses.add('util');
          this.needScanner = true;
          return `sc.${{ int: 'nextInt()', double: 'nextDouble()', word: 'next()', line: 'nextLine()' }[e.kind]}`;
        }
        this.warn('Input used inside an expression; C/C++ require a separate read statement.');
        return '/* input */ 0';
      case 'cast': {
        const from = typeOf(e.arg, this.an, this.locals);
        if (t === 'python') {
          if (e.to.base === 'int' || e.to.base === 'long') return from.base === 'char' ? `ord(${this.ex(e.arg)})` : `int(${this.ex(e.arg)})`;
          if (e.to.base === 'double') return `float(${this.ex(e.arg)})`;
          if (e.to.base === 'char') return from.base === 'char' ? this.ex(e.arg) : `chr(${this.ex(e.arg)})`;
          return this.ex(e.arg);
        }
        if (t === 'javascript') {
          if (e.to.base === 'int' || e.to.base === 'long') return from.base === 'char' ? `${this.ex(e.arg, 15)}.charCodeAt(0)` : `Math.trunc(${this.ex(e.arg)})`;
          if (e.to.base === 'char') return from.base === 'char' ? this.ex(e.arg) : `String.fromCharCode(${this.ex(e.arg)})`;
          return this.ex(e.arg);
        }
        return `(${this.ctype(e.to)}) ${this.ex(e.arg, 13)}`;
      }
    }
  }

  /** Map / set / string / exception operations. Returns null when not handled here. */
  richIntrinsic(e: Extract<Expr, { k: 'intr' }>, ty0: TypeRef): string | null {
    const t = this.t;
    const a = e.args;
    const A = (i: number, p = 1) => this.ex(a[i], p);
    const isMap = ty0.base === 'map' && !ty0.dims;
    const isSet = ty0.base === 'set' && !ty0.dims;
    const isStr = ty0.base === 'string' && !ty0.dims;
    const strOp = (py: string, js: string, java: string, cpp: () => string) => {
      if (t === 'python') return py;
      if (t === 'javascript') return js;
      if (t === 'java') return java;
      if (t === 'cpp') return cpp();
      this.warn(`C target: string operation '${e.name}' needs a manual implementation.`);
      return `/* ${e.name} */ ${A(0)}`;
    };
    switch (e.name) {
      case 'has':
        return this.contains(a[0], a[1], false);
      case 'getor':
        if (t === 'python') return `${A(0, 15)}.get(${A(1)}, ${A(2)})`;
        if (t === 'java') return `${A(0, 15)}.getOrDefault(${A(1)}, ${A(2)})`;
        if (t === 'javascript') return `(${A(0, 15)}.has(${A(1)}) ? ${A(0, 15)}.get(${A(1)}) : ${A(2, 3)})`;
        if (t === 'cpp') return `(${A(0, 15)}.count(${A(1)}) ? ${A(0, 15)}[${A(1)}] : ${A(2, 3)})`;
        return null;
      case 'remove':
        if (isMap || isSet) {
          if (t === 'python') return isMap ? `${A(0, 15)}.pop(${A(1)}, None)` : `${A(0, 15)}.discard(${A(1)})`;
          if (t === 'java') return `${A(0, 15)}.remove(${A(1)})`;
          if (t === 'javascript') return `${A(0, 15)}.delete(${A(1)})`;
          if (t === 'cpp') return `${A(0, 15)}.erase(${A(1)})`;
        }
        if (ty0.dims > 0) {
          if (t === 'python') return `${A(0, 15)}.remove(${A(1)})`;
          if (t === 'java') return `${A(0, 15)}.remove(${this.jbox({ ...ty0, dims: 0 })}.valueOf(${A(1)}))`;
          if (t === 'javascript') return `${A(0, 15)}.splice(${A(0, 15)}.indexOf(${A(1)}), 1)`;
          if (t === 'cpp') {
            this.uses.add('algorithm');
            return `${A(0, 15)}.erase(find(${A(0, 15)}.begin(), ${A(0, 15)}.end(), ${A(1)}))`;
          }
        }
        return null;
      case 'popkey':
        if (isMap) {
          if (t === 'python') return `${A(0, 15)}.pop(${A(1)})`;
          if (t === 'java') return `${A(0, 15)}.remove(${A(1)})`;
          this.warn(`Removing and returning a map entry in one step is not supported for ${LANG_LABEL[t]}; read the value first, then remove the key.`);
          return null;
        }
        if (ty0.dims > 0) {
          if (t === 'python') return `${A(0, 15)}.pop(${A(1)})`;
          if (t === 'java') return `${A(0, 15)}.remove((int) ${A(1, 13)})`;
          if (t === 'javascript') return `${A(0, 15)}.splice(${A(1)}, 1)[0]`;
        }
        return null;
      case 'keys':
      case 'values': {
        const which = e.name;
        if (!isMap) return null;
        if (t === 'python') return `list(${A(0, 15)}.${which}())`;
        if (t === 'javascript') return `[...${A(0, 15)}.${which}()]`;
        if (t === 'java') return `new ArrayList<>(${A(0, 15)}.${which === 'keys' ? 'keySet' : 'values'}())`;
        if (t === 'cpp') {
          this.uses.add('vector');
          const el = which === 'keys' ? ty0.key : ty0.val;
          return `[&]() { vector<${this.ctype(el ?? { base: 'int', dims: 0 })}> _r; for (auto& _p : ${A(0, 15)}) _r.push_back(_p.${which === 'keys' ? 'first' : 'second'}); return _r; }()`;
        }
        return null;
      }
      case 'sorted': {
        const el = isMap ? ty0.key : isSet ? ty0.val : { ...ty0, dims: ty0.dims - 1 };
        if (t === 'python') return `sorted(${A(0)})`;
        if (t === 'javascript') return `[...${A(0, 15)}${isMap ? '.keys()' : ''}].sort((_a, _b) => (_a < _b ? -1 : _a > _b ? 1 : 0))`;
        if (t === 'java') {
          this.uses.add('util');
          this.uses.add('stream');
          const src = isMap ? `${A(0, 15)}.keySet().stream()` : isSet || this.isJavaList(a[0]) ? `${A(0, 15)}.stream()` : `Arrays.stream(${A(0)}).boxed()`;
          return `${src}.sorted().collect(Collectors.toCollection(ArrayList::new))`;
        }
        if (t === 'cpp') {
          this.uses.add('algorithm');
          this.uses.add('vector');
          const ct = this.ctype(el ?? { base: 'int', dims: 0 });
          if (isMap) return `[&]() { vector<${ct}> _r; for (auto& _p : ${A(0, 15)}) _r.push_back(_p.first); sort(_r.begin(), _r.end()); return _r; }()`;
          return `[&]() { vector<${ct}> _r(${A(0, 15)}.begin(), ${A(0, 15)}.end()); sort(_r.begin(), _r.end()); return _r; }()`;
        }
        return null;
      }
      case 'upper':
      case 'lower': {
        const up = e.name === 'upper';
        return strOp(`${A(0, 15)}.${e.name}()`, `${A(0, 15)}.${up ? 'toUpperCase' : 'toLowerCase'}()`, `${A(0, 15)}.${up ? 'toUpperCase' : 'toLowerCase'}()`, () => {
          this.uses.add('cctype');
          this.uses.add('string');
          return `[&]() { string _r = ${A(0)}; for (auto& _c : _r) _c = ${up ? 'toupper' : 'tolower'}(_c); return _r; }()`;
        });
      }
      case 'strip':
        return strOp(`${A(0, 15)}.strip()`, `${A(0, 15)}.trim()`, `${A(0, 15)}.trim()`, () => {
          this.uses.add('string');
          return `[&]() { string _r = ${A(0)}; size_t _b = _r.find_first_not_of(" \\t\\n\\r"); if (_b == string::npos) return string(); size_t _e = _r.find_last_not_of(" \\t\\n\\r"); return _r.substr(_b, _e - _b + 1); }()`;
        });
      case 'replace':
        return strOp(`${A(0, 15)}.replace(${A(1)}, ${A(2)})`, `${A(0, 15)}.replaceAll(${A(1)}, ${A(2)})`, `${A(0, 15)}.replace(${A(1)}, ${A(2)})`, () => {
          this.uses.add('string');
          return `[&]() { string _r = ${A(0)}; string _f = ${A(1)}, _t = ${A(2)}; size_t _i = 0; while (!_f.empty() && (_i = _r.find(_f, _i)) != string::npos) { _r.replace(_i, _f.size(), _t); _i += _t.size(); } return _r; }()`;
        });
      case 'find':
        if (!isStr && ty0.dims > 0) {
          if (t === 'python') return `${A(0, 15)}.index(${A(1)})`;
          if (t === 'javascript') return `${A(0, 15)}.indexOf(${A(1)})`;
          if (t === 'java' && this.isJavaList(a[0])) return `${A(0, 15)}.indexOf(${A(1)})`;
        }
        return strOp(`${A(0, 15)}.find(${A(1)})`, `${A(0, 15)}.indexOf(${A(1)})`, `${A(0, 15)}.indexOf(${A(1)})`, () => `(int)${A(0, 15)}.find(${A(1)})`);
      case 'startswith':
        return strOp(`${A(0, 15)}.startswith(${A(1)})`, `${A(0, 15)}.startsWith(${A(1)})`, `${A(0, 15)}.startsWith(${A(1)})`, () => `(${A(0, 15)}.rfind(${A(1)}, 0) == 0)`);
      case 'endswith':
        return strOp(`${A(0, 15)}.endswith(${A(1)})`, `${A(0, 15)}.endsWith(${A(1)})`, `${A(0, 15)}.endsWith(${A(1)})`, () => {
          this.uses.add('string');
          return `[&]() { string _s = ${A(0)}, _x = ${A(1)}; return _s.size() >= _x.size() && _s.compare(_s.size() - _x.size(), _x.size(), _x) == 0; }()`;
        });
      case 'split': {
        const sep = a[1] ? A(1) : null;
        return strOp(
          `${A(0, 15)}.split(${sep ?? ''})`,
          sep ? `${A(0, 15)}.split(${sep})` : `${A(0, 15)}.trim().split(/\\s+/)`,
          (() => {
            this.uses.add('util');
            return sep ? `new ArrayList<>(Arrays.asList(${A(0, 15)}.split(java.util.regex.Pattern.quote(${sep}))))` : `new ArrayList<>(Arrays.asList(${A(0, 15)}.trim().split("\\\\s+")))`;
          })(),
          () => {
            this.uses.add('sstream');
            this.uses.add('vector');
            this.uses.add('string');
            if (sep) return `[&]() { vector<string> _r; string _s = ${A(0)}, _d = ${sep}; size_t _b = 0, _i; while ((_i = _s.find(_d, _b)) != string::npos) { _r.push_back(_s.substr(_b, _i - _b)); _b = _i + _d.size(); } _r.push_back(_s.substr(_b)); return _r; }()`;
            return `[&]() { vector<string> _r; istringstream _in(${A(0)}); string _w; while (_in >> _w) _r.push_back(_w); return _r; }()`;
          },
        );
      }
      case 'join': {
        const lt = ty0;
        const strs = lt.base === 'string' || lt.base === 'char';
        if (t === 'python') return strs ? `${A(1, 15)}.join(${A(0)})` : `${A(1, 15)}.join(map(str, ${A(0)}))`;
        if (t === 'javascript') return `${A(0, 15)}.join(${A(1)})`;
        if (t === 'java') {
          this.uses.add('util');
          this.uses.add('stream');
          if (strs && this.isJavaList(a[0])) return `String.join(${A(1)}, ${A(0)})`;
          const src = this.isJavaList(a[0]) ? `${A(0, 15)}.stream()` : `Arrays.stream(${A(0)})${lt.base === 'string' ? '' : '.boxed()'}`;
          return `${src}.map(String::valueOf).collect(Collectors.joining(${A(1)}))`;
        }
        if (t === 'cpp') {
          this.uses.add('sstream');
          return `[&]() { ostringstream _o; bool _f = true; for (auto& _x : ${A(0, 15)}) { if (!_f) _o << ${A(1)}; _o << _x; _f = false; } return _o.str(); }()`;
        }
        return null;
      }
      case 'errmsg':
        if (t === 'python') return `str(${A(0)})`;
        if (t === 'java') return `${A(0, 15)}.getMessage()`;
        if (t === 'javascript') return `${A(0, 15)}.message`;
        if (t === 'cpp') return `string(${A(0, 15)}.what())`;
        return '"error"';
      case 'tostr': {
        const at = typeOf(a[0], this.an, this.locals);
        if (at.base === 'object' && at.cls === EXC_CLASS) return this.richIntrinsic({ k: 'intr', name: 'errmsg', args: a }, at);
        return null;
      }
      case 'len':
        return isMap || isSet ? this.lenOf(a[0]) : null;
    }
    return null;
  }

  intrinsic(e: Extract<Expr, { k: 'intr' }>): string {
    const t = this.t;
    const a = e.args;
    const A = (i: number, p = 1) => this.ex(a[i], p);
    const ty0 = typeOf(a[0], this.an, this.locals);
    if (e.orig && this.isObj(a[0]) && ty0.cls && this.an.funcs.has(methodKey(ty0.cls, e.orig)))
      return this.ex({ k: 'call', callee: { k: 'mem', obj: a[0], prop: e.orig }, args: a.slice(1) });
    const rich = this.richIntrinsic(e, ty0);
    if (rich !== null) return rich;
    switch (e.name) {
      case 'len':
        return this.lenOf(a[0]);
      case 'abs':
        if (t === 'python') return `abs(${A(0)})`;
        if (t === 'java' || t === 'javascript') return `Math.abs(${A(0)})`;
        if (t === 'c') {
          if (ty0.base === 'double') {
            this.uses.add('math');
            return `fabs(${A(0)})`;
          }
          this.uses.add('stdlib');
          return ty0.base === 'long' ? `llabs(${A(0)})` : `abs(${A(0)})`;
        }
        this.uses.add('math');
        return `abs(${A(0)})`;
      case 'max':
      case 'min': {
        if (t === 'python') return `${e.name}(${A(0)}, ${A(1)})`;
        if (t === 'java' || t === 'javascript') return `Math.${e.name}(${A(0)}, ${A(1)})`;
        if (t === 'cpp') {
          this.uses.add('algorithm');
          const t1 = typeOf(a[1], this.an, this.locals);
          if (ty0.base !== t1.base) return `${e.name}<${this.ctype({ base: ty0.base === 'double' || t1.base === 'double' ? 'double' : ty0.base === 'long' || t1.base === 'long' ? 'long' : 'int', dims: 0 })}>(${A(0)}, ${A(1)})`;
          return `${e.name}(${A(0)}, ${A(1)})`;
        }
        const cmp = e.name === 'max' ? '>' : '<';
        return `((${A(0, 9)}) ${cmp} (${A(1, 9)}) ? (${A(0)}) : (${A(1)}))`;
      }
      case 'pow': {
        const intResult = typeOf(e, this.an, this.locals).base === 'int';
        if (t === 'python') return `${A(0, 15)} ** ${A(1, 14)}`;
        if (t === 'javascript') return `${A(0, 15)} ** ${A(1, 14)}`;
        const base = t === 'java' ? `Math.pow(${A(0)}, ${A(1)})` : `pow(${A(0)}, ${A(1)})`;
        if (t !== 'java') this.uses.add('math');
        if (intResult || (this.src !== 'python' && false)) return t === 'java' ? `(long) ${base}` : `(long long) ${base}`;
        return base;
      }
      case 'sqrt':
      case 'floor':
      case 'ceil': {
        if (t === 'python') {
          this.uses.add('math');
          return `math.${e.name}(${A(0)})`;
        }
        if (t === 'java' || t === 'javascript') {
          const inner = `Math.${e.name}(${A(0)})`;
          return e.name !== 'sqrt' && t === 'java' ? `(int) ${inner}` : inner;
        }
        this.uses.add('math');
        return e.name === 'sqrt' ? `sqrt(${A(0)})` : `(int) ${e.name}(${A(0)})`;
      }
      case 'tostr':
        if (t === 'python') return `str(${A(0)})`;
        if (t === 'javascript') return `String(${A(0)})`;
        if (t === 'java') return `String.valueOf(${A(0)})`;
        if (t === 'cpp') {
          this.uses.add('string');
          return `to_string(${A(0)})`;
        }
        this.warn('C target: converting a number to a string needs sprintf with a buffer.');
        return `/* to string */ ${A(0)}`;
      case 'toint':
        if (ty0.base === 'string') {
          if (t === 'python') return `int(${A(0)})`;
          if (t === 'javascript') return `parseInt(${A(0)})`;
          if (t === 'java') return `Integer.parseInt(${A(0)})`;
          if (t === 'cpp') return `stoi(${A(0)})`;
          this.uses.add('stdlib');
          return `atoi(${A(0)})`;
        }
        if (t === 'python') return `int(${A(0)})`;
        if (t === 'javascript') return `Math.trunc(${A(0)})`;
        return `(int) ${A(0, 13)}`;
      case 'todouble':
        if (t === 'python') return `float(${A(0)})`;
        if (t === 'javascript') return `Number(${A(0)})`;
        if (ty0.base === 'string') {
          if (t === 'java') return `Double.parseDouble(${A(0)})`;
          if (t === 'cpp') return `stod(${A(0)})`;
          this.uses.add('stdlib');
          return `atof(${A(0)})`;
        }
        return `(double) ${A(0, 13)}`;
      case 'sum':
        if (t === 'python') return `sum(${A(0)})`;
        if (t === 'javascript') return `${A(0, 15)}.reduce((a, b) => a + b, 0)`;
        if (t === 'java') {
          this.uses.add('util');
          return this.isJavaList(a[0]) ? `${A(0, 15)}.stream().mapToInt(Integer::intValue).sum()` : `Arrays.stream(${A(0)}).sum()`;
        }
        if (t === 'cpp') {
          this.uses.add('numeric');
          return `accumulate(${A(0, 15)}.begin(), ${A(0, 15)}.end(), 0)`;
        }
        this.warn('C target: sum() needs an explicit loop.');
        return `/* sum of ${A(0)} */ 0`;
      case 'push':
        if (ty0.base === 'set' && !ty0.dims) {
          if (t === 'python') return `${A(0, 15)}.add(${A(1)})`;
          if (t === 'javascript' || t === 'java') return `${A(0, 15)}.add(${A(1)})`;
          if (t === 'cpp') return `${A(0, 15)}.insert(${A(1)})`;
        }
        if (t === 'python') return `${A(0, 15)}.append(${A(1)})`;
        if (t === 'javascript') return `${A(0, 15)}.push(${A(1)})`;
        if (t === 'java') return `${A(0, 15)}.add(${A(1)})`;
        if (t === 'cpp') return `${A(0, 15)}.push_back(${A(1)})`;
        return `${A(0, 15)}[${this.lenOf(a[0])}++] = ${A(1)}`;
      case 'pop':
        if (t === 'python' || t === 'javascript') return `${A(0, 15)}.pop()`;
        if (t === 'java') return `${A(0, 15)}.remove(${A(0, 15)}.size() - 1)`;
        if (t === 'cpp') {
          this.warn('C++ target: pop_back() returns nothing; read back() before popping if the value is needed.');
          return `${A(0, 15)}.back()`;
        }
        return `${A(0, 15)}[--${this.lenOf(a[0])}]`;
    }
    return `${e.name}(${a.map((x) => this.ex(x)).join(', ')})`;
  }
}

function isIntish(t: TypeRef) {
  return t.dims === 0 && (t.base === 'int' || t.base === 'long' || t.base === 'char' || t.base === 'bool');
}

function usesLenOf(body: Stmt[], name: string): boolean {
  let found = false;
  walkStmts(body, {
    expr: (e) => {
      if (e.k === 'intr' && e.name === 'len' && e.args[0]?.k === 'id' && e.args[0].name === name) found = true;
    },
    stmt: (s) => {
      if (s.k === 'foreach' && s.iter.k === 'id' && s.iter.name === name) found = true;
    },
  });
  return found;
}

function hasContinue(body: Stmt[]): boolean {
  let found = false;
  walkStmts(body, { stmt: (s) => s.k === 'continue' && (found = true) });
  return found;
}

export function cStr(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r') + '"';
}
function javaStr(s: string) {
  return cStr(s);
}
export function pyStr(s: string): string {
  return cStr(s);
}
function escapeFStr(s: string, q: string): string {
  let r = s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\{/g, '{{').replace(/\}/g, '}}');
  r = r.split(q).join('\\' + q);
  return r;
}

const RESERVED = new Set(['main', 'length', 'print', 'int', 'char', 'class', 'new', 'delete', 'this', 'default', 'function', 'var', 'let', 'const', 'switch', 'case']);

/** Rename snake_case identifiers to camelCase (Java / JavaScript conventions) when no collision occurs. */
function camelCaseNames(prog: Program): Program {
  const names = new Set<string>();
  const collect = (o: unknown) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(collect);
    const n = o as Record<string, unknown>;
    if (n.k === 'id' && typeof n.name === 'string') names.add(n.name);
    if (n.k === 'decl' && typeof n.name === 'string') names.add(n.name);
    if ((n.k === 'range' || n.k === 'foreach') && typeof n.var === 'string') names.add(n.var);
    for (const v of Object.values(n)) collect(v);
  };
  collect(prog);
  for (const f of prog.funcs) {
    names.add(f.name);
    f.params.forEach((p) => names.add(p.name));
  }
  const map = new Map<string, string>();
  for (const n of names) {
    if (!/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(n)) continue;
    const c = n.replace(/_([a-z0-9])/g, (_m, ch: string) => ch.toUpperCase());
    if (names.has(c) || RESERVED.has(c) || [...map.values()].includes(c)) continue;
    map.set(n, c);
  }
  if (!map.size) return prog;
  const rn = (x: string) => map.get(x) ?? x;
  const walk = (o: unknown): unknown => {
    if (!o || typeof o !== 'object') return o;
    if (Array.isArray(o)) return o.map(walk);
    const n = { ...(o as Record<string, unknown>) };
    if (n.k === 'id' && typeof n.name === 'string') n.name = rn(n.name);
    if (n.k === 'decl' && typeof n.name === 'string') n.name = rn(n.name);
    if ((n.k === 'range' || n.k === 'foreach') && typeof n.var === 'string') n.var = rn(n.var);
    for (const [k, v] of Object.entries(n)) if (v && typeof v === 'object') n[k] = walk(v);
    return n;
  };
  return {
    ...prog,
    globals: walk(prog.globals) as Stmt[],
    main: walk(prog.main) as Stmt[],
    funcs: prog.funcs.map((f) => ({ ...f, name: rn(f.name), params: f.params.map((p) => ({ ...p, name: rn(p.name) })), body: walk(f.body) as Stmt[] })),
  };
}
