/**
 * Structured, renderer-independent UML diagram model + Zod schemas.
 * Shared by the server (validation, generation, PDF export) and the client (editing, rendering).
 */
import { z } from 'zod';

export const DIAGRAM_TYPES = ['class', 'usecase', 'sequence', 'activity', 'state', 'component', 'deployment', 'object'] as const;
export type DiagramType = (typeof DIAGRAM_TYPES)[number];
export const DIAGRAM_LABEL: Record<DiagramType, string> = {
  class: 'Class diagram',
  usecase: 'Use case diagram',
  sequence: 'Sequence diagram',
  activity: 'Activity diagram',
  state: 'State machine diagram',
  component: 'Component diagram',
  deployment: 'Deployment diagram',
  object: 'Object diagram',
};

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/, 'ids may contain letters, digits, _ . : -');
const name = z.string().max(200);
const visibility = z.enum(['+', '-', '#', '~']);
export type Visibility = z.infer<typeof visibility>;
export const VISIBILITY_LABEL: Record<Visibility, string> = { '+': 'public', '-': 'private', '#': 'protected', '~': 'package' };

export const MemberSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.string().max(120).default(''),
  visibility: visibility.default('-'),
  isStatic: z.boolean().default(false),
  defaultValue: z.string().max(120).default(''),
});
export const MethodSchema = z.object({
  name: z.string().min(1).max(120),
  params: z.array(z.object({ name: z.string().min(1).max(80), type: z.string().max(120).default('') })).max(20).default([]),
  returnType: z.string().max(120).default(''),
  visibility: visibility.default('+'),
  isStatic: z.boolean().default(false),
  isAbstract: z.boolean().default(false),
});
export type Member = z.infer<typeof MemberSchema>;
export type Method = z.infer<typeof MethodSchema>;

const base = { id, name, parent: id.nullable().default(null), note: z.string().max(1000).default('') };

export const ElementSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('class'), classKind: z.enum(['class', 'abstract', 'interface', 'enum']).default('class'), attributes: z.array(MemberSchema).max(60).default([]), methods: z.array(MethodSchema).max(60).default([]), stereotype: z.string().max(60).default('') }),
  z.object({ ...base, kind: z.literal('actor'), role: z.enum(['primary', 'secondary']).default('primary') }),
  z.object({ ...base, kind: z.literal('usecase') }),
  z.object({ ...base, kind: z.literal('boundary') }),
  z.object({ ...base, kind: z.literal('participant'), participantType: z.enum(['participant', 'actor', 'boundary', 'control', 'entity', 'database']).default('participant') }),
  z.object({ ...base, kind: z.literal('initial') }),
  z.object({ ...base, kind: z.literal('final') }),
  z.object({ ...base, kind: z.literal('flowFinal') }),
  z.object({ ...base, kind: z.literal('action') }),
  z.object({ ...base, kind: z.literal('decision') }),
  z.object({ ...base, kind: z.literal('merge') }),
  z.object({ ...base, kind: z.literal('fork') }),
  z.object({ ...base, kind: z.literal('join') }),
  z.object({ ...base, kind: z.literal('lane') }),
  z.object({ ...base, kind: z.literal('state'), description: z.string().max(300).default(''), entry: z.string().max(120).default(''), exit: z.string().max(120).default(''), doActivity: z.string().max(120).default('') }),
  z.object({ ...base, kind: z.literal('component'), stereotype: z.string().max(60).default('') }),
  z.object({ ...base, kind: z.literal('interface') }),
  z.object({ ...base, kind: z.literal('port') }),
  z.object({ ...base, kind: z.literal('node'), nodeType: z.enum(['node', 'device', 'executionEnvironment']).default('node'), stereotype: z.string().max(60).default('') }),
  z.object({ ...base, kind: z.literal('artifact') }),
  z.object({ ...base, kind: z.literal('object'), className: z.string().max(120).default(''), slots: z.array(z.object({ name: z.string().min(1).max(80), value: z.string().max(200).default('') })).max(40).default([]) }),
]);
export type DiagramElement = z.infer<typeof ElementSchema>;
export type ElementKind = DiagramElement['kind'];
export type ElementOf<K extends ElementKind> = Extract<DiagramElement, { kind: K }>;

