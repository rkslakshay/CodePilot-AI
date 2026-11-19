import { tokenize, type Token } from './lexer.js';
import type { ClassDef, ExcKind, Expr, Func, Lang, Param, PrintPart, Program, Stmt, TypeRef, BaseType } from './ir.js';
import { normalizeProgram } from './normalize.js';
import { walkStmts, mapStmts } from './walk.js';

export class ParseError extends Error {
  constructor(message: string, public line: number) {
    super(message);
  }
}

const C_TYPE_WORDS = new Set([
  'int', 'long', 'short', 'unsigned', 'signed', 'float', 'double', 'char', 'bool', 'boolean', 'void', 'string', 'String',
  'auto', 'var', 'byte', 'size_t', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Character', 'vector', 'ArrayList',
  'List', 'Scanner', 'BufferedReader', 'std', 'const', 'final', 'static', 'unsigned', 'long long', 'StringBuilder',
]);
const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'inline', 'export', 'extern', 'register', 'volatile', 'synchronized']);

const C_BIN_PREC: Record<string, number> = {
  '||': 3, '&&': 4, '|': 5, '^': 6, '&': 7, '==': 8, '!=': 8, '===': 8, '!==': 8,
  '<': 9, '>': 9, '<=': 9, '>=': 9, instanceof: 9, '<<': 10, '>>': 10, '>>>': 10,
  '+': 11, '-': 11, '*': 12, '/': 12, '%': 12, '**': 14,
};
const PY_BIN_PREC: Record<string, number> = {
  or: 3, and: 4, in: 8, 'not in': 8, is: 8, 'is not': 8, '==': 8, '!=': 8, '<': 8, '>': 8, '<=': 8, '>=': 8,
  '|': 5, '^': 6, '&': 7, '<<': 10, '>>': 10, '+': 11, '-': 11, '*': 12, '/': 12, '//': 12, '%': 12, '**': 14,
};
const MAP_TYPES = ['HashMap', 'Map', 'TreeMap', 'LinkedHashMap', 'unordered_map', 'map'];
const SET_TYPES = ['HashSet', 'Set', 'TreeSet', 'LinkedHashSet', 'unordered_set', 'set'];

/** Map exception class names of any supported language to a canonical kind. */
export function excKind(name: string): ExcKind {
  const n = name.replace(/^std::/, '');
  if (/^(ValueError|IllegalArgumentException|NumberFormatException|invalid_argument|TypeError|IllegalStateException)$/.test(n)) return 'ValueError';
  if (/^(IndexError|IndexOutOfBoundsException|ArrayIndexOutOfBoundsException|StringIndexOutOfBoundsException|out_of_range|RangeError)$/.test(n)) return 'IndexError';
  if (/^(KeyError|NoSuchElementException)$/.test(n)) return 'KeyError';
  if (/^(ZeroDivisionError|ArithmeticException)$/.test(n)) return 'ZeroDivisionError';
  if (/^(RuntimeError|RuntimeException|runtime_error|Error|logic_error)$/.test(n)) return 'RuntimeError';
  return 'Exception';
}

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=', '**=', '//=']);

export function parseProgram(src: string, lang: Lang): Program {
  const p = new Parser(src, lang);
  const prog = lang === 'python' ? p.parsePython() : p.parseCFamily();
  return normalizeProgram(prog);
}

class Parser {
  toks: Token[];
  p = 0;
  warnings: string[] = [];
  py: boolean;
  scanners = new Set<string>();
  /** names of user-defined classes (pre-scanned so they can be recognised as types before their definition) */
  classNames = new Set<string>();
  /** nested Python functions moved to top level */
  hoisted: Func[] = [];

  constructor(private src: string, private lang: Lang) {
    this.toks = tokenize(src, lang);
    this.py = lang === 'python';
    for (let i = 0; i < this.toks.length - 1; i++) {
      const a = this.toks[i];
      const b = this.toks[i + 1];
      if (a.t === 'id' && (a.v === 'class' || a.v === 'struct') && b.t === 'id' && b.v !== 'Main') this.classNames.add(b.v);
    }
  }

  /** Consume a closing '>' of a generic, splitting '>>' / '>>>' tokens produced by the lexer. */
  closeAngle() {
    const t = this.peek();
    if (t.t === 'op' && t.v === '>') {
      this.p++;
      return;
    }
    if (t.t === 'op' && (t.v === '>>' || t.v === '>>>' || t.v === '>=' || t.v === '>>=')) {
      t.v = t.v.slice(1);
      return;
    }
    throw new ParseError("Expected '>'", t.line);
  }

