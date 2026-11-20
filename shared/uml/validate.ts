/** Semantic validation of a diagram: structure first (Zod), then UML notation rules. */
import { DiagramSchema, ELEMENT_KINDS, RELATIONSHIP_KINDS, ELEMENT_LABEL, RELATIONSHIP_LABEL, type Diagram, type DiagramElement, type ElementKind, type Relationship } from './model.js';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
  elementId?: string;
  relationshipId?: string;
}
export interface ValidationResult {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
}

const CONTAINERS: Partial<Record<ElementKind, ElementKind[]>> = {
  usecase: ['boundary'],
  action: ['lane'],
  decision: ['lane'],
  merge: ['lane'],
  fork: ['lane'],
  join: ['lane'],
  initial: ['lane'],
  final: ['lane'],
  flowFinal: ['lane'],
  artifact: ['node'],
  node: ['node'],
  component: ['component', 'node'],
  port: ['component'],
  interface: ['component', 'node'],
  state: ['state'],
};

/** Which endpoint kinds each relationship kind accepts: [sources, targets]. */
const ENDPOINTS: Record<string, [ElementKind[], ElementKind[]]> = {
  'class:association': [['class'], ['class']],
  'class:aggregation': [['class'], ['class']],
  'class:composition': [['class'], ['class']],
  'class:inheritance': [['class'], ['class']],
  'class:realization': [['class'], ['class']],
  'class:dependency': [['class'], ['class']],
  'usecase:association': [['actor', 'usecase'], ['usecase', 'actor']],
  'usecase:include': [['usecase'], ['usecase']],
  'usecase:extend': [['usecase'], ['usecase']],
  'usecase:generalization': [['actor', 'usecase'], ['actor', 'usecase']],
  'sequence:message': [['participant'], ['participant']],
  'activity:flow': [['initial', 'action', 'decision', 'merge', 'fork', 'join'], ['action', 'decision', 'merge', 'fork', 'join', 'final', 'flowFinal']],
  'state:transition': [['initial', 'state', 'decision'], ['state', 'final', 'decision']],
  'component:dependency': [['component', 'port', 'node'], ['component', 'interface', 'port', 'node']],
  'component:provides': [['component', 'port'], ['interface']],
  'component:requires': [['component', 'port'], ['interface']],
  'component:association': [['component', 'node', 'port'], ['component', 'node', 'port']],
  'deployment:communication': [['node'], ['node']],
  'deployment:deploy': [['artifact', 'component'], ['node']],
  'deployment:dependency': [['artifact', 'component', 'node'], ['artifact', 'component', 'node']],
  'object:link': [['object'], ['object']],
};

