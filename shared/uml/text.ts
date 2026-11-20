/**
 * Source exports. PlantUML text is produced for all 8 diagram types. Mermaid text only for the
 * types Mermaid can express in UML notation (class, sequence, state); for the others `toMermaid`
 * returns null rather than a misleading flowchart.
 */
import type { Diagram, DiagramElement, Relationship } from './model.js';
import { methodText, memberText } from './layout.js';

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;
const alias = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_');
const msgs = (d: Diagram) => (d.relationships.filter((r) => r.kind === 'message') as Extract<Relationship, { kind: 'message' }>[]).sort((a, b) => a.order - b.order);

export function toPlantUml(d: Diagram): string {
  const L: string[] = ['@startuml'];
  if (d.title) L.push(`title ${d.title}`);
  const byId = new Map(d.elements.map((e) => [e.id, e]));
  const children = (pid: string | null) => d.elements.filter((e) => e.parent === pid);
  const name = (id: string) => alias(id);
  const mult = (m?: string) => (m ? ` ${q(m)}` : '');
  const lbl = (s: string) => (s ? ` : ${s.replace(/\n/g, ' ')}` : '');
  switch (d.type) {
    case 'class': {
      for (const e of d.elements) {
        if (e.kind !== 'class') continue;
        const kw = e.classKind === 'interface' ? 'interface' : e.classKind === 'abstract' ? 'abstract class' : e.classKind === 'enum' ? 'enum' : 'class';
        L.push(`${kw} ${q(e.name)} as ${name(e.id)}${e.stereotype ? ` <<${e.stereotype}>>` : ''} {`);
        for (const a of e.attributes) L.push(`  ${a.isStatic ? '{static} ' : ''}${memberText(a)}`);
        for (const m of e.methods) L.push(`  ${m.isStatic ? '{static} ' : ''}${m.isAbstract ? '{abstract} ' : ''}${methodText(m)}`);
        L.push('}');
      }
      for (const r of d.relationships) {
        const s = name(r.source);
        const t = name(r.target);
        if (r.kind === 'inheritance') L.push(`${t} <|-- ${s}${lbl(r.label)}`);
        else if (r.kind === 'realization') L.push(`${t} <|.. ${s}${lbl(r.label)}`);
        else if (r.kind === 'dependency') L.push(`${s} ..> ${t}${lbl(r.label)}`);
        else if (r.kind === 'composition' || r.kind === 'aggregation' || r.kind === 'association') {
          const arrow = r.kind === 'composition' ? '*--' : r.kind === 'aggregation' ? 'o--' : r.navigable ? '-->' : '--';
          L.push(`${s}${mult(r.sourceMultiplicity)} ${arrow}${mult(r.targetMultiplicity)} ${t}${lbl(r.label)}`);
        }
      }
      break;
    }
    case 'usecase': {
      L.push('left to right direction');
      for (const e of d.elements) if (e.kind === 'actor') L.push(`actor ${q(e.name)} as ${name(e.id)}${e.role === 'secondary' ? ' <<secondary>>' : ''}`);
      for (const b of d.elements.filter((e) => e.kind === 'boundary')) {
        L.push(`rectangle ${q(b.name)} {`);
        for (const u of children(b.id)) L.push(`  usecase ${q(u.name)} as ${name(u.id)}`);
        L.push('}');
      }
      for (const u of d.elements.filter((e) => e.kind === 'usecase' && (!e.parent || !byId.has(e.parent)))) L.push(`usecase ${q(u.name)} as ${name(u.id)}`);
      for (const r of d.relationships) {
        if (r.kind === 'include') L.push(`${name(r.source)} ..> ${name(r.target)} : <<include>>`);
        else if (r.kind === 'extend') L.push(`${name(r.source)} ..> ${name(r.target)} : <<extend>>${r.label ? ` ${r.label}` : ''}`);
        else if (r.kind === 'generalization') L.push(`${name(r.target)} <|-- ${name(r.source)}`);
        else L.push(`${name(r.source)} -- ${name(r.target)}${lbl(r.label)}`);
      }
      break;
    }
    case 'sequence': {
      const kw: Record<string, string> = { participant: 'participant', actor: 'actor', boundary: 'boundary', control: 'control', entity: 'entity', database: 'database' };
      for (const e of d.elements) if (e.kind === 'participant') L.push(`${kw[e.participantType]} ${q(e.name)} as ${name(e.id)}`);
      const opens = new Map<number, string[]>();
      const closes = new Map<number, number>();
      const elses = new Map<number, string[]>();
      for (const f of d.fragments) {
        opens.set(f.operands[0].from, [...(opens.get(f.operands[0].from) ?? []), `${f.kind}${f.operands[0].guard ? ` ${f.operands[0].guard}` : ''}`]);
        for (const o of f.operands.slice(1)) elses.set(o.from, [...(elses.get(o.from) ?? []), `${f.kind === 'par' ? 'else' : 'else'}${o.guard ? ` ${o.guard}` : ''}`]);
        const end = f.operands[f.operands.length - 1].to;
        closes.set(end, (closes.get(end) ?? 0) + 1);
      }
      for (const m of msgs(d)) {
        for (const e of elses.get(m.order) ?? []) L.push(e);
        for (const o of opens.get(m.order) ?? []) L.push(o);
        const arrow = m.messageKind === 'return' ? '-->' : m.messageKind === 'async' ? '->>' : m.messageKind === 'create' ? '-->' : '->';
        L.push(`${name(m.source)} ${arrow} ${name(m.target)}${lbl(m.messageKind === 'create' ? `<<create>> ${m.label}` : m.label)}`);
        if (m.messageKind === 'sync' && m.source !== m.target) L.push(`activate ${name(m.target)}`);
        if (m.messageKind === 'return' && m.source !== m.target) L.push(`deactivate ${name(m.source)}`);
        for (let i = 0; i < (closes.get(m.order) ?? 0); i++) L.push('end');
      }
      break;
    }
    case 'activity': {
      // PlantUML "old" activity syntax keeps arbitrary graphs (merges, forks) without re-structuring
      const node = (e: DiagramElement) =>
        e.kind === 'initial' ? '(*)' : e.kind === 'final' || e.kind === 'flowFinal' ? '(*)' : e.kind === 'fork' || e.kind === 'join' ? `===${alias(e.id)}===` : e.kind === 'decision' || e.kind === 'merge' ? `<> ${alias(e.id)}` : `${q(e.name)} as ${alias(e.id)}`;
      for (const e of d.elements.filter((x) => x.kind === 'decision' || x.kind === 'merge')) L.push(`' ${e.kind} ${e.name || e.id}`);
      for (const r of d.relationships) {
        const s = byId.get(r.source);
        const t = byId.get(r.target);
        if (!s || !t) continue;
        L.push(`${node(s)} --> ${r.kind === 'flow' && r.guard ? `[${r.guard}] ` : ''}${node(t)}`);
      }
      if (d.elements.some((e) => e.kind === 'lane')) L.push(`' swimlanes: ${d.elements.filter((e) => e.kind === 'lane').map((l) => l.name).join(', ')}`);
      break;
    }
    case 'state': {
      const st = (id: string) => {
        const e = byId.get(id);
        return e && (e.kind === 'initial' || e.kind === 'final') ? '[*]' : name(id);
      };
      for (const e of d.elements) {
        if (e.kind === 'state') {
          L.push(`state ${q(e.name)} as ${name(e.id)}`);
          if (e.entry) L.push(`${name(e.id)} : entry / ${e.entry}`);
          if (e.doActivity) L.push(`${name(e.id)} : do / ${e.doActivity}`);
          if (e.exit) L.push(`${name(e.id)} : exit / ${e.exit}`);
        } else if (e.kind === 'decision') L.push(`state ${name(e.id)} <<choice>>`);
      }
      for (const r of d.relationships) if (r.kind === 'transition') L.push(`${st(r.source)} --> ${st(r.target)}${lbl([r.event, r.guard && `[${r.guard}]`, r.action && `/ ${r.action}`].filter(Boolean).join(' '))}`);
      break;
    }
    case 'component':
    case 'deployment': {
      const emit = (pid: string | null, ind: string) => {
        for (const e of children(pid)) {
          const kids = children(e.id);
          const kw = e.kind === 'component' ? 'component' : e.kind === 'interface' ? 'interface' : e.kind === 'artifact' ? 'artifact' : e.kind === 'port' ? 'portin' : e.kind === 'node' ? (e.nodeType === 'device' ? 'node' : 'node') : 'rectangle';
          const stereo = e.kind === 'node' ? ` <<${e.stereotype || e.nodeType}>>` : e.kind === 'component' && e.stereotype ? ` <<${e.stereotype}>>` : '';
          if (kids.length) {
            L.push(`${ind}${kw} ${q(e.name)} as ${name(e.id)}${stereo} {`);
            emit(e.id, `${ind}  `);
            L.push(`${ind}}`);
          } else L.push(`${ind}${kw} ${q(e.name)} as ${name(e.id)}${stereo}`);
        }
      };
      emit(null, '');
      for (const r of d.relationships) {
        const arrow = r.kind === 'dependency' || r.kind === 'deploy' ? '..>' : r.kind === 'provides' ? '-()' : r.kind === 'requires' ? '--(' : '--';
        if (r.kind === 'provides') L.push(`${name(r.source)} - ${name(r.target)}`);
        else if (r.kind === 'requires') L.push(`${name(r.source)} ..> ${name(r.target)} : requires`);
        else L.push(`${name(r.source)} ${arrow} ${name(r.target)}${lbl(r.kind === 'deploy' ? '<<deploy>>' : r.label)}`);
      }
      break;
    }
    case 'object': {
      for (const e of d.elements) {
        if (e.kind !== 'object') continue;
        L.push(`object ${q(`${e.name}${e.className ? ` : ${e.className}` : ''}`)} as ${name(e.id)} {`);
        for (const s of e.slots) L.push(`  ${s.name} = ${s.value}`);
        L.push('}');
      }
      for (const r of d.relationships) L.push(`${name(r.source)} -- ${name(r.target)}${lbl(r.label)}`);
      break;
    }
  }
  L.push('@enduml');
  return L.join('\n');
}