  // ---------- token helpers ----------
  peek(o = 0): Token {
    return this.toks[Math.min(this.p + o, this.toks.length - 1)];
  }
  next(): Token {
    return this.toks[this.p++] ?? this.toks[this.toks.length - 1];
  }
  isOp(v: string, o = 0) {
    const t = this.peek(o);
    return t.t === 'op' && t.v === v;
  }
  isId(v?: string, o = 0) {
    const t = this.peek(o);
    return t.t === 'id' && (v === undefined || t.v === v);
  }
  eatOp(v: string) {
    if (this.isOp(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  eatId(v: string) {
    if (this.isId(v)) {
      this.p++;
      return true;
    }
    return false;
  }
  expectOp(v: string) {
    if (!this.eatOp(v)) {
      const t = this.peek();
      throw new ParseError(`Expected '${v}' but found '${t.v || t.t}'`, t.line);
    }
  }
  expectId(): string {
    const t = this.next();
    if (t.t !== 'id') throw new ParseError(`Expected identifier but found '${t.v || t.t}'`, t.line);
    return t.v;
  }
  rawFrom(startIdx: number): string {
    const s = this.toks[startIdx]?.pos ?? 0;
    const e = this.toks[this.p]?.pos ?? this.src.length;
    return this.src.slice(s, e).trim();
  }
  /** Skip a balanced region until `;` (depth 0) or a closing block; used for error recovery. */
  skipStatement(start: number) {
    this.p = start;
    let depth = 0;
    while (this.peek().t !== 'eof') {
      const t = this.next();
      if (t.t === 'op' && (t.v === '(' || t.v === '[' || t.v === '{')) depth++;
      if (t.t === 'op' && (t.v === ')' || t.v === ']' || t.v === '}')) {
        depth--;
        if (depth <= 0 && t.v === '}') {
          if (depth < 0) {
            this.p--;
            return;
          }
          if (this.isOp(';')) this.p++;
          return;
        }
      }
      if (depth <= 0 && t.t === 'op' && t.v === ';') return;
    }
  }
  skipPyLine(start: number) {
    this.p = start;
    // skip the line and any indented block following it
    while (this.peek().t !== 'nl' && this.peek().t !== 'eof') this.p++;
    if (this.peek().t === 'nl') this.p++;
    if (this.peek().t === 'indent') {
      let d = 0;
      while (this.peek().t !== 'eof') {
        const t = this.next();
        if (t.t === 'indent') d++;
        if (t.t === 'dedent') {
          d--;
          if (d === 0) break;
        }
      }
    }
  }

  // ================= C FAMILY =================
  parseCFamily(): Program {
    const prog: Program = { lang: this.lang, globals: [], funcs: [], classes: [], main: [], hasMain: false, warnings: this.warnings };
    const topLevel: Stmt[] = [];
    while (this.peek().t !== 'eof') {
      const t = this.peek();
      if (t.t === 'pp' ) {
        this.p++;
        continue;
      }
      if (t.t === 'comment') {
        this.p++;
        topLevel.push({ k: 'comment', text: t.v, line: t.line });
        continue;
      }
      if (this.isId('import') || this.isId('package') || (this.isId('using') && this.lang === 'cpp')) {
        this.skipStatement(this.p);
        continue;
      }
      if (this.isOp(';') || this.isOp('}')) {
        this.p++;
        continue;
      }
      // Java class wrapper
      const save = this.p;
      while (this.peek().t === 'id' && MODIFIERS.has(this.peek().v)) this.p++;
      if (this.isId('class') && this.lang === 'java' && !this.classHasMain()) {
        this.parseClassDef(prog);
        continue;
      }
      if (this.isId('class') && this.lang === 'java') {
        this.p++;
        prog.className = this.expectId();
        while (!this.isOp('{') && this.peek().t !== 'eof') this.p++;
        this.expectOp('{');
        this.parseClassBody(prog);
        continue;
      }
      this.p = save;
      this.parseTopLevelItem(prog, topLevel);
    }
    // decide on the main body
    const mainFn = prog.funcs.find((f) => f.name === 'main');
    if (mainFn) {
      prog.funcs = prog.funcs.filter((f) => f !== mainFn);
      prog.main = mainFn.body;
      const last = prog.main[prog.main.length - 1];
      if (last && last.k === 'return' && (!last.value || (last.value.k === 'num' && last.value.value === 0))) prog.main.pop();
      prog.hasMain = true;
      // JS: top-level statements other than main() call
      const rest = topLevel.filter((s) => !isCallTo(s, 'main'));
      for (const s of rest) {
        if (s.k === 'decl' || s.k === 'comment') prog.globals.push(s);
        else prog.main.unshift(s);
      }
    } else {
      // script style (JavaScript) — non declarations are main statements
      for (const s of topLevel) {
        if (this.lang !== 'javascript' && (s.k === 'decl' || s.k === 'comment')) prog.globals.push(s);
        else prog.main.push(s);
      }
    }
    return prog;
  }

  /** At a 'class' keyword: does the class body contain a main method? */
  classHasMain(): boolean {
    let i = this.p;
    while (i < this.toks.length && !(this.toks[i].t === 'op' && this.toks[i].v === '{')) i++;
    let depth = 0;
    for (; i < this.toks.length; i++) {
      const t = this.toks[i];
      if (t.t === 'op' && t.v === '{') depth++;
      if (t.t === 'op' && t.v === '}' && --depth === 0) return false;
      if (t.t === 'id' && t.v === 'main' && this.toks[i + 1]?.v === '(') return true;
    }
    return false;
  }

  /** Parse `class Name { fields; constructor; methods }` for C++, Java, JavaScript and C structs. */
  parseClassDef(prog: Program) {
    const line = this.peek().line;
    this.next(); // class / struct
    const name = this.expectId();
    this.classNames.add(name);
    if (!this.isOp('{')) {
      if (this.isId('extends') || this.isOp(':') || this.isId('implements')) this.warnings.push(`Line ${line}: inheritance of class ${name} is not converted; only its own members are kept.`);
      while (!this.isOp('{')) {
        if (this.peek().t === 'eof') throw new ParseError('Missing class body', line);
        this.p++;
      }
    }
    this.expectOp('{');
    const cls: ClassDef = { name, fields: [], ctor: null, methods: [], line };
    while (!this.isOp('}')) {
      const t = this.peek();
      if (t.t === 'eof') throw new ParseError(`Missing '}' for class ${name}`, line);
      if (t.t === 'comment' || this.isOp(';')) {
        this.p++;
        continue;
      }
      if ((this.isId('public') || this.isId('private') || this.isId('protected')) && this.isOp(':', 1)) {
        this.p += 2;
        continue;
      }
      const mline = this.peek().line;
      let isStatic = false;
      while (this.peek().t === 'id' && (MODIFIERS.has(this.peek().v) || ['virtual', 'explicit', 'friend', 'override', 'async'].includes(this.peek().v)) && !(this.lang === 'javascript' && this.isOp('(', 1))) {
        if (this.peek().v === 'static') isStatic = true;
        this.p++;
      }
      if (isStatic) this.warnings.push(`Line ${mline}: static members of ${name} are converted as instance members.`);
      if (this.isOp('~')) {
        // C++ destructor — memory is managed differently in other languages
        this.skipStatement(this.p);
        this.warnings.push(`Line ${mline}: destructor of ${name} was dropped.`);
        continue;
      }
      if (this.lang === 'javascript') {
        if ((this.isId('get') || this.isId('set')) && this.isId(undefined, 1) && this.isOp('(', 2)) this.p++;
        if (this.isId() && this.isOp('(', 1)) {
          const mname = this.expectId();
          const params = this.parseParams();
          const body = this.parseBlock();
          const f: Func = { name: mname, params, ret: { base: 'unknown', dims: 0 }, body, line: mline };
          if (mname === 'constructor') cls.ctor = f;
          else cls.methods.push(f);
          continue;
        }
        if (this.isId() && (this.isOp('=', 1) || this.isOp(';', 1))) {
          const fname = this.expectId();
          const init = this.eatOp('=') ? this.parseAssign() : undefined;
          this.eatOp(';');
          cls.fields.push({ name: fname, type: { base: 'unknown', dims: 0 }, init });
          continue;
        }
        throw new ParseError(`Unsupported member in class ${name}`, mline);
      }
      // constructor: Name(params) [: init-list] { body }
      if (this.isId(name) && this.isOp('(', 1)) {
        this.p++;
        const params = this.parseParams();
        const pre: Stmt[] = [];
        if (this.eatOp(':')) {
          do {
            const f = this.expectId();
            this.expectOp(this.isOp('{') ? '{' : '(');
            const v = this.isOp(')') || this.isOp('}') ? undefined : this.parseExpr();
            if (!this.eatOp(')')) this.expectOp('}');
            if (v) pre.push({ k: 'expr', expr: { k: 'assign', op: '=', target: { k: 'mem', obj: { k: 'this' }, prop: f }, value: v }, line: mline });
          } while (this.eatOp(','));
        }
        if (this.eatOp(';')) {
          this.warnings.push(`Line ${mline}: constructor declared without a body in the class is not converted.`);
          continue;
        }
        const body = this.parseBlock();
        cls.ctor = { name, params, ret: { base: 'void', dims: 0 }, body: [...pre, ...body], line: mline };
        continue;
      }
      const ty = this.tryParseType() ?? (this.isId() && this.isId(undefined, 1) ? null : null);
      if (!ty) throw new ParseError(`Unsupported member in class ${name}`, mline);
      if (this.isId() && this.isOp('(', 1)) {
        const mname = this.expectId();
        const params = this.parseParams();
        while (this.isId('const') || this.isId('override') || this.isId('noexcept')) this.p++;
        if (this.isId('throws')) while (!this.isOp('{') && !this.isOp(';')) this.p++;
        if (this.eatOp(';')) {
          this.warnings.push(`Line ${mline}: method ${name}::${mname} is defined outside the class and is not converted.`);
          continue;
        }
        const body = this.parseBlock();
        cls.methods.push({ name: mname, params, ret: ty, body, line: mline });
        continue;
      }
      for (const d of this.parseDeclarators(ty, mline, false)) if (d.k === 'decl') cls.fields.push({ name: d.name, type: d.type, init: d.init });
    }
    this.expectOp('}');
    this.eatOp(';');
    prog.classes.push(cls);
  }

  parseClassBody(prog: Program) {
    while (!this.isOp('}') && this.peek().t !== 'eof') {
      const t = this.peek();
      if (t.t === 'comment') {
        this.p++;
        prog.globals.push({ k: 'comment', text: t.v, line: t.line });
        continue;
      }
      if (this.isOp(';')) {
        this.p++;
        continue;
      }
      this.parseTopLevelItem(prog, prog.globals);
    }
    this.eatOp('}');
  }

  parseTopLevelItem(prog: Program, sink: Stmt[]) {
    const start = this.p;
    const line = this.peek().line;
    try {
      while (this.peek().t === 'id' && MODIFIERS.has(this.peek().v)) this.p++;
      if ((this.isId('class') || this.isId('struct')) && this.isId(undefined, 1) && (this.isOp('{', 2) || this.isOp(':', 2) || this.isId('extends', 2) || this.isId('implements', 2))) {
        this.parseClassDef(prog);
        return;
      }
      if (this.isId('struct') || this.isId('class') || this.isId('typedef') || this.isId('template') || this.isId('enum') || this.isId('interface') || this.isId('union')) {
        this.skipStatement(start);
        const text = this.rawFrom(start);
        sink.push({ k: 'raw', text, reason: `${this.toks[start].v === 'template' ? 'Templates' : 'User-defined types (struct/class/enum)'} are not supported by the offline converter`, line });
        this.warnings.push(`Line ${line}: user-defined types are not converted automatically.`);
        return;
      }
      if (this.lang === 'javascript' && this.isId('function')) {
        this.p++;
        const name = this.expectId();
        const params = this.parseParams();
        const body = this.parseBlock();
        prog.funcs.push({ name, params, ret: { base: 'unknown', dims: 0 }, body, line });
        return;
      }
      if (this.lang !== 'javascript') {
        const ty = this.tryParseType();
        if (ty && this.isId() && this.isOp('(', 1)) {
          const name = this.expectId();
          const params = this.parseParams();
          if (this.isId('throws')) {
            while (!this.isOp('{')) this.p++;
          }
          if (this.eatOp(';')) return; // prototype
          const body = this.parseBlock();
          prog.funcs.push({ name, params, ret: ty, body, line });
          return;
        }
        this.p = start;
      }
      sink.push(...this.parseCStmt());
    } catch (e) {
      this.skipStatement(start);
      const text = this.rawFrom(start);
      sink.push({ k: 'raw', text, reason: (e as Error).message, line });
      this.warnings.push(`Line ${line}: could not convert this section (${(e as Error).message}).`);
    }
  }

  parseParams(): Param[] {
    this.expectOp('(');
    const params: Param[] = [];
    while (!this.isOp(')')) {
      if (this.eatId('void') && this.isOp(')')) break;
      let type: TypeRef = { base: 'unknown', dims: 0 };
      if (this.lang !== 'javascript') {
        const t = this.tryParseType();
        if (!t) throw new ParseError('Could not read parameter type', this.peek().line);
        type = t;
      }
      this.eatOp('&');
      this.eatOp('...');
      const name = this.expectId();
      while (this.eatOp('[')) {
        while (!this.isOp(']')) this.p++;
        this.expectOp(']');
        type = { ...type, dims: type.dims + 1 };
      }
      if (this.eatOp('=')) this.parseExpr(); // default value (JS) — ignored
      params.push({ name, type });
      if (!this.eatOp(',')) break;
    }
    this.expectOp(')');
    return params;
  }

  /** Attempts to parse a C/C++/Java type at the cursor. Returns null (cursor unchanged) when not a type. */
  tryParseType(): TypeRef | null {
    const start = this.p;
    while (this.isId('const') || this.isId('final') || this.isId('static') || this.isId('unsigned') || this.isId('signed') || this.isId('struct')) this.p++;
    if (this.isId('std') && this.isOp('::', 1)) this.p += 2;
    const t = this.peek();
    if (t.t !== 'id') {
      this.p = start;
      return null;
    }
    let base: BaseType;
    let dims = 0;
    let dynamic = false;
    const word = t.v;
    const simple: Record<string, BaseType> = {
      int: 'int', short: 'int', byte: 'int', Integer: 'int', size_t: 'int', long: 'long', Long: 'long', float: 'double', double: 'double',
      Double: 'double', Float: 'double', char: 'char', Character: 'char', bool: 'bool', boolean: 'bool', Boolean: 'bool',
      string: 'string', String: 'string', void: 'void', auto: 'unknown', var: 'unknown', StringBuilder: 'string',
    };
    if (word in simple) {
      base = simple[word];
      this.p++;
      if (word === 'long' && this.isId('long')) this.p++;
      if ((word === 'long' || word === 'short') && this.isId('int')) this.p++;
    } else if (['vector', 'ArrayList', 'List', 'LinkedList', 'deque', 'Deque'].includes(word) && this.isOp('<', 1)) {
      this.p += 2;
      const inner = this.tryParseType();
      if (!inner) {
        this.p = start;
        return null;
      }
      this.closeAngle();
      base = inner.base;
      dims = inner.dims + 1;
      dynamic = true;
      if (inner.base === 'map' || inner.base === 'set' || inner.base === 'object') return { base: inner.base, dims, dynamic, key: inner.key, val: inner.val, cls: inner.cls };
    } else if ((MAP_TYPES.includes(word) || SET_TYPES.includes(word)) && this.isOp('<', 1) && this.isOp('>', 2)) {
      // Java diamond: new HashMap<>() — element types come from the declaration / usage
      this.p += 3;
      return MAP_TYPES.includes(word) ? { base: 'map', dims: 0, key: { base: 'unknown', dims: 0 }, val: { base: 'unknown', dims: 0 } } : { base: 'set', dims: 0, val: { base: 'unknown', dims: 0 } };
    } else if (MAP_TYPES.includes(word) && this.isOp('<', 1)) {
      this.p += 2;
      const key = this.tryParseType();
      if (!key || !this.eatOp(',')) throw new ParseError('Could not read map key type', t.line);
      const val = this.tryParseType();
      if (!val) throw new ParseError('Could not read map value type', t.line);
      this.closeAngle();
      this.eatOp('&');
      return { base: 'map', dims: 0, key, val };
    } else if (SET_TYPES.includes(word) && this.isOp('<', 1)) {
      this.p += 2;
      const val = this.tryParseType();
      if (!val) throw new ParseError('Could not read set element type', t.line);
      this.closeAngle();
      this.eatOp('&');
      return { base: 'set', dims: 0, val };
    } else if (this.classNames.has(word)) {
      this.p++;
      while (this.isOp('*')) this.p++;
      let cdims = 0;
      while (this.isOp('[') && this.isOp(']', 1)) {
        this.p += 2;
        cdims++;
      }
      this.eatOp('&');
      return { base: 'object', dims: cdims, cls: word };
    } else if (word === 'Scanner' || word === 'BufferedReader') {
      this.p++;
      base = 'unknown';
      (this as any)._scannerDecl = true;
    } else {
      this.p = start;
      return null;
    }
    // handle closing '>>' produced as one token for nested generics
    while (this.isOp('*') ) {
      this.p++;
      if (base === 'char') base = 'string';
      else dims++;
    }
    while (this.isOp('[') && this.isOp(']', 1)) {
      this.p += 2;
      dims++;
    }
    this.eatOp('&');
    return { base, dims, dynamic };
  }

  parseBlock(): Stmt[] {
    this.expectOp('{');
    const out: Stmt[] = [];
    while (!this.isOp('}')) {
      if (this.peek().t === 'eof') throw new ParseError("Missing closing '}'", this.peek().line);
      const start = this.p;
      const line = this.peek().line;
      try {
        out.push(...this.parseCStmt());
      } catch (e) {
        this.skipStatement(start);
        out.push({ k: 'raw', text: this.rawFrom(start), reason: (e as Error).message, line });
        this.warnings.push(`Line ${line}: could not convert statement (${(e as Error).message}).`);
      }
    }
    this.expectOp('}');
    return out;
  }

  parseBody(): Stmt[] {
    if (this.isOp('{')) return this.parseBlock();
    return this.parseCStmt();
  }

  parseCStmt(): Stmt[] {
    const t = this.peek();
    const line = t.line;
    if (t.t === 'comment') {
      this.p++;
      return [{ k: 'comment', text: t.v, line }];
    }
    if (t.t === 'pp') {
      this.p++;
      return [];
    }
    if (this.isOp('{')) return this.parseBlock();
    if (this.eatOp(';')) return [];
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.p++;
          this.expectOp('(');
          const cond = this.parseExpr();
          this.expectOp(')');
          const then = this.parseBody();
          const elifs: { cond: Expr; body: Stmt[] }[] = [];
          let els: Stmt[] | undefined;
          while (this.peek().t === 'comment' && this.isId('else', 1)) this.p++;
          while (this.isId('else')) {
            this.p++;
            if (this.isId('if')) {
              this.p++;
              this.expectOp('(');
              const c = this.parseExpr();
              this.expectOp(')');
              elifs.push({ cond: c, body: this.parseBody() });
            } else {
              els = this.parseBody();
              break;
            }
          }
          return [{ k: 'if', cond, then, elifs, else: els, line }];
        }
        case 'while': {
          this.p++;
          this.expectOp('(');
          const cond = this.parseExpr();
          this.expectOp(')');
          return [{ k: 'while', cond, body: this.parseBody(), line }];
        }
        case 'do': {
          this.p++;
          const body = this.parseBody();
          if (!this.eatId('while')) throw new ParseError("Expected 'while' after do-block", this.peek().line);
          this.expectOp('(');
          const cond = this.parseExpr();
          this.expectOp(')');
          this.eatOp(';');
          return [{ k: 'dowhile', cond, body, line }];
        }
        case 'for':
          return [this.parseCFor()];
        case 'return': {
          this.p++;
          if (this.eatOp(';')) return [{ k: 'return', line }];
          const value = this.parseExpr();
          this.eatOp(';');
          return [{ k: 'return', value, line }];
        }
        case 'break':
          this.p++;
          this.eatOp(';');
          return [{ k: 'break', line }];
        case 'continue':
          this.p++;
          this.eatOp(';');
          return [{ k: 'continue', line }];
        case 'switch':
          return this.parseSwitch();
        case 'cin':
          return [this.parseCin()];
        case 'cout':
        case 'cerr':
          return [this.parseCout()];
        case 'try':
          return [this.parseTryC()];
        case 'throw':
          return [this.parseThrowC()];
        case 'delete':
          this.skipStatement(this.p);
          return [];
        case 'goto':
        case 'class':
          throw new ParseError(`'${t.v}' statements are not supported offline`, line);
        case 'let':
        case 'const':
        case 'var':
          if (this.lang === 'javascript') {
            this.p++;
            return this.parseDeclarators({ base: 'unknown', dims: 0 }, line, t.v === 'const');
          }
      }
      // declarations
      const save = this.p;
      const ty = this.tryParseType();
      if (ty && (this as any)._scannerDecl) {
        (this as any)._scannerDecl = false;
        const name = this.peek().v;
        this.scanners.add(name);
        this.skipStatement(save);
        return [];
      }
      if (ty && this.isId() && !this.isOp('(', 1)) return this.parseDeclarators(ty, line, false);
      if (ty && this.isId() && this.isOp('(', 1) && (ty.dynamic || ty.base === 'object')) return this.parseDeclarators(ty, line, false);
      this.p = save;
    }
    // expression statement
    const expr = this.parseExpr();
    this.eatOp(';');
    return [this.exprToStmt(expr, line)];
  }