const rbase = { id, source: id, target: id, label: z.string().max(200).default('') };
export const RelationshipSchema = z.discriminatedUnion('kind', [
  ...(['association', 'aggregation', 'composition'] as const).map((k) =>
    z.object({ ...rbase, kind: z.literal(k), sourceMultiplicity: z.string().max(20).default(''), targetMultiplicity: z.string().max(20).default(''), sourceRole: z.string().max(60).default(''), targetRole: z.string().max(60).default(''), navigable: z.boolean().default(false) }),
  ),
  z.object({ ...rbase, kind: z.literal('inheritance') }),
  z.object({ ...rbase, kind: z.literal('realization') }),
  z.object({ ...rbase, kind: z.literal('dependency') }),
  z.object({ ...rbase, kind: z.literal('include') }),
  z.object({ ...rbase, kind: z.literal('extend') }),
  z.object({ ...rbase, kind: z.literal('generalization') }),
  z.object({ ...rbase, kind: z.literal('message'), messageKind: z.enum(['sync', 'async', 'return', 'create']).default('sync'), order: z.number().int().min(0).max(100000) }),
  z.object({ ...rbase, kind: z.literal('flow'), guard: z.string().max(120).default('') }),
  z.object({ ...rbase, kind: z.literal('transition'), event: z.string().max(120).default(''), guard: z.string().max(120).default(''), action: z.string().max(120).default('') }),
  z.object({ ...rbase, kind: z.literal('provides') }),
  z.object({ ...rbase, kind: z.literal('requires') }),
  z.object({ ...rbase, kind: z.literal('communication') }),
  z.object({ ...rbase, kind: z.literal('deploy') }),
  z.object({ ...rbase, kind: z.literal('link'), sourceRole: z.string().max(60).default(''), targetRole: z.string().max(60).default(''), sourceMultiplicity: z.string().max(20).default(''), targetMultiplicity: z.string().max(20).default('') }),
] as unknown as [z.ZodDiscriminatedUnionOption<'kind'>, ...z.ZodDiscriminatedUnionOption<'kind'>[]]);

export type AssociationLike = { id: string; source: string; target: string; label: string; kind: 'association' | 'aggregation' | 'composition'; sourceMultiplicity: string; targetMultiplicity: string; sourceRole: string; targetRole: string; navigable: boolean };
export type Relationship =
  | AssociationLike
  | { id: string; source: string; target: string; label: string; kind: 'inheritance' | 'realization' | 'dependency' | 'include' | 'extend' | 'generalization' | 'provides' | 'requires' | 'communication' | 'deploy' }
  | { id: string; source: string; target: string; label: string; kind: 'message'; messageKind: 'sync' | 'async' | 'return' | 'create'; order: number }
  | { id: string; source: string; target: string; label: string; kind: 'flow'; guard: string }
  | { id: string; source: string; target: string; label: string; kind: 'transition'; event: string; guard: string; action: string }
  | { id: string; source: string; target: string; label: string; kind: 'link'; sourceRole: string; targetRole: string; sourceMultiplicity: string; targetMultiplicity: string };
export type RelationshipKind = Relationship['kind'];

export const FragmentSchema = z.object({
  id,
  kind: z.enum(['alt', 'opt', 'loop', 'par', 'break', 'critical']),
  operands: z.array(z.object({ guard: z.string().max(120).default(''), from: z.number().int().min(0), to: z.number().int().min(0) })).min(1).max(8),
});
export type Fragment = z.infer<typeof FragmentSchema>;

