/**
 * Local-AI contracts for UML generation. The model answers with names (not ids); the converter
 * resolves names, reports every unresolved reference and never invents elements to satisfy one.
 */
import { fields } from '../providers/schemas.js';
import { DiagramBuilder, slug, type Diagram, type DiagramType } from '../../../shared/uml/index.js';

const { str, int, enm, arr, obj } = fields;
const vis = enm(['public', 'private', 'protected', 'package']);
const yesno = enm(['yes', 'no']);

export const UML_AI = {
  class: obj({
    title: str(200),
    classes: arr(obj({ name: str(80), kind: enm(['class', 'abstract', 'interface', 'enum']), attributes: arr(obj({ name: str(60), type: str(60), visibility: vis }), 15), methods: arr(obj({ name: str(60), parameters: str(200), returnType: str(60), visibility: vis }), 15) }), 25),
    relationships: arr(obj({ from: str(80), to: str(80), type: enm(['association', 'aggregation', 'composition', 'inheritance', 'realization', 'dependency']), label: str(80), fromMultiplicity: str(12), toMultiplicity: str(12) }), 40),
  }),
  usecase: obj({
    title: str(200),
    system: str(120),
    actors: arr(obj({ name: str(80), primary: yesno }), 12),
    useCases: arr(obj({ name: str(120) }), 25),
    associations: arr(obj({ actor: str(80), useCase: str(120) }), 50),
    includes: arr(obj({ from: str(120), to: str(120) }), 20),
    extends: arr(obj({ from: str(120), to: str(120), condition: str(120) }), 20),
  }),
  sequence: obj({
    title: str(200),
    participants: arr(obj({ name: str(80), type: enm(['actor', 'participant', 'boundary', 'control', 'entity', 'database']) }), 12),
    messages: arr(obj({ from: str(80), to: str(80), text: str(160), type: enm(['sync', 'async', 'return', 'create']) }), 50),
    fragments: arr(obj({ type: enm(['alt', 'opt', 'loop', 'par']), condition: str(120), firstMessage: int(1, 50), lastMessage: int(1, 50), elseCondition: str(120), elseFirstMessage: int(0, 50) }), 8),
  }),
  activity: obj({
    title: str(200),
    nodes: arr(obj({ id: str(40), type: enm(['start', 'action', 'decision', 'merge', 'fork', 'join', 'end']), text: str(160), lane: str(60) }), 40),
    flows: arr(obj({ from: str(40), to: str(40), guard: str(80) }), 60),
  }),
  state: obj({
    title: str(200),
    states: arr(obj({ name: str(80), entry: str(80), exit: str(80), doActivity: str(80) }), 25),
    initialState: str(80),
    finalStates: arr(str(80), 6),
    transitions: arr(obj({ from: str(80), to: str(80), event: str(80), guard: str(80), action: str(80) }), 50),
  }),
  component: obj({
    title: str(200),
    components: arr(obj({ name: str(80), stereotype: str(40) }), 25),
    interfaces: arr(obj({ name: str(80), providedBy: str(80), requiredBy: arr(str(80), 8) }), 15),
    dependencies: arr(obj({ from: str(80), to: str(80), label: str(60) }), 40),
  }),
  deployment: obj({
    title: str(200),
    nodes: arr(obj({ name: str(80), type: enm(['device', 'executionEnvironment', 'node']), insideNode: str(80) }), 20),
    artifacts: arr(obj({ name: str(80), node: str(80) }), 25),
    connections: arr(obj({ from: str(80), to: str(80), protocol: str(40) }), 30),
  }),
  object: obj({
    title: str(200),
    objects: arr(obj({ name: str(60), className: str(60), values: arr(obj({ name: str(60), value: str(100) }), 12) }), 25),
    links: arr(obj({ from: str(60), to: str(60), label: str(60) }), 40),
  }),
};