  parseDeclarators(type: TypeRef, line: number, isConst: boolean): Stmt[] {
    const out: Stmt[] = [];
    do {
      const name = this.expectId();
      let ty = { ...type };
      const sizes: Expr[] = [];
      while (this.eatOp('[')) {
        if (this.isOp(']')) sizes.push({ k: 'raw', text: '' });
        else sizes.push(this.parseExpr());
        this.expectOp(']');
        ty = { ...ty, dims: ty.dims + 1 };
      }
      let init: Expr | undefined;
      if (this.eatOp('=')) init = this.parseAssign();
      else if (this.isOp('(') && ty.base === 'object' && ty.dims === 0) {
        // C++: Node n(5);
        this.p++;
        const args: Expr[] = [];
        while (!this.isOp(')')) {
          args.push(this.parseAssign());
          if (!this.eatOp(',')) break;
        }
        this.expectOp(')');
        init = { k: 'new', cls: ty.cls!, args };
      } else if (this.isOp('(') && ty.dynamic) {
        // vector<int> v(n) / vector<int> v(n, 0)
        this.p++;
        const args: Expr[] = [];
        while (!this.isOp(')')) {
          args.push(this.parseAssign());
          if (!this.eatOp(',')) break;
        }
        this.expectOp(')');
        if (args.length) init = { k: 'newarr', elem: { base: ty.base, dims: ty.dims - 1 }, size: args[0], fill: args[1] };
      } else if (this.isOp('{') && (ty.dims > 0 || ty.base === 'map' || ty.base === 'set')) {
        init = this.parsePrimary();
      }
      if (!init && sizes.length === 1 && sizes[0].k !== 'raw') init = { k: 'newarr', elem: { base: ty.base, dims: 0 }, size: sizes[0] };
      if (ty.base === 'map' && ty.dims === 0) {
        if (!init) init = { k: 'maplit', entries: [] };
        else if (init.k === 'arr') init = { k: 'maplit', entries: init.items.map((it) => (it.k === 'arr' && it.items.length === 2 ? { key: it.items[0], value: it.items[1] } : { key: it, value: { k: 'null' } as Expr })) };
      }
      if (ty.base === 'set' && ty.dims === 0) {
        if (!init) init = { k: 'setlit', items: [] };
        else if (init.k === 'arr') init = { k: 'setlit', items: init.items };
      }
      if (!init && ty.base === 'object' && ty.dims === 0 && this.lang === 'cpp') init = { k: 'new', cls: ty.cls!, args: [] };
      if (ty.dims > 0 && sizes.length === 1 && sizes[0].k !== 'raw' && init?.k === 'arr') {
        // int a[5] = {0}  -> fixed size filled array
        if (init.items.length < 2) init = { k: 'newarr', elem: { base: ty.base, dims: 0 }, size: sizes[0], fill: init.items[0] };
      }
      out.push({ k: 'decl', name, type: ty, init, line, isConst });
    } while (this.eatOp(','));
    this.eatOp(';');
    return out;
  }

