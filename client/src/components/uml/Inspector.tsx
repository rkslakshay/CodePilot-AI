/** Properties inspector for the diagram, the selected element or the selected relationship. */
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowLeftRight, Plus, Trash2, X } from 'lucide-react';
import {
  ELEMENT_KINDS, RELATIONSHIP_KINDS, ELEMENT_LABEL, RELATIONSHIP_LABEL, DIAGRAM_LABEL, VISIBILITY_LABEL, CONTAINER_KINDS, updateElement, updateRelationship, deleteElement, deleteRelationship, moveMessage, makeElement,
  type Diagram, type DiagramElement, type Relationship, type Member, type Method, type Fragment, type Evidence, type Issue,
} from '@shared/uml/index';
import { Badge, Button, IconButton, Input, Select, Switch, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import type { Selection } from './Canvas';

type Change = (d: Diagram) => void;

/** Text input that commits on blur / Enter, so one edit is one undo step. */
function LazyInput({ value, onCommit, placeholder, className, multiline, ariaLabel, mono }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string; multiline?: boolean; ariaLabel: string; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => v !== value && onCommit(v);
  const cls = cn('h-8 text-[13px]', mono && 'font-mono', className);
  if (multiline) return <Textarea aria-label={ariaLabel} value={v} placeholder={placeholder} rows={2} className={cn('min-h-0 text-[13px]', className)} onChange={(e) => setV(e.target.value)} onBlur={commit} />;
  return (
    <Input
      aria-label={ariaLabel}
      value={v}
      placeholder={placeholder}
      className={cls}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setV(value);
        e.stopPropagation();
      }}
    />
  );
}
function Row({ label, children, group }: { label: string; children: ReactNode; group?: boolean }) {
  // rows holding several controls are groups, not labels (a <label> would rename the buttons inside it)
  if (group)
    return (
      <div role="group" aria-label={label} className="grid grid-cols-[88px_1fr] items-center gap-2 text-[12.5px]">
        <span className="text-muted">{label}</span>
        {children}
      </div>
    );
  return (
    <label className="grid grid-cols-[88px_1fr] items-center gap-2 text-[12.5px]">
      <span className="text-muted">{label}</span>
      {children}
    </label>
  );
}
function Group({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border px-3 py-3 first:border-t-0">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-subtle">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}
const BASIS: Record<Evidence['basis'], { label: string; tone: 'success' | 'warning' | 'info' | 'primary' }> = {
  extracted: { label: 'Extracted from code', tone: 'success' },
  inferred: { label: 'Inferred', tone: 'warning' },
  stated: { label: 'Stated in description', tone: 'info' },
  ai: { label: 'Suggested by local AI', tone: 'primary' },
};
function EvidenceBox({ ev }: { ev?: Evidence }) {
  if (!ev) return null;
  const b = BASIS[ev.basis];
  return (
    <Group title="Evidence">
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={b.tone}>{b.label}</Badge>
        <Badge tone="neutral">{ev.confidence} confidence</Badge>
      </div>
      {ev.detail && <p className="text-[12px] leading-relaxed text-muted">{ev.detail}</p>}
      {ev.file && (
        <p className="truncate font-mono text-[11.5px] text-subtle" title={ev.file}>
          {ev.file}
          {ev.line ? `:${ev.line}` : ''}
        </p>
      )}
    </Group>
  );
}
function IssuesFor({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <div className="space-y-1">
      {issues.map((i, n) => (
        <p key={n} className={cn('rounded-md px-2 py-1 text-[12px]', i.level === 'error' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')}>
          {i.message}
        </p>
      ))}
    </div>
  );
}

const paramsText = (m: Method) => m.params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ');
const parseParams = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [n, ...t] = x.split(':');
      return { name: n.trim() || 'arg', type: t.join(':').trim() };
    });

// ====================================================================== element
function ElementPanel({ d, el, onChange, onSelect, issues }: { d: Diagram; el: DiagramElement; onChange: Change; onSelect: (s: Selection | null) => void; issues: Issue[] }) {
  const set = (patch: Record<string, unknown>) => onChange(updateElement(d, el.id, patch as Partial<DiagramElement>));
  const e = el as DiagramElement & Record<string, any>;
  const containers = d.elements.filter((x) => x.id !== el.id && CONTAINER_KINDS.has(x.kind));
  const changeKind = (kind: DiagramElement['kind']) => {
    const fresh = makeElement(kind, { id: el.id, name: el.name, parent: el.parent, note: el.note });
    onChange({ ...d, elements: d.elements.map((x) => (x.id === el.id ? fresh : x)) });
  };
  const moveParticipant = (delta: -1 | 1) => {
    const parts = d.elements.filter((x) => x.kind === 'participant');
    const i = parts.findIndex((x) => x.id === el.id);
    const j = i + delta;
    if (j < 0 || j >= parts.length) return;
    [parts[i], parts[j]] = [parts[j], parts[i]];
    onChange({ ...d, elements: [...parts, ...d.elements.filter((x) => x.kind !== 'participant')] });
  };
  const members = (key: 'attributes' | 'slots') => (e[key] ?? []) as any[];
  return (
    <>
      <Group
        title={ELEMENT_LABEL[el.kind]}
        right={<IconButton icon={Trash2} label="Delete element" size="icon-sm" variant="ghost" onClick={() => (onChange(deleteElement(d, el.id).diagram), onSelect(null))} />}
      >
        <IssuesFor issues={issues} />
        <Row label="Name">
          <LazyInput ariaLabel="Element name" value={el.name} onCommit={(v) => set({ name: v })} />
        </Row>
        <Row label="Kind">
          <Select aria-label="Element kind" className="h-8 text-[13px]" value={el.kind} onChange={(x) => changeKind(x.target.value as DiagramElement['kind'])}>
            {ELEMENT_KINDS[d.type].map((k) => (
              <option key={k} value={k}>
                {ELEMENT_LABEL[k]}
              </option>
            ))}
          </Select>
        </Row>
        {d.type !== 'sequence' && (
          <Row label="Inside">
            <Select aria-label="Parent container" className="h-8 text-[13px]" value={el.parent ?? ''} onChange={(x) => set({ parent: x.target.value || null })}>
              <option value="">— top level —</option>
              {containers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id} ({ELEMENT_LABEL[c.kind]})
                </option>
              ))}
            </Select>
          </Row>
        )}
        {el.kind === 'class' && (
          <>
            <Row label="Class kind">
              <Select aria-label="Class kind" className="h-8 text-[13px]" value={e.classKind} onChange={(x) => set({ classKind: x.target.value })}>
                <option value="class">Class</option>
                <option value="abstract">Abstract class</option>
                <option value="interface">Interface</option>
                <option value="enum">Enumeration</option>
              </Select>
            </Row>
            <Row label="Stereotype">
              <LazyInput ariaLabel="Stereotype" value={e.stereotype} placeholder="e.g. entity" onCommit={(v) => set({ stereotype: v })} />
            </Row>
          </>
        )}
        {el.kind === 'actor' && (
          <Row label="Role">
            <Select aria-label="Actor role" className="h-8 text-[13px]" value={e.role} onChange={(x) => set({ role: x.target.value })}>
              <option value="primary">Primary (initiates)</option>
              <option value="secondary">Secondary (supporting)</option>
            </Select>
          </Row>
        )}
        {el.kind === 'participant' && (
          <>
            <Row label="Type">
              <Select aria-label="Participant type" className="h-8 text-[13px]" value={e.participantType} onChange={(x) => set({ participantType: x.target.value })}>
                {['participant', 'actor', 'boundary', 'control', 'entity', 'database'].map((k) => (
                  <option key={k} value={k}>
                    {k[0].toUpperCase() + k.slice(1)}
                  </option>
                ))}
              </Select>
            </Row>
            <Row label="Order" group>
              <div className="flex gap-1">
                <Button size="xs" icon={ArrowLeft} onClick={() => moveParticipant(-1)}>
                  Left
                </Button>
                <Button size="xs" icon={ArrowRight} onClick={() => moveParticipant(1)}>
                  Right
                </Button>
              </div>
            </Row>
          </>
        )}
        {el.kind === 'state' && (
          <>
            {(['entry', 'doActivity', 'exit'] as const).map((k) => (
              <Row key={k} label={k === 'doActivity' ? 'do /' : `${k} /`}>
                <LazyInput ariaLabel={`State ${k}`} value={e[k]} onCommit={(v) => set({ [k]: v })} />
              </Row>
            ))}
          </>
        )}
        {(el.kind === 'component' || el.kind === 'node') && (
          <Row label="Stereotype">
            <LazyInput ariaLabel="Stereotype" value={e.stereotype} onCommit={(v) => set({ stereotype: v })} />
          </Row>
        )}
        {el.kind === 'node' && (
          <Row label="Node type">
            <Select aria-label="Node type" className="h-8 text-[13px]" value={e.nodeType} onChange={(x) => set({ nodeType: x.target.value })}>
              <option value="node">Node</option>
              <option value="device">Device</option>
              <option value="executionEnvironment">Execution environment</option>
            </Select>
          </Row>
        )}
        {el.kind === 'object' && (
          <Row label="Class">
            <LazyInput ariaLabel="Object class" value={e.className} onCommit={(v) => set({ className: v })} />
          </Row>
        )}
        <Row label="Note">
          <LazyInput ariaLabel="Note" multiline value={el.note} onCommit={(v) => set({ note: v })} />
        </Row>
      </Group>

      {el.kind === 'class' && (
        <>
          <Group title={e.classKind === 'enum' ? 'Literals' : 'Attributes'} right={<IconButton icon={Plus} label="Add attribute" size="icon-sm" onClick={() => set({ attributes: [...members('attributes'), { name: e.classKind === 'enum' ? 'VALUE' : 'field', type: '', visibility: '-', isStatic: false, defaultValue: '' }] })} />}>
            {members('attributes').map((a: Member, i: number) => {
              const upd = (p: Partial<Member>) => set({ attributes: members('attributes').map((x: Member, j: number) => (j === i ? { ...x, ...p } : x)) });
              return (
                <div key={i} className="flex items-center gap-1" data-testid="uml-attribute">
                  <Select aria-label="Visibility" className="h-8 w-[52px] shrink-0 pl-2! pr-5! font-mono text-[13px]" value={a.visibility} onChange={(x) => upd({ visibility: x.target.value as Member['visibility'] })}>
                    {Object.entries(VISIBILITY_LABEL).map(([k, l]) => (
                      <option key={k} value={k} title={l}>
                        {k}
                      </option>
                    ))}
                  </Select>
                  <LazyInput ariaLabel="Attribute name" mono value={a.name} onCommit={(v) => v.trim() && upd({ name: v.trim() })} />
                  <LazyInput ariaLabel="Attribute type" mono placeholder="type" className="w-20" value={a.type} onCommit={(v) => upd({ type: v })} />
                  <label className="flex items-center gap-0.5 text-[11px] text-muted" title="Static (class-level) member, shown underlined">
                    <input type="checkbox" aria-label="Static" checked={a.isStatic} onChange={(x) => upd({ isStatic: x.target.checked })} />S
                  </label>
                  <IconButton icon={X} label="Remove attribute" size="icon-sm" onClick={() => set({ attributes: members('attributes').filter((_: unknown, j: number) => j !== i) })} />
                </div>
              );
            })}
          </Group>
          {e.classKind !== 'enum' && (
            <Group title="Operations" right={<IconButton icon={Plus} label="Add operation" size="icon-sm" onClick={() => set({ methods: [...e.methods, { name: 'operation', params: [], returnType: '', visibility: '+', isStatic: false, isAbstract: false }] })} />}>
              {(e.methods as Method[]).map((m, i) => {
                const upd = (p: Partial<Method>) => set({ methods: (e.methods as Method[]).map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <div key={i} className="space-y-1 rounded-lg border border-border p-1.5" data-testid="uml-method">
                    <div className="flex items-center gap-1">
                      <Select aria-label="Visibility" className="h-8 w-[52px] shrink-0 pl-2! pr-5! font-mono text-[13px]" value={m.visibility} onChange={(x) => upd({ visibility: x.target.value as Method['visibility'] })}>
                        {Object.keys(VISIBILITY_LABEL).map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </Select>
                      <LazyInput ariaLabel="Operation name" mono value={m.name} onCommit={(v) => v.trim() && upd({ name: v.trim() })} />
                      <IconButton icon={X} label="Remove operation" size="icon-sm" onClick={() => set({ methods: (e.methods as Method[]).filter((_, j) => j !== i) })} />
                    </div>
                    <div className="flex items-center gap-1">
                      <LazyInput ariaLabel="Parameters" mono placeholder="a: int, b: String" value={paramsText(m)} onCommit={(v) => upd({ params: parseParams(v) })} />
                      <LazyInput ariaLabel="Return type" mono placeholder="return" className="w-20" value={m.returnType} onCommit={(v) => upd({ returnType: v })} />
                    </div>
                    <div className="flex gap-3 text-[12px] text-muted">
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={m.isStatic} onChange={(x) => upd({ isStatic: x.target.checked })} /> static
                      </label>
                      <label className="flex items-center gap-1">
                        <input type="checkbox" checked={m.isAbstract} onChange={(x) => upd({ isAbstract: x.target.checked })} /> abstract
                      </label>
                    </div>
                  </div>
                );
              })}
            </Group>
          )}
        </>
      )}
      {el.kind === 'object' && (
        <Group title="Slots (attribute values)" right={<IconButton icon={Plus} label="Add slot" size="icon-sm" onClick={() => set({ slots: [...members('slots'), { name: 'attribute', value: '' }] })} />}>
          {members('slots').map((s: { name: string; value: string }, i: number) => {
            const upd = (p: Partial<typeof s>) => set({ slots: members('slots').map((x: typeof s, j: number) => (j === i ? { ...x, ...p } : x)) });
            return (
              <div key={i} className="flex items-center gap-1">
                <LazyInput ariaLabel="Slot name" mono value={s.name} onCommit={(v) => v.trim() && upd({ name: v.trim() })} />
                <span className="text-muted">=</span>
                <LazyInput ariaLabel="Slot value" mono value={s.value} onCommit={(v) => upd({ value: v })} />
                <IconButton icon={X} label="Remove slot" size="icon-sm" onClick={() => set({ slots: members('slots').filter((_: unknown, j: number) => j !== i) })} />
              </div>
            );
          })}
        </Group>
      )}
      <EvidenceBox ev={d.meta.evidence[el.id]} />
    </>
  );
}