export const PROMPT_HINT: Record<DiagramType, string> = {
  class: 'List every class (abstract classes and interfaces too) with key attributes and methods, then the relationships. Use inheritance for "is a", composition for "consists of / owns parts that cannot exist alone", aggregation for "has / contains", association for other links, realization for implementing interfaces. Multiplicities like 1, 0..1, 0..*, 1..*.',
  usecase: 'Identify actors (primary = initiates use cases, secondary = external systems that help), the use cases as short verb phrases, which actor takes part in which use case, and include / extend relationships between use cases.',
  sequence: 'List the participants in order from left to right, then every message in time order. Use "return" for replies. Fragments refer to message numbers (1 = first message); use alt with elseCondition / elseFirstMessage for if/else, opt for optional steps, loop for repetition.',
  activity: 'Use one "start" node, "action" nodes for steps, "decision" nodes for branches with guarded flows, "merge" nodes to join branches, "fork"/"join" for parallel steps and an "end" node. Give each node a short unique id and connect them with flows. Use lane only if responsibilities are stated.',
  state: 'List the states, the initial state, the final states (if any) and the transitions with the event that triggers them, optional guard and action.',
  component: 'List the software components, interfaces they provide or require, and dependencies between components (with the protocol or purpose as label).',
  deployment: 'List hardware devices and execution environments (insideNode = the device they run on), the deployed artifacts and the node they are deployed on, and communication paths with the protocol.',
  object: 'List concrete object instances with their class and attribute values, and the links between objects.',
};

const vmap: Record<string, '+' | '-' | '#' | '~'> = { public: '+', private: '-', protected: '#', package: '~' };