  parseCFor(): Stmt {
    const line = this.next().line; // 'for'
    this.expectOp('(');
    // for-each forms
    const save = this.p;
    if (this.lang === 'javascript' && (this.isId('const') || this.isId('let') || this.isId('var')) && this.isOp('[', 1)) {
      // for (const [k, v] of m) / of m.entries() / of Object.entries(o)
      this.p += 2;
      const kv = this.expectId();
      this.expectOp(',');
      const vv = this.expectId();
      this.expectOp(']');
      if (!this.eatId('of')) throw new ParseError("Expected 'of'", line);
      let iter = this.parseExpr();
      this.expectOp(')');
      if (iter.k === 'call' && iter.callee.k === 'mem' && iter.callee.prop === 'entries' && iter.args.length === 0) iter = iter.callee.obj;
      if (iter.k === 'call' && calleeName(iter.callee) === 'Object.entries') iter = iter.args[0];
      const body = this.parseBody();
      return { k: 'foreach', var: kv, iter, body: [{ k: 'decl', name: vv, type: { base: 'unknown', dims: 0 }, init: { k: 'idx', obj: iter, index: { k: 'id', name: kv } }, line }, ...body], line };
    }
    if (this.lang === 'java' && this.isId('Map') && this.isOp('.', 1) && this.isId('Entry', 2)) {
      this.p += 3;
      if (this.isOp('<')) {
        let d = 0;
        do {
          const t = this.next();
          if (t.v === '<') d++;
          if (t.v === '>') d--;
          if (t.v === '>>') d -= 2;
        } while (d > 0 && this.peek().t !== 'eof');
      }
      const ev = this.expectId();
      this.expectOp(':');
      let iter = this.parseExpr();
      this.expectOp(')');
      if (iter.k === 'call' && iter.callee.k === 'mem' && iter.callee.prop === 'entrySet') iter = iter.callee.obj;
      const key = `${ev}Key`;
      const m = iter;
      const body = mapStmts(this.parseBody(), (e) => {
        if (e.k === 'call' && e.callee.k === 'mem' && e.callee.obj.k === 'id' && e.callee.obj.name === ev) {
          if (e.callee.prop === 'getKey') return { k: 'id', name: key };
          if (e.callee.prop === 'getValue') return { k: 'idx', obj: m, index: { k: 'id', name: key } };
        }
        return e;
      });
      return { k: 'foreach', var: key, iter: m, body, line };
    }
    if (this.lang === 'javascript' && (this.isId('const') || this.isId('let') || this.isId('var')) && this.isId(undefined, 1) && (this.isId('of', 2) || this.isId('in', 2))) {
      this.p++;
      const v = this.expectId();
      const kind = this.next().v;
      const iter = this.parseExpr();
      this.expectOp(')');
      const body = this.parseBody();
      if (kind === 'in') throw new ParseError("'for...in' over object keys is not supported", line);
      return { k: 'foreach', var: v, iter, body, line };
    }
    if (this.lang !== 'javascript') {
      const ty = this.tryParseType();
      if (ty && (this.isId() || this.isOp('[')) && (this.isOp(':', 1) || this.isOp('[')))  {
        // C++17 structured binding: for (auto& [k, v] : m)
        if (this.eatOp('[')) {
          const kv = this.expectId();
          this.expectOp(',');
          const vv = this.expectId();
          this.expectOp(']');
          this.expectOp(':');
          const iter = this.parseExpr();
          this.expectOp(')');
          const body = this.parseBody();
          return { k: 'foreach', var: kv, iter, body: [{ k: 'decl', name: vv, type: { base: 'unknown', dims: 0 }, init: { k: 'idx', obj: iter, index: { k: 'id', name: kv } }, line }, ...body], line };
        }
        const v = this.expectId();
        this.expectOp(':');
        const iter = this.parseExpr();
        this.expectOp(')');
        let body = this.parseBody();
        // C++ map iteration: p.first / p.second
        let usesPair = false;
        walkStmts(body, { expr: (e) => e.k === 'mem' && e.obj.k === 'id' && e.obj.name === v && (e.prop === 'first' || e.prop === 'second') && (usesPair = true) });
        if (usesPair && this.lang === 'cpp') {
          const key = `${v}_key`;
          body = mapStmts(body, (e) => (e.k === 'mem' && e.obj.k === 'id' && e.obj.name === v ? (e.prop === 'first' ? { k: 'id', name: key } : e.prop === 'second' ? { k: 'idx', obj: iter, index: { k: 'id', name: key } } : e) : e));
          return { k: 'foreach', var: key, iter, body, line };
        }
        return { k: 'foreach', var: v, varType: ty.base === 'unknown' ? undefined : ty, iter, body, line };
      }
      this.p = save;
    }
    let init: Stmt[] = [];
    if (!this.isOp(';')) {
      if (this.lang === 'javascript' && (this.isId('let') || this.isId('var') || this.isId('const'))) {
        this.p++;
        init = this.parseDeclarators({ base: 'unknown', dims: 0 }, line, false);
      } else {
        const ty = this.lang === 'javascript' ? null : this.tryParseType();
        if (ty && this.isId()) init = this.parseDeclarators(ty, line, false);
        else {
          const exprs: Stmt[] = [this.exprToStmt(this.parseExpr(), line)];
          while (this.eatOp(',')) exprs.push(this.exprToStmt(this.parseExpr(), line));
          init = exprs;
          this.expectOp(';');
        }
      }
    } else this.expectOp(';');
    const cond = this.isOp(';') ? undefined : this.parseExpr();
    this.expectOp(';');
    const update: Expr[] = [];
    while (!this.isOp(')')) {
      update.push(this.parseExpr());
      if (!this.eatOp(',')) break;
    }
    this.expectOp(')');
    const body = this.parseBody();
    return toRangeOrFor({ k: 'for', init, cond, update, body, line });
  }

  parseTryC(): Stmt {
    const line = this.next().line; // try
    const body = this.parseBlock();
    const catches: { kind: ExcKind; var: string | null; body: Stmt[] }[] = [];
    while (this.eatId('catch')) {
      let kind: ExcKind = 'Exception';
      let v: string | null = null;
      if (this.eatOp('(')) {
        if (this.eatOp('...')) kind = 'Exception';
        else {
          const ids: string[] = [];
          while (!this.isOp(')')) {
            const t = this.next();
            if (t.t === 'eof') throw new ParseError('Unterminated catch', line);
            if (t.t === 'id' && t.v !== 'const' && t.v !== 'std' && t.v !== 'final') ids.push(t.v);
          }
          if (ids.length === 1 && this.lang === 'javascript') v = ids[0];
          else if (ids.length >= 1) {
            v = ids.length >= 2 ? ids[ids.length - 1] : null;
            const typeNames = ids.length >= 2 ? ids.slice(0, -1) : ids;
            const kinds = [...new Set(typeNames.map(excKind))];
            kind = kinds.length === 1 ? kinds[0] : 'Exception';
          }
        }
        this.expectOp(')');
      }
      catches.push({ kind, var: v, body: this.parseBlock() });
    }
    const fin = this.eatId('finally') ? this.parseBlock() : undefined;
    return { k: 'try', body, catches, finally: fin, line };
  }

  parseThrowC(): Stmt {
    const line = this.next().line; // throw
    if (this.eatOp(';')) return { k: 'throw', kind: 'Exception', line };
    this.eatId('new');
    if (this.isId('std') && this.isOp('::', 1)) this.p += 2;
    if (!this.isId()) throw new ParseError('Only exception objects can be thrown', line);
    const name = this.expectId();
    let message: Expr | undefined;
    if (this.eatOp('(')) {
      if (!this.isOp(')')) message = this.parseExpr();
      while (!this.isOp(')')) this.p++;
      this.expectOp(')');
    }
    this.eatOp(';');
    return { k: 'throw', kind: excKind(name), message, line };
  }

  parseSwitch(): Stmt[] {
    const line = this.next().line;
    this.expectOp('(');
    const subject = this.parseExpr();
    this.expectOp(')');
    this.expectOp('{');
    const cases: { values: Expr[]; body: Stmt[]; isDefault: boolean }[] = [];
    let cur: { values: Expr[]; body: Stmt[]; isDefault: boolean } | null = null;
    while (!this.isOp('}')) {
      if (this.eatId('case')) {
        const v = this.parseTernary();
        this.expectOp(':');
        if (cur && cur.body.length === 0) cur.values.push(v);
        else {
          cur = { values: [v], body: [], isDefault: false };
          cases.push(cur);
        }
        continue;
      }
      if (this.eatId('default')) {
        this.expectOp(':');
        cur = { values: [], body: [], isDefault: true };
        cases.push(cur);
        continue;
      }
      if (!cur) throw new ParseError('Statement before first case', this.peek().line);
      cur.body.push(...this.parseCStmt());
    }
    this.expectOp('}');
    const conds = cases.filter((c) => !c.isDefault);
    const def = cases.find((c) => c.isDefault);
    const strip = (b: Stmt[], isLast = false) => {
      const last = b[b.length - 1];
      if (last && last.k === 'break') return b.slice(0, -1);
      if (!isLast && b.length && !['return', 'break', 'continue'].includes(last.k)) this.warnings.push(`Line ${line}: switch case falls through; converted as independent branches.`);
      return b;
    };
    const mk = (c: { values: Expr[] }): Expr =>
      c.values.map((v) => ({ k: 'bin', op: '==', left: subject, right: v }) as Expr).reduce((a, b) => ({ k: 'bin', op: '||', left: a, right: b }));
    if (!conds.length) return def ? strip(def.body) : [];
    return [
      {
        k: 'if',
        cond: mk(conds[0]),
        then: strip(conds[0].body),
        elifs: conds.slice(1).map((c, i) => ({ cond: mk(c), body: strip(c.body, !def && i === conds.length - 2) })),
        else: def ? strip(def.body, true) : undefined,
        line,
      },
    ];
  }

  parseCin(): Stmt {
    const line = this.next().line;
    const targets: Expr[] = [];
    while (this.eatOp('>>')) targets.push(this.parsePostfix());
    this.eatOp(';');
    return { k: 'read', targets, kinds: targets.map(() => 'word'), line };
  }

  parseCout(): Stmt {
    const line = this.next().line;
    const parts: PrintPart[] = [];
    let newline = false;
    let precision: number | undefined;
    while (this.eatOp('<<')) {
      if (this.isId('endl') || (this.isId('std') && this.isOp('::', 1) && this.isId('endl', 2))) {
        this.p += this.isId('std') ? 3 : 1;
        parts.push({ text: '\n' });
        continue;
      }
      if (this.isId('fixed') || this.isId('setprecision') || (this.isId('std') && (this.isId('fixed', 2) || this.isId('setprecision', 2)))) {
        if (this.isId('std')) this.p += 2;
        if (this.eatId('setprecision')) {
          this.expectOp('(');
          const pe = this.parseExpr();
          this.expectOp(')');
          if (pe.k === 'num') precision = pe.value;
          else this.warnings.push(`Line ${line}: setprecision formatting is approximated.`);
        } else this.p++;
        continue;
      }
      const e = this.parseBinary(11);
      if (e.k === 'str') parts.push({ text: e.value });
      else if (e.k === 'char') parts.push({ text: e.value });
      else parts.push({ expr: e, precision, _fixedCandidate: true } as PrintPart);
    }
    this.eatOp(';');
    // trailing newline
    const last = parts[parts.length - 1];
    if (last?.text?.endsWith('\n')) {
      newline = true;
      last.text = last.text.slice(0, -1);
      if (!last.text) parts.pop();
    }
    return { k: 'print', parts: mergeText(parts), newline, line };
  }

