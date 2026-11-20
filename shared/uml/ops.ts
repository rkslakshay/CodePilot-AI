/** Pure editing operations on a diagram (every operation returns a new diagram). */
import { MAX_COORD, DIAGRAM_TYPES, ELEMENT_KINDS, RELATIONSHIP_KINDS, ElementSchema, RelationshipSchema, type Diagram, type DiagramElement, type DiagramType, type ElementKind, type Relationship, type RelationshipKind } from './model.js';

let counter = 0;
/** Unique, readable id (`cls_3_lx9k`). */
export function newId(prefix = 'el', taken?: Set<string>): string {
  for (;;) {
    const id = `${prefix}_${++counter}_${Math.random().toString(36).slice(2, 6)}`;
    if (!taken || !taken.has(id)) return id;
  }
}
export const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'el';

export function emptyDiagram(type: DiagramType, title = ''): Diagram {
  if (!DIAGRAM_TYPES.includes(type)) throw new Error(`Unknown diagram type ${type}`);
  return { version: 1, type, title, elements: [], relationships: [], fragments: [], layout: { positions: {}, manual: [], direction: 'TB', routes: {} }, meta: { generation: { method: 'manual', label: 'Created manually', warnings: [] }, evidence: {} } };
}

/** A new element of `kind` with defaults (validated by the schema). */
export function makeElement(kind: ElementKind, props: Partial<DiagramElement> & { name?: string } = {}, taken?: Set<string>): DiagramElement {
  const nameDefault: Partial<Record<ElementKind, string>> = { class: 'NewClass', actor: 'Actor', usecase: 'New use case', boundary: 'System', participant: 'Participant', action: 'Action', lane: 'Lane', state: 'State', component: 'Component', interface: 'IService', port: 'port', node: 'Node', artifact: 'app.jar', object: 'obj' };
  return ElementSchema.parse({ id: props.id ?? newId(kind, taken), name: nameDefault[kind] ?? '', parent: null, ...props, kind }) as DiagramElement;
}
export function makeRelationship(kind: RelationshipKind, source: string, target: string, props: Partial<Relationship> = {}, taken?: Set<string>): Relationship {
  return RelationshipSchema.parse({ id: props.id ?? newId('rel', taken), order: 0, ...props, kind, source, target }) as Relationship;
}

const taken = (d: Diagram) => new Set([...d.elements.map((e) => e.id), ...d.relationships.map((r) => r.id), ...d.fragments.map((f) => f.id)]);

export function addElement(d: Diagram, kind: ElementKind, props: Partial<DiagramElement> = {}, at?: { x: number; y: number }): { diagram: Diagram; id: string } {
  if (!ELEMENT_KINDS[d.type].includes(kind)) throw new Error(`${kind} cannot be added to a ${d.type} diagram`);
  const el = makeElement(kind, props, taken(d));
  const positions = { ...d.layout.positions };
  if (at) positions[el.id] = at;
  return { diagram: { ...d, elements: [...d.elements, el], layout: { ...d.layout, positions, manual: at ? [...d.layout.manual, el.id] : d.layout.manual } }, id: el.id };
}

export function updateElement(d: Diagram, id: string, patch: Partial<DiagramElement>): Diagram {
  if (!d.elements.some((e) => e.id === id)) throw new Error(`Element ${id} not found`);
  const { id: _i, kind: _k, ...rest } = patch as Record<string, unknown>;
  return { ...d, elements: d.elements.map((e) => (e.id === id ? (ElementSchema.parse({ ...e, ...rest }) as DiagramElement) : e)) };
}

/**
 * Deletes an element and everything that would otherwise reference it: its relationships,
 * its children (recursively) and their relationships. Returns what was removed so the UI can say so.
 */
export function deleteElement(d: Diagram, id: string): { diagram: Diagram; removedElements: string[]; removedRelationships: string[] } {
  const remove = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of d.elements) if (e.parent && remove.has(e.parent) && !remove.has(e.id)) (remove.add(e.id), (grew = true));
  }
  const rels = d.relationships.filter((r) => remove.has(r.source) || remove.has(r.target)).map((r) => r.id);
  const positions = { ...d.layout.positions };
  for (const x of remove) delete positions[x];
  const evidence = { ...d.meta.evidence };
  for (const x of [...remove, ...rels]) delete evidence[x];
  return {
    diagram: {
      ...d,
      elements: d.elements.filter((e) => !remove.has(e.id)),
      relationships: d.relationships.filter((r) => !rels.includes(r.id)),
      layout: { ...d.layout, positions, manual: d.layout.manual.filter((m) => !remove.has(m)) },
      meta: { ...d.meta, evidence },
    },
    removedElements: [...remove],
    removedRelationships: rels,
  };
}

