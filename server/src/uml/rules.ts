/**
 * Deterministic (offline) text → UML. Two layers:
 *  1. structured arrow notation (exact): e.g. `Order *-- "1..*" Item : contains`, `User -> API : login`,
 *     `[*] --> Created`, `Created --> Paid : pay [ok] / email`;
 *  2. sentence patterns for plain English ("A member can borrow multiple books", "X is a Y",
 *     "if … otherwise …", "in parallel", "from A to B when E", …).
 * Every result says which extraction was used; nothing is labelled as AI.
 */
import { DiagramBuilder, slug, type Diagram, type DiagramType } from '../../../shared/uml/index.js';

export interface RuleResult {
  diagram: Diagram;
  method: 'structured' | 'sentences';
  notes: string[];
}

const STOP = new Set('a an the this that these those each every any some all one two many multiple several create make draw generate design build show give diagram class classes use case cases system include includes including with and or of for to in on at by from as it its is are be can may must should will would also then when if else otherwise which who where there their they we our you your user users please uml sequence activity state component deployment object'.split(' '));
const QUANT: Record<string, string> = { many: '0..*', multiple: '0..*', several: '0..*', 'one or more': '1..*', 'zero or more': '0..*', 'a list of': '0..*', 'a set of': '0..*', a: '1', an: '1', one: '1', 'exactly one': '1', 'at most one': '0..1', 'an optional': '0..1', 'zero or one': '0..1' };