  exprToStmt(expr: Expr, line: number): Stmt {
    // printing / reading calls
    if (expr.k === 'call') {
      const name = calleeName(expr.callee);
      if (name === 'printf' || name === 'System.out.printf' || name === 'System.out.format') {
        const [fmt, ...args] = expr.args;
        if (fmt?.k !== 'str') throw new ParseError('printf with non-literal format string', line);
        const { parts, newline } = parseFormat(fmt.value, args, this.warnings, line);
        return { k: 'print', parts, newline, line };
      }
      if (name === 'puts') return { k: 'print', parts: argParts(expr.args[0]), newline: true, line };
      if (name === 'putchar') return { k: 'print', parts: argParts(expr.args[0]), newline: false, line };
      if (name === 'System.out.println' || name === 'console.log') {
        const parts: PrintPart[] = [];
        expr.args.forEach((a, i) => {
          if (i > 0) parts.push({ text: ' ' });
          parts.push(...argParts(a));
        });
        return { k: 'print', parts: mergeText(parts), newline: true, line };
      }
      if (name === 'System.out.print' || name === 'process.stdout.write')
        return { k: 'print', parts: mergeText(argParts(expr.args[0])), newline: false, line };
      if (name === 'scanf') {
        const [fmt, ...args] = expr.args;
        const kinds = fmt?.k === 'str' ? (fmt.value.match(/%[0-9]*l*[a-z]/g) || []).map(specKind) : args.map(() => 'int' as const);
        return { k: 'read', targets: args.map((a) => (a.k === 'un' && a.op === '&' ? a.arg : a)), kinds, line };
      }
      if (name === 'getline') return { k: 'read', targets: [expr.args[1]], kinds: ['line'], line };
    }
    return { k: 'expr', expr, line };
  }

  // ================= PYTHON =================
  parsePython(): Program {
    const prog: Program = { lang: 'python', globals: [], funcs: [], classes: [], main: [], hasMain: false, warnings: this.warnings };
    const top: Stmt[] = [];
    while (this.peek().t !== 'eof') {
      if (this.peek().t === 'nl' || this.peek().t === 'dedent' || this.peek().t === 'indent') {
        this.p++;
        continue;
      }
      const start = this.p;
      const line = this.peek().line;
      try {
        if (this.isId('def')) {
          prog.funcs.push(this.parsePyDef());
          continue;
        }
        if (this.isId('class')) {
          prog.classes.push(this.parsePyClass());
          continue;
        }
        if (this.isOp('@')) {
          this.warnings.push(`Line ${line}: decorator ignored.`);
          while (this.peek().t !== 'nl' && this.peek().t !== 'eof') this.p++;
          continue;
        }
        if (this.isId('if') && this.isId('__name__', 1)) {
          // if __name__ == "__main__":
          while (!this.isOp(':')) this.p++;
          this.p++;
          const body = this.parsePySuite();
          prog.hasMain = true;
          top.push(...body);
          continue;
        }
        top.push(...this.parsePyStmt());
      } catch (e) {
        this.skipPyLine(start);
        top.push({ k: 'raw', text: this.rawFrom(start), reason: (e as Error).message, line });
        this.warnings.push(`Line ${line}: could not convert statement (${(e as Error).message}).`);
      }
    }
    prog.funcs.push(...this.hoisted);
    const mainFn = prog.funcs.find((f) => f.name === 'main');
    const onlyCallsMain = top.filter((s) => s.k !== 'comment').every((s) => isCallTo(s, 'main'));
    if (mainFn && onlyCallsMain) {
      prog.funcs = prog.funcs.filter((f) => f !== mainFn);
      prog.main = mainFn.body;
      prog.hasMain = true;
      prog.globals.push(...top.filter((s) => s.k === 'comment'));
    } else {
      prog.main = top;
    }
    return prog;
  }

  parsePyDef(): Func {
    const line = this.next().line;
    const name = this.expectId();
    this.expectOp('(');
    const params: Param[] = [];
    while (!this.isOp(')')) {
      const pn = this.expectId();
      let type: TypeRef = { base: 'unknown', dims: 0 };
      if (this.eatOp(':')) type = this.parsePyAnnotation();
      if (this.eatOp('=')) this.parseExpr();
      params.push({ name: pn, type });
      if (!this.eatOp(',')) break;
    }
    this.expectOp(')');
    let ret: TypeRef = { base: 'unknown', dims: 0 };
    if (this.eatOp('->')) ret = this.parsePyAnnotation();
    this.expectOp(':');
    const body = this.parsePySuite();
    return { name, params, ret, body, line };
  }

  parsePyClass(): ClassDef {
    const line = this.next().line; // class
    const name = this.expectId();
    this.classNames.add(name);
    if (this.eatOp('(')) {
      const bases: string[] = [];
      while (!this.isOp(')')) {
        const t = this.next();
        if (t.t === 'id') bases.push(t.v);
      }
      this.expectOp(')');
      if (bases.some((b) => b !== 'object')) this.warnings.push(`Line ${line}: inheritance of class ${name} is not converted; only its own members are kept.`);
    }
    this.expectOp(':');
    const cls: ClassDef = { name, fields: [], ctor: null, methods: [], line };
    if (this.peek().t !== 'nl') throw new ParseError('Expected an indented class body', line);
    this.p++;
    while (this.peek().t === 'comment') this.p++;
    if (this.peek().t !== 'indent') throw new ParseError('Expected an indented class body', line);
    this.p++;
    while (this.peek().t !== 'dedent' && this.peek().t !== 'eof') {
      const t = this.peek();
      if (t.t === 'nl' || t.t === 'comment') {
        this.p++;
        continue;
      }
      if (this.isOp('@')) {
        this.warnings.push(`Line ${t.line}: decorator ${this.peek(1).v} ignored.`);
        while (this.peek().t !== 'nl' && this.peek().t !== 'eof') this.p++;
        continue;
      }
      if (this.isId('pass') || t.t === 'str') {
        while (this.peek().t !== 'nl' && this.peek().t !== 'eof') this.p++;
        continue;
      }
      if (this.isId('def')) {
        const f = this.parsePyDef();
        const self = f.params.shift();
        (f as Func & { selfName?: string }).selfName = self?.name ?? 'self';
        if (f.name === '__init__') cls.ctor = f;
        else cls.methods.push(f);
        continue;
      }
      if (this.isId() && (this.isOp('=', 1) || this.isOp(':', 1))) {
        const fname = this.expectId();
        let type: TypeRef = { base: 'unknown', dims: 0 };
        if (this.eatOp(':')) type = this.parsePyAnnotation();
        const init = this.eatOp('=') ? this.parseExpr() : undefined;
        if (this.peek().t === 'nl') this.p++;
        cls.fields.push({ name: fname, type, init });
        continue;
      }
      throw new ParseError(`Unsupported statement in class ${name}`, t.line);
    }
    this.p++; // dedent
    return cls;
  }

  parsePyTry(): Stmt {
    const line = this.next().line; // try
    this.expectOp(':');
    const body = this.parsePySuite();
    const catches: { kind: ExcKind; var: string | null; body: Stmt[] }[] = [];
    while (this.eatId('except')) {
      let kind: ExcKind = 'Exception';
      let v: string | null = null;
      if (!this.isOp(':')) {
        const names: string[] = [];
        if (this.eatOp('(')) {
          while (!this.isOp(')')) {
            const t = this.next();
            if (t.t === 'id') names.push(t.v);
          }
          this.expectOp(')');
        } else names.push(this.expectId());
        const kinds = [...new Set(names.map(excKind))];
        kind = kinds.length === 1 ? kinds[0] : 'Exception';
        if (this.eatId('as')) v = this.expectId();
      }
      this.expectOp(':');
      catches.push({ kind, var: v, body: this.parsePySuite() });
    }
    if (this.isId('else')) throw new ParseError('try/except/else is not supported', line);
    let fin: Stmt[] | undefined;
    if (this.eatId('finally')) {
      this.expectOp(':');
      fin = this.parsePySuite();
    }
    return { k: 'try', body, catches, finally: fin, line };
  }

  parsePyAnnotation(): TypeRef {
    const w = this.expectId();
    const map: Record<string, BaseType> = { int: 'int', float: 'double', str: 'string', bool: 'bool', None: 'void' };
    if ((w === 'dict' || w === 'Dict') && this.eatOp('[')) {
      const key = this.parsePyAnnotation();
      this.expectOp(',');
      const val = this.parsePyAnnotation();
      this.expectOp(']');
      return { base: 'map', dims: 0, key, val };
    }
    if ((w === 'set' || w === 'Set') && this.eatOp('[')) {
      const val = this.parsePyAnnotation();
      this.expectOp(']');
      return { base: 'set', dims: 0, val };
    }
    if (this.classNames.has(w)) return { base: 'object', dims: 0, cls: w };
    if (w === 'list' || w === 'List') {
      if (this.eatOp('[')) {
        const inner = this.parsePyAnnotation();
        this.expectOp(']');
        return { base: inner.base, dims: inner.dims + 1, dynamic: true };
      }
      return { base: 'unknown', dims: 1, dynamic: true };
    }
    return { base: map[w] ?? 'unknown', dims: 0 };
  }

  parsePySuite(): Stmt[] {
    if (this.peek().t !== 'nl') {
      // single-line suite: if x: return y
      const s = this.parsePySimple();
      return s;
    }
    this.p++;
    while (this.peek().t === 'comment') this.p++;
    if (this.peek().t !== 'indent') throw new ParseError('Expected an indented block', this.peek().line);
    this.p++;
    const out: Stmt[] = [];
    while (this.peek().t !== 'dedent' && this.peek().t !== 'eof') {
      if (this.peek().t === 'nl') {
        this.p++;
        continue;
      }
      const start = this.p;
      const line = this.peek().line;
      try {
        out.push(...this.parsePyStmt());
      } catch (e) {
        this.skipPyLine(start);
        out.push({ k: 'raw', text: this.rawFrom(start), reason: (e as Error).message, line });
        this.warnings.push(`Line ${line}: could not convert statement (${(e as Error).message}).`);
      }
    }
    this.p++; // dedent
    return out;
  }