export function addRelationship(d: Diagram, kind: RelationshipKind, source: string, target: string, props: Partial<Relationship> = {}): { diagram: Diagram; id: string } {
  if (!RELATIONSHIP_KINDS[d.type].includes(kind)) throw new Error(`${kind} is not used in a ${d.type} diagram`);
  if (!d.elements.some((e) => e.id === source) || !d.elements.some((e) => e.id === target)) throw new Error('Both ends of a relationship must exist');
  const order = kind === 'message' ? Math.max(-1, ...d.relationships.filter((r) => r.kind === 'message').map((r) => (r as { order: number }).order)) + 1 : undefined;
  const rel = makeRelationship(kind, source, target, { ...(order !== undefined ? { order } : {}), ...props } as Partial<Relationship>, taken(d));
  return { diagram: { ...d, relationships: [...d.relationships, rel] }, id: rel.id };
}

/** Updates a relationship; changing `kind` keeps the shared fields and applies the new kind's defaults. */
export function updateRelationship(d: Diagram, id: string, patch: Partial<Relationship> & { kind?: RelationshipKind }): Diagram {
  const cur = d.relationships.find((r) => r.id === id);
  if (!cur) throw new Error(`Relationship ${id} not found`);
  if (patch.kind && !RELATIONSHIP_KINDS[d.type].includes(patch.kind)) throw new Error(`${patch.kind} is not used in a ${d.type} diagram`);
  const next = RelationshipSchema.parse({ ...cur, ...patch, id: cur.id }) as Relationship;
  if (!d.elements.some((e) => e.id === next.source) || !d.elements.some((e) => e.id === next.target)) throw new Error('Both ends of a relationship must exist');
  return { ...d, relationships: d.relationships.map((r) => (r.id === id ? next : r)) };
}
export function deleteRelationship(d: Diagram, id: string): Diagram {
  const evidence = { ...d.meta.evidence };
  delete evidence[id];
  return { ...d, relationships: d.relationships.filter((r) => r.id !== id), meta: { ...d.meta, evidence } };
}
/** Swaps the order of two sequence messages / moves a message up or down. */
export function moveMessage(d: Diagram, id: string, delta: -1 | 1): Diagram {
  const msgs = d.relationships.filter((r) => r.kind === 'message').sort((a, b) => (a as { order: number }).order - (b as { order: number }).order) as (Relationship & { order: number })[];
  const i = msgs.findIndex((m) => m.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= msgs.length) return d;
  const a = msgs[i].order;
  const b = msgs[j].order;
  return { ...d, relationships: d.relationships.map((r) => (r.id === msgs[i].id ? { ...r, order: b } : r.id === msgs[j].id ? { ...r, order: a } : r)) as Relationship[] };
}

/** Records a user-chosen position (kept by auto layout until "re-layout everything"). */
export function moveElement(d: Diagram, id: string, x: number, y: number): Diagram {
  const c = (v: number) => Math.max(-MAX_COORD, Math.min(MAX_COORD, Math.round(v)));
  return { ...d, layout: { ...d.layout, positions: { ...d.layout.positions, [id]: { x: c(x), y: c(y) } }, manual: d.layout.manual.includes(id) ? d.layout.manual : [...d.layout.manual, id] } };
}

/** Bounded undo / redo history of diagram snapshots. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(public present: T, private limit = 100) {}
  push(next: T) {
    if (next === this.present) return;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
  }
  undo(): T {
    if (this.past.length) {
      this.future.push(this.present);
      this.present = this.past.pop()!;
    }
    return this.present;
  }
  redo(): T {
    if (this.future.length) {
      this.past.push(this.present);
      this.present = this.future.pop()!;
    }
    return this.present;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  reset(present: T) {
    this.present = present;
    this.past = [];
    this.future = [];
  }
}