// ====================================================================== relationship
function RelationshipPanel({ d, rel, onChange, onSelect, issues }: { d: Diagram; rel: Relationship; onChange: Change; onSelect: (s: Selection | null) => void; issues: Issue[] }) {
  const r = rel as Relationship & Record<string, any>;
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Record<string, unknown>) => {
    try {
      onChange(updateRelationship(d, rel.id, patch as never));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const name = (id: string) => d.elements.find((e) => e.id === id)?.name || id;
  const ends = d.elements.filter((e) => d.type !== 'sequence' || e.kind === 'participant');
  return (
    <>
      <Group
        title={RELATIONSHIP_LABEL[rel.kind]}
        right={<IconButton icon={Trash2} label="Delete relationship" size="icon-sm" onClick={() => (onChange(deleteRelationship(d, rel.id)), onSelect(null))} />}
      >
        <IssuesFor issues={issues} />
        {err && <p className="rounded-md bg-danger-soft px-2 py-1 text-[12px] text-danger">{err}</p>}
        <Row label="Kind">
          <Select aria-label="Relationship kind" className="h-8 text-[13px]" value={rel.kind} onChange={(x) => set({ kind: x.target.value })}>
            {RELATIONSHIP_KINDS[d.type].map((k) => (
              <option key={k} value={k}>
                {RELATIONSHIP_LABEL[k]}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="From">
          <Select aria-label="Source" className="h-8 text-[13px]" value={rel.source} onChange={(x) => set({ source: x.target.value })}>
            {ends.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name || e.id}
              </option>
            ))}
          </Select>
        </Row>
        <Row label="To">
          <Select aria-label="Target" className="h-8 text-[13px]" value={rel.target} onChange={(x) => set({ target: x.target.value })}>
            {ends.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name || e.id}
              </option>
            ))}
          </Select>
        </Row>
        <div className="flex justify-end">
          <Button size="xs" icon={ArrowLeftRight} onClick={() => set({ source: rel.target, target: rel.source })}>
            Reverse direction
          </Button>
        </div>
        <Row label="Label">
          <LazyInput ariaLabel="Relationship label" value={rel.label} placeholder={rel.kind === 'message' ? 'operation(args)' : ''} onCommit={(v) => set({ label: v })} />
        </Row>
        {rel.kind === 'message' && (
          <>
            <Row label="Message">
              <Select aria-label="Message kind" className="h-8 text-[13px]" value={r.messageKind} onChange={(x) => set({ messageKind: x.target.value })}>
                <option value="sync">Synchronous call</option>
                <option value="async">Asynchronous</option>
                <option value="return">Return</option>
                <option value="create">Create</option>
              </Select>
            </Row>
            <Row label="Order" group>
              <div className="flex gap-1">
                <Button size="xs" icon={ArrowUp} onClick={() => onChange(moveMessage(d, rel.id, -1))}>
                  Earlier
                </Button>
                <Button size="xs" icon={ArrowDown} onClick={() => onChange(moveMessage(d, rel.id, 1))}>
                  Later
                </Button>
              </div>
            </Row>
          </>
        )}
        {rel.kind === 'flow' && (
          <Row label="Guard">
            <LazyInput ariaLabel="Guard" placeholder="condition" value={r.guard} onCommit={(v) => set({ guard: v.replace(/^\[|\]$/g, '') })} />
          </Row>
        )}
        {rel.kind === 'transition' && (
          <>
            <Row label="Event">
              <LazyInput ariaLabel="Trigger event" value={r.event} onCommit={(v) => set({ event: v })} />
            </Row>
            <Row label="Guard">
              <LazyInput ariaLabel="Guard" value={r.guard} onCommit={(v) => set({ guard: v.replace(/^\[|\]$/g, '') })} />
            </Row>
            <Row label="Effect">
              <LazyInput ariaLabel="Effect" value={r.action} onCommit={(v) => set({ action: v })} />
            </Row>
          </>
        )}
        {(['association', 'aggregation', 'composition', 'link'] as string[]).includes(rel.kind) && (
          <>
            <Row label={`${name(rel.source)} end`} group>
              <div className="flex gap-1">
                <LazyInput ariaLabel="Source multiplicity" mono placeholder="1" value={r.sourceMultiplicity} onCommit={(v) => set({ sourceMultiplicity: v })} />
                <LazyInput ariaLabel="Source role" placeholder="role" value={r.sourceRole} onCommit={(v) => set({ sourceRole: v })} />
              </div>
            </Row>
            <Row label={`${name(rel.target)} end`} group>
              <div className="flex gap-1">
                <LazyInput ariaLabel="Target multiplicity" mono placeholder="0..*" value={r.targetMultiplicity} onCommit={(v) => set({ targetMultiplicity: v })} />
                <LazyInput ariaLabel="Target role" placeholder="role" value={r.targetRole} onCommit={(v) => set({ targetRole: v })} />
              </div>
            </Row>
            {rel.kind === 'association' && (
              <span className="flex items-center gap-2 text-[12.5px] text-muted">
                <Switch label="Navigable towards target (arrow)" checked={r.navigable} onChange={(v) => set({ navigable: v })} />
                Navigable towards target (arrow)
              </span>
            )}
          </>
        )}
      </Group>
      <EvidenceBox ev={d.meta.evidence[rel.id]} />
    </>
  );
}