export function validateDiagram(input: unknown): ValidationResult & { diagram: Diagram | null } {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const parsed = DiagramSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 25)) errors.push({ level: 'error', code: 'schema', message: `${i.path.join('.') || 'diagram'}: ${i.message}` });
    return { valid: false, errors, warnings, diagram: null };
  }
  const d = parsed.data as unknown as Diagram;
  const err = (code: string, message: string, ref: Partial<Issue> = {}) => errors.push({ level: 'error', code, message, ...ref });
  const warn = (code: string, message: string, ref: Partial<Issue> = {}) => warnings.push({ level: 'warning', code, message, ...ref });

  // ---------------------------------------------------------------- identifiers
  const ids = new Map<string, DiagramElement>();
  const all = new Set<string>();
  for (const e of d.elements) {
    if (all.has(e.id)) err('duplicate-id', `Duplicate identifier "${e.id}".`, { elementId: e.id });
    all.add(e.id);
    ids.set(e.id, e);
  }
  for (const r of d.relationships) {
    if (all.has(r.id)) err('duplicate-id', `Duplicate identifier "${r.id}".`, { relationshipId: r.id });
    all.add(r.id);
  }
  for (const f of d.fragments) {
    if (all.has(f.id)) err('duplicate-id', `Duplicate identifier "${f.id}".`);
    all.add(f.id);
  }

  // ---------------------------------------------------------------- elements
  const allowedKinds = ELEMENT_KINDS[d.type];
  const names = new Map<string, string>();
  for (const e of d.elements) {
    const ref = { elementId: e.id };
    if (!allowedKinds.includes(e.kind)) err('element-kind', `${ELEMENT_LABEL[e.kind]} elements are not part of a ${d.type} diagram.`, ref);
    const needsName = !['initial', 'final', 'flowFinal', 'decision', 'merge', 'fork', 'join'].includes(e.kind);
    if (needsName && !e.name.trim()) err('empty-name', `${ELEMENT_LABEL[e.kind]} "${e.id}" has no name.`, ref);
    if (needsName && e.name.trim()) {
      const key = `${e.kind}:${e.name.trim().toLowerCase()}:${e.parent ?? ''}`;
      if (names.has(key)) warn('duplicate-name', `Two ${ELEMENT_LABEL[e.kind].toLowerCase()}s are named "${e.name}".`, ref);
      names.set(key, e.id);
    }
    if (e.parent !== null) {
      const p = ids.get(e.parent);
      if (!p) err('missing-parent', `"${e.name || e.id}" is inside "${e.parent}", which does not exist.`, ref);
      else if (!(CONTAINERS[e.kind] ?? []).includes(p.kind)) err('invalid-parent', `A ${ELEMENT_LABEL[e.kind].toLowerCase()} cannot be placed inside a ${ELEMENT_LABEL[p.kind].toLowerCase()}.`, ref);
    }
    if (e.kind === 'class') {
      const seen = new Set<string>();
      for (const a of e.attributes) {
        if (seen.has(a.name)) warn('duplicate-member', `${e.name} declares attribute "${a.name}" twice.`, ref);
        seen.add(a.name);
      }
      if (e.classKind === 'interface' && e.attributes.some((a) => !a.isStatic)) warn('interface-attribute', `Interface ${e.name} has non-static attributes.`, ref);
      if (e.classKind !== 'abstract' && e.classKind !== 'interface' && e.methods.some((m) => m.isAbstract)) warn('abstract-method', `${e.name} has abstract methods but is not abstract.`, ref);
    }
  }
  // containment cycles
  for (const e of d.elements) {
    const seen = new Set<string>([e.id]);
    let p = e.parent;
    while (p) {
      if (seen.has(p)) {
        err('parent-cycle', `"${e.name || e.id}" is (indirectly) inside itself.`, { elementId: e.id });
        break;
      }
      seen.add(p);
      p = ids.get(p)?.parent ?? null;
    }
  }

  // ---------------------------------------------------------------- relationships
  const allowedRel = RELATIONSHIP_KINDS[d.type];
  for (const r of d.relationships) {
    const ref = { relationshipId: r.id };
    if (!allowedRel.includes(r.kind)) {
      err('relationship-kind', `${RELATIONSHIP_LABEL[r.kind]} is not used in a ${d.type} diagram.`, ref);
      continue;
    }
    const s = ids.get(r.source);
    const t = ids.get(r.target);
    if (!s) err('missing-endpoint', `Relationship "${r.id}" starts at "${r.source}", which does not exist.`, ref);
    if (!t) err('missing-endpoint', `Relationship "${r.id}" ends at "${r.target}", which does not exist.`, ref);
    if (!s || !t) continue;
    const ep = ENDPOINTS[`${d.type}:${r.kind}`];
    if (ep && (!ep[0].includes(s.kind) || !ep[1].includes(t.kind)))
      err('invalid-endpoint', `${RELATIONSHIP_LABEL[r.kind]} cannot connect a ${ELEMENT_LABEL[s.kind].toLowerCase()} to a ${ELEMENT_LABEL[t.kind].toLowerCase()}.`, ref);
    if (r.kind === 'realization' && t.kind === 'class' && t.classKind !== 'interface') warn('realization-target', `${s.name} realizes ${t.name}, which is not an interface.`, ref);
    if (r.kind === 'inheritance' && s.kind === 'class' && t.kind === 'class' && t.classKind === 'interface' && s.classKind !== 'interface') warn('inherit-interface', `${s.name} extends interface ${t.name}; use interface realization instead.`, ref);
    if (r.kind === 'inheritance' && r.source === r.target) err('self-inheritance', `${s.name} cannot inherit from itself.`, ref);
    if ((r.kind === 'include' || r.kind === 'extend') && r.source === r.target) err('self-include', `A use case cannot ${r.kind} itself.`, ref);
    if (r.kind === 'usecase:association' as never) void 0;
    if (d.type === 'usecase' && r.kind === 'association' && s.kind === t.kind) err('invalid-endpoint', 'An association in a use case diagram connects an actor and a use case.', ref);
  }
  // inheritance cycles (class diagram) and generalization cycles (use case)
  const inh = d.relationships.filter((r) => r.kind === 'inheritance' || r.kind === 'generalization');
  const parents = new Map<string, string[]>();
  for (const r of inh) parents.set(r.source, [...(parents.get(r.source) ?? []), r.target]);
  for (const start of parents.keys()) {
    const stack = [...(parents.get(start) ?? [])];
    const seen = new Set<string>();
    while (stack.length) {
      const n = stack.pop()!;
      if (n === start) {
        err('inheritance-cycle', `Inheritance cycle through "${ids.get(start)?.name ?? start}".`, { elementId: start });
        break;
      }
      if (seen.has(n)) continue;
      seen.add(n);
      stack.push(...(parents.get(n) ?? []));
    }
  }

  // ---------------------------------------------------------------- per-type notation checks
  const incoming = (id: string) => d.relationships.filter((r) => r.target === id);
  const outgoing = (id: string) => d.relationships.filter((r) => r.source === id);
  if (d.type === 'activity' || d.type === 'state') {
    const inits = d.elements.filter((e) => e.kind === 'initial');
    if (!inits.length && d.elements.length) warn('no-initial', 'The diagram has no initial node.');
    for (const e of d.elements) {
      if (e.kind === 'initial' && incoming(e.id).length) err('initial-incoming', 'An initial node cannot have incoming flows.', { elementId: e.id });
      if ((e.kind === 'final' || e.kind === 'flowFinal') && outgoing(e.id).length) err('final-outgoing', 'A final node cannot have outgoing flows.', { elementId: e.id });
      if (e.kind === 'initial' && outgoing(e.id).length !== 1) warn('initial-outgoing', 'An initial node should have exactly one outgoing flow.', { elementId: e.id });
      if (e.kind === 'decision' && outgoing(e.id).length < 2) warn('decision-branches', `Decision "${e.name || e.id}" should have at least two outgoing flows.`, { elementId: e.id });
      if (e.kind === 'decision' && d.type === 'activity' && outgoing(e.id).some((r) => r.kind === 'flow' && !r.guard)) warn('decision-guard', `Flows leaving decision "${e.name || e.id}" should have guards.`, { elementId: e.id });
      if (e.kind === 'fork' && outgoing(e.id).length < 2) warn('fork-branches', 'A fork should split into at least two flows.', { elementId: e.id });
      if (e.kind === 'join' && incoming(e.id).length < 2) warn('join-branches', 'A join should merge at least two flows.', { elementId: e.id });
      if (!['initial', 'lane'].includes(e.kind) && d.elements.length > 1 && !incoming(e.id).length && e.kind !== 'state') warn('unreachable', `"${e.name || ELEMENT_LABEL[e.kind]}" has no incoming flow.`, { elementId: e.id });
      if (e.kind === 'state' && d.elements.some((x) => x.kind === 'initial') && !incoming(e.id).length) warn('unreachable', `State "${e.name}" is never entered.`, { elementId: e.id });
    }
  }
  if (d.type === 'sequence') {
    const orders = d.relationships.filter((r) => r.kind === 'message').map((r) => (r as { order: number }).order);
    if (new Set(orders).size !== orders.length) warn('message-order', 'Two messages share the same order number; they will be drawn in id order.');
    const max = orders.length ? Math.max(...orders) : -1;
    for (const f of d.fragments) {
      for (const o of f.operands) {
        if (o.from > o.to) err('fragment-range', `Fragment "${f.kind}" has an operand that ends before it starts.`);
        if (o.from > max) warn('fragment-empty', `Fragment "${f.kind}" covers no messages.`);
      }
      if ((f.kind === 'alt' || f.kind === 'par') && f.operands.length < 2) warn('fragment-operands', `An "${f.kind}" fragment normally has at least two operands.`);
    }
  }
  if (d.type === 'usecase') {
    for (const e of d.elements) if (e.kind === 'usecase' && !d.relationships.some((r) => r.source === e.id || r.target === e.id)) warn('isolated', `Use case "${e.name}" is not connected to any actor.`, { elementId: e.id });
  }
  if (d.type === 'object') {
    for (const e of d.elements) if (e.kind === 'object' && !e.className) warn('object-class', `Object "${e.name}" has no class.`, { elementId: e.id });
  }
  for (const e of d.elements) {
    if (['lane', 'boundary'].includes(e.kind)) continue;
    if (d.type === 'class' && d.elements.length > 1 && !d.relationships.some((r) => r.source === e.id || r.target === e.id)) warn('isolated', `${e.name} has no relationships.`, { elementId: e.id });
  }
  return { valid: errors.length === 0, errors, warnings, diagram: d };
}

/** Removes relationships with missing endpoints / disallowed kinds and reports exactly what was removed. */
export function pruneInvalid(d: Diagram): { diagram: Diagram; removed: string[] } {
  const ids = new Set(d.elements.map((e) => e.id));
  const removed: string[] = [];
  const allowed = RELATIONSHIP_KINDS[d.type];
  const relationships = d.relationships.filter((r: Relationship) => {
    const ok = ids.has(r.source) && ids.has(r.target) && allowed.includes(r.kind);
    if (!ok) removed.push(`${RELATIONSHIP_LABEL[r.kind] ?? r.kind} ${r.source} → ${r.target}`);
    return ok;
  });
  const elements = d.elements.map((e) => (e.parent && !ids.has(e.parent) ? { ...e, parent: null } : e));
  return { diagram: { ...d, elements, relationships }, removed };
}