export const MERMAID_TYPES = ['class', 'sequence', 'state'] as const;

export function toMermaid(d: Diagram): string | null {
  const byId = new Map(d.elements.map((e) => [e.id, e]));
  const n = (id: string) => alias(id);
  const L: string[] = [];
  if (d.type === 'class') {
    L.push('classDiagram');
    for (const e of d.elements) {
      if (e.kind !== 'class') continue;
      L.push(`  class ${n(e.id)}["${e.name}"] {`);
      if (e.classKind === 'interface') L.push('    <<interface>>');
      else if (e.classKind === 'abstract') L.push('    <<abstract>>');
      else if (e.classKind === 'enum') L.push('    <<enumeration>>');
      for (const a of e.attributes) L.push(`    ${a.visibility}${a.type ? `${a.type} ` : ''}${a.name}${a.isStatic ? '$' : ''}`);
      for (const m of e.methods) L.push(`    ${m.visibility}${m.name}(${m.params.map((p) => (p.type ? `${p.type} ${p.name}` : p.name)).join(', ')})${m.isAbstract ? '*' : m.isStatic ? '$' : ''}${m.returnType ? ` ${m.returnType}` : ''}`);
      L.push('  }');
    }
    for (const r of d.relationships) {
      const lab = r.label ? ` : ${r.label}` : '';
      if (r.kind === 'inheritance') L.push(`  ${n(r.target)} <|-- ${n(r.source)}${lab}`);
      else if (r.kind === 'realization') L.push(`  ${n(r.target)} <|.. ${n(r.source)}${lab}`);
      else if (r.kind === 'dependency') L.push(`  ${n(r.source)} ..> ${n(r.target)}${lab}`);
      else if (r.kind === 'composition' || r.kind === 'aggregation' || r.kind === 'association') {
        const sm = r.sourceMultiplicity ? ` "${r.sourceMultiplicity}"` : '';
        const tm = r.targetMultiplicity ? ` "${r.targetMultiplicity}"` : '';
        const arrow = r.kind === 'composition' ? '*--' : r.kind === 'aggregation' ? 'o--' : r.navigable ? '-->' : '--';
        L.push(`  ${n(r.source)}${sm} ${arrow}${tm} ${n(r.target)}${lab}`);
      }
    }
    return L.join('\n');
  }
  if (d.type === 'sequence') {
    L.push('sequenceDiagram');
    for (const e of d.elements) if (e.kind === 'participant') L.push(`  ${e.participantType === 'actor' ? 'actor' : 'participant'} ${n(e.id)} as ${e.name}`);
    const opens = new Map<number, string[]>();
    const elses = new Map<number, string[]>();
    const closes = new Map<number, number>();
    for (const f of d.fragments) {
      const kw = f.kind === 'par' ? 'par' : f.kind === 'opt' ? 'opt' : f.kind === 'loop' ? 'loop' : f.kind === 'break' ? 'break' : f.kind === 'critical' ? 'critical' : 'alt';
      opens.set(f.operands[0].from, [...(opens.get(f.operands[0].from) ?? []), `${kw} ${f.operands[0].guard || ' '}`]);
      for (const o of f.operands.slice(1)) elses.set(o.from, [...(elses.get(o.from) ?? []), `${f.kind === 'par' ? 'and' : 'else'} ${o.guard || ' '}`]);
      const end = f.operands[f.operands.length - 1].to;
      closes.set(end, (closes.get(end) ?? 0) + 1);
    }
    for (const m of msgs(d)) {
      for (const e of elses.get(m.order) ?? []) L.push(`  ${e}`);
      for (const o of opens.get(m.order) ?? []) L.push(`  ${o}`);
      const arrow = m.messageKind === 'return' ? '-->>' : m.messageKind === 'async' ? '-)' : m.messageKind === 'create' ? '-->>' : '->>';
      L.push(`  ${n(m.source)}${arrow}${n(m.target)}: ${(m.messageKind === 'create' ? `«create» ${m.label}` : m.label) || ' '}`);
      for (let i = 0; i < (closes.get(m.order) ?? 0); i++) L.push('  end');
    }
    return L.join('\n');
  }
  if (d.type === 'state') {
    L.push('stateDiagram-v2');
    const st = (id: string) => {
      const e = byId.get(id);
      return e && (e.kind === 'initial' || e.kind === 'final') ? '[*]' : n(id);
    };
    for (const e of d.elements) {
      if (e.kind === 'state') L.push(`  state "${e.name}" as ${n(e.id)}`);
      if (e.kind === 'decision') L.push(`  state ${n(e.id)} <<choice>>`);
    }
    for (const r of d.relationships) if (r.kind === 'transition') {
      const lab = [r.event, r.guard && `[${r.guard}]`, r.action && `/ ${r.action}`].filter(Boolean).join(' ');
      L.push(`  ${st(r.source)} --> ${st(r.target)}${lab ? ` : ${lab}` : ''}`);
    }
    return L.join('\n');
  }
  return null;
}
