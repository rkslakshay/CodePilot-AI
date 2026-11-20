/**
 * Source code → UML with the shared Tree-sitter parsers (deterministic; nothing is executed).
 *  - class diagrams for Java, TypeScript / TSX, JavaScript, Python, C++ (classes / structs) and C (structs)
 *  - sequence diagram of the calls made by one method (Java, TS / JS, Python)
 *  - activity diagram of one function's control flow (all supported languages)
 * Every relationship records its evidence: "extracted" (stated in the code, e.g. `extends`) or
 * "inferred" (derived, e.g. composition from `new X()` in a constructor) with file and line.
 */
import type Parser from 'web-tree-sitter';
import { parseWith, type Grammar } from '../engine/syntax.js';
import { AppError } from '../utils/http.js';
import { DiagramBuilder, slug, type Diagram, type Evidence, type Member, type Method } from '../../../shared/uml/index.js';

type Node = Parser.SyntaxNode;
export interface SourceFile {
  path: string;
  content: string;
  language: string | null;
}
const GRAMMAR: Record<string, Grammar> = { java: 'java', typescript: 'typescript', tsx: 'tsx', javascript: 'javascript', python: 'python', cpp: 'cpp', c: 'c' };
export const grammarOf = (lang: string | null): Grammar | null => (lang ? GRAMMAR[lang] ?? null : null);
const line = (n: Node) => n.startPosition.row + 1;
const walk = (n: Node, f: (x: Node) => boolean | void) => {
  if (f(n) === false) return;
  for (const c of n.namedChildren) walk(c, f);
};
const field = (n: Node | null | undefined, name: string) => n?.childForFieldName(name) ?? null;

interface ClassInfo {
  name: string;
  kind: 'class' | 'abstract' | 'interface' | 'enum';
  stereotype: string;
  attributes: (Member & { line: number; init?: string; collection: boolean; refs: string[] })[];
  methods: (Method & { line: number; endLine: number; node: Node; refs: string[] })[];
  extends: string[];
  implements: string[];
  file: string;
  line: number;
  creates: { cls: string; line: number; inCtor: boolean; field?: string }[];
}