const cap = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** Removes articles / filler words and trailing "as …" and keeps the original casing (first letter upper-cased). */
export const clean = (s: string) =>
  s
    .trim()
    .replace(/^(?:the|a|an|each|every|and|or|then)\s+/i, '')
    .replace(/\s+(?:as(?:\s+(?:an?\s+)?(?:actors?|participants?))?)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
const pascal = (s: string) => cap(s.trim()).replace(/\s+/g, '');
export function singular(w: string): string {
  if (/ies$/i.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
  if (/(ses|xes|ches|shes)$/i.test(w)) return w.slice(0, -2);
  if (/s$/i.test(w) && !/(ss|us|is)$/i.test(w) && w.length > 3) return w.slice(0, -1);
  return w;
}
const sentences = (t: string) => t.replace(/\r/g, '').split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim().replace(/[.!?;]+$/, '')).filter(Boolean);
const splitList = (s: string) => s.split(/\s*,\s*|\s+and\s+|\s+or\s+|\s*\/\s*/i).map((x) => x.trim().replace(/^(?:and|or)\s+/i, '').replace(/^(the|a|an)\s+/i, '')).filter(Boolean);

class Names {
  ids = new Map<string, string>();
  b: DiagramBuilder;
  constructor(b: DiagramBuilder) {
    this.b = b;
  }
  key = (s: string) => singular(clean(s).toLowerCase());
  has = (s: string) => this.ids.has(this.key(s));
  get = (s: string) => this.ids.get(this.key(s));
  add(rawName: string, kind: Parameters<DiagramBuilder['el']>[1], props: Record<string, unknown> = {}, prefix = 'e'): string {
    const name = kind === 'class' || kind === 'object' ? rawName.trim() : clean(rawName);
    const k = this.key(name);
    if (this.ids.has(k)) return this.ids.get(k)!;
    let id = `${prefix}_${slug(name)}`;
    for (let n = 2; this.b.d.elements.some((e) => e.id === id); n++) id = `${prefix}_${slug(name)}_${n}`;
    this.b.el(id, kind, name, props);
    this.ids.set(k, id);
    return id;
  }
}

// =================================================================== structured notation
const ARROW_LINE = /^\s*(.+?)\s+(<\|--|--\|>|<\|\.\.|\.\.\|>|\*--|--\*|o--|--o|\.\.>|<\.\.|-->>|->>|-->|->|--|-\(\)|-\(|\.\.)\s+(.+?)\s*(?::\s*(.*))?$/;

function structured(type: DiagramType, text: string): RuleResult | null {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("'") && !l.startsWith('//') && !/^@(start|end)uml/i.test(l));
  const arrowLines = lines.filter((l) => ARROW_LINE.test(l) || /^\[\*\]/.test(l));
  if (arrowLines.length < Math.max(1, Math.ceil(lines.length / 3))) return null;
  const b = new DiagramBuilder(type, '');
  const n = new Names(b);
  const notes: string[] = [];
  const title = lines.find((l) => /^title\s+/i.test(l));
  if (title) b.d.title = title.replace(/^title\s+/i, '');
  const unquote = (s: string) => s.trim().replace(/^"(.*)"$/, '$1').replace(/^\((.*)\)$/, '$1').trim();
  const mult = (s: string) => {
    const m = /^(.*?)\s*"([^"]+)"$/.exec(s.trim()) ?? /^"([^"]+)"\s*(.*)$/.exec(s.trim());
    if (!m) return { name: unquote(s), m: '' };
    return /^"/.test(s.trim()) ? { name: unquote(m[2]), m: m[1] } : { name: unquote(m[1]), m: m[2] };
  };
  const frags: { kind: 'alt' | 'opt' | 'loop' | 'par'; guard: string; from: number; operands: { guard: string; from: number }[] }[] = [];
  const fragDone: { kind: 'alt' | 'opt' | 'loop' | 'par'; operands: { guard: string; from: number; to: number }[] }[] = [];
  let msgCount = 0;
  for (const raw of lines) {
    if (/^title\s+/i.test(raw)) continue;
    if (type === 'sequence') {
      const fm = /^(alt|opt|loop|par)\b\s*(.*)$/i.exec(raw);
      if (fm) {
        frags.push({ kind: fm[1].toLowerCase() as 'alt', guard: fm[2], from: msgCount, operands: [] });
        continue;
      }
      const em = /^(else|and)\b\s*(.*)$/i.exec(raw);
      if (em && frags.length) {
        frags[frags.length - 1].operands.push({ guard: em[2] || 'else', from: msgCount });
        continue;
      }
      if (/^end$/i.test(raw) && frags.length) {
        const f = frags.pop()!;
        const starts = [{ guard: f.guard, from: f.from }, ...f.operands];
        const ops = starts.map((o, i) => ({ guard: o.guard, from: o.from, to: (starts[i + 1]?.from ?? msgCount) - 1 })).filter((o) => o.to >= o.from);
        if (ops.length) fragDone.push({ kind: f.kind, operands: ops });
        continue;
      }
      const decl = /^(actor|participant|boundary|control|entity|database)\s+(.+?)(?:\s+as\s+\w+)?$/i.exec(raw);
      if (decl) {
        n.add(unquote(decl[2]), 'participant', { participantType: decl[1].toLowerCase() }, 'p');
        continue;
      }
    }
    if (type === 'class') {
      const decl = /^(abstract class|abstract|class|interface|enum)\s+([\w$]+)\s*(\{(.*)\})?$/i.exec(raw);
      if (decl) {
        const kind = /interface/i.test(decl[1]) ? 'interface' : /abstract/i.test(decl[1]) ? 'abstract' : /enum/i.test(decl[1]) ? 'enum' : 'class';
        const members = (decl[4] ?? '').split(';').map((x) => x.trim()).filter(Boolean);
        const vm: Record<string, string> = { '+': '+', '-': '-', '#': '#', '~': '~' };
        const attributes = members.filter((x) => !x.includes('(')).map((x) => {
          const v = vm[x[0]] ?? '-';
          const [nm, tp] = x.replace(/^[+\-#~]\s*/, '').split(':').map((s) => s.trim());
          return { name: nm, type: tp ?? '', visibility: v };
        });
        const methods = members.filter((x) => x.includes('(')).map((x) => {
          const v = vm[x[0]] ?? '+';
          const m = /^([\w$]+)\s*\(([^)]*)\)\s*(?::\s*(.+))?$/.exec(x.replace(/^[+\-#~]\s*/, ''));
          return { name: m?.[1] ?? x, params: (m?.[2] ?? '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => ({ name: p.split(':')[0].trim(), type: (p.split(':')[1] ?? '').trim() })), returnType: m?.[3] ?? '', visibility: v };
        });
        const id = n.add(decl[2], 'class', { classKind: kind }, 'cls');
        const el = b.d.elements.find((e) => e.id === id)!;
        if (el.kind === 'class') {
          el.classKind = kind;
          el.attributes.push(...(attributes as typeof el.attributes));
          el.methods.push(...(methods.map((m) => ({ ...m, isStatic: false, isAbstract: kind === 'interface' })) as typeof el.methods));
        }
        continue;
      }
    }
    if (type === 'object') {
      const od = /^([\w$]+)\s*:\s*([\w$]+)\s*(\{(.*)\})?$/.exec(raw);
      if (od) {
        const slots = (od[4] ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean).map((x) => ({ name: x.split('=')[0].trim(), value: (x.split('=').slice(1).join('=') ?? '').trim() }));
        n.add(od[1], 'object', { className: od[2], slots }, 'o');
        continue;
      }
    }
    const m = ARROW_LINE.exec(raw);
    const star = /^\[\*\]\s*-->\s*(.+?)\s*(?::\s*(.*))?$/.exec(raw) ?? /^(.+?)\s*-->\s*\[\*\]\s*(?::\s*(.*))?$/.exec(raw);
    if (type === 'state' && star) {
      const toFinal = /\[\*\]\s*(?::|$)/.test(raw.split('-->')[1] ?? '');
      const st = unquote(star[1]);
      const sid = n.add(st, 'state', {}, 's');
      if (toFinal) {
        if (!b.d.elements.some((e) => e.id === 'final')) b.el('final', 'final', '');
        b.rel('transition', sid, 'final', parseTransition(star[2] ?? ''));
      } else {
        if (!b.d.elements.some((e) => e.id === 'initial')) b.el('initial', 'initial', '');
        b.rel('transition', 'initial', sid, parseTransition(star[2] ?? ''));
      }
      continue;
    }
    if (!m) {
      notes.push(`Ignored line: "${raw.slice(0, 60)}"`);
      continue;
    }
    const [, left, arrow, right, label = ''] = m;
    const L = mult(left);
    const R = mult(right);
    switch (type) {
      case 'class': {
        const a = n.add(pascal(L.name), 'class', {}, 'cls');
        const c = n.add(pascal(R.name), 'class', {}, 'cls');
        const kinds: Record<string, [string, boolean]> = { '<|--': ['inheritance', true], '--|>': ['inheritance', false], '<|..': ['realization', true], '..|>': ['realization', false], '*--': ['composition', false], '--*': ['composition', true], 'o--': ['aggregation', false], '--o': ['aggregation', true], '..>': ['dependency', false], '<..': ['dependency', true], '-->': ['association', false], '--': ['association', false], '->': ['association', false] };
        const [kind, rev] = kinds[arrow] ?? ['association', false];
        const [s, t] = rev ? [c, a] : [a, c];
        const [sm, tm] = rev ? [R.m, L.m] : [L.m, R.m];
        b.rel(kind as 'association', s, t, { label, ...(['association', 'aggregation', 'composition'].includes(kind) ? { sourceMultiplicity: sm, targetMultiplicity: tm, navigable: arrow === '-->' || arrow === '->' } : {}) });
        break;
      }
      case 'usecase': {
        const isUc = (s: string) => /^\(.*\)$/.test(s.trim());
        const sys = b.d.elements.find((e) => e.kind === 'boundary')?.id ?? b.el('system', 'boundary', 'System');
        const mk = (raw2: string) => (isUc(raw2) ? n.add(unquote(raw2), 'usecase', { parent: sys }, 'uc') : n.add(unquote(raw2), 'actor', {}, 'actor'));
        const a = mk(L.name.startsWith('(') ? `(${L.name})` : left.trim());
        const c = mk(right.trim());
        if (/include/i.test(label)) b.rel('include', a, c);
        else if (/extend/i.test(label)) b.rel('extend', a, c, { label: label.replace(/<<\s*extend\s*>>|«extend»|extends?/i, '').trim() });
        else if (arrow === '<|--') b.rel('generalization', c, a);
        else b.rel('association', a, c);
        break;
      }
      case 'sequence': {
        const a = n.add(unquote(left), 'participant', {}, 'p');
        const c = n.add(unquote(right), 'participant', {}, 'p');
        const kind = arrow === '-->' || arrow === '-->>' ? 'return' : arrow === '->>' ? 'async' : 'sync';
        b.msg(a, c, label, kind);
        msgCount++;
        break;
      }
      case 'activity': {
        const node = (s: string) => {
          const t = unquote(s);
          if (/^\(?\*\)?$|^start$/i.test(t)) return b.d.elements.find((e) => e.kind === 'initial')?.id ?? b.el('start', 'initial', '');
          if (/^end$|^stop$/i.test(t)) return b.d.elements.find((e) => e.kind === 'final')?.id ?? b.el('end', 'final', '');
          if (/^<>\s*/.test(t) || /\?$/.test(t)) return n.add(t.replace(/^<>\s*/, ''), 'decision', {}, 'dec');
          return n.add(t, 'action', {}, 'act');
        };
        b.rel('flow', node(left), node(right), { guard: label.replace(/^\[|\]$/g, '') });
        break;
      }
      case 'state': {
        const a = n.add(unquote(left), 'state', {}, 's');
        const c = n.add(unquote(right), 'state', {}, 's');
        b.rel('transition', a, c, parseTransition(label));
        break;
      }
      case 'component': {
        const a = n.add(unquote(left), 'component', {}, 'cmp');
        if (arrow === '-()' || arrow === '-(') {
          const i = n.add(unquote(right), 'interface', {}, 'if');
          b.rel(arrow === '-()' ? 'provides' : 'requires', a, i);
        } else b.rel('dependency', a, n.add(unquote(right), 'component', {}, 'cmp'), { label });
        break;
      }
      case 'deployment': {
        const a = n.add(unquote(left), 'node', {}, 'node');
        const c = n.add(unquote(right), 'node', {}, 'node');
        b.rel('communication', a, c, { label });
        break;
      }
      case 'object': {
        const a = n.add(unquote(left), 'object', {}, 'o');
        const c = n.add(unquote(right), 'object', {}, 'o');
        b.rel('link', a, c, { label });
        break;
      }
    }
  }
  for (const f of fragDone) b.frag(f.kind, f.operands);
  if (!b.d.elements.length) return null;
  const d = b.build('rules', 'Structured text (offline, not AI)');
  return { diagram: d, method: 'structured', notes };
}
function parseTransition(label: string) {
  const m = /^\s*([^[/]*?)\s*(?:\[([^\]]*)\])?\s*(?:\/\s*(.*))?$/.exec(label ?? '') ?? [];
  return { event: (m[1] ?? '').trim(), guard: (m[2] ?? '').trim(), action: (m[3] ?? '').trim() };
}

// =================================================================== sentence patterns
function classSentences(text: string, b: DiagramBuilder, notes: string[]) {
  const n = new Names(b);
  const all = sentences(text);
  // explicit lists: "include Book, Member and Loan" / "classes: A, B"
  for (const s of all) {
    const m = /\b(?:include|includes|including|containing|with|classes|entities|such as)\s*:?\s+([A-Z][\w ]*(?:\s*,\s*[A-Z][\w ]*)*(?:\s*,?\s*and\s+[A-Z][\w ]*)?)/.exec(s);
    if (m) for (const x of splitList(m[1])) if (/^[A-Z]/.test(x) && x.split(' ').length <= 3) n.add(pascal(singular(x)), 'class', {}, 'cls');
  }
  // capitalised / CamelCase words that are not stop words
  for (const s of all) for (const w of s.match(/\b[A-Z][a-zA-Z0-9]+\b/g) ?? []) if (!STOP.has(w.toLowerCase()) && s.indexOf(w) > 0) n.add(pascal(singular(w)), 'class', {}, 'cls');
  // lower-case nouns in the unambiguous form "A member can borrow multiple books"
  for (const s of all) {
    const m = /^(?:an?|each|every)\s+([a-z][a-z]+)\s+(?:can|may|must)\s+[a-z]+\s+(?:many|multiple|several|one or more|zero or more|an?|one)\s+([a-z][a-z]+)$/i.exec(s);
    if (m && !STOP.has(m[1].toLowerCase()) && !STOP.has(m[2].toLowerCase())) for (const w of [m[1], m[2]]) n.add(pascal(singular(w)), 'class', {}, 'cls');
  }
  const findClass = (phrase: string) => {
    const words = phrase.trim().split(/\s+/);
    for (let len = Math.min(3, words.length); len >= 1; len--) for (let i = words.length - len; i >= 0; i--) {
      const cand = pascal(singular(words.slice(i, i + len).join(' ')));
      if (n.has(cand)) return n.get(cand)!;
    }
    return null;
  };
  const quant = (q: string | undefined, plural: boolean) => (q ? QUANT[q.toLowerCase()] ?? '' : plural ? '0..*' : '1');
  for (const s of all) {
    let m: RegExpExecArray | null;
    if ((m = /^(?:an?\s+|the\s+|each\s+|every\s+)?(.+?)\s+(?:is an?|is a kind of|is a type of|extends|inherits from|is a subclass of|specializes)\s+(?:an?\s+)?(.+)$/i.exec(s))) {
      const a = findClass(m[1]);
      const c = findClass(m[2]);
      if (a && c && a !== c) b.rel('inheritance', a, c);
      continue;
    }
    if ((m = /^(?:an?\s+|the\s+|each\s+)?(.+?)\s+implements\s+(?:the\s+)?(.+)$/i.exec(s))) {
      const a = findClass(m[1]);
      const c = findClass(m[2]);
      if (a && c) {
        const el = b.d.elements.find((e) => e.id === c);
        if (el?.kind === 'class') el.classKind = 'interface';
        b.rel('realization', a, c);
      }
      continue;
    }
    if ((m = /^(?:an?\s+|the\s+|each\s+|every\s+)?(.+?)\s+(?:consists of|is composed of|is made up of|contains|owns)\s+(many|multiple|several|one or more|zero or more|a list of|a set of|an?|one)?\s*(.+)$/i.exec(s))) {
      const a = findClass(m[1]);
      const targets = splitList(m[3]).map(findClass).filter(Boolean) as string[];
      for (const t of targets) if (a && t !== a) b.rel('composition', a, t, { sourceMultiplicity: '1', targetMultiplicity: quant(m[2], /s\b/.test(m[3])) });
      if (a && targets.length) continue;
    }
    if ((m = /^(?:an?\s+|the\s+|each\s+|every\s+)?(.+?)\s+(?:has|have|holds|keeps)\s+(many|multiple|several|one or more|zero or more|a list of|a set of|an?|one|exactly one|at most one|an optional)?\s*(.+)$/i.exec(s))) {
      const a = findClass(m[1]);
      const parts = splitList(m[3]);
      const classTargets = parts.map(findClass);
      if (a && classTargets.some(Boolean)) {
        parts.forEach((p, i) => {
          const t = classTargets[i];
          if (t && t !== a) b.rel('aggregation', a, t, { sourceMultiplicity: '1', targetMultiplicity: quant(m![2], /s$/.test(p)) });
        });
        continue;
      }
      if (a) {
        // "X has a name, email and phone" → attributes
        const el = b.d.elements.find((e) => e.id === a);
        if (el?.kind === 'class') for (const p of parts) if (/^[a-z][\w ]{0,30}$/i.test(p) && p.split(' ').length <= 3) el.attributes.push({ name: p.replace(/\s+(\w)/g, (_x, c: string) => c.toUpperCase()), type: '', visibility: '-', isStatic: false, defaultValue: '' });
        continue;
      }
    }
    if ((m = /^(?:an?\s+|the\s+|each\s+|every\s+)?(.+?)\s+(?:uses|depends on|calls|creates|sends|notifies)\s+(?:an?\s+|the\s+)?(.+)$/i.exec(s))) {
      const a = findClass(m[1]);
      const t = findClass(m[2]);
      if (a && t && a !== t) {
        b.rel('dependency', a, t, { label: /creates/i.test(s) ? 'creates' : /sends/i.test(s) ? 'sends' : /notifies/i.test(s) ? 'notifies' : '' });
        continue;
      }
    }
    if ((m = /^(?:an?\s+|the\s+|each\s+|every\s+)?(.+?)\s+(?:belongs to|is assigned to|is owned by|is part of)\s+(?:an?\s+|one\s+|the\s+)?(.+)$/i.exec(s))) {
      const a = findClass(m[1]);
      const t = findClass(m[2]);
      if (a && t && a !== t) {
        if (/part of/i.test(s)) b.rel('composition', t, a, { sourceMultiplicity: '1', targetMultiplicity: '0..*' });
        else b.rel('association', a, t, { sourceMultiplicity: '0..*', targetMultiplicity: '1', navigable: true, label: /assigned/i.test(s) ? 'assigned to' : '' });
        continue;
      }
    }
    // generic: "<A> (can|may|must)? <verb phrase> (many|multiple|…)? <B>"
    if ((m = /^(?:an?\s+|the\s+|each\s+|every\s+)?([A-Za-z][\w ]*?)\s+(?:can|may|must|should|will)?\s*([a-z]+(?:\s+(?:in|for|to|on|with|from))?)\s+(many|multiple|several|one or more|zero or more|an?|one|the)?\s*([A-Za-z][\w ]*)$/i.exec(s))) {
      const a = findClass(m[1]);
      const t = findClass(m[4]);
      if (a && t && a !== t && !/^(is|are|be|has|have)$/i.test(m[2])) {
        const verb = m[2].replace(/^(\w+?)(e?s)?$/, '$1').toLowerCase();
        const label = /s$/.test(m[2]) ? m[2].toLowerCase() : `${verb}${/(s|sh|ch|x)$/.test(verb) ? 'es' : verb.endsWith('e') ? 's' : 's'}`;
        b.rel('association', a, t, { label, sourceMultiplicity: '1', targetMultiplicity: quant(m[3] === 'the' ? undefined : m[3], /s$/.test(m[4].trim())), navigable: true });
      }
    }
  }
  if (!b.d.relationships.length && b.d.elements.length > 1) notes.push('No relationships were recognised; describe them with sentences such as "A member can borrow multiple books" or arrows such as "Member --> Book".');
}

function useCaseSentences(text: string, b: DiagramBuilder, notes: string[]) {
  const n = new Names(b);
  const sysName = /\bfor (?:an?|the)\s+([\w -]+?)\s+(?:system|application|app|platform|website|portal)\b/i.exec(text);
  const sys = b.el('system', 'boundary', sysName ? `${cap(sysName[1])} ${/(system|application|app|platform|website|portal)/i.exec(sysName[0])![1].replace(/^\w/, (c) => c.toUpperCase())}` : 'System');
  const secondaryWord = /\b(system|service|gateway|bank|api|server|provider|database|processor)\b/i;
  const actorList = /\b(?:actors?|users?)\s*(?:are|:|include|including)\s*([A-Z][\w ]*(?:\s*,\s*[A-Z][\w ]*)*(?:\s*,?\s*and\s+[A-Z][\w ]*)?)/.exec(text);
  if (actorList) for (const a of splitList(actorList[1])) n.add(clean(a), 'actor', { role: secondaryWord.test(a) ? 'secondary' : 'primary' }, 'actor');
  const withActors = /\bwith\s+([A-Z][\w ]*(?:\s*,\s*[A-Z][\w ]*)*(?:\s*,?\s*and\s+[A-Z][\w ]*)?)\s+(?:as\s+)?actors?\b/.exec(text);
  if (withActors) for (const a of splitList(withActors[1])) n.add(clean(a), 'actor', { role: secondaryWord.test(a) ? 'secondary' : 'primary' }, 'actor');
  for (const s of sentences(text)) {
    let m: RegExpExecArray | null;
    if ((m = /^(?:an?\s+|the\s+)?([A-Z][\w ]*?)\s+(?:can|may|must|should be able to|is able to|wants to|needs to|will)\s+(.+)$/.exec(s))) {
      const actor = n.add(clean(m[1].trim()), 'actor', { role: secondaryWord.test(m[1]) ? 'secondary' : 'primary' }, 'actor');
      for (const raw of splitList(m[2].replace(/\s+(?:in|on|through|using) the (?:app|system|application)$/i, ''))) {
        const uc = n.add(clean(raw.replace(/^to\s+/, '')).replace(/^(\w)/, (c) => c.toUpperCase()), 'usecase', { parent: sys }, 'uc');
        b.rel('association', actor, uc);
      }
      continue;
    }
    if ((m = /^(.+?)\s+(?:includes|always requires|requires)\s+(.+)$/i.exec(s))) {
      const a = n.get(m[1]) ?? n.add(clean(m[1]), 'usecase', { parent: sys }, 'uc');
      const c = n.get(m[2]) ?? n.add(clean(m[2]), 'usecase', { parent: sys }, 'uc');
      b.rel('include', a, c);
      continue;
    }
    if ((m = /^(.+?)\s+(?:extends|optionally extends)\s+(.+?)(?:\s+(?:when|if)\s+(.+))?$/i.exec(s))) {
      const a = n.get(m[1]) ?? n.add(clean(m[1]), 'usecase', { parent: sys }, 'uc');
      const c = n.get(m[2]) ?? n.add(clean(m[2]), 'usecase', { parent: sys }, 'uc');
      b.rel('extend', a, c, { label: m[3] ? `[${m[3]}]` : '' });
      continue;
    }
    if ((m = /^(.+?)\s+(?:is handled by|is processed by|involves|uses)\s+(?:the\s+)?([A-Z][\w ]+)$/.exec(s))) {
      const uc = n.get(m[1]);
      if (uc) b.rel('association', uc, n.add(clean(m[2]), 'actor', { role: 'secondary' }, 'actor'));
    }
  }
  // "Banking System" listed as an actor but never connected: connect it to the use cases it is named in
  if (!b.d.relationships.length) notes.push('No "<actor> can <action>" sentences were found; describe what each actor can do, e.g. "Customer can view balance, transfer funds and pay bills".');
}

function sequenceSentences(text: string, b: DiagramBuilder, notes: string[]) {
  const n = new Names(b);
  const listed = /\b(?:between|participants?:?|involving)\s+(?:the\s+)?([A-Z][\w ]*(?:\s*,\s*(?:the\s+)?[A-Z][\w ]*)*(?:\s*,?\s*and\s+(?:the\s+)?[A-Z][\w ]*)?)/.exec(text);
  const typeOf = (s: string) => (/\b(user|customer|admin|person|client|student|member)\b/i.test(s) ? 'actor' : /\b(database|db|store|repository)\b/i.test(s) ? 'database' : /\b(ui|frontend|front-end|page|screen|form|browser|app)\b/i.test(s) ? 'boundary' : /\b(api|server|service|controller|backend|gateway)\b/i.test(s) ? 'control' : 'participant');
  if (listed) for (const p of splitList(listed[1])) n.add(clean(p), 'participant', { participantType: typeOf(p) }, 'p');
  const known = () => [...n.ids.keys()].sort((a, c) => c.length - a.length);
  const findP = (s: string) => {
    const low = s.toLowerCase();
    let best: { id: string; at: number; len: number } | null = null;
    for (const k of known()) {
      const i = low.search(new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`));
      if (i >= 0 && (!best || i < best.at || (i === best.at && k.length > best.len))) best = { id: n.ids.get(k)!, at: i, len: k.length };
    }
    return best;
  };
  let lastCaller: string | null = null;
  let lastCallee: string | null = null;
  for (const raw of text.split(/(?<=[.!?;])\s+|\n+|,\s*(?:then|and then|which|after which)\s+|\s+then\s+/i).map((s) => s.trim().replace(/[.!?;]+$/, '')).filter(Boolean)) {
    // subject = first participant mentioned (or a new capitalised subject)
    let m = /^(?:the\s+|a\s+|an\s+)?([A-Z][\w ]*?)\s+(sends?|calls?|requests?|asks?|queries|query|forwards?|submits?|validates?|checks?|returns?|responds?|replies?|notifies?|stores?|saves?|creates?|signs?|logs?|enters?|clicks?|communicates?|passes?|fetches?|looks?)\b(.*)$/.exec(raw);
    if (!m) continue;
    const from = n.has(m[1]) ? n.get(m[1])! : n.add(clean(m[1].trim()), 'participant', { participantType: typeOf(m[1]) }, 'p');
    const verb = m[2].toLowerCase();
    const rest = m[3].trim();
    const targetMatch = /\b(?:to|with|from|on|in|against|for)\s+(?:the\s+)?([A-Z][\w ]*?)(?:\s+(?:to|for|with|and|which|that)\b|$)/.exec(rest);
    let to: string | null = targetMatch ? (n.has(targetMatch[1]) ? n.get(targetMatch[1])! : n.add(clean(targetMatch[1].trim()), 'participant', { participantType: typeOf(targetMatch[1]) }, 'p')) : null;
    if (!to) {
      // the receiver is whichever participant is mentioned first: a known one or a new capitalised name
      const f = findP(rest);
      const capWord = /\b(?:the\s+)?([A-Z][\w]*(?:\s+[A-Z][\w]*)*)/.exec(rest);
      const capIsNew = capWord && !n.has(capWord[1]) && n.key(capWord[1]) !== n.key(b.d.elements.find((e) => e.id === from)?.name ?? '');
      if (capIsNew && (!f || capWord!.index < f.at)) to = n.add(capWord![1], 'participant', { participantType: typeOf(capWord![1]) }, 'p');
      else if (f && f.id !== from) to = f.id;
    }
    const isReturn = /^(returns?|responds?|replies?)$/.test(verb);
    if (!to && isReturn && lastCaller && from === lastCallee) to = lastCaller;
    if (!to && /^(validates?|checks?|stores?|saves?|logs?)$/.test(verb)) to = from; // self call
    if (!to) {
      notes.push(`Could not find the receiver in: "${raw.slice(0, 70)}"`);
      continue;
    }
    const label = `${verb.replace(/s$/, '').replace(/ie$/, 'y')} ${rest.replace(targetMatch?.[0] ?? '', '').trim()}`.trim().replace(/\s+/g, ' ').slice(0, 80);
    b.msg(from, to, isReturn ? rest.replace(/^(the\s+)?/, '').replace(targetMatch?.[0] ?? '', '').trim() || 'result' : label, isReturn ? 'return' : /notif|async/.test(verb) ? 'async' : 'sync');
    if (!isReturn && from !== to) {
      lastCaller = from;
      lastCallee = to;
    }
  }
  if (!b.d.relationships.length) notes.push('No messages were recognised; write one step per sentence, e.g. "The Frontend sends the credentials to the Auth API", or use arrows such as "Frontend -> Auth API : POST /login".');
}

function activitySentences(text: string, b: DiagramBuilder, notes: string[]) {
  const n = new Names(b);
  const start = b.el('start', 'initial', '');
  let tails: { id: string; guard: string }[] = [{ id: start, guard: '' }];
  const connect = (to: string) => {
    for (const t of tails) b.rel('flow', t.id, to, { guard: t.guard });
    tails = [{ id: to, guard: '' }];
  };
  const steps = text
    .replace(/^(?:create|draw|generate|make|design)\s+(?:an?\s+)?activity diagram\s+(?:for|of|showing)\s+(?:an?\s+|the\s+)?[^:,.]*[:,.]\s*/i, '')
    .split(/(?<=[.!?;])\s+|\n+|,\s*then\s+|\s+then\s+|,\s*(?=if\b)|,\s*after that\s+/i)
    .map((s) => s.trim().replace(/[.!?;]+$/, ''))
    .filter(Boolean);
  const action = (s: string) => n.add(clean(s.replace(/^(?:the\s+(?:system|user|customer)\s+)?/i, '').replace(/^(first|next|finally|afterwards)\s*,?\s*/i, '')).replace(/^(\w)/, (c) => c.toUpperCase()).slice(0, 120), 'action', {}, 'act');
  for (const s of steps) {
    let m: RegExpExecArray | null;
    if ((m = /^if\s+(.+?),\s*(.+?)(?:[,;]?\s*(?:otherwise|else|if not)\s*,?\s*(.+))?$/i.exec(s))) {
      const dec = n.add(`dec_${b.d.elements.length}`, 'decision', {}, 'dec');
      const decEl = b.d.elements.find((e) => e.id === dec)!;
      decEl.name = '';
      connect(dec);
      const yes = action(m[2]);
      b.rel('flow', dec, yes, { guard: m[1] });
      const branchTails = [{ id: yes, guard: '' }];
      if (m[3]) {
        const no = action(m[3]);
        b.rel('flow', dec, no, { guard: 'else' });
        branchTails.push({ id: no, guard: '' });
      } else branchTails.push({ id: dec, guard: 'else' });
      const merge = b.el(`merge_${b.d.elements.length}`, 'merge', '');
      for (const t of branchTails) b.rel('flow', t.id, merge, { guard: t.guard });
      tails = [{ id: merge, guard: '' }];
      continue;
    }
    if ((m = /^(?:in parallel|at the same time|simultaneously)\s*,?\s*(.+)$/i.exec(s)) || (m = /^(.+?)\s+(?:in parallel|at the same time|simultaneously)$/i.exec(s))) {
      const fork = b.el(`fork_${b.d.elements.length}`, 'fork', '');
      connect(fork);
      const join = b.el(`join_${b.d.elements.length}`, 'join', '');
      for (const p of splitList(m[1].replace(/^(the system\s+)/i, ''))) {
        const a = action(p);
        b.rel('flow', fork, a);
        b.rel('flow', a, join);
      }
      tails = [{ id: join, guard: '' }];
      continue;
    }
    if (s.split(' ').length > 18) notes.push(`Long step shortened: "${s.slice(0, 50)}…"`);
    connect(action(s.replace(/^then\s+/i, '').split(' ').slice(0, 14).join(' ')));
  }
  const end = b.el('end', 'final', '');
  connect(end);
  if (b.d.elements.length <= 3) notes.push('Very few steps were recognised; write one step per sentence or separate steps with "then".');
}

function stateSentences(text: string, b: DiagramBuilder, notes: string[]) {
  const n = new Names(b);
  const list = /\b(?:states?|containing|stages?|statuses)\s*(?:are|:|include|including|of|such as)?\s*([A-Z][\w ]*(?:\s*,\s*[A-Z][\w ]*)*(?:\s*,?\s*(?:and|or)\s+[A-Z][\w ]*)?)/.exec(text);
  const listed = list ? splitList(list[1]).map((x) => cap(x.trim())) : [];
  for (const s of listed) n.add(s, 'state', {}, 's');
  let transitions = 0;
  for (const s of sentences(text)) {
    let m: RegExpExecArray | null;
    if ((m = /\bfrom\s+([A-Z][\w ]*?)\s+to\s+([A-Z][\w ]*?)(?:\s+(?:when|on|after|if|once)\s+(.+))?$/i.exec(s)) || (m = /^(?:an?\s+|the\s+)?(?:\w+\s+in\s+)?([A-Z][\w ]*?)\s+(?:becomes|moves to|goes to|changes to|transitions to|can become|can move to)\s+([A-Z][\w ]*?)(?:\s+(?:when|on|after|if|once)\s+(.+))?$/.exec(s))) {
      const a = n.add(clean(m[1].trim()), 'state', {}, 's');
      const c = n.add(clean(m[2].trim()), 'state', {}, 's');
      b.rel('transition', a, c, { event: (m[3] ?? '').replace(/^(the|a)\s+/i, '').trim() });
      transitions++;
    }
  }
  const states = b.d.elements.filter((e) => e.kind === 'state');
  if (!states.length) return;
  if (!transitions && listed.length > 1) {
    // only a list: a linear lifecycle in the given order; states named like terminal outcomes end the machine
    const terminal = /^(cancel+ed|rejected|failed|closed|completed|delivered|archived|expired|refunded)$/i;
    const main = listed.filter((x) => !/^(cancel+ed|rejected|failed|expired)$/i.test(x));
    for (let i = 0; i < main.length - 1; i++) b.rel('transition', n.get(main[i])!, n.get(main[i + 1])!);
    for (const x of listed.filter((y) => /^(cancel+ed|rejected|failed|expired)$/i.test(y))) for (const src of main.slice(0, -1).slice(0, 3)) b.rel('transition', n.get(src)!, n.get(x)!, { event: x.toLowerCase().replace(/lled$/, 'l').replace(/ed$/, '') });
    notes.push('Only a list of states was found: transitions were assumed in the listed order (marked as inferred).');
    for (const r of b.d.relationships) b.d.meta.evidence[r.id] = { basis: 'inferred', detail: 'Assumed from the order of the listed states.', confidence: 'low' };
    void terminal;
  }
  const incoming = new Set(b.d.relationships.map((r) => r.target));
  const outgoing = new Set(b.d.relationships.map((r) => r.source));
  const first = states.find((s) => !incoming.has(s.id)) ?? states[0];
  b.el('initial', 'initial', '');
  b.rel('transition', 'initial', first.id);
  const ends = states.filter((s) => !outgoing.has(s.id));
  if (ends.length) {
    b.el('final', 'final', '');
    for (const e of ends) b.rel('transition', e.id, 'final');
  }
}

function componentSentences(text: string, b: DiagramBuilder, notes: string[]) {
  const n = new Names(b);
  const list = /\b(?:components?|services|modules|with|containing|including)\s*:?\s+([A-Z][\w ]*(?:\s*,\s*(?:an?\s+|the\s+)?[A-Z][\w ]*)*(?:\s*,?\s*and\s+(?:an?\s+|the\s+)?[A-Z][\w ]*)?)/.exec(text);
  if (list) for (const c of splitList(list[1])) n.add(clean(c), 'component', { stereotype: /\bexternal\b/i.test(c) ? 'external' : '' }, 'cmp');
  for (const s of sentences(text)) {
    let m: RegExpExecArray | null;
    if ((m = /^(?:the\s+)?([A-Z][\w ]*?)\s+(?:provides|exposes|offers)\s+(?:an?\s+|the\s+)?([A-Z][\w ]*?)(?:\s+interface)?$/.exec(s))) {
      const c = n.add(clean(m[1]), 'component', {}, 'cmp');
      b.rel('provides', c, n.add(m[2].trim(), 'interface', {}, 'if'));
      continue;
    }
    if ((m = /^(?:the\s+)?([A-Z][\w ]*?)\s+(?:requires|needs)\s+(?:an?\s+|the\s+)?([A-Z][\w ]*?)(?:\s+interface)?$/.exec(s))) {
      const c = n.add(clean(m[1]), 'component', {}, 'cmp');
      const i = n.has(m[2]) ? n.get(m[2])! : n.add(m[2].trim(), 'interface', {}, 'if');
      const el = b.d.elements.find((e) => e.id === i);
      b.rel(el?.kind === 'interface' ? 'requires' : 'dependency', c, i);
      continue;
    }
    if ((m = /^(?:the\s+)?([A-Z][\w ]*?)\s+(?:uses|calls|talks to|depends on|connects to|communicates with|sends \w+ to|reads from|writes to|stores data in|queries)\s+(?:an?\s+|the\s+)?([A-Z][\w ]*?)(?:\s+(?:via|over|using|through)\s+(.+))?$/.exec(s))) {
      const a = n.add(clean(m[1]), 'component', {}, 'cmp');
      const c = n.add(clean(m[2]), 'component', {}, 'cmp');
      if (a !== c) b.rel('dependency', a, c, { label: m[3] ?? '' });
    }
  }
  if (!b.d.relationships.length && b.d.elements.length) notes.push('No dependencies were recognised; use sentences such as "The Backend API uses the Database via SQL".');
}

function deploymentSentences(text: string, b: DiagramBuilder, notes: string[]) {
  const n = new Names(b);
  const machine = /\b(server|machine|device|computer|laptop|phone|mobile|tablet|client|vm|host|cluster|container|browser)\b/i;
  const env = /\b(node\.?js|jvm|java|python|docker|tomcat|nginx|apache|browser|runtime|postgres|postgresql|mysql|mongodb|redis|kubernetes|container)\b/i;
  for (const s of sentences(text)) {
    let m: RegExpExecArray | null;
    if ((m = /^(?:the\s+|an?\s+)?([A-Za-z][\w .-]*?)\s+(?:runs on|is deployed on|is deployed to|is hosted on|lives on|is installed on)\s+(?:the\s+|an?\s+)?([A-Za-z][\w .-]*?)$/i.exec(s))) {
      const host = n.add(clean(m[2].trim()), 'node', { nodeType: env.test(m[2]) ? 'executionEnvironment' : 'device' }, 'node');
      const what = m[1].trim();
      if (/\.\w{1,5}$|\b(app|application|service|api|bundle|war|jar|site|frontend|backend|database schema)\b/i.test(what) && !machine.test(what)) {
        const a = n.add(what, 'artifact', { parent: host }, 'art');
        const el = b.d.elements.find((e) => e.id === a);
        if (el) el.parent = host;
      } else {
        const inner = n.add(clean(what), 'node', { nodeType: env.test(what) ? 'executionEnvironment' : 'device' }, 'node');
        const el = b.d.elements.find((e) => e.id === inner);
        if (el && inner !== host) el.parent = host;
      }
      continue;
    }
    if ((m = /^(?:the\s+)?([A-Za-z][\w .-]*?)\s+(?:connects to|communicates with|talks to|sends requests to|accesses)\s+(?:the\s+)?([A-Za-z][\w .-]*?)(?:\s+(?:via|over|using|through)\s+(.+))?$/i.exec(s))) {
      const a = n.has(m[1]) ? n.get(m[1])! : n.add(clean(m[1]), 'node', { nodeType: 'device' }, 'node');
      const c = n.has(m[2]) ? n.get(m[2])! : n.add(clean(m[2]), 'node', { nodeType: 'device' }, 'node');
      const top = (id: string) => {
        let cur = b.d.elements.find((e) => e.id === id);
        while (cur?.parent) cur = b.d.elements.find((e) => e.id === cur!.parent);
        return cur?.id ?? id;
      };
      const ta = b.d.elements.find((e) => e.id === a)?.kind === 'node' ? a : top(a);
      const tc = b.d.elements.find((e) => e.id === c)?.kind === 'node' ? c : top(c);
      if (ta !== tc) b.rel('communication', ta, tc, { label: m[3] ?? '' });
    }
  }
  const list = /\b(?:across|on|between|with nodes?)\s+(?:a|an|the)?\s*([a-z][\w ]*(?:\s*,\s*(?:a|an|the)?\s*[a-z][\w ]*)*(?:\s*,?\s*and\s+(?:a|an|the)?\s*[a-z][\w ]*))/i.exec(text);
  if (list && !b.d.elements.length) for (const x of splitList(list[1])) if (machine.test(x)) n.add(clean(x.replace(/^(a|an|the)\s+/i, '')), 'node', { nodeType: 'device' }, 'node');
  if (!b.d.relationships.length && b.d.elements.length > 1) {
    notes.push('No communication paths were stated; nodes were connected in the order they were mentioned (marked as inferred).');
    const tops = b.d.elements.filter((e) => e.kind === 'node' && !e.parent);
    for (let i = 0; i < tops.length - 1; i++) {
      const id = b.rel('communication', tops[i].id, tops[i + 1].id);
      b.d.meta.evidence[id] = { basis: 'inferred', detail: 'Assumed from the order of the description.', confidence: 'low' };
    }
  }
}

function objectSentences(text: string, b: DiagramBuilder, notes: string[]) {
  const n = new Names(b);
  for (const s of sentences(text)) {
    let m: RegExpExecArray | null;
    if ((m = /^(?:the\s+)?([a-z][\w]*|"[^"]+")\s+(?:is an?|is the)\s+([A-Z]\w*)(?:\s+(?:with|whose|having)\s+(.+))?$/.exec(s))) {
      const slots = (m[3] ?? '').split(/\s*,\s*|\s+and\s+/).map((x) => /^(\w+)\s*(?:=|is|of)\s*(.+)$/.exec(x.trim())).filter(Boolean).map((x) => ({ name: x![1], value: x![2] }));
      n.add(m[1].replace(/"/g, ''), 'object', { className: m[2], slots }, 'o');
      continue;
    }
    if ((m = /^(?:the\s+)?([a-z]\w*)\s+(?:is linked to|is enrolled in|enrolls in|belongs to|is in|references|works in|owns|has)\s+(?:the\s+)?([a-z]\w*)$/.exec(s))) {
      if (n.has(m[1]) && n.has(m[2])) b.rel('link', n.get(m[1])!, n.get(m[2])!, { label: s.replace(m[1], '').replace(m[2], '').trim().replace(/^(is\s+)/, '') });
    }
  }
  if (!b.d.elements.length) notes.push('No objects were recognised; write "asha is a Student with rollNo = CS21-014" or "asha : Student { rollNo = CS21-014 }".');
}

/** Rule-based generation; returns null when nothing usable was recognised. */
export function generateWithRules(type: DiagramType, text: string): RuleResult | null {
  const s = structured(type, text);
  if (s) return s;
  const b = new DiagramBuilder(type, '');
  const titleM = /\bfor (?:an?\s+|the\s+)?([\w -]{3,60}?)(?:\.|:|,|$| system| application| app)/i.exec(text);
  b.d.title = titleM ? cap(titleM[1].trim()) : '';
  const notes: string[] = [];
  ({ class: classSentences, usecase: useCaseSentences, sequence: sequenceSentences, activity: activitySentences, state: stateSentences, component: componentSentences, deployment: deploymentSentences, object: objectSentences })[type](text, b, notes);
  const meaningful = type === 'activity' ? b.d.elements.length > 3 : b.d.elements.filter((e) => e.kind !== 'boundary').length > 0;
  if (!meaningful) return null;
  const d = b.build('rules', 'Rule-based extraction (offline, not AI)');
  for (const e of d.elements) if (!d.meta.evidence[e.id]) d.meta.evidence[e.id] = { basis: 'stated', detail: 'Named in your description.', confidence: 'high' };
  return { diagram: d, method: 'sentences', notes };
}