// ====================================================================== diagram (nothing selected)
function FragmentsPanel({ d, onChange }: { d: Diagram; onChange: Change }) {
  const msgs = (d.relationships.filter((r) => r.kind === 'message') as { order: number; label: string }[]).sort((a, b) => a.order - b.order);
  const n = msgs.length;
  const setF = (i: number, f: Fragment | null) => onChange({ ...d, fragments: f ? d.fragments.map((x, j) => (j === i ? f : x)) : d.fragments.filter((_, j) => j !== i) });
  const label = (i: number) => `${i + 1}. ${msgs[i]?.label || 'message'}`.slice(0, 32);
  return (
    <Group
      title="Combined fragments"
      right={
        n > 0 && (
          <IconButton
            icon={Plus}
            label="Add fragment"
            size="icon-sm"
            onClick={() => onChange({ ...d, fragments: [...d.fragments, { id: `f${Date.now().toString(36)}`, kind: 'opt', operands: [{ guard: 'condition', from: 0, to: Math.min(1, n - 1) }] }] })}
          />
        )
      }
    >
      {!d.fragments.length && <p className="text-[12px] text-muted">{n ? 'Group messages into alt / opt / loop / par / break / critical fragments.' : 'Add messages first.'}</p>}
      {d.fragments.map((f, i) => (
        <div key={f.id} className="space-y-1.5 rounded-lg border border-border p-2" data-testid="uml-fragment">
          <div className="flex items-center gap-1">
            <Select aria-label="Fragment kind" className="h-8 text-[13px]" value={f.kind} onChange={(x) => setF(i, { ...f, kind: x.target.value as Fragment['kind'] })}>
              {['alt', 'opt', 'loop', 'par', 'break', 'critical'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
            <IconButton icon={Plus} label="Add operand" size="icon-sm" onClick={() => setF(i, { ...f, operands: [...f.operands, { guard: 'else', from: Math.min(n - 1, f.operands[f.operands.length - 1].to + 1), to: n - 1 }] })} />
            <IconButton icon={Trash2} label="Remove fragment" size="icon-sm" onClick={() => setF(i, null)} />
          </div>
          {f.operands.map((o, k) => {
            const upd = (p: Partial<typeof o>) => setF(i, { ...f, operands: f.operands.map((x, j) => (j === k ? { ...x, ...p } : x)) });
            return (
              <div key={k} className="space-y-1 border-l-2 border-primary/40 pl-2">
                <LazyInput ariaLabel="Operand guard" placeholder="guard" value={o.guard} onCommit={(v) => upd({ guard: v.replace(/^\[|\]$/g, '') })} />
                <div className="flex items-center gap-1 text-[12px] text-muted">
                  <Select aria-label="First message" className="h-7 text-[12px]" value={o.from} onChange={(x) => upd({ from: Number(x.target.value) })}>
                    {msgs.map((_, j) => (
                      <option key={j} value={j}>
                        {label(j)}
                      </option>
                    ))}
                  </Select>
                  →
                  <Select aria-label="Last message" className="h-7 text-[12px]" value={o.to} onChange={(x) => upd({ to: Number(x.target.value) })}>
                    {msgs.map((_, j) => (
                      <option key={j} value={j}>
                        {label(j)}
                      </option>
                    ))}
                  </Select>
                  {f.operands.length > 1 && <IconButton icon={X} label="Remove operand" size="icon-sm" onClick={() => setF(i, { ...f, operands: f.operands.filter((_, j) => j !== k) })} />}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </Group>
  );
}

function DiagramPanel({ d, onChange }: { d: Diagram; onChange: Change }) {
  const g = d.meta.generation;
  const ev = Object.values(d.meta.evidence);
  const count = (b: Evidence['basis']) => ev.filter((x) => x.basis === b).length;
  return (
    <>
      <Group title="Diagram">
        <Row label="Type">
          <span className="text-[13px] font-medium">{DIAGRAM_LABEL[d.type]}</span>
        </Row>
        <Row label="Title">
          <LazyInput ariaLabel="Diagram title" value={d.title} onCommit={(v) => onChange({ ...d, title: v })} />
        </Row>
        {d.type !== 'sequence' && (
          <Row label="Direction">
            <Select aria-label="Layout direction" className="h-8 text-[13px]" value={d.layout.direction} onChange={(x) => onChange({ ...d, layout: { ...d.layout, direction: x.target.value as 'TB' | 'LR' } })}>
              <option value="TB">Top → bottom</option>
              <option value="LR">Left → right</option>
            </Select>
          </Row>
        )}
        <p className="text-[12px] text-muted">
          {d.elements.length} elements · {d.relationships.length} relationships{d.layout.manual.length ? ` · ${d.layout.manual.length} placed manually` : ''}
        </p>
      </Group>
      {d.type === 'sequence' && <FragmentsPanel d={d} onChange={onChange} />}
      <Group title="Origin">
        <p className="text-[12.5px]" data-testid="uml-origin">
          {g.label}
          {g.model ? ` · ${g.model}` : ''}
        </p>
        {g.sourcePath && <p className="truncate font-mono text-[11.5px] text-subtle">{g.sourcePath}</p>}
        {g.prompt && <p className="line-clamp-4 rounded-md bg-elevated px-2 py-1 text-[12px] text-muted">“{g.prompt}”</p>}
        {ev.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(['extracted', 'stated', 'inferred', 'ai'] as const).map((b) => count(b) > 0 && <Badge key={b} tone={BASIS[b].tone}>{`${count(b)} ${BASIS[b].label.toLowerCase()}`}</Badge>)}
          </div>
        )}
        {g.warnings.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-warning">
            {g.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}

export function Inspector({ d, selection, onChange, onSelect, issues }: { d: Diagram; selection: Selection | null; onChange: Change; onSelect: (s: Selection | null) => void; issues: Issue[] }) {
  const el = selection?.kind === 'element' ? d.elements.find((e) => e.id === selection.id) : undefined;
  const rel = selection?.kind === 'relationship' ? d.relationships.find((r) => r.id === selection.id) : undefined;
  return (
    <div className="h-full overflow-y-auto" data-testid="uml-inspector">
      {el ? (
        <ElementPanel key={el.id} d={d} el={el} onChange={onChange} onSelect={onSelect} issues={issues.filter((i) => i.elementId === el.id)} />
      ) : rel ? (
        <RelationshipPanel key={rel.id} d={d} rel={rel} onChange={onChange} onSelect={onSelect} issues={issues.filter((i) => i.relationshipId === rel.id)} />
      ) : (
        <DiagramPanel d={d} onChange={onChange} />
      )}
    </div>
  );
}