  parsePyStmt(): Stmt[] {
    const t = this.peek();
    const line = t.line;
    if (t.t === 'comment') {
      this.p++;
      return [{ k: 'comment', text: t.v, line }];
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': {
          this.p++;
          const cond = this.parseExpr();
          this.expectOp(':');
          const then = this.parsePySuite();
          const elifs: { cond: Expr; body: Stmt[] }[] = [];
          let els: Stmt[] | undefined;
          while (this.isId('elif')) {
            this.p++;
            const c = this.parseExpr();
            this.expectOp(':');
            elifs.push({ cond: c, body: this.parsePySuite() });
          }
          if (this.eatId('else')) {
            this.expectOp(':');
            els = this.parsePySuite();
          }
          return [{ k: 'if', cond, then, elifs, else: els, line }];
        }
        case 'while': {
          this.p++;
          const cond = this.parseExpr();
          this.expectOp(':');
          const body = this.parsePySuite();
          if (this.isId('else')) throw new ParseError('while-else is not supported', line);
          return [{ k: 'while', cond, body, line }];
        }
        case 'for':
          return [this.parsePyFor()];
        case 'def': {
          const f = this.parsePyDef();
          this.hoisted.push(f);
          this.warnings.push(`Line ${line}: nested function ${f.name}() was moved to the top level; it must not rely on variables of the enclosing function.`);
          return [];
        }
        case 'try':
          return [this.parsePyTry()];
        case 'raise': {
          this.p++;
          if (this.peek().t === 'nl' || this.peek().t === 'eof') {
            if (this.peek().t === 'nl') this.p++;
            return [{ k: 'throw', kind: 'Exception', line }];
          }
          const ex = this.parseExpr();
          if (this.peek().t === 'nl') this.p++;
          if (ex.k === 'call' && ex.callee.k === 'id') return [{ k: 'throw', kind: excKind(ex.callee.name), message: ex.args[0], line }];
          if (ex.k === 'id') return [{ k: 'throw', kind: excKind(ex.name), line }];
          throw new ParseError('Unsupported raise statement', line);
        }
        case 'class':
        case 'with':
        case 'lambda':
        case 'global':
        case 'nonlocal':
        case 'yield':
        case 'async':
        case 'del':
          throw new ParseError(`'${t.v}' is not supported by the offline converter`, line);
      }
    }
    return this.parsePySimple();
  }

  parsePySimple(): Stmt[] {
    const t = this.peek();
    const line = t.line;
    const end = () => {
      if (this.peek().t === 'comment') this.p++;
      if (this.peek().t === 'nl') this.p++;
    };
    if (this.isId('import') || this.isId('from')) {
      while (this.peek().t !== 'nl' && this.peek().t !== 'eof') this.p++;
      end();
      return [];
    }
    if (this.eatId('pass')) {
      end();
      return [];
    }
    if (this.eatId('return')) {
      if (this.peek().t === 'nl' || this.peek().t === 'comment') {
        end();
        return [{ k: 'return', line }];
      }
      const value = this.parseExpr();
      if (this.isOp(',')) throw new ParseError('Returning multiple values (tuples) is not supported', line);
      end();
      return [{ k: 'return', value, line }];
    }
    if (this.eatId('break')) {
      end();
      return [{ k: 'break', line }];
    }
    if (this.eatId('continue')) {
      end();
      return [{ k: 'continue', line }];
    }
    // print(...)
    if (this.isId('print') && this.isOp('(', 1)) {
      this.p += 2;
      const args: Expr[] = [];
      let sep = ' ';
      let endStr = '\n';
      while (!this.isOp(')')) {
        if (this.isId() && this.isOp('=', 1) && (this.isId('sep') || this.isId('end'))) {
          const kw = this.next().v;
          this.p++;
          const v = this.parseExpr();
          if (v.k !== 'str') throw new ParseError(`print(${kw}=...) must be a string literal`, line);
          if (kw === 'sep') sep = v.value;
          else endStr = v.value;
        } else args.push(this.parseExpr());
        if (!this.eatOp(',')) break;
      }
      this.expectOp(')');
      end();
      const parts: PrintPart[] = [];
      args.forEach((a, i) => {
        if (i > 0 && sep) parts.push({ text: sep });
        parts.push(...argParts(a));
      });
      let newline = false;
      if (endStr.endsWith('\n')) {
        newline = true;
        endStr = endStr.slice(0, -1);
      }
      if (endStr) parts.push({ text: endStr });
      return [{ k: 'print', parts: mergeText(parts), newline, line }];
    }
    // tuple assignment: a, b = x, y
    const startP = this.p;
    if (this.isId() && this.isOp(',', 1)) {
      const targets: Expr[] = [];
      do targets.push(this.parsePostfix());
      while (this.eatOp(','));
      if (this.eatOp('=')) {
        const values: Expr[] = [];
        const first = this.parseExpr();
        values.push(first);
        while (this.eatOp(',')) values.push(this.parseExpr());
        end();
        // a, b = map(int, input().split())
        if (values.length === 1 && isMapIntInput(first)) {
          const kind = (first as any)._kind as 'int' | 'double';
          return [{ k: 'read', targets, kinds: targets.map(() => kind), line }];
        }
        if (values.length !== targets.length) throw new ParseError('Tuple unpacking with mismatched sizes is not supported', line);
        const out: Stmt[] = [];
        values.forEach((v, i) => out.push({ k: 'expr', expr: { k: 'assign', op: '=', target: { k: 'id', name: `_t${i}` }, value: v }, line }));
        targets.forEach((tg, i) => out.push({ k: 'expr', expr: { k: 'assign', op: '=', target: tg, value: { k: 'id', name: `_t${i}` } }, line }));
        return out;
      }
      this.p = startP;
    }
    // annotated assignment x: int = 5
    if (this.isId() && this.isOp(':', 1)) {
      const name = this.expectId();
      this.p++;
      const type = this.parsePyAnnotation();
      let init: Expr | undefined;
      if (this.eatOp('=')) init = this.parseExpr();
      end();
      return [{ k: 'decl', name, type, init, line }];
    }
    const expr = this.parseExpr();
    if (this.isOp(',')) throw new ParseError('Tuples are not supported by the offline converter', line);
    end();
    return [{ k: 'expr', expr, line }];
  }

  parsePyFor(): Stmt {
    const line = this.next().line;
    const v = this.expectId();
    if (this.eatOp(',')) {
      const v2 = this.expectId();
      if (!this.eatId('in')) throw new ParseError("Expected 'in'", line);
      const it = this.parseExpr();
      this.expectOp(':');
      const body = this.parsePySuite();
      if (it.k === 'call' && calleeName(it.callee) === 'enumerate' && it.args.length === 1) {
        const arr = it.args[0];
        return {
          k: 'range', var: v, start: num(0), end: { k: 'call', callee: { k: 'id', name: 'len' }, args: [arr] }, step: 1, declared: false,
          body: [{ k: 'expr', expr: { k: 'assign', op: '=', target: { k: 'id', name: v2 }, value: { k: 'idx', obj: arr, index: { k: 'id', name: v } } }, line }, ...body],
          line,
        };
      }
      if (it.k === 'call' && it.callee.k === 'mem' && it.callee.prop === 'items' && it.args.length === 0) {
        const m = it.callee.obj;
        return { k: 'foreach', var: v, iter: m, body: [{ k: 'expr', expr: { k: 'assign', op: '=', target: { k: 'id', name: v2 }, value: { k: 'idx', obj: m, index: { k: 'id', name: v } } }, line }, ...body], line };
      }
      throw new ParseError('Multiple loop variables are only supported with enumerate() and dict.items()', line);
    }
    if (!this.eatId('in')) throw new ParseError("Expected 'in'", line);
    const it = this.parseExpr();
    this.expectOp(':');
    const body = this.parsePySuite();
    if (it.k === 'call' && calleeName(it.callee) === 'range') {
      const a = it.args;
      let start: Expr = num(0);
      let endE: Expr;
      let step = 1;
      if (a.length === 1) endE = a[0];
      else {
        start = a[0];
        endE = a[1];
      }
      if (a.length === 3) {
        const s = a[2];
        if (s.k === 'num') step = s.value;
        else if (s.k === 'un' && s.op === '-' && s.arg.k === 'num') step = -s.arg.value;
        else throw new ParseError('range() step must be a numeric literal', line);
      }
      return { k: 'range', var: v, start, end: endE, step, declared: false, body, line };
    }
    return { k: 'foreach', var: v, iter: it, body, line };
  }

  // ================= EXPRESSIONS =================
  parseExpr(): Expr {
    return this.parseAssign();
  }

  parseAssign(): Expr {
    const left = this.parseTernary();
    const t = this.peek();
    if (t.t === 'op' && ASSIGN_OPS.has(t.v)) {
      this.p++;
      const value = this.parseAssign();
      return { k: 'assign', op: t.v, target: left, value };
    }
    if (t.t === 'op' && t.v === ':=') throw new ParseError('Walrus operator is not supported', t.line);
    return left;
  }

  parseTernary(): Expr {
    const cond = this.parseBinary(0);
    if (!this.py && this.eatOp('?')) {
      const a = this.parseAssign();
      this.expectOp(':');
      const b = this.parseAssign();
      return { k: 'tern', cond, then: a, else: b };
    }
    if (this.py && this.isId('if')) {
      // only when inside an expression (x if c else y)
      const save = this.p;
      this.p++;
      const c = this.parseBinary(0);
      if (this.eatId('else')) {
        const b = this.parseTernary();
        return { k: 'tern', cond: c, then: cond, else: b };
      }
      this.p = save;
    }
    return cond;
  }

  binOpAt(): string | null {
    const t = this.peek();
    if (this.py) {
      if (t.t === 'id') {
        if (t.v === 'not' && this.isId('in', 1)) return 'not in';
        if (t.v === 'is' && this.isId('not', 1)) return 'is not';
        if (t.v in PY_BIN_PREC) return t.v;
        return null;
      }
      if (t.t === 'op' && t.v in PY_BIN_PREC) return t.v;
      return null;
    }
    if (t.t === 'op' && t.v in C_BIN_PREC) return t.v;
    if (t.t === 'id' && t.v === 'instanceof') return t.v;
    return null;
  }

  parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const op = this.binOpAt();
      if (!op) break;
      const table = this.py ? PY_BIN_PREC : C_BIN_PREC;
      const prec = table[op];
      if (prec < minPrec) break;
      this.p += op.includes(' ') ? 2 : 1;
      const right = op === '**' ? this.parseBinary(prec) : this.parseBinary(prec + 1);
      left = { k: 'bin', op: normOp(op), left, right };
    }
    return left;
  }

  parseUnary(): Expr {
    const t = this.peek();
    if (this.py && t.t === 'id' && t.v === 'not') {
      this.p++;
      return { k: 'un', op: '!', arg: this.parseBinary(5) };
    }
    if (t.t === 'op') {
      if (t.v === '!' || t.v === '-' || t.v === '+' || t.v === '~' || t.v === '&' || t.v === '*') {
        this.p++;
        const arg = this.parseUnary();
        if (t.v === '*') return arg; // pointer deref — treated as value
        if (t.v === '-' && arg.k === 'num') return { ...arg, value: -arg.value, raw: '-' + arg.raw };
        return { k: 'un', op: t.v, arg };
      }
      if (t.v === '++' || t.v === '--') {
        this.p++;
        return { k: 'upd', op: t.v, prefix: true, arg: this.parseUnary() };
      }
      // C-style cast
      if (t.v === '(' && !this.py && this.lang !== 'javascript') {
        const save = this.p;
        this.p++;
        const ty = this.tryParseType();
        if (ty && this.isOp(')') && ty.dims === 0) {
          this.p++;
          return { k: 'cast', to: ty, arg: this.parseUnary() };
        }
        this.p = save;
      }
    }
    if (t.t === 'id' && (t.v === 'typeof' || t.v === 'sizeof') && this.lang !== 'python') {
      this.p++;
      const arg = this.parseUnary();
      return { k: 'call', callee: { k: 'id', name: t.v }, args: [arg] };
    }
    return this.parsePostfix();
  }

  parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      if (this.isOp('(')) {
        this.p++;
        const args: Expr[] = [];
        while (!this.isOp(')')) {
          if (this.py && this.isId() && this.isOp('=', 1)) throw new ParseError('Keyword arguments are not supported', this.peek().line);
          args.push(this.parseAssign());
          if (!this.eatOp(',')) break;
        }
        this.expectOp(')');
        e = { k: 'call', callee: e, args };
      } else if (this.isOp('[')) {
        this.p++;
        if (this.py && this.isOp(':')) {
          this.p++;
          const end = this.isOp(']') ? undefined : this.parseExpr();
          if (this.isOp(':')) throw new ParseError('Slices with a step are not supported', this.peek().line);
          this.expectOp(']');
          e = { k: 'slice', obj: e, end };
          continue;
        }
        const index = this.parseExpr();
        if (this.py && this.isOp(':')) {
          this.p++;
          const end = this.isOp(']') ? undefined : this.parseExpr();
          if (this.isOp(':')) throw new ParseError('Slices with a step are not supported', this.peek().line);
          this.expectOp(']');
          e = { k: 'slice', obj: e, start: index, end };
          continue;
        }
        this.expectOp(']');
        e = { k: 'idx', obj: e, index };
      } else if (this.isOp('.') || this.isOp('->') || this.isOp('::')) {
        const sep = this.next().v;
        const prop = this.expectId();
        if (sep === '::' && e.k === 'id' && e.name === 'std') e = { k: 'id', name: prop };
        else e = { k: 'mem', obj: e, prop };
      } else if (!this.py && (this.isOp('++') || this.isOp('--'))) {
        const op = this.next().v as '++' | '--';
        e = { k: 'upd', op, prefix: false, arg: e };
      } else break;
    }
    return e;
  }

  parsePrimary(): Expr {
    const t = this.next();
    switch (t.t) {
      case 'num': {
        const clean = t.v.replace(/[_lLuU]/g, '').replace(/[fFdD]$/, (m) => (/^0x/i.test(t.v) ? m : ''));
        const isFloat = !/^0x/i.test(t.v) && (/[.eE]/.test(clean) || /[fFdD]$/.test(t.v));
        return { k: 'num', value: Number(clean), raw: clean, float: isFloat };
      }
      case 'str':
        if (t.prefix?.includes('f') || t.prefix === 't') return this.parseInterpolated(t);
        return { k: 'str', value: t.v };
      case 'char':
        return { k: 'char', value: t.v };
      case 'id': {
        const v = t.v;
        if (v === 'true' || v === 'True') return { k: 'bool', value: true };
        if (v === 'false' || v === 'False') return { k: 'bool', value: false };
        if (['null', 'NULL', 'nullptr', 'None', 'undefined'].includes(v)) return { k: 'null' };
        if (v === 'new' && !this.py) return this.parseNew(t.line);
        if (v === 'this' && !this.py) return { k: 'this' };
        if (v === 'lambda' || v === 'function') throw new ParseError('Lambdas / anonymous functions are not supported', t.line);
        return { k: 'id', name: v };
      }
      case 'op': {
        if (t.v === '(') {
          const e = this.parseExpr();
          if (this.isOp(',')) throw new ParseError('Tuples are not supported by the offline converter', t.line);
          this.expectOp(')');
          if (this.isOp('=>')) throw new ParseError('Arrow functions are not supported', t.line);
          return e;
        }
        if (t.v === '{' && (this.py || this.lang === 'javascript')) return this.parseDictOrSet(t.line);
        if (t.v === '[' || (t.v === '{' && !this.py)) {
          const close = t.v === '[' ? ']' : '}';
          const items: Expr[] = [];
          while (!this.isOp(close)) {
            items.push(this.parseAssign());
            if (this.py && this.isId('for')) {
              // [expr for _ in range(n)]
              this.p++;
              this.expectId();
              if (!this.eatId('in')) throw new ParseError("Expected 'in'", t.line);
              const it = this.parseExpr();
              this.expectOp(close);
              if (it.k === 'call' && calleeName(it.callee) === 'range' && it.args.length === 1)
                return { k: 'newarr', elem: { base: 'unknown', dims: 0 }, size: it.args[0], fill: items[0] };
              throw new ParseError('List comprehensions are not supported', t.line);
            }
            if (!this.eatOp(',')) break;
          }
          this.expectOp(close);
          return { k: 'arr', items };
        }
        throw new ParseError(`Unexpected '${t.v}'`, t.line);
      }
      default:
        throw new ParseError(`Unexpected ${t.t === 'eof' ? 'end of input' : `'${t.v}'`}`, t.line);
    }
  }

  /** Python dict / set literal, or JavaScript object literal used as a map. Cursor is after '{'. */
  parseDictOrSet(line: number): Expr {
    if (this.eatOp('}')) return { k: 'maplit', entries: [] };
    const first = this.lang === 'javascript' && (this.isId() || this.peek().t === 'num') && this.isOp(':', 1) ? { k: 'str', value: this.next().v } as Expr : this.parseAssign();
    if (this.eatOp(':')) {
      const entries = [{ key: first, value: this.parseAssign() }];
      if (this.py && this.isId('for')) throw new ParseError('Dictionary comprehensions are not supported', line);
      while (this.eatOp(',')) {
        if (this.isOp('}')) break;
        const key = this.lang === 'javascript' && (this.isId() || this.peek().t === 'num') && this.isOp(':', 1) ? ({ k: 'str', value: this.next().v } as Expr) : this.parseAssign();
        this.expectOp(':');
        entries.push({ key, value: this.parseAssign() });
      }
      this.expectOp('}');
      return { k: 'maplit', entries };
    }
    if (this.lang === 'javascript') throw new ParseError('Unsupported object literal', line);
    if (this.py && this.isId('for')) throw new ParseError('Set comprehensions are not supported', line);
    const items = [first];
    while (this.eatOp(',')) {
      if (this.isOp('}')) break;
      items.push(this.parseAssign());
    }
    this.expectOp('}');
    return { k: 'setlit', items };
  }

  /** Arguments of a constructor call, if present. */
  ctorArgs(): Expr[] {
    const args: Expr[] = [];
    if (!this.eatOp('(')) return args;
    while (!this.isOp(')')) {
      args.push(this.parseAssign());
      if (!this.eatOp(',')) break;
    }
    this.expectOp(')');
    return args;
  }

  parseNew(line: number): Expr {
    const ty = this.tryParseType();
    if (ty?.base === 'map' && ty.dims === 0) {
      const args = this.ctorArgs();
      return args[0]?.k === 'maplit' ? args[0] : { k: 'maplit', entries: [] };
    }
    if (ty?.base === 'set' && ty.dims === 0) {
      const args = this.ctorArgs();
      return { k: 'setlit', items: setItems(args[0]) };
    }
    if (ty?.base === 'object' && ty.dims === 0 && this.isOp('(')) return { k: 'new', cls: ty.cls!, args: this.ctorArgs() };
    if (!ty) {
      const name = this.expectId();
      if (MAP_TYPES.includes(name) || SET_TYPES.includes(name)) {
        if (this.isOp('<')) {
          let d = 0;
          do {
            const t = this.next();
            if (t.v === '<') d++;
            if (t.v === '>') d--;
            if (t.v === '>>') d -= 2;
          } while (d > 0 && this.peek().t !== 'eof');
        }
        const args = this.ctorArgs();
        if (MAP_TYPES.includes(name)) return args[0]?.k === 'maplit' ? args[0] : { k: 'maplit', entries: [] };
        return { k: 'setlit', items: setItems(args[0]) };
      }
      if (this.classNames.has(name)) return { k: 'new', cls: name, args: this.ctorArgs() };
      if (name === 'Array' && this.isOp('(')) {
        this.p++;
        const size = this.parseExpr();
        this.expectOp(')');
        return { k: 'newarr', elem: { base: 'unknown', dims: 0 }, size };
      }
      if (name === 'Scanner' || name === 'BufferedReader') {
        // consumed in decl handling
        while (!this.isOp(';')) this.p++;
        return { k: 'raw', text: 'scanner' };
      }
      throw new ParseError(`Objects of type '${name}' are not supported`, line);
    }
    if (ty.dynamic) {
      // new ArrayList<>() / new ArrayList<Integer>()
      if (this.isOp('(')) {
        this.p++;
        while (!this.isOp(')')) this.p++;
        this.p++;
      }
      return { k: 'arr', items: [] };
    }
    if (this.isOp('<')) {
      // ArrayList<>
      while (!this.isOp('(')) this.p++;
      this.p++;
      while (!this.isOp(')')) this.p++;
      this.p++;
      return { k: 'arr', items: [] };
    }
    if (this.eatOp('[')) {
      if (this.eatOp(']')) {
        const init = this.parsePrimary();
        return init;
      }
      const size = this.parseExpr();
      this.expectOp(']');
      let dims = 0;
      while (this.eatOp('[')) {
        while (!this.isOp(']')) this.p++;
        this.p++;
        dims++;
      }
      if (dims > 0) throw new ParseError('Multi-dimensional arrays are not supported offline', line);
      return { k: 'newarr', elem: { base: ty.base, dims: 0 }, size };
    }
    if (this.isOp('(')) throw new ParseError('Object construction is not supported', line);
    throw new ParseError('Unsupported new-expression', line);
  }

  parseInterpolated(t: Token): Expr {
    const parts: PrintPart[] = [];
    const s = t.v;
    const isTemplate = t.prefix === 't';
    let i = 0;
    let buf = '';
    while (i < s.length) {
      if (isTemplate ? s.startsWith('${', i) : s[i] === '{' && s[i + 1] !== '{') {
        if (buf) parts.push({ text: buf });
        buf = '';
        let j = i + (isTemplate ? 2 : 1);
        let depth = 1;
        while (j < s.length && depth > 0) {
          if (s[j] === '{') depth++;
          if (s[j] === '}') depth--;
          if (depth > 0) j++;
        }
        let inner = s.slice(i + (isTemplate ? 2 : 1), j);
        let precision: number | undefined;
        const fm = !isTemplate ? inner.match(/:\.(\d+)f$/) : null;
        if (fm) {
          precision = Number(fm[1]);
          inner = inner.slice(0, fm.index);
        }
        const sub = new Parser(inner, this.lang);
        const expr = sub.parseExpr();
        parts.push({ expr, precision });
        i = j + 1;
      } else if (!isTemplate && (s.startsWith('{{', i) || s.startsWith('}}', i))) {
        buf += s[i];
        i += 2;
      } else {
        buf += s[i];
        i++;
      }
    }
    if (buf) parts.push({ text: buf });
    return { k: 'fstr', parts };
  }
}