// ------------------------------------------------------------------ type helpers
const PRIMS = new Set('int long short byte char boolean bool float double void string number any unknown object never null undefined str bytes list dict set tuple String Object Integer Long Double Float Boolean Character Byte Short size_t uint8_t int32_t int64_t uint32_t uint64_t auto var let const Promise Map Set List ArrayList LinkedList HashMap HashSet Optional Array Record Partial Readonly Vector vector map set unordered_map unordered_set shared_ptr unique_ptr weak_ptr std Iterable Iterator Collection Sequence Mapping Dict Tuple Any Callable Type Function Date'.split(' '));
const COLLECTION = /\b(List|ArrayList|LinkedList|Set|HashSet|TreeSet|Collection|Iterable|Array|vector|list|set|deque|Sequence|Vector|Queue|Stack|Deque|ReadonlyArray)\b|\[\]$|\[\]>|^list\[|^set\[|^tuple\[/;
const MAPPING = /\b(Map|HashMap|TreeMap|Dict|dict|Record|unordered_map|map|Mapping)\b/;
/** Type names mentioned in a type expression (generic arguments included). */
export function typeRefs(t: string): string[] {
  return [...new Set((t.match(/[A-Za-z_][\w]*/g) ?? []).filter((w) => !PRIMS.has(w) && /^[A-Z]/.test(w)))];
}
/** Head type of each item in a supertype list: "Repository<Book>, Comparable<T>" → Repository, Comparable. */
export function typeHeads(t: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of t) {
    if (ch === '<' || ch === '[' || ch === '(') depth++;
    if (ch === '>' || ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      items.push(cur);
      cur = '';
    } else cur += ch;
  }
  items.push(cur);
  return items
    .map((x) => x.replace(/^\s*(extends|implements|public|private|protected|virtual)\s+/g, '').trim())
    .map((x) => (/^([A-Za-z_][\w.]*)/.exec(x)?.[1] ?? '').split('.').pop() ?? '')
    .filter((x) => /^[A-Z]/.test(x) && !PRIMS.has(x));
}
// Python forward references are strings: self.owner: "Person" → Person
const clean = (t: string) => t.replace(/^:\s*/, '').replace(/\s+/g, ' ').trim().replace(/^(['"])(.*)\1$/, '$2').slice(0, 120);

// ------------------------------------------------------------------ Java
function javaClasses(root: Node, file: string, out: ClassInfo[]) {
  walk(root, (n) => {
    if (!['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'].includes(n.type)) return;
    const mods = n.namedChildren.find((c) => c.type === 'modifiers')?.text ?? '';
    const name = field(n, 'name')?.text ?? '?';
    const info: ClassInfo = { name, kind: n.type === 'interface_declaration' ? 'interface' : n.type === 'enum_declaration' ? 'enum' : /\babstract\b/.test(mods) ? 'abstract' : 'class', stereotype: n.type === 'record_declaration' ? 'record' : '', attributes: [], methods: [], extends: [], implements: [], file, line: line(n), creates: [] };
    const sup = field(n, 'superclass');
    if (sup) info.extends.push(...typeHeads(sup.text).slice(0, 1));
    const ifs = field(n, 'interfaces') ?? n.namedChildren.find((c) => c.type === 'super_interfaces' || c.type === 'extends_interfaces');
    if (ifs) (n.type === 'interface_declaration' ? info.extends : info.implements).push(...typeHeads(ifs.text.replace(/^\s*(implements|extends)\s+/, '')));
    const body = field(n, 'body');
    for (const m of body?.namedChildren ?? []) {
      const mm = m.namedChildren.find((c) => c.type === 'modifiers')?.text ?? '';
      const vis = /\bpublic\b/.test(mm) ? '+' : /\bprivate\b/.test(mm) ? '-' : /\bprotected\b/.test(mm) ? '#' : n.type === 'interface_declaration' ? '+' : '~';
      if (m.type === 'field_declaration' || m.type === 'constant_declaration') {
        const type = clean(field(m, 'type')?.text ?? '');
        for (const d of m.namedChildren.filter((c) => c.type === 'variable_declarator')) {
          const init = field(d, 'value')?.text;
          info.attributes.push({ name: field(d, 'name')?.text ?? '?', type, visibility: vis as Member['visibility'], isStatic: /\bstatic\b/.test(mm) || n.type === 'interface_declaration', defaultValue: init && init.length < 40 && !/^new\b/.test(init) ? init : '', line: line(m), init, collection: COLLECTION.test(type) || MAPPING.test(type), refs: typeRefs(type) });
        }
      } else if (m.type === 'method_declaration' || m.type === 'constructor_declaration') {
        const params = (field(m, 'parameters')?.namedChildren ?? []).filter((p) => p.type === 'formal_parameter' || p.type === 'spread_parameter').map((p) => ({ name: field(p, 'name')?.text ?? p.text.split(' ').pop() ?? 'p', type: clean(field(p, 'type')?.text ?? '') }));
        const ret = m.type === 'constructor_declaration' ? '' : clean(field(m, 'type')?.text ?? '');
        info.methods.push({ name: field(m, 'name')?.text ?? '?', params, returnType: ret === 'void' ? '' : ret, visibility: vis as Method['visibility'], isStatic: /\bstatic\b/.test(mm), isAbstract: /\babstract\b/.test(mm) || (n.type === 'interface_declaration' && !field(m, 'body') && !/\b(default|static)\b/.test(mm)), line: line(m), endLine: m.endPosition.row + 1, node: m, refs: [...params.flatMap((p) => typeRefs(p.type)), ...typeRefs(ret)] });
        if (m.type === 'constructor_declaration') info.methods[info.methods.length - 1].name = info.name;
      } else if (m.type === 'enum_body_declarations') {
        // methods / fields after the enum constants
      } else if (m.type === 'enum_constant') info.attributes.push({ name: field(m, 'name')?.text ?? m.text, type: '', visibility: '+', isStatic: true, defaultValue: '', line: line(m), collection: false, refs: [] });
    }
    if (n.type === 'enum_declaration') for (const c of body?.namedChildren.filter((x) => x.type === 'enum_constant') ?? []) if (!info.attributes.some((a) => a.name === (field(c, 'name')?.text ?? c.text))) info.attributes.push({ name: field(c, 'name')?.text ?? c.text, type: '', visibility: '+', isStatic: true, defaultValue: '', line: line(c), collection: false, refs: [] });
    collectCreates(n, info, (x) => x.type === 'object_creation_expression', (x) => typeRefs(field(x, 'type')?.text ?? '')[0], ['constructor_declaration']);
    out.push(info);
  });
}

// ------------------------------------------------------------------ TypeScript / JavaScript
function tsClasses(root: Node, file: string, out: ClassInfo[], g: Grammar) {
  walk(root, (n) => {
    const isClass = n.type === 'class_declaration' || n.type === 'abstract_class_declaration' || (n.type === 'class' && n.parent?.type === 'variable_declarator');
    const isIface = n.type === 'interface_declaration';
    const isEnum = n.type === 'enum_declaration';
    if (!isClass && !isIface && !isEnum) return;
    const name = field(n, 'name')?.text ?? (n.parent?.type === 'variable_declarator' ? field(n.parent, 'name')?.text : null) ?? '?';
    const info: ClassInfo = { name, kind: isIface ? 'interface' : isEnum ? 'enum' : n.type === 'abstract_class_declaration' ? 'abstract' : 'class', stereotype: '', attributes: [], methods: [], extends: [], implements: [], file, line: line(n), creates: [] };
    for (const h of n.namedChildren) {
      if (h.type === 'class_heritage') {
        for (const c of h.namedChildren) {
          if (c.type === 'extends_clause') info.extends.push(...typeHeads(c.text.replace(/^extends\s+/, '')).slice(0, 1));
          else if (c.type === 'implements_clause') info.implements.push(...typeHeads(c.text.replace(/^implements\s+/, '')));
          else if (g === 'javascript') info.extends.push(...typeHeads(c.text).slice(0, 1));
        }
      }
      if (h.type === 'extends_type_clause') info.extends.push(...typeHeads(h.text.replace(/^extends\s+/, '')));
    }
    const body = field(n, 'body');
    for (const m of body?.namedChildren ?? []) {
      const acc = m.namedChildren.find((c) => c.type === 'accessibility_modifier')?.text ?? '';
      const nameNode = field(m, 'name') ?? field(m, 'property');
      const nm = nameNode?.text ?? '';
      const vis = acc === 'private' || nm.startsWith('#') ? '-' : acc === 'protected' ? '#' : '+';
      const isStatic = /^\s*(?:(?:public|private|protected|readonly|abstract|override)\s+)*static\b/.test(m.text);
      if (m.type === 'public_field_definition' || m.type === 'field_definition' || m.type === 'property_signature') {
        const type = clean(field(m, 'type')?.text ?? '');
        const init = field(m, 'value')?.text;
        info.attributes.push({ name: nm.replace(/^#/, ''), type, visibility: vis as Member['visibility'], isStatic, defaultValue: init && init.length < 40 && !/^new\b/.test(init) && !/=>/.test(init) ? init : '', line: line(m), init, collection: COLLECTION.test(type) || MAPPING.test(type), refs: typeRefs(type) });
      } else if (['method_definition', 'method_signature', 'abstract_method_signature'].includes(m.type)) {
        const params = (field(m, 'parameters')?.namedChildren ?? []).filter((p) => /parameter/.test(p.type) || p.type === 'identifier' || p.type === 'assignment_pattern').map((p) => ({ name: (field(p, 'pattern') ?? field(p, 'left') ?? p).text.replace(/^(public|private|protected|readonly)\s+/, '').split(/[:=]/)[0].trim(), type: clean(field(p, 'type')?.text ?? ''), isProp: /^(public|private|protected|readonly)\s/.test(p.text), propVis: (/^(public|private|protected)/.exec(p.text)?.[1] ?? 'public') as string }));
        const ret = clean(field(m, 'return_type')?.text ?? '');
        const isCtor = nm === 'constructor';
        info.methods.push({ name: isCtor ? info.name : nm.replace(/^#/, ''), params: params.map(({ name: a, type }) => ({ name: a, type })), returnType: ret === 'void' ? '' : ret, visibility: vis as Method['visibility'], isStatic, isAbstract: m.type === 'abstract_method_signature' || (isIface && true), line: line(m), endLine: m.endPosition.row + 1, node: m, refs: [...params.flatMap((p) => typeRefs(p.type)), ...typeRefs(ret)] });
        // TypeScript parameter properties: constructor(private repo: Repo)
        if (isCtor) for (const p of params.filter((x) => x.isProp)) info.attributes.push({ name: p.name, type: p.type, visibility: (p.propVis === 'private' ? '-' : p.propVis === 'protected' ? '#' : '+') as Member['visibility'], isStatic: false, defaultValue: '', line: line(m), collection: COLLECTION.test(p.type), refs: typeRefs(p.type) });
        // JavaScript: this.x = … in the constructor
        if (isCtor) walk(m, (x) => {
          if (x.type === 'assignment_expression' && /^this\.\w+$/.test(field(x, 'left')?.text ?? '')) {
            const an = field(x, 'left')!.text.slice(5);
            if (!info.attributes.some((a) => a.name === an)) {
              const v = field(x, 'right');
              const created = v?.type === 'new_expression' ? typeRefs(field(v, 'constructor')?.text ?? '')[0] : undefined;
              info.attributes.push({ name: an, type: created ?? '', visibility: an.startsWith('_') ? '-' : '+', isStatic: false, defaultValue: '', line: line(x), init: v?.text, collection: v?.type === 'array', refs: created ? [created] : [] });
            }
          }
        });
      } else if (m.type === 'enum_assignment' || (isEnum && m.type === 'property_identifier')) info.attributes.push({ name: (field(m, 'name') ?? m).text, type: '', visibility: '+', isStatic: true, defaultValue: '', line: line(m), collection: false, refs: [] });
    }
    collectCreates(n, info, (x) => x.type === 'new_expression', (x) => typeRefs(field(x, 'constructor')?.text ?? '')[0], [], (x) => x.type === 'method_definition' && field(x, 'name')?.text === 'constructor');
    out.push(info);
  });
}

// ------------------------------------------------------------------ Python
function pyClasses(root: Node, file: string, out: ClassInfo[]) {
  walk(root, (n) => {
    if (n.type !== 'class_definition') return;
    const name = field(n, 'name')?.text ?? '?';
    const bases = (field(n, 'superclasses')?.namedChildren ?? []).map((b) => b.text).filter((b) => !/^(object|metaclass=.*)$/.test(b));
    const isAbcBase = bases.some((b) => /^(ABC|abc\.ABC|Protocol|typing\.Protocol)$/.test(b));
    const isEnum = bases.some((b) => /Enum$/.test(b));
    const info: ClassInfo = { name, kind: isEnum ? 'enum' : bases.some((b) => /Protocol$/.test(b)) ? 'interface' : 'class', stereotype: '', attributes: [], methods: [], extends: bases.filter((b) => !/^(ABC|abc\.ABC|Protocol|typing\.Protocol|Enum|IntEnum|StrEnum|enum\.Enum|Generic\[.*\])$/.test(b)).map((b) => b.replace(/\[.*$/, '').split('.').pop()!), implements: [], file, line: line(n), creates: [] };
    const vis = (nm: string) => (nm.startsWith('__') && !nm.endsWith('__') ? '-' : nm.startsWith('_') && !nm.startsWith('__') ? '#' : '+');
    let abstractCount = 0;
    for (const st of field(n, 'body')?.namedChildren ?? []) {
      const def = st.type === 'decorated_definition' ? field(st, 'definition') : st;
      const decos = st.type === 'decorated_definition' ? st.namedChildren.filter((c) => c.type === 'decorator').map((c) => c.text) : [];
      if (def?.type === 'function_definition') {
        const nm = field(def, 'name')?.text ?? '?';
        const params = (field(def, 'parameters')?.namedChildren ?? [])
          .map((p) => ({ name: (p.type === 'identifier' ? p.text : field(p, 'name')?.text ?? p.namedChildren[0]?.text ?? p.text).replace(/^\*+/, ''), type: clean(field(p, 'type')?.text ?? '') }))
          .filter((p, i) => !(i === 0 && (p.name === 'self' || p.name === 'cls')));
        const ret = clean(field(def, 'return_type')?.text ?? '');
        const isAbs = decos.some((d) => /abstractmethod/.test(d));
        if (isAbs) abstractCount++;
        info.methods.push({ name: nm === '__init__' ? name : nm, params, returnType: ret === 'None' ? '' : ret, visibility: (nm === '__init__' ? '+' : vis(nm)) as Method['visibility'], isStatic: decos.some((d) => /staticmethod|classmethod/.test(d)), isAbstract: isAbs, line: line(def), endLine: def.endPosition.row + 1, node: def, refs: [...params.flatMap((p) => typeRefs(p.type)), ...typeRefs(ret)] });
        if (nm === '__init__')
          walk(def, (x) => {
            if ((x.type === 'assignment' || x.type === 'augmented_assignment') && /^self\.\w+$/.test(field(x, 'left')?.text ?? '')) {
              const an = field(x, 'left')!.text.slice(5);
              if (info.attributes.some((a) => a.name === an)) return;
              const t = clean(field(x, 'type')?.text ?? '');
              const v = field(x, 'right');
              const paramType = v?.type === 'identifier' ? params.find((p) => p.name === v.text)?.type ?? '' : '';
              const called = v?.type === 'call' ? field(v, 'function')?.text : undefined;
              const created = called && /^[A-Z]\w*$/.test(called) ? called : undefined;
              const type = t || paramType || created || (v?.type === 'list' || v?.type === 'list_comprehension' ? 'list' : v?.type === 'dictionary' ? 'dict' : '');
              info.attributes.push({ name: an, type, visibility: vis(an) as Member['visibility'], isStatic: false, defaultValue: '', line: line(x), init: v?.text, collection: /^(list|set|tuple)/.test(type) || v?.type === 'list', refs: typeRefs(type) });
            }
          });
      } else if (st.type === 'expression_statement' && st.namedChildren[0]?.type === 'assignment') {
        const a = st.namedChildren[0];
        const nm = field(a, 'left')?.text ?? '';
        if (/^\w+$/.test(nm)) {
          const t = clean(field(a, 'type')?.text ?? '');
          info.attributes.push({ name: nm, type: t, visibility: vis(nm) as Member['visibility'], isStatic: !isEnum, defaultValue: (field(a, 'right')?.text ?? '').slice(0, 40), line: line(a), collection: COLLECTION.test(t), refs: typeRefs(t) });
        }
      }
    }
    if (abstractCount && (isAbcBase || info.kind === 'class')) info.kind = 'abstract';
    if (isAbcBase && info.kind === 'class' && info.methods.every((m) => m.isAbstract) && info.methods.length) info.kind = 'interface';
    collectCreates(n, info, (x) => x.type === 'call' && /^[A-Z]\w*$/.test(field(x, 'function')?.text ?? ''), (x) => field(x, 'function')!.text, [], (x) => x.type === 'function_definition' && field(x, 'name')?.text === '__init__');
    out.push(info);
  });
}

// ------------------------------------------------------------------ C++ / C
function cppClasses(root: Node, file: string, out: ClassInfo[], g: Grammar) {
  walk(root, (n) => {
    if (!['class_specifier', 'struct_specifier'].includes(n.type) || !field(n, 'body')) return;
    const name = field(n, 'name')?.text ?? (n.parent?.type === 'type_definition' ? field(n.parent, 'declarator')?.text : null) ?? '?';
    if (name === '?') return;
    const info: ClassInfo = { name, kind: 'class', stereotype: n.type === 'struct_specifier' ? 'struct' : '', attributes: [], methods: [], extends: [], implements: [], file, line: line(n), creates: [] };
    const base = n.namedChildren.find((c) => c.type === 'base_class_clause');
    if (base) info.extends.push(...typeHeads(base.text.replace(/^\s*:\s*/, '').replace(/\b(public|private|protected|virtual)\b/g, '')));
    let access: Member['visibility'] = n.type === 'class_specifier' ? '-' : '+';
    let pure = 0;
    for (const m of field(n, 'body')?.namedChildren ?? []) {
      if (m.type === 'access_specifier') {
        access = /public/.test(m.text) ? '+' : /protected/.test(m.text) ? '#' : '-';
        continue;
      }
      const isStatic = /^\s*static\b/.test(m.text);
      if (m.type === 'field_declaration' || m.type === 'declaration') {
        const type = clean(field(m, 'type')?.text ?? '');
        const decl = field(m, 'declarator');
        if (!decl) continue;
        const fn = decl.type === 'function_declarator' ? decl : decl.namedChildren.find((c) => c.type === 'function_declarator');
        if (fn) {
          const isPure = /=\s*0\s*;?\s*$/.test(m.text);
          if (isPure) pure++;
          const params = (field(fn, 'parameters')?.namedChildren ?? []).filter((p) => p.type === 'parameter_declaration').map((p) => ({ name: (field(p, 'declarator')?.text ?? '').replace(/[*&]/g, '').trim() || 'arg', type: clean(`${field(p, 'type')?.text ?? ''}${/^[*&]/.test(field(p, 'declarator')?.text ?? '') ? field(p, 'declarator')!.text[0] : ''}`) }));
          const nm = (field(fn, 'declarator')?.text ?? '?').replace(/^~/, '~');
          info.methods.push({ name: nm, params, returnType: type === 'void' ? '' : type, visibility: access, isStatic, isAbstract: isPure, line: line(m), endLine: m.endPosition.row + 1, node: m, refs: [...params.flatMap((p) => typeRefs(p.type)), ...typeRefs(type)] });
        } else {
          const typeNode = field(m, 'type');
          for (const d of m.namedChildren.filter((c) => /^(field_identifier|identifier|pointer_declarator|array_declarator|init_declarator|reference_declarator)$/.test(c.type) && c.startIndex !== typeNode?.startIndex)) {
            const raw = d.text;
            const nm = raw.replace(/[*&]|\[.*\]|=.*$/g, '').trim();
            if (!nm) continue;
            const t = `${type}${raw.startsWith('*') ? '*' : ''}${/\[/.test(raw) ? '[]' : ''}`;
            info.attributes.push({ name: nm, type: t, visibility: access, isStatic, defaultValue: '', line: line(m), collection: COLLECTION.test(t) || /\[\]$/.test(t), refs: typeRefs(t) });
          }
        }
      } else if (m.type === 'function_definition') {
        const fn = field(m, 'declarator');
        const params = (field(fn, 'parameters')?.namedChildren ?? []).filter((p) => p.type === 'parameter_declaration').map((p) => ({ name: (field(p, 'declarator')?.text ?? '').replace(/[*&]/g, '').trim() || 'arg', type: clean(field(p, 'type')?.text ?? '') }));
        const type = clean(field(m, 'type')?.text ?? '');
        info.methods.push({ name: field(fn, 'declarator')?.text ?? '?', params, returnType: type === 'void' ? '' : type, visibility: access, isStatic, isAbstract: false, line: line(m), endLine: m.endPosition.row + 1, node: m, refs: [...params.flatMap((p) => typeRefs(p.type)), ...typeRefs(type)] });
      }
    }
    if (pure) info.kind = info.methods.every((m) => m.isAbstract || m.name === info.name || m.name.startsWith('~')) && !info.attributes.length ? 'interface' : 'abstract';
    if (g === 'cpp') collectCreates(n, info, (x) => x.type === 'new_expression', (x) => typeRefs(field(x, 'type')?.text ?? '')[0], []);
    out.push(info);
  });
}

/** Records `new X()` / `X()` calls, noting whether they initialise a field inside a constructor. */
function collectCreates(cls: Node, info: ClassInfo, isNew: (n: Node) => boolean, typeOf: (n: Node) => string | undefined, ctorTypes: string[], isCtor: (n: Node) => boolean = (x) => ctorTypes.includes(x.type)) {
  walk(cls, (x) => {
    if (x !== cls && ['class_declaration', 'class_definition', 'class_specifier'].includes(x.type)) return false;
    if (!isNew(x)) return;
    const t = typeOf(x);
    if (!t) return;
    let inCtor = false;
    let fieldName: string | undefined;
    for (let p = x.parent; p && p !== cls; p = p.parent) {
      if (isCtor(p)) inCtor = true;
      if ((p.type === 'assignment_expression' || p.type === 'assignment') && /^(this|self)\.\w+$/.test(field(p, 'left')?.text ?? '')) fieldName = field(p, 'left')!.text.split('.')[1];
      if (p.type === 'variable_declarator' && p.parent?.type === 'field_declaration') {
        fieldName = field(p, 'name')?.text;
        inCtor = true; // field initialiser
      }
      if (p.type === 'public_field_definition' || p.type === 'field_definition') {
        fieldName = (field(p, 'name') ?? field(p, 'property'))?.text;
        inCtor = true;
      }
    }
    info.creates.push({ cls: t, line: line(x), inCtor, field: fieldName });
  });
}

export function extractClasses(files: SourceFile[]): { classes: ClassInfo[]; skipped: string[] } {
  const classes: ClassInfo[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const g = grammarOf(f.language);
    if (!g) {
      skipped.push(`${f.path} (unsupported language)`);
      continue;
    }
    const tree = parseWith(f.content, g);
    if (!tree) continue;
    try {
      if (g === 'java') javaClasses(tree.rootNode, f.path, classes);
      else if (g === 'python') pyClasses(tree.rootNode, f.path, classes);
      else if (g === 'cpp' || g === 'c') cppClasses(tree.rootNode, f.path, classes, g);
      else tsClasses(tree.rootNode, f.path, classes, g);
    } finally {
      tree.delete();
    }
  }
  return { classes, skipped };
}

/** Class diagram from source files. External supertypes are shown with «external»; other relationships only between extracted classes. */
export function classDiagramFromSource(files: SourceFile[], opts: { title?: string; maxClasses?: number } = {}): { diagram: Diagram; stats: { classes: number; relationships: number; extracted: number; inferred: number; skipped: string[]; truncated: boolean } } {
  const { classes: all, skipped } = extractClasses(files);
  if (!all.length) throw new AppError(422, 'no_classes', 'No classes, interfaces, enums or structs were found in the selected source. A class diagram needs type declarations; for procedural code try an activity diagram of a function.');
  const max = opts.maxClasses ?? 60;
  // keep the most connected classes when there are too many
  const nameCount = new Map<string, number>();
  for (const c of all) for (const r of [...c.extends, ...c.implements, ...c.attributes.flatMap((a) => a.refs), ...c.methods.flatMap((m) => m.refs)]) nameCount.set(r, (nameCount.get(r) ?? 0) + 1);
  const ranked = [...all].sort((a, b) => (nameCount.get(b.name) ?? 0) + b.methods.length / 10 - ((nameCount.get(a.name) ?? 0) + a.methods.length / 10));
  const classes = ranked.slice(0, max);
  const truncated = all.length > classes.length;
  const b = new DiagramBuilder('class', opts.title ?? '');
  const idOf = new Map<string, string>();
  const ev: Record<string, Evidence> = {};
  for (const c of classes) {
    if (idOf.has(c.name)) continue; // same simple name in two files: first wins (reported below)
    const id = b.el(`cls_${slug(c.name)}`, 'class', c.name, {
      classKind: c.kind,
      stereotype: c.stereotype,
      attributes: c.attributes.slice(0, 40).map(({ name, type, visibility, isStatic, defaultValue }) => ({ name, type, visibility, isStatic, defaultValue })),
      methods: c.methods.slice(0, 40).map(({ name, params, returnType, visibility, isStatic, isAbstract }) => ({ name, params: params.slice(0, 20), returnType, visibility, isStatic, isAbstract })),
    });
    idOf.set(c.name, id);
    ev[id] = { basis: 'extracted', detail: `Declared in ${c.file}`, confidence: 'high', file: c.file, line: c.line };
  }
  let extracted = 0;
  let inferred = 0;
  const external = (name: string, kind: 'class' | 'interface') => {
    if (idOf.has(name)) return idOf.get(name)!;
    const id = b.el(`ext_${slug(name)}`, 'class', name, { classKind: kind, stereotype: 'external' });
    idOf.set(name, id);
    ev[id] = { basis: 'extracted', detail: 'Referenced as a supertype; declared outside the analysed files.', confidence: 'high' };
    return id;
  };
  const seen = new Set<string>();
  const addRel = (kind: Parameters<DiagramBuilder['rel']>[0], s: string, t: string, props: Record<string, unknown>, e: Evidence) => {
    const k = `${kind}|${s}|${t}`;
    if (seen.has(k) || s === t) return;
    seen.add(k);
    const id = b.rel(kind, s, t, { ...props, id: `r_${b.d.relationships.length + 1}` });
    ev[id] = e;
    if (e.basis === 'extracted') extracted++;
    else inferred++;
  };
  for (const c of classes) {
    const s = idOf.get(c.name);
    if (!s) continue;
    for (const p of c.extends) addRel('inheritance', s, idOf.get(p) ?? external(p, c.kind === 'interface' ? 'interface' : 'class'), {}, { basis: 'extracted', detail: `${c.name} extends ${p}`, confidence: 'high', file: c.file, line: c.line });
    for (const p of c.implements) addRel('realization', s, idOf.get(p) ?? external(p, 'interface'), {}, { basis: 'extracted', detail: `${c.name} implements ${p}`, confidence: 'high', file: c.file, line: c.line });
    const linked = new Set<string>();
    for (const a of c.attributes) {
      for (const r of a.refs) {
        const t = idOf.get(r);
        if (!t || t === s || r === c.name) continue;
        const created = c.creates.find((x) => x.cls === r && x.inCtor && (x.field === a.name || !x.field));
        const props = { label: '', sourceRole: '', targetRole: a.name, targetMultiplicity: a.collection ? '0..*' : a.type.endsWith('*') || /Optional|\| null|\| undefined|None/.test(a.type) ? '0..1' : '1', navigable: true };
        if (created && !a.collection) addRel('composition', s, t, props, { basis: 'inferred', detail: `Field ${a.name} is created by ${c.name} itself (new ${r} at line ${created.line}), so its lifetime is likely owned.`, confidence: 'medium', file: c.file, line: created.line });
        else addRel('association', s, t, props, { basis: 'extracted', detail: `Field ${c.name}.${a.name}: ${a.type}`, confidence: 'high', file: c.file, line: a.line });
        linked.add(t);
      }
    }
    for (const m of c.methods) for (const r of m.refs) {
      const t = idOf.get(r);
      if (t && t !== s && !linked.has(t)) {
        addRel('dependency', s, t, { label: '' }, { basis: 'extracted', detail: `${c.name}.${m.name}(…) uses ${r} in its signature`, confidence: 'medium', file: c.file, line: m.line });
        linked.add(t);
      }
    }
    for (const x of c.creates) {
      const t = idOf.get(x.cls);
      if (t && t !== s && !linked.has(t)) {
        addRel('dependency', s, t, { label: 'creates' }, { basis: 'inferred', detail: `${c.name} creates ${x.cls} (line ${x.line})`, confidence: 'medium', file: c.file, line: x.line });
        linked.add(t);
      }
    }
  }
  const d = b.build('source', 'Extracted from source code (Tree-sitter, offline)');
  d.meta.evidence = ev;
  const dupNames = all.filter((c, i) => all.findIndex((o) => o.name === c.name) !== i).map((c) => `${c.name} (${c.file})`);
  d.meta.generation.warnings = [
    ...(truncated ? [`Showing the ${classes.length} most connected of ${all.length} classes.`] : []),
    ...(dupNames.length ? [`Classes with the same name in several files were merged: ${dupNames.slice(0, 5).join(', ')}`] : []),
    ...skipped.slice(0, 10).map((x) => `Skipped ${x}`),
  ];
  return { diagram: d, stats: { classes: classes.length, relationships: d.relationships.length, extracted, inferred, skipped, truncated } };
}

// ------------------------------------------------------------------ functions in a file (for the picker)
export function listFunctions(file: SourceFile): { name: string; qualified: string; line: number }[] {
  const g = grammarOf(file.language);
  if (!g) return [];
  const tree = parseWith(file.content, g);
  if (!tree) return [];
  const out: { name: string; qualified: string; line: number }[] = [];
  try {
    walk(tree.rootNode, (n) => {
      if (!['function_declaration', 'function_definition', 'method_declaration', 'method_definition', 'constructor_declaration', 'generator_function_declaration'].includes(n.type)) return;
      let name = field(n, 'name')?.text;
      if (!name && (g === 'c' || g === 'cpp')) {
        let d = field(n, 'declarator');
        while (d && d.type !== 'function_declarator') d = field(d, 'declarator');
        name = field(d, 'declarator')?.text;
      }
      if (!name) return;
      let cls = '';
      for (let p = n.parent; p; p = p.parent) if (['class_declaration', 'class_definition', 'class_specifier', 'abstract_class_declaration'].includes(p.type)) {
        cls = field(p, 'name')?.text ?? '';
        break;
      }
      out.push({ name, qualified: cls ? `${cls}.${name}` : name, line: line(n) });
    });
  } finally {
    tree.delete();
  }
  return out;
}
function findFunction(root: Node, qualified: string, g: Grammar): Node | null {
  const [cls, fn] = qualified.includes('.') ? qualified.split('.') : ['', qualified];
  let found: Node | null = null;
  walk(root, (n) => {
    if (found) return false;
    if (!['function_declaration', 'function_definition', 'method_declaration', 'method_definition', 'constructor_declaration', 'generator_function_declaration'].includes(n.type)) return;
    let name = field(n, 'name')?.text;
    if (!name && (g === 'c' || g === 'cpp')) {
      let d = field(n, 'declarator');
      while (d && d.type !== 'function_declarator') d = field(d, 'declarator');
      name = field(d, 'declarator')?.text;
    }
    if (name !== fn) return;
    if (cls) {
      let ok = false;
      for (let p = n.parent; p; p = p.parent) if (field(p, 'name')?.text === cls) ok = true;
      if (!ok) return;
    }
    found = n;
    return false;
  });
  return found;
}

// ------------------------------------------------------------------ sequence of calls
/** Sequence diagram of the calls made inside one method, in source order; receivers resolved from declared types. */
export function sequenceFromSource(files: SourceFile[], target: { path: string; function: string }): Diagram {
  const file = files.find((f) => f.path === target.path);
  if (!file) throw new AppError(404, 'not_found', 'Source file not found');
  const g = grammarOf(file.language);
  if (!g || g === 'c' || g === 'cpp') throw new AppError(422, 'unsupported', 'Call-sequence extraction supports Java, TypeScript, JavaScript and Python. Use an activity diagram for C / C++ functions.');
  const { classes } = extractClasses(files);
  const tree = parseWith(file.content, g)!;
  try {
    const fn = findFunction(tree.rootNode, target.function, g);
    if (!fn) throw new AppError(404, 'not_found', `Function ${target.function} was not found in ${target.path}.`);
    const ownerName = target.function.includes('.') ? target.function.split('.')[0] : '';
    const owner = classes.find((c) => c.name === ownerName);
    const b = new DiagramBuilder('sequence', `${target.function}()`);
    b.el('caller', 'participant', 'Caller', { participantType: 'actor' });
    const selfId = b.el(`p_${slug(ownerName || 'self')}`, 'participant', ownerName ? `:${ownerName}` : 'self');
    const parts = new Map<string, string>([['__self', selfId]]);
    const ev: Record<string, Evidence> = {};
    const participant = (cls: string, label: string) => {
      if (!parts.has(cls)) parts.set(cls, b.el(`p_${slug(cls)}`, 'participant', label, { participantType: /repo|dao|store|db/i.test(cls) ? 'database' : 'participant' }));
      return parts.get(cls)!;
    };
    // types of locals and parameters
    const types = new Map<string, string>();
    for (const a of owner?.attributes ?? []) if (a.refs[0]) types.set(`this.${a.name}`, a.refs[0]), types.set(`self.${a.name}`, a.refs[0]);
    walk(fn, (n) => {
      if (['formal_parameter', 'required_parameter', 'optional_parameter', 'typed_parameter', 'local_variable_declaration', 'variable_declarator', 'lexical_declaration'].includes(n.type)) {
        const t = typeRefs(field(n, 'type')?.text ?? field(n.parent, 'type')?.text ?? '')[0];
        const nm = (field(n, 'name') ?? field(n, 'pattern'))?.text ?? (n.type === 'typed_parameter' ? n.namedChildren[0]?.text : undefined);
        if (t && nm) types.set(nm, t);
        const v = field(n, 'value');
        if (nm && v && (v.type === 'new_expression' || v.type === 'object_creation_expression')) {
          const ct = typeRefs((field(v, 'constructor') ?? field(v, 'type'))?.text ?? '')[0];
          if (ct) types.set(nm, ct);
        }
      }
      if (n.type === 'assignment' && field(n, 'left')?.type === 'identifier') {
        const v = field(n, 'right');
        if (v?.type === 'call' && /^[A-Z]\w*$/.test(field(v, 'function')?.text ?? '')) types.set(field(n, 'left')!.text, field(v, 'function')!.text);
      }
    });
    b.msg('caller', selfId, `${target.function.split('.').pop()}()`);
    const fragStack: { kind: 'loop' | 'opt' | 'alt'; guard: string; from: number; elseFrom?: number; elseGuard?: string }[] = [];
    let msgs = 1;
    const visit = (n: Node) => {
      const isLoop = /^(for_statement|for_in_statement|enhanced_for_statement|while_statement|do_statement|for_of_statement)$/.test(n.type);
      const isIf = n.type === 'if_statement';
      if (isLoop || isIf) {
        const cond = (field(n, 'condition') ?? field(n, 'right') ?? n.namedChildren[0])?.text.replace(/^\(|\)$/g, '').slice(0, 50) ?? '';
        const start = msgs;
        if (isIf) {
          const cons = field(n, 'consequence') ?? n.namedChildren[1];
          const alt = field(n, 'alternative');
          if (cons) visit(cons);
          const elseFrom = msgs;
          if (alt) visit(alt);
          if (msgs > start) {
            if (alt && msgs > elseFrom && elseFrom > start) b.frag('alt', [{ guard: cond, from: start, to: elseFrom - 1 }, { guard: 'else', from: elseFrom, to: msgs - 1 }]);
            else b.frag('opt', [{ guard: cond, from: start, to: msgs - 1 }]);
          }
          return;
        }
        for (const c of n.namedChildren) visit(c);
        if (msgs > start) b.frag('loop', [{ guard: cond, from: start, to: msgs - 1 }]);
        return;
      }
      if (['call_expression', 'method_invocation', 'call', 'new_expression', 'object_creation_expression'].includes(n.type)) {
        for (const c of n.namedChildren) visit(c); // arguments first (evaluated before the call)
        let recv = '';
        let method = '';
        if (n.type === 'method_invocation') {
          recv = field(n, 'object')?.text ?? '';
          method = field(n, 'name')?.text ?? '';
        } else if (n.type === 'new_expression' || n.type === 'object_creation_expression') {
          const t = typeRefs((field(n, 'constructor') ?? field(n, 'type'))?.text ?? '')[0];
          if (t && classes.some((c) => c.name === t)) {
            const to = participant(t, `:${t}`);
            b.msg(selfId, to, '«create»', 'create');
            ev[`m${msgs}`] = { basis: 'extracted', detail: `new ${t}(…) at line ${line(n)}`, confidence: 'high', file: file.path, line: line(n) };
            msgs++;
          }
          return;
        } else {
          const f = field(n, 'function');
          if (f?.type === 'member_expression' || f?.type === 'attribute') {
            recv = (field(f, 'object'))?.text ?? '';
            method = (field(f, 'property') ?? field(f, 'attribute'))?.text ?? '';
          } else if (f?.type === 'identifier' && /^[A-Z]/.test(f.text) && classes.some((c) => c.name === f.text) && g === 'python') {
            const to = participant(f.text, `:${f.text}`);
            b.msg(selfId, to, '«create»', 'create');
            msgs++;
            return;
          } else return;
        }
        const args = (field(n, 'arguments')?.text ?? '()').slice(0, 30);
        if (recv === 'this' || recv === 'self') {
          if (owner?.methods.some((m) => m.name === method)) {
            b.msg(selfId, selfId, `${method}${args.length > 28 ? '(…)' : args}`);
            ev[`m${msgs}`] = { basis: 'extracted', detail: `call at line ${line(n)}`, confidence: 'high', file: file.path, line: line(n) };
            msgs++;
          }
          return;
        }
        const type = types.get(recv) ?? (classes.some((c) => c.name === recv) ? recv : undefined);
        if (!type || !classes.some((c) => c.name === type)) return; // library / unknown receivers are left out
        const to = participant(type, `${/^this\.|^self\./.test(recv) ? recv.split('.')[1] : recv}:${type}`);
        b.msg(selfId, to, `${method}${args.length > 28 ? '(…)' : args}`);
        ev[`m${msgs}`] = { basis: types.has(recv) ? 'extracted' : 'inferred', detail: `call at line ${line(n)} (receiver type from ${types.has(recv) ? 'its declaration' : 'the class name'})`, confidence: 'high', file: file.path, line: line(n) };
        msgs++;
        return;
      }
      if (['lambda', 'arrow_function', 'function_expression', 'lambda_expression'].includes(n.type)) return; // callbacks run later
      for (const c of n.namedChildren) visit(c);
    };
    visit(field(fn, 'body') ?? fn);
    b.msg(selfId, 'caller', 'return', 'return');
    void fragStack;
    if (msgs <= 1) throw new AppError(422, 'no_calls', `${target.function} does not call methods of other classes found in the analysed files, so there is no interaction to draw. Try an activity diagram of its control flow instead.`);
    const d = b.build('source', 'Extracted from source code (Tree-sitter, offline)');
    d.meta.generation.sourcePath = file.path;
    d.meta.generation.warnings = ['Only calls whose receiver type is declared in the analysed files are shown; library calls and callbacks are omitted.'];
    for (const [k, v] of Object.entries(ev)) d.meta.evidence[k] = v;
    return d;
  } finally {
    tree.delete();
  }
}

// ------------------------------------------------------------------ activity of one function
export function activityFromSource(file: SourceFile, fnName: string): Diagram {
  const g = grammarOf(file.language);
  if (!g) throw new AppError(422, 'unsupported', 'This language is not supported for activity extraction.');
  const tree = parseWith(file.content, g)!;
  try {
    const fn = findFunction(tree.rootNode, fnName, g);
    if (!fn) throw new AppError(404, 'not_found', `Function ${fnName} was not found in ${file.path}.`);
    const b = new DiagramBuilder('activity', `${fnName}()`);
    const start = b.el('start', 'initial', '');
    const end = b.el('end', 'final', '');
    let k = 0;
    const id = (p: string) => `${p}_${++k}`;
    const text = (n: Node) => n.text.replace(/\s+/g, ' ').replace(/;$/, '').trim();
    const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
    type Tail = { id: string; guard: string };
    const link = (tails: Tail[], to: string) => {
      for (const t of tails) b.rel('flow', t.id, to, { guard: t.guard });
    };
    const STMT_BLOCK = new Set(['block', 'statement_block', 'compound_statement']);
    const seq = (nodes: Node[], tails: Tail[]): Tail[] => {
      let cur = tails;
      for (const s of nodes) {
        if (!cur.length) break; // unreachable after return
        cur = stmt(s, cur);
      }
      return cur;
    };
    const body = (n: Node | null): Node[] => (!n ? [] : STMT_BLOCK.has(n.type) || n.type === 'else_clause' ? n.namedChildren.filter((c) => c.type !== 'comment').flatMap((c) => (c.type === 'else_clause' ? [] : [c])) : [n]);
    const stmt = (s: Node, tails: Tail[]): Tail[] => {
      switch (s.type) {
        case 'comment':
          return tails;
        case 'if_statement': {
          const dec = b.el(id('dec'), 'decision', '');
          link(tails, dec);
          const cond = short(text(field(s, 'condition') ?? s.namedChildren[0]).replace(/^\(|\)$/g, ''), 50);
          const consTails = seq(body(field(s, 'consequence') ?? s.namedChildren.find((c) => STMT_BLOCK.has(c.type)) ?? null), [{ id: dec, guard: cond }]);
          let alt = field(s, 'alternative');
          const elifs = s.namedChildren.filter((c) => c.type === 'elif_clause');
          let elseTails: Tail[];
          if (elifs.length) {
            // python elif chain → nested decisions
            let prev: Tail[] = [{ id: dec, guard: 'else' }];
            const collected: Tail[] = [];
            for (const e of elifs) {
              const d2 = b.el(id('dec'), 'decision', '');
              link(prev, d2);
              collected.push(...seq(body(field(e, 'consequence')), [{ id: d2, guard: short(text(field(e, 'condition') ?? e), 50) }]));
              prev = [{ id: d2, guard: 'else' }];
            }
            const elseC = s.namedChildren.find((c) => c.type === 'else_clause');
            collected.push(...(elseC ? seq(body(field(elseC, 'body') ?? elseC.namedChildren[0]), prev) : prev));
            elseTails = collected;
          } else {
            if (alt?.type === 'else_clause') alt = field(alt, 'body') ?? alt.namedChildren[0] ?? null;
            elseTails = alt ? (alt.type === 'if_statement' ? stmt(alt, [{ id: dec, guard: 'else' }]) : seq(body(alt), [{ id: dec, guard: 'else' }])) : [{ id: dec, guard: 'else' }];
          }
          const all = [...consTails, ...elseTails];
          if (!all.length) return [];
          const merge = b.el(id('merge'), 'merge', '');
          link(all, merge);
          return [{ id: merge, guard: '' }];
        }
        case 'for_statement':
        case 'for_in_statement':
        case 'enhanced_for_statement':
        case 'while_statement':
        case 'for_range_loop':
        case 'for_of_statement': {
          const dec = b.el(id('loop'), 'decision', '');
          link(tails, dec);
          const head = short(text(s).split('{')[0].split(':\n')[0].replace(/\s*\)?\s*\{?$/, ''), 50);
          const inner = seq(body(field(s, 'body') ?? s.namedChildren.find((c) => STMT_BLOCK.has(c.type)) ?? null), [{ id: dec, guard: head.replace(/^(for|while)\s*\(?/, '').replace(/\)$/, '') }]);
          link(inner, dec);
          return [{ id: dec, guard: 'done' }];
        }
        case 'return_statement':
        case 'throw_statement':
        case 'raise_statement': {
          const a = b.el(id('act'), 'action', short(text(s)));
          link(tails, a);
          b.rel('flow', a, end);
          return [];
        }
        case 'try_statement':
          return seq([...(field(s, 'body') ? body(field(s, 'body')) : body(s.namedChildren.find((c) => STMT_BLOCK.has(c.type)) ?? null))], tails);
        default: {
          if (STMT_BLOCK.has(s.type)) return seq(body(s), tails);
          const a = b.el(id('act'), 'action', short(text(s)));
          link(tails, a);
          return [{ id: a, guard: '' }];
        }
      }
    };
    const rest = seq(body(field(fn, 'body')), [{ id: start, guard: '' }]);
    link(rest, end);
    if (b.d.elements.length > 160) throw new AppError(422, 'too_large', `${fnName} has too many statements for a readable activity diagram (${b.d.elements.length} nodes). Split it into smaller functions.`);
    const d = b.build('source', 'Extracted from source code (Tree-sitter, offline)');
    d.meta.generation.sourcePath = file.path;
    for (const e of d.elements) d.meta.evidence[e.id] = { basis: 'extracted', detail: `Control flow of ${fnName} in ${file.path}`, confidence: 'high', file: file.path, line: line(fn) };
    return d;
  } finally {
    tree.delete();
  }
}
