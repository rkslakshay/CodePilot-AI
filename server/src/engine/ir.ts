/**
 * Language-neutral intermediate representation (IR) used by the offline
 * translation pipeline: source -> tokens -> IR -> (code | pseudocode | flowchart).
 */
export type Lang = 'c' | 'cpp' | 'java' | 'python' | 'javascript';
export const LANGS: Lang[] = ['c', 'cpp', 'java', 'python', 'javascript'];
export const LANG_LABEL: Record<Lang, string> = {
  c: 'C',
  cpp: 'C++',
  java: 'Java',
  python: 'Python',
  javascript: 'JavaScript',
};
export const LANG_EXT: Record<Lang, string> = { c: 'c', cpp: 'cpp', java: 'java', python: 'py', javascript: 'js' };

export type BaseType = 'int' | 'long' | 'double' | 'char' | 'bool' | 'string' | 'void' | 'unknown' | 'map' | 'set' | 'object';
export interface TypeRef {
  base: BaseType;
  /** array nesting depth (0 = scalar) */
  dims: number;
  /** true when the collection grows (vector / ArrayList / Python list with append) */
  dynamic?: boolean;
  /** map key type */
  key?: TypeRef;
  /** map value type / set element type */
  val?: TypeRef;
  /** class name for base === 'object' */
  cls?: string;
}
export const T = {
  int: (): TypeRef => ({ base: 'int', dims: 0 }),
  long: (): TypeRef => ({ base: 'long', dims: 0 }),
  double: (): TypeRef => ({ base: 'double', dims: 0 }),
  bool: (): TypeRef => ({ base: 'bool', dims: 0 }),
  string: (): TypeRef => ({ base: 'string', dims: 0 }),
  char: (): TypeRef => ({ base: 'char', dims: 0 }),
  void: (): TypeRef => ({ base: 'void', dims: 0 }),
  unknown: (): TypeRef => ({ base: 'unknown', dims: 0 }),
  array: (base: BaseType, dims = 1, dynamic = false): TypeRef => ({ base, dims, dynamic }),
};

export type Expr =
  | { k: 'num'; value: number; raw: string; float: boolean }
  | { k: 'str'; value: string }
  | { k: 'char'; value: string }
  | { k: 'bool'; value: boolean }
  | { k: 'null' }
  | { k: 'id'; name: string }
  | { k: 'bin'; op: string; left: Expr; right: Expr }
  | { k: 'un'; op: string; arg: Expr }
  | { k: 'upd'; op: '++' | '--'; prefix: boolean; arg: Expr }
  | { k: 'assign'; op: string; target: Expr; value: Expr }
  | { k: 'tern'; cond: Expr; then: Expr; else: Expr }
  | { k: 'call'; callee: Expr; args: Expr[] }
  /** canonical library operation (len, max, push ...) normalised across languages */
  | { k: 'intr'; name: string; args: Expr[]; /** original method name when created from obj.method(...) */ orig?: string }
  | { k: 'idx'; obj: Expr; index: Expr }
  | { k: 'mem'; obj: Expr; prop: string }
  | { k: 'arr'; items: Expr[] }
  | { k: 'newarr'; elem: TypeRef; size: Expr; fill?: Expr }
  | { k: 'input'; kind: 'int' | 'double' | 'word' | 'line' }
  | { k: 'cast'; to: TypeRef; arg: Expr }
  | { k: 'fstr'; parts: PrintPart[] }
  | { k: 'raw'; text: string }
  /** dictionary / map literal */
  | { k: 'maplit'; entries: { key: Expr; value: Expr }[] }
  /** set literal */
  | { k: 'setlit'; items: Expr[] }
  /** object construction: new Cls(args) / Cls(args) */
  | { k: 'new'; cls: string; args: Expr[] }
  /** self / this */
  | { k: 'this' }
  /** s[a:b] / substring(a, b) — end is exclusive */
  | { k: 'slice'; obj: Expr; start?: Expr; end?: Expr };

/** Canonical exception kinds shared across languages. */
export type ExcKind = 'ValueError' | 'IndexError' | 'KeyError' | 'ZeroDivisionError' | 'RuntimeError' | 'Exception';

export interface PrintPart {
  /** literal text or expression */
  text?: string;
  expr?: Expr;
  precision?: number;
}

export type Stmt =
  | { k: 'decl'; name: string; type: TypeRef; init?: Expr; line?: number; isConst?: boolean }
  | { k: 'expr'; expr: Expr; line?: number }
  | { k: 'if'; cond: Expr; then: Stmt[]; elifs: { cond: Expr; body: Stmt[] }[]; else?: Stmt[]; line?: number }
  | { k: 'while'; cond: Expr; body: Stmt[]; line?: number }
  | { k: 'dowhile'; cond: Expr; body: Stmt[]; line?: number }
  | {
      k: 'range';
      var: string;
      start: Expr;
      /** exclusive end */
      end: Expr;
      step: number;
      body: Stmt[];
      declared: boolean;
      line?: number;
    }
  | { k: 'for'; init: Stmt[]; cond?: Expr; update: Expr[]; body: Stmt[]; line?: number }
  | { k: 'foreach'; var: string; varType?: TypeRef; iter: Expr; body: Stmt[]; line?: number }
  | { k: 'return'; value?: Expr; line?: number }
  | { k: 'break'; line?: number }
  | { k: 'continue'; line?: number }
  | { k: 'print'; parts: PrintPart[]; newline: boolean; line?: number }
  | { k: 'read'; targets: Expr[]; kinds: ('int' | 'double' | 'word' | 'line')[]; line?: number }
  | { k: 'comment'; text: string; line?: number }
  | { k: 'raw'; text: string; reason: string; line?: number }
  | { k: 'try'; body: Stmt[]; catches: { kind: ExcKind; var: string | null; body: Stmt[] }[]; finally?: Stmt[]; line?: number }
  | { k: 'throw'; kind: ExcKind; message?: Expr; line?: number };

export interface Param {
  name: string;
  type: TypeRef;
}
export interface Func {
  name: string;
  params: Param[];
  ret: TypeRef;
  body: Stmt[];
  line?: number;
}
export interface ClassDef {
  name: string;
  fields: { name: string; type: TypeRef; init?: Expr }[];
  ctor: Func | null;
  methods: Func[];
  line?: number;
}
export interface Program {
  lang: Lang;
  globals: Stmt[];
  funcs: Func[];
  /** user-defined classes (fields, constructor, methods) */
  classes: ClassDef[];
  /** body of main() or top-level script statements */
  main: Stmt[];
  /** whether the source had an explicit main function */
  hasMain: boolean;
  warnings: string[];
  className?: string;
}

export function typeName(t: TypeRef): string {
  return t.base + '[]'.repeat(t.dims);
}