// ---------- helpers ----------
export function num(v: number): Expr {
  return { k: 'num', value: v, raw: String(v), float: false };
}

function normOp(op: string): string {
  if (op === 'and') return '&&';
  if (op === 'or') return '||';
  if (op === '===') return '==';
  if (op === '!==') return '!=';
  return op;
}

export function calleeName(e: Expr): string {
  if (e.k === 'id') return e.name;
  if (e.k === 'mem') return `${calleeName(e.obj)}.${e.prop}`;
  return '';
}

function isCallTo(s: Stmt, name: string) {
  return s.k === 'expr' && s.expr.k === 'call' && calleeName(s.expr.callee) === name;
}

function setItems(e: Expr | undefined): Expr[] {
  if (!e) return [];
  if (e.k === 'arr' || e.k === 'setlit') return e.items;
  if (e.k === 'call' && /^(Arrays\.asList|List\.of|Set\.of)$/.test(calleeName(e.callee))) return e.args;
  return [];
}

function isMapIntInput(e: Expr): boolean {
  // map(int, input().split())  or list(map(int, input().split()))
  if (e.k === 'call' && calleeName(e.callee) === 'list' && e.args.length === 1) return isMapIntInput(e.args[0]) && ((e as any)._kind = (e.args[0] as any)._kind, true);
  if (e.k === 'call' && calleeName(e.callee) === 'map' && e.args.length === 2 && e.args[0].k === 'id' && ['int', 'float'].includes(e.args[0].name)) {
    (e as any)._kind = e.args[0].name === 'int' ? 'int' : 'double';
    return true;
  }
  return false;
}