/** Converts the model's answer into a diagram. Unresolved names are reported, never invented. */
export function convertAi(type: DiagramType, a: any, prompt: string): { diagram: Diagram; problems: string[] } {
  const b = new DiagramBuilder(type, String(a.title ?? '').slice(0, 200));
  const problems: string[] = [];
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const idFor = (name: string, prefix: string) => {
    let id = `${prefix}_${slug(name)}`;
    for (let n = 2; used.has(id); n++) id = `${prefix}_${slug(name)}_${n}`;
    used.add(id);
    ids.set(key(name), id);
    return id;
  };
  const ref = (name: string, what: string): string | null => {
    const id = ids.get(key(name ?? ''));
    if (!id) problems.push(`${what} refers to "${name}", which is not defined.`);
    return id ?? null;
  };
  const dup = (name: string) => ids.has(key(name));
  switch (type) {
    case 'class':
      for (const c of a.classes ?? []) {
        if (!c.name?.trim() || dup(c.name)) continue;
        b.el(idFor(c.name, 'cls'), 'class', c.name.trim(), {
          classKind: c.kind,
          attributes: (c.attributes ?? []).filter((x: any) => x.name?.trim()).map((x: any) => ({ name: x.name.trim(), type: x.type ?? '', visibility: vmap[x.visibility] ?? '-' })),
          methods: (c.methods ?? []).filter((x: any) => x.name?.trim()).map((m: any) => ({
            name: m.name.trim().replace(/\(.*$/, ''),
            params: String(m.parameters ?? '')
              .split(',')
              .map((p: string) => p.trim())
              .filter(Boolean)
              .map((p: string) => {
                const [n, t] = p.includes(':') ? p.split(':').map((x) => x.trim()) : p.split(/\s+/).reverse();
                return { name: (n || 'arg').slice(0, 80), type: (t ?? '').slice(0, 120) };
              }),
            returnType: m.returnType ?? '',
            visibility: vmap[m.visibility] ?? '+',
            isAbstract: c.kind === 'interface',
          })),
        });
      }
      for (const r of a.relationships ?? []) {
        const s = ref(r.from, `A ${r.type} relationship`);
        const t = ref(r.to, `A ${r.type} relationship`);
        if (!s || !t) continue;
        const assoc = ['association', 'aggregation', 'composition'].includes(r.type);
        b.rel(r.type, s, t, { label: r.label ?? '', ...(assoc ? { sourceMultiplicity: r.fromMultiplicity ?? '', targetMultiplicity: r.toMultiplicity ?? '' } : {}) });
      }
      break;
    case 'usecase': {
      for (const ac of a.actors ?? []) if (ac.name?.trim() && !dup(ac.name)) b.el(idFor(ac.name, 'actor'), 'actor', ac.name.trim(), { role: ac.primary === 'no' ? 'secondary' : 'primary' });
      const sys = b.el('system', 'boundary', a.system?.trim() || 'System');
      for (const u of a.useCases ?? []) if (u.name?.trim() && !dup(u.name)) b.el(idFor(u.name, 'uc'), 'usecase', u.name.trim(), { parent: sys });
      for (const x of a.associations ?? []) {
        const s = ref(x.actor, 'An actor association');
        const t = ref(x.useCase, 'An actor association');
        if (s && t) b.rel('association', s, t);
      }
      for (const x of a.includes ?? []) {
        const s = ref(x.from, 'An include');
        const t = ref(x.to, 'An include');
        if (s && t) b.rel('include', s, t);
      }
      for (const x of a.extends ?? []) {
        const s = ref(x.from, 'An extend');
        const t = ref(x.to, 'An extend');
        if (s && t) b.rel('extend', s, t, { label: x.condition ? `[${x.condition.replace(/^\[|\]$/g, '')}]` : '' });
      }
      break;
    }
    case 'sequence': {
      for (const p of a.participants ?? []) if (p.name?.trim() && !dup(p.name)) b.el(idFor(p.name, 'p'), 'participant', p.name.trim(), { participantType: p.type });
      const msgs = (a.messages ?? []) as any[];
      msgs.forEach((m) => {
        const s = ref(m.from, 'A message');
        const t = ref(m.to, 'A message');
        if (s && t) b.msg(s, t, m.text ?? '', m.type);
      });
      const n = b.d.relationships.length;
      for (const f of a.fragments ?? []) {
        const from = Number(f.firstMessage) - 1;
        const to = Number(f.lastMessage) - 1;
        if (!(from >= 0 && to >= from && to < n)) {
          problems.push(`A ${f.type} fragment covers messages ${f.firstMessage}–${f.lastMessage}, which do not exist.`);
          continue;
        }
        const ef = Number(f.elseFirstMessage) - 1;
        if (f.type === 'alt' && ef > from && ef <= to) b.frag('alt', [{ guard: f.condition ?? '', from, to: ef - 1 }, { guard: f.elseCondition || 'else', from: ef, to }]);
        else b.frag(f.type, [{ guard: f.condition ?? '', from, to }]);
      }
      break;
    }
    case 'activity': {
      const lanes = new Map<string, string>();
      for (const nd of a.nodes ?? []) {
        if (!nd.id?.trim() || dup(nd.id)) continue;
        let parent: string | null = null;
        if (nd.lane?.trim()) {
          if (!lanes.has(key(nd.lane))) lanes.set(key(nd.lane), b.el(`lane_${slug(nd.lane)}`, 'lane', nd.lane.trim()));
          parent = lanes.get(key(nd.lane))!;
        }
        const kind = nd.type === 'start' ? 'initial' : nd.type === 'end' ? 'final' : nd.type;
        b.el(idFor(nd.id, 'n'), kind, kind === 'action' || kind === 'decision' ? (nd.text ?? '') : '', { parent });
      }
      for (const f of a.flows ?? []) {
        const s = ref(f.from, 'A flow');
        const t = ref(f.to, 'A flow');
        if (s && t && s !== t) b.rel('flow', s, t, { guard: String(f.guard ?? '').replace(/^\[|\]$/g, '') });
      }
      break;
    }
    case 'state': {
      for (const s of a.states ?? []) if (s.name?.trim() && !dup(s.name)) b.el(idFor(s.name, 's'), 'state', s.name.trim(), { entry: s.entry ?? '', exit: s.exit ?? '', doActivity: s.doActivity ?? '' });
      const init = a.initialState ? ref(a.initialState, 'The initial state') : null;
      if (init) {
        b.el('initial', 'initial', '');
        b.rel('transition', 'initial', init);
      }
      const finals = (a.finalStates ?? []).filter((x: string) => x?.trim());
      if (finals.length) b.el('final', 'final', '');
      for (const f of finals) {
        const s = ref(f, 'A final state');
        if (s) b.rel('transition', s, 'final');
      }
      for (const t of a.transitions ?? []) {
        const s = ref(t.from, 'A transition');
        const tt = ref(t.to, 'A transition');
        if (s && tt) b.rel('transition', s, tt, { event: t.event ?? '', guard: String(t.guard ?? '').replace(/^\[|\]$/g, ''), action: t.action ?? '' });
      }
      break;
    }
    case 'component': {
      for (const c of a.components ?? []) if (c.name?.trim() && !dup(c.name)) b.el(idFor(c.name, 'cmp'), 'component', c.name.trim(), { stereotype: c.stereotype ?? '' });
      for (const i of a.interfaces ?? []) {
        if (!i.name?.trim() || dup(i.name)) continue;
        const id = b.el(idFor(i.name, 'if'), 'interface', i.name.trim());
        if (i.providedBy?.trim()) {
          const p = ref(i.providedBy, `Interface ${i.name}`);
          if (p) b.rel('provides', p, id);
        }
        for (const r of i.requiredBy ?? []) {
          const c = ref(r, `Interface ${i.name}`);
          if (c) b.rel('requires', c, id);
        }
      }
      for (const x of a.dependencies ?? []) {
        const s = ref(x.from, 'A dependency');
        const t = ref(x.to, 'A dependency');
        if (s && t && s !== t) b.rel('dependency', s, t, { label: x.label ?? '' });
      }
      break;
    }
    case 'deployment': {
      const nodes = (a.nodes ?? []) as any[];
      for (const nd of nodes) if (nd.name?.trim() && !dup(nd.name)) b.el(idFor(nd.name, 'node'), 'node', nd.name.trim(), { nodeType: nd.type });
      for (const nd of nodes) {
        if (!nd.insideNode?.trim()) continue;
        const me = ids.get(key(nd.name));
        const p = ref(nd.insideNode, `Node ${nd.name}`);
        const el = b.d.elements.find((e) => e.id === me);
        if (el && p && p !== me) el.parent = p;
      }
      for (const ar of a.artifacts ?? []) {
        if (!ar.name?.trim() || dup(ar.name)) continue;
        const p = ar.node?.trim() ? ref(ar.node, `Artifact ${ar.name}`) : null;
        b.el(idFor(ar.name, 'art'), 'artifact', ar.name.trim(), { parent: p });
      }
      for (const c of a.connections ?? []) {
        const s = ref(c.from, 'A communication path');
        const t = ref(c.to, 'A communication path');
        if (s && t && s !== t) b.rel('communication', s, t, { label: c.protocol ?? '' });
      }
      break;
    }
    case 'object': {
      for (const o of a.objects ?? []) if (o.name?.trim() && !dup(o.name)) b.el(idFor(o.name, 'o'), 'object', o.name.trim(), { className: o.className ?? '', slots: (o.values ?? []).filter((v: any) => v.name?.trim()).map((v: any) => ({ name: v.name.trim(), value: String(v.value ?? '') })) });
      for (const l of a.links ?? []) {
        const s = ref(l.from, 'A link');
        const t = ref(l.to, 'A link');
        if (s && t && s !== t) b.rel('link', s, t, { label: l.label ?? '' });
      }
      break;
    }
  }
  const d = b.build('ai', 'Local AI');
  d.meta.generation.prompt = prompt.slice(0, 4000);
  for (const e of d.elements) d.meta.evidence[e.id] = { basis: 'ai', detail: 'Proposed by the local AI model from your description.', confidence: 'medium' };
  return { diagram: d, problems };
}