export const EvidenceSchema = z.object({
  basis: z.enum(['extracted', 'inferred', 'stated', 'ai']),
  detail: z.string().max(400).default(''),
  confidence: z.enum(['high', 'medium', 'low']).default('high'),
  file: z.string().max(400).optional(),
  line: z.number().int().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** Canvas coordinates; far beyond any real layout (400 elements in one row is < 100 000 px). */
export const MAX_COORD = 1_000_000;
const coord = z.number().finite().min(-MAX_COORD).max(MAX_COORD);
const point = z.object({ x: coord, y: coord });
export const GenerationSchema = z.object({
  method: z.enum(['ai', 'rules', 'source', 'repository', 'manual', 'template']),
  label: z.string().max(200),
  model: z.string().max(120).optional(),
  prompt: z.string().max(4000).optional(),
  sourcePath: z.string().max(400).optional(),
  repoId: z.number().int().optional(),
  at: z.string().max(40).optional(),
  warnings: z.array(z.string().max(400)).max(50).default([]),
});
export type Generation = z.infer<typeof GenerationSchema>;

export const DiagramSchema = z.object({
  version: z.literal(1).default(1),
  type: z.enum(DIAGRAM_TYPES),
  title: z.string().max(200).default(''),
  elements: z.array(ElementSchema).max(400),
  relationships: z.array(RelationshipSchema).max(800).default([]),
  fragments: z.array(FragmentSchema).max(60).default([]),
  layout: z
    .object({
      positions: z.record(z.string(), point).default({}),
      manual: z.array(z.string()).default([]),
      direction: z.enum(['TB', 'LR']).default('TB'),
      routes: z.record(z.string(), z.object({ points: z.array(point).max(60), s: point, t: point })).default({}),
    })
    .default({}),
  meta: z
    .object({
      generation: GenerationSchema.default({ method: 'manual', label: 'Created manually' }),
      evidence: z.record(z.string(), EvidenceSchema).default({}),
    })
    .default({}),
});
export interface Diagram {
  version: 1;
  type: DiagramType;
  title: string;
  elements: DiagramElement[];
  relationships: Relationship[];
  fragments: Fragment[];
  layout: { positions: Record<string, { x: number; y: number }>; manual: string[]; direction: 'TB' | 'LR'; routes?: Record<string, { points: { x: number; y: number }[]; s: { x: number; y: number }; t: { x: number; y: number } }> };
  meta: { generation: Generation; evidence: Record<string, Evidence> };
}

/** Parses unknown input into a Diagram (applies defaults). Throws a ZodError on invalid structure. */
export function parseDiagram(input: unknown): Diagram {
  return DiagramSchema.parse(input) as unknown as Diagram;
}
export function safeParseDiagram(input: unknown): { ok: true; diagram: Diagram } | { ok: false; errors: string[] } {
  const r = DiagramSchema.safeParse(input);
  if (r.success) return { ok: true, diagram: r.data as unknown as Diagram };
  return { ok: false, errors: r.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || 'diagram'}: ${i.message}`) };
}

/** Element kinds that may appear in each diagram type. */
export const ELEMENT_KINDS: Record<DiagramType, ElementKind[]> = {
  class: ['class'],
  usecase: ['actor', 'usecase', 'boundary'],
  sequence: ['participant'],
  activity: ['initial', 'final', 'flowFinal', 'action', 'decision', 'merge', 'fork', 'join', 'lane'],
  state: ['initial', 'final', 'state', 'decision'],
  component: ['component', 'interface', 'port', 'node'],
  deployment: ['node', 'artifact', 'component'],
  object: ['object'],
};
/** Relationship kinds allowed per diagram type. */
export const RELATIONSHIP_KINDS: Record<DiagramType, RelationshipKind[]> = {
  class: ['association', 'aggregation', 'composition', 'inheritance', 'realization', 'dependency'],
  usecase: ['association', 'include', 'extend', 'generalization'],
  sequence: ['message'],
  activity: ['flow'],
  state: ['transition'],
  component: ['dependency', 'provides', 'requires', 'association'],
  deployment: ['communication', 'deploy', 'dependency'],
  object: ['link'],
};
export const RELATIONSHIP_LABEL: Record<RelationshipKind, string> = {
  association: 'Association',
  aggregation: 'Aggregation',
  composition: 'Composition',
  inheritance: 'Inheritance (generalization)',
  realization: 'Interface realization',
  dependency: 'Dependency',
  include: '«include»',
  extend: '«extend»',
  generalization: 'Generalization',
  message: 'Message',
  flow: 'Control flow',
  transition: 'Transition',
  provides: 'Provided interface',
  requires: 'Required interface',
  communication: 'Communication path',
  deploy: '«deploy»',
  link: 'Link',
};
export const ELEMENT_LABEL: Record<ElementKind, string> = {
  class: 'Class',
  actor: 'Actor',
  usecase: 'Use case',
  boundary: 'System boundary',
  participant: 'Participant',
  initial: 'Initial node',
  final: 'Final node',
  flowFinal: 'Flow final',
  action: 'Action',
  decision: 'Decision',
  merge: 'Merge',
  fork: 'Fork',
  join: 'Join',
  lane: 'Swimlane',
  state: 'State',
  component: 'Component',
  interface: 'Interface',
  port: 'Port',
  node: 'Node',
  artifact: 'Artifact',
  object: 'Object',
};