function specKind(spec: string): 'int' | 'double' | 'word' | 'line' {
  const c = spec[spec.length - 1];
  if ('dilu'.includes(c)) return 'int';
  if ('fge'.includes(c)) return 'double';
  return 'word';
}

/** Turn an argument of a print call into print parts, flattening string concatenation. */
export function argParts(e: Expr | undefined): PrintPart[] {
  if (!e) return [];
  if (e.k === 'str') return [{ text: e.value }];
  if (e.k === 'char') return [{ text: e.value }];
  if (e.k === 'fstr') return e.parts;
  if (e.k === 'bin' && e.op === '+') {
    // Java / JS evaluate '+' left to right; the expression becomes a string once a string literal appears.
    if (isStringy(e.left)) return [...argParts(e.left), ...leaf(e.right)];
    if (isStrLit(e.right)) return [{ expr: e.left }, ...leaf(e.right)];
  }
  return [{ expr: e }];
}

function leaf(e: Expr): PrintPart[] {
  return isStrLit(e) ? argParts(e) : [{ expr: e }];
}
function isStrLit(e: Expr) {
  return e.k === 'str' || e.k === 'fstr';
}
function isStringy(e: Expr): boolean {
  if (isStrLit(e)) return true;
  if (e.k === 'bin' && e.op === '+') return isStringy(e.left) || isStrLit(e.right);
  return false;
}

export function mergeText(parts: PrintPart[]): PrintPart[] {
  const out: PrintPart[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p.text !== undefined && last && last.text !== undefined) last.text += p.text;
    else out.push({ ...p });
  }
  return out.filter((p) => p.expr || p.text);
}

/** Parse a printf format string into print parts. */
export function parseFormat(fmt: string, args: Expr[], warnings: string[], line: number): { parts: PrintPart[]; newline: boolean } {
  const parts: PrintPart[] = [];
  let ai = 0;
  const re = /%([-+ 0#]*)(\d+)?(?:\.(\d+))?(hh|h|ll|l|L|z)?([diufFeEgGxXoscp%])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fmt))) {
    if (m.index > last) parts.push({ text: fmt.slice(last, m.index) });
    last = re.lastIndex;
    if (m[5] === '%') {
      parts.push({ text: '%' });
      continue;
    }
    if (m[2]) warnings.push(`Line ${line}: printf field width '%${m[2]}' is not preserved.`);
    const arg = args[ai++];
    if (!arg) continue;
    const precision = m[3] !== undefined ? Number(m[3]) : 'fFeE'.includes(m[5]) ? 6 : undefined;
    parts.push({ expr: arg, precision });
  }
  if (last < fmt.length) parts.push({ text: fmt.slice(last) });
  const merged = mergeText(parts);
  let newline = false;
  const lastPart = merged[merged.length - 1];
  if (lastPart?.text?.endsWith('\n')) {
    newline = true;
    lastPart.text = lastPart.text.slice(0, -1);
    if (!lastPart.text) merged.pop();
  }
  return { parts: merged, newline };
}

function toRangeOrFor(f: Extract<Stmt, { k: 'for' }>): Stmt {
  if (f.init.length !== 1 || !f.cond || f.update.length !== 1) return f;
  const init = f.init[0];
  let v: string | undefined;
  let start: Expr | undefined;
  let declared = false;
  if (init.k === 'decl' && init.init) {
    v = init.name;
    start = init.init;
    declared = true;
  } else if (init.k === 'expr' && init.expr.k === 'assign' && init.expr.op === '=' && init.expr.target.k === 'id') {
    v = init.expr.target.name;
    start = init.expr.value;
  }
  if (!v || !start) return f;
  const c = f.cond;
  if (c.k !== 'bin' || c.left.k !== 'id' || c.left.name !== v || !['<', '<=', '>', '>='].includes(c.op)) return f;
  const u = f.update[0];
  let step = 0;
  if (u.k === 'upd' && u.arg.k === 'id' && u.arg.name === v) step = u.op === '++' ? 1 : -1;
  else if (u.k === 'assign' && u.target.k === 'id' && u.target.name === v && u.value.k === 'num' && !u.value.float) {
    if (u.op === '+=') step = u.value.value;
    if (u.op === '-=') step = -u.value.value;
  }
  if (!step) return f;
  if ((step > 0 && (c.op === '>' || c.op === '>=')) || (step < 0 && (c.op === '<' || c.op === '<='))) return f;
  if (assignsTo(f.body, v)) return f;
  let end = c.right;
  if (c.op === '<=') end = addConst(end, 1);
  if (c.op === '>=') end = addConst(end, -1);
  return { k: 'range', var: v, start, end, step, body: f.body, declared, line: f.line };
}

export function addConst(e: Expr, k: number): Expr {
  if (k === 0) return e;
  if (e.k === 'num' && !e.float) return { ...e, value: e.value + k, raw: String(e.value + k) };
  if (e.k === 'bin' && (e.op === '+' || e.op === '-') && e.right.k === 'num' && !e.right.float) {
    const r = e.op === '+' ? e.right.value + k : e.right.value - k;
    if (r === 0) return e.left;
    if (r > 0) return { k: 'bin', op: e.op === '+' ? '+' : '-', left: e.left, right: num(Math.abs(r)) } as Expr;
    return { k: 'bin', op: e.op === '+' ? '-' : '+', left: e.left, right: num(Math.abs(r)) } as Expr;
  }
  return { k: 'bin', op: k > 0 ? '+' : '-', left: e, right: num(Math.abs(k)) };
}

function assignsTo(body: Stmt[], v: string): boolean {
  let found = false;
  walkStmts(body, {
    expr: (e) => {
      if (e.k === 'assign' && e.target.k === 'id' && e.target.name === v) found = true;
      if (e.k === 'upd' && e.arg.k === 'id' && e.arg.name === v) found = true;
    },
    stmt: (s) => {
      if (s.k === 'read' && s.targets.some((t) => t.k === 'id' && t.name === v)) found = true;
    },
  });
  return found;
}

function argPartsOrEmpty(_e?: Expr) {
  return _e;
}
void argPartsOrEmpty;
