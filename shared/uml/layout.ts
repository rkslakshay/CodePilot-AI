/**
 * Element sizing, auto layout and geometry.
 *
 * Sizes are computed from an estimate of the rendered text width (deterministic: no DOM, so the
 * server and the browser compute identical layouts). Containers (system boundaries, swimlanes,
 * deployment nodes, composite components / states) are not positioned themselves: their box is
 * the bounding box of their children plus padding, so dragging a child or the container stays
 * consistent.
 */
import { layout as dagreLayout } from 'dagre-d3-es/src/dagre/index.js';
import { Graph } from 'dagre-d3-es/src/graphlib/index.js';
import type { Diagram, DiagramElement, Member, Method, Relationship } from './model.js';

export const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, Arial, sans-serif";
export const MONO = "'JetBrains Mono', Consolas, 'Courier New', monospace";
export const FS = 12.5; // base font size
const LINE = 18;

/** Approximate rendered width of a string (calibrated for Inter / Segoe UI; errs on the wide side). */
export function textWidth(s: string, size = FS, bold = false): number {
  let w = 0;
  for (const ch of s) {
    if ('iljI.,:;|!\'`'.includes(ch)) w += 0.3;
    else if ('ft()[]{}r '.includes(ch)) w += 0.38;
    else if ('mwMW@%'.includes(ch)) w += 0.88;
    else if (ch >= 'A' && ch <= 'Z') w += 0.68;
    else if (ch >= '0' && ch <= '9') w += 0.57;
    else w += 0.55;
  }
  return Math.ceil(w * size * (bold ? 1.07 : 1));
}
/** Word-wraps text to lines of at most `max` pixels. */
export function wrap(s: string, max: number, size = FS): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size) > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

export const memberText = (a: Member) => `${a.visibility} ${a.name}${a.type ? `: ${a.type}` : ''}${a.defaultValue ? ` = ${a.defaultValue}` : ''}`;
export const methodText = (m: Method) => `${m.visibility} ${m.name}(${m.params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(', ')})${m.returnType ? `: ${m.returnType}` : ''}`;
export const objectTitle = (e: { name: string; className: string }) => `${e.name}${e.className ? ` : ${e.className}` : ''}`;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const CONTAINER_KINDS = new Set(['boundary', 'lane', 'node', 'component', 'state']);

/** Natural size of a leaf element. */
export function elementSize(e: DiagramElement, d: Diagram): { w: number; h: number } {
  switch (e.kind) {
    case 'class': {
      const header = e.classKind === 'interface' || e.classKind === 'enum' || e.stereotype ? 2 : 1;
      const lines = [e.name, ...e.attributes.map(memberText), ...e.methods.map(methodText)];
      const w = Math.max(150, ...lines.map((l, i) => textWidth(l, i === 0 ? FS + 1 : FS - 0.5, i === 0) + 26), e.stereotype ? textWidth(`«${e.stereotype}»`) + 26 : 0);
      const h = 10 + header * LINE + 8 + Math.max(1, e.attributes.length) * LINE + 8 + (e.classKind === 'enum' && !e.methods.length ? 0 : Math.max(1, e.methods.length) * LINE + 8);
      return { w: Math.min(w, 520), h };
    }
    case 'actor': {
      const lines = wrap(e.name, 130);
      return { w: Math.max(70, ...lines.map((l) => textWidth(l) + 12)), h: 62 + lines.length * LINE };
    }
    case 'usecase': {
      const lines = wrap(e.name, 150);
      return { w: Math.max(130, ...lines.map((l) => textWidth(l))) + 46, h: Math.max(50, 22 + lines.length * LINE) };
    }
    case 'participant':
      return e.participantType === 'participant' ? { w: Math.max(96, textWidth(e.name, FS, true) + 28), h: 38 } : { w: Math.max(96, textWidth(e.name, FS, true) + 20), h: 72 };
    case 'initial':
      return { w: 26, h: 26 };
    case 'final':
    case 'flowFinal':
      return { w: 30, h: 30 };
    case 'decision':
    case 'merge':
      return { w: 40, h: 40 };
    case 'fork':
    case 'join':
      return d.layout.direction === 'LR' ? { w: 10, h: 96 } : { w: 110, h: 10 };
    case 'action': {
      const lines = wrap(e.name, 180);
      return { w: Math.max(110, ...lines.map((l) => textWidth(l))) + 30, h: Math.max(40, 18 + lines.length * LINE) };
    }
    case 'state': {
      const extra = [e.entry && `entry / ${e.entry}`, e.doActivity && `do / ${e.doActivity}`, e.exit && `exit / ${e.exit}`].filter(Boolean) as string[];
      const desc = e.description ? wrap(e.description, 200, FS - 1) : [];
      const lines = [...extra, ...desc];
      return { w: Math.max(120, textWidth(e.name, FS, true) + 34, ...lines.map((l) => textWidth(l, FS - 1) + 26)), h: 38 + (lines.length ? 8 + lines.length * (LINE - 2) : 0) };
    }
    case 'component':
      return { w: Math.max(150, textWidth(e.name, FS, true) + 60, e.stereotype ? textWidth(`«${e.stereotype}»`) + 60 : 0), h: e.stereotype ? 68 : 56 };
    case 'interface':
      return { w: Math.max(70, textWidth(e.name, FS - 0.5) + 12), h: 46 };
    case 'port':
      return { w: 14, h: 14 };
    case 'node':
      return { w: Math.max(150, textWidth(e.name, FS, true) + 44, e.stereotype ? textWidth(`«${e.stereotype}»`) + 44 : textWidth(`«${nodeStereo(e.nodeType)}»`) + 44), h: 74 };
    case 'artifact':
      return { w: Math.max(120, textWidth(e.name) + 56), h: 46 };
    case 'object': {
      const lines = [objectTitle(e), ...e.slots.map((s) => `${s.name} = ${s.value}`)];
      return { w: Math.max(140, ...lines.map((l, i) => textWidth(l, FS, i === 0) + 26)), h: 34 + Math.max(1, e.slots.length) * LINE + 8 };
    }
    case 'boundary':
    case 'lane':
      return { w: 200, h: 120 };
  }
}
export const nodeStereo = (t: string) => (t === 'device' ? 'device' : t === 'executionEnvironment' ? 'executionEnvironment' : 'node');

export interface Geometry {
  boxes: Record<string, Box>; // every element (containers included)
  containers: Set<string>;
  width: number;
  height: number;
  sequence?: SequenceGeometry;
}
export interface SequenceGeometry {
  lifelineTop: number;
  lifelineBottom: number;
  messages: { id: string; y: number; x1: number; x2: number; self: boolean }[];
  activations: { participant: string; x: number; y1: number; y2: number; depth: number }[];
  fragments: { id: string; x: number; y: number; w: number; h: number; dividers: { y: number; guard: string }[]; label: string; guard: string }[];
}

const MARGIN = 40;
const childrenOf = (d: Diagram) => {
  const m = new Map<string, DiagramElement[]>();
  for (const e of d.elements) if (e.parent) m.set(e.parent, [...(m.get(e.parent) ?? []), e]);
  return m;
};
const PAD: Record<string, { t: number; r: number; b: number; l: number }> = {
  boundary: { t: 40, r: 30, b: 26, l: 30 },
  lane: { t: 40, r: 24, b: 20, l: 24 },
  node: { t: 52, r: 24, b: 22, l: 24 },
  component: { t: 46, r: 22, b: 20, l: 22 },
  state: { t: 40, r: 20, b: 18, l: 20 },
};

/**
 * Auto layout. With `force` every element is re-positioned. Otherwise elements that already have a
 * position keep it (manual edits are never lost) and only new elements are placed.
 */
export function autoLayout(d: Diagram, opts: { force?: boolean } = {}): Diagram {
  if (d.type === 'sequence') return d; // sequence geometry is derived from message order
  const kids = childrenOf(d);
  const isContainer = (e: DiagramElement) => CONTAINER_KINDS.has(e.kind) && (kids.get(e.id)?.length ?? 0) > 0;
  const leaves = d.elements.filter((e) => !isContainer(e));
  const missing = leaves.filter((e) => !d.layout.positions[e.id]);
  if (!opts.force && missing.length === 0) return d;
  const fresh = opts.force || missing.length === leaves.length;
  if (!fresh) {
    // keep every existing position; place only the new elements next to the existing drawing
    const kept = { ...d.layout.positions };
    const geo = geometry({ ...d, layout: { ...d.layout, positions: kept } }, true);
    let y = MARGIN;
    for (const e of missing) {
      const s = elementSize(e, d);
      kept[e.id] = { x: Math.max(MARGIN, geo.width + 20), y };
      y += s.h + 30;
    }
    return { ...d, layout: { ...d.layout, positions: kept } };
  }
  const res = d.type === 'usecase' ? (d.elements.filter((e) => e.kind === 'boundary').length <= 1 ? useCaseGraphLayout(d) : { positions: useCaseLayout(d), routes: {} }) : d.type === 'activity' && d.elements.some((e) => e.kind === 'lane' && kids.get(e.id)?.length) ? laneLayout(d) : nestedLayout(d);
  const n = normalise(res.positions, res.routes);
  return { ...d, layout: { ...d.layout, positions: n.positions, routes: n.routes, manual: [] } };
}

type Pos = Record<string, { x: number; y: number }>;
export interface Route {
  points: { x: number; y: number }[];
  s: { x: number; y: number };
  t: { x: number; y: number };
}
type Routes = Record<string, Route>;

const graphOpts = (d: Diagram) => {
  const lr = d.layout.direction === 'LR' || d.type === 'deployment' || d.type === 'component';
  return { rankdir: lr ? 'LR' : 'TB', nodesep: d.type === 'class' ? 60 : 50, ranksep: d.type === 'class' ? 80 : d.type === 'activity' ? 50 : 72, edgesep: 24, marginx: 0, marginy: 0 };
};
const isUp = (r: Relationship) => r.kind === 'inheritance' || r.kind === 'realization' || r.kind === 'generalization';

/**
 * Lays out one containment level with dagre. Containers are laid out recursively first and then
 * treated as a single box of their computed size, so nested deployment nodes / composite components
 * never overlap regardless of padding.
 */
function nestedLayout(d: Diagram): { positions: Pos; routes: Routes } {
  const kids = childrenOf(d);
  const byId = new Map(d.elements.map((e) => [e.id, e]));
  const positions: Pos = {};
  const routes: Routes = {};
  const ancestorAt = (id: string, level: string | null): string | null => {
    let cur: string | null = id;
    for (let n = 0; cur && n < 60; n++) {
      const p: string | null = byId.get(cur)?.parent ?? null;
      if (p === level || (level === null && p !== null && !byId.has(p))) return cur;
      cur = p;
    }
    return null;
  };
  const level = (parentId: string | null): { w: number; h: number; pos: Pos; routes: Routes } => {
    const members = d.elements.filter((e) => (parentId === null ? !e.parent || !byId.has(e.parent) : e.parent === parentId));
    const sizes = new Map<string, { w: number; h: number }>();
    const inner = new Map<string, { pos: Pos; routes: Routes }>();
    for (const m of members) {
      if (CONTAINER_KINDS.has(m.kind) && kids.get(m.id)?.length) {
        const sub = level(m.id);
        const pad = PAD[m.kind] ?? { t: 30, r: 20, b: 20, l: 20 };
        sizes.set(m.id, { w: Math.max(sub.w + pad.l + pad.r, textWidth(m.name, FS, true) + 60), h: sub.h + pad.t + pad.b });
        inner.set(m.id, { pos: sub.pos, routes: sub.routes });
      } else {
        const s = elementSize(m, d);
        sizes.set(m.id, { w: s.w, h: s.h + (m.kind === 'decision' || m.kind === 'merge' ? 16 : 0) });
      }
    }
    const g = new Graph({ multigraph: true });
    g.setGraph(graphOpts(d));
    g.setDefaultEdgeLabel(() => ({}));
    for (const m of members) g.setNode(m.id, { width: sizes.get(m.id)!.w, height: sizes.get(m.id)!.h });
    const direct = new Map<string, Relationship>();
    for (const r of d.relationships) {
      const a = ancestorAt(r.source, parentId);
      const b = ancestorAt(r.target, parentId);
      if (!a || !b || a === b || !g.hasNode(a) || !g.hasNode(b)) continue;
      const [v, w] = isUp(r) ? [b, a] : [a, b];
      const label = labelOf(r);
      g.setEdge(v, w, { width: label ? Math.min(220, textWidth(label, FS - 1) + 10) : 0, height: label ? 18 : 0, labelpos: 'c' }, r.id);
      if (a === r.source && b === r.target) direct.set(r.id, r);
    }
    dagreLayout(g, {});
    const pos: Pos = {};
    const rts: Routes = {};
    let maxX = 0;
    let maxY = 0;
    for (const m of members) {
      const n = g.node(m.id) as { x: number; y: number };
      const s = sizes.get(m.id)!;
      const x = n.x - s.w / 2;
      const y = n.y - s.h / 2 + (m.kind === 'decision' || m.kind === 'merge' ? 8 : 0);
      maxX = Math.max(maxX, x + s.w);
      maxY = Math.max(maxY, y + s.h);
      const sub = inner.get(m.id);
      if (sub) {
        const pad = PAD[m.kind] ?? { t: 30, r: 20, b: 20, l: 20 };
        for (const [k, p] of Object.entries(sub.pos)) pos[k] = { x: x + pad.l + p.x, y: y + pad.t + p.y };
        for (const [k, r] of Object.entries(sub.routes)) rts[k] = shiftRoute(r, x + pad.l, y + pad.t);
      } else pos[m.id] = { x, y };
    }
    for (const e of g.edges()) {
      const r = direct.get(e.name as string);
      if (!r) continue;
      const pts = ((g.edge(e) as { points?: { x: number; y: number }[] }).points ?? []).map((p) => ({ x: p.x, y: p.y }));
      if (pts.length < 2) continue;
      rts[r.id] = { points: isUp(r) ? pts.reverse() : pts, s: { x: 0, y: 0 }, t: { x: 0, y: 0 } };
    }
    return { w: maxX, h: maxY, pos, routes: rts };
  };
  const top = level(null);
  Object.assign(positions, top.pos);
  for (const [k, r] of Object.entries(top.routes)) {
    const rel = d.relationships.find((x) => x.id === k);
    // a route is only kept when both ends are positioned leaf elements (containers are sized from their children)
    if (!rel || !positions[rel.source] || !positions[rel.target]) continue;
    routes[k] = { ...r, s: positions[rel.source], t: positions[rel.target] };
  }
  return { positions, routes };
}

/** Activity diagram with swimlanes: global top-to-bottom ranks, each lane a column. */
function laneLayout(d: Diagram): { positions: Pos; routes: Routes } {
  const lanes = d.elements.filter((e) => e.kind === 'lane');
  const nodes = d.elements.filter((e) => e.kind !== 'lane');
  const g = new Graph({ multigraph: true });
  g.setGraph(graphOpts(d));
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) {
    const s = elementSize(n, d);
    g.setNode(n.id, { width: s.w, height: s.h + (n.kind === 'decision' || n.kind === 'merge' ? 16 : 0) });
  }
  for (const r of d.relationships) if (g.hasNode(r.source) && g.hasNode(r.target) && r.source !== r.target) g.setEdge(r.source, r.target, {}, r.id);
  dagreLayout(g, {});
  const positions: Pos = {};
  let x = 0;
  const groups = [...lanes.map((l) => ({ lane: l.id as string | null, items: nodes.filter((n) => n.parent === l.id) })), { lane: null, items: nodes.filter((n) => !n.parent || !lanes.some((l) => l.id === n.parent)) }];
  for (const grp of groups) {
    if (!grp.items.length) continue;
    const xs = grp.items.map((n) => (g.node(n.id) as { x: number }).x - elementSize(n, d).w / 2);
    const minX = Math.min(...xs);
    let maxR = 0;
    for (const n of grp.items) {
      const c = g.node(n.id) as { x: number; y: number };
      const s = elementSize(n, d);
      positions[n.id] = { x: x + (c.x - s.w / 2 - minX), y: c.y - s.h / 2 + (n.kind === 'decision' || n.kind === 'merge' ? 8 : 0) };
      maxR = Math.max(maxR, positions[n.id].x + s.w);
    }
    x = maxR + PAD.lane.l + PAD.lane.r + 30;
  }
  return { positions, routes: {} }; // lanes shift columns, so dagre routes would no longer match
}

const shiftRoute = (r: Route, dx: number, dy: number): Route => ({ points: r.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), s: r.s, t: r.t });

/**
 * Use case diagram with one system boundary: dagre left-to-right with crossing minimisation and
 * routed edges. Primary actors take the first rank, base use cases the next, included / extending
 * use cases follow, and secondary actors are forced to the last rank, outside the boundary.
 */
function useCaseGraphLayout(d: Diagram): { positions: Pos; routes: Routes } {
  const g = new Graph({ multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 26, ranksep: 86, edgesep: 20, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const byId = new Map(d.elements.map((e) => [e.id, e]));
  const leaves = d.elements.filter((e) => e.kind !== 'boundary');
  for (const e of leaves) {
    const s = elementSize(e, d);
    g.setNode(e.id, { width: s.w, height: s.h + (e.kind === 'actor' && e.role === 'secondary' ? 14 : 0) });
  }
  const isSecondary = (id: string) => {
    const e = byId.get(id);
    return e?.kind === 'actor' && e.role === 'secondary';
  };
  // depth of include / extend chains decides how far right secondary actors must go
  const chain = d.relationships.filter((r) => r.kind === 'include' || r.kind === 'extend').length ? 2 : 1;
  const edgeIds: Record<string, { v: string; w: string; reversed: boolean }> = {};
  for (const r of d.relationships) {
    if (!g.hasNode(r.source) || !g.hasNode(r.target) || r.source === r.target) continue;
    let v = r.source;
    let w = r.target;
    let minlen = 1;
    const sk = byId.get(r.source)!.kind;
    const tk = byId.get(r.target)!.kind;
    if (r.kind === 'association') {
      if (tk === 'actor' && !isSecondary(r.target)) [v, w] = [r.target, r.source];
      if (sk === 'usecase' && isSecondary(r.target)) minlen = chain;
      if (sk === 'actor' && isSecondary(r.source)) {
        [v, w] = [r.target, r.source];
        minlen = chain;
      }
    } else if (r.kind === 'extend') [v, w] = [r.target, r.source]; // base use case left, extension right
    else if (r.kind === 'generalization') [v, w] = [r.target, r.source];
    const label = labelOf(r);
    g.setEdge(v, w, { minlen, width: label ? Math.min(200, textWidth(label, FS - 1) + 10) : 0, height: label ? 18 : 0, labelpos: 'c' }, r.id);
    edgeIds[r.id] = { v, w, reversed: v !== r.source };
  }
  dagreLayout(g, {});
  const positions: Pos = {};
  for (const e of leaves) {
    const n = g.node(e.id) as { x: number; y: number };
    const s = elementSize(e, d);
    positions[e.id] = { x: n.x - s.w / 2, y: n.y - s.h / 2 };
  }
  // keep actors clear of the boundary: shift them out if dagre placed them too close
  const ucs = leaves.filter((e) => e.kind === 'usecase');
  if (ucs.length) {
    const minX = Math.min(...ucs.map((u) => positions[u.id].x)) - PAD.boundary.l;
    const maxX = Math.max(...ucs.map((u) => positions[u.id].x + elementSize(u, d).w)) + PAD.boundary.r;
    for (const a of leaves.filter((e) => e.kind === 'actor')) {
      const w = elementSize(a, d).w;
      const p = positions[a.id];
      if (p.x + w > minX - 30 && p.x < maxX + 30) {
        if (isSecondary(a.id)) p.x = maxX + 50;
        else p.x = minX - 50 - w;
      }
    }
  }
  const routes: Routes = {};
  for (const e of g.edges()) {
    const id = e.name as string;
    const info = edgeIds[id];
    const rel = d.relationships.find((r) => r.id === id);
    if (!info || !rel) continue;
    const pts = ((g.edge(e) as { points?: { x: number; y: number }[] }).points ?? []).map((p) => ({ x: p.x, y: p.y }));
    if (pts.length < 2) continue;
    routes[id] = { points: info.reversed ? pts.reverse() : pts, s: positions[rel.source], t: positions[rel.target] };
  }
  // routes become stale where an actor was shifted; drop them (straight lines are drawn instead)
  for (const [id, r] of Object.entries(routes)) {
    const rel = d.relationships.find((x) => x.id === id)!;
    const n1 = g.node(rel.source) as { x: number };
    const n2 = g.node(rel.target) as { x: number };
    const s1 = elementSize(byId.get(rel.source)!, d);
    const s2 = elementSize(byId.get(rel.target)!, d);
    if (Math.abs(n1.x - s1.w / 2 - positions[rel.source].x) > 0.5 || Math.abs(n2.x - s2.w / 2 - positions[rel.target].x) > 0.5) delete routes[id];
    else routes[id] = { ...r, s: { ...positions[rel.source] }, t: { ...positions[rel.target] } };
  }
  return { positions, routes };
}

/** Fallback for several system boundaries: actors left (primary) / right (secondary), use cases stacked per boundary. */
function useCaseLayout(d: Diagram): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  const actors = d.elements.filter((e) => e.kind === 'actor');
  const ucs = d.elements.filter((e) => e.kind === 'usecase');
  const boundaries = d.elements.filter((e) => e.kind === 'boundary');
  const left = actors.filter((a) => a.kind === 'actor' && a.role === 'primary');
  const right = actors.filter((a) => a.kind === 'actor' && a.role === 'secondary');
  const connected = (u: string, a: string) => d.relationships.some((r) => (r.source === u && r.target === a) || (r.source === a && r.target === u));
  // barycentre ordering of use cases by connected actor index
  const actorIndex = new Map<string, number>();
  left.forEach((a, i) => actorIndex.set(a.id, i));
  right.forEach((a, i) => actorIndex.set(a.id, i));
  const bary = (u: DiagramElement) => {
    const idx = actors.filter((a) => connected(u.id, a.id)).map((a) => actorIndex.get(a.id)! / Math.max(1, (a.kind === 'actor' && a.role === 'primary' ? left : right).length));
    return idx.length ? idx.reduce((x, y) => x + y, 0) / idx.length : 0.5;
  };
  const ucW = Math.max(160, ...ucs.map((u) => elementSize(u, d).w));
  const actorW = Math.max(80, ...actors.map((a) => elementSize(a, d).w));
  const groups: { boundary: DiagramElement | null; items: DiagramElement[] }[] = boundaries.map((b) => ({ boundary: b, items: ucs.filter((u) => u.parent === b.id) }));
  const loose = ucs.filter((u) => !u.parent || !boundaries.some((b) => b.id === u.parent));
  if (loose.length) groups.push({ boundary: null, items: loose });
  const touchesActor = (u: DiagramElement) => actors.some((a) => connected(u.id, a.id));
  const xBoundary = MARGIN + actorW + 70;
  let y = MARGIN;
  let maxRight = xBoundary;
  for (const gr of groups) {
    const primary = [...gr.items].filter(touchesActor).sort((a, b) => bary(a) - bary(b));
    const secondary = gr.items.filter((u) => !touchesActor(u));
    // order the second column next to the use cases they are connected to
    const rowOf = (u: DiagramElement) => {
      const linked = primary.map((p, i) => (connected(p.id, u.id) ? i : -1)).filter((i) => i >= 0);
      return linked.length ? linked.reduce((a, b) => a + b, 0) / linked.length : primary.length;
    };
    secondary.sort((a, b) => rowOf(a) - rowOf(b));
    // base use cases (connected to actors) in one or two columns; included / extending use cases in rows
    // underneath, so lines to actors on either side never pass behind them
    const columns = primary.length > 7 ? [primary.slice(0, Math.ceil(primary.length / 2)), primary.slice(Math.ceil(primary.length / 2))] : [primary];
    const pad = gr.boundary ? PAD.boundary : { t: 0, r: 0, b: 0, l: 0 };
    const colH = columns.map((col) => col.reduce((acc, u) => acc + elementSize(u, d).h + 26, -26));
    const innerH = Math.max(...colH, 0);
    const perRow = 3;
    const rows: DiagramElement[][] = [];
    for (let i = 0; i < secondary.length; i += perRow) rows.push(secondary.slice(i, i + perRow));
    const rowW = rows.map((row) => row.reduce((acc, u) => acc + elementSize(u, d).w + 36, -36));
    const colsW = columns.length * (ucW + 70) - 70;
    const innerW = Math.max(colsW, ...rowW, 0);
    columns.forEach((col, ci) => {
      let cy = y + pad.t + (innerH - colH[ci]) / 2;
      for (const u of col) {
        const s = elementSize(u, d);
        out[u.id] = { x: xBoundary + pad.l + (innerW - colsW) / 2 + ci * (ucW + 70) + (ucW - s.w) / 2, y: cy };
        cy += s.h + 26;
      }
    });
    let ry = y + pad.t + innerH + (innerH ? 60 : 0);
    rows.forEach((row, ri) => {
      let rx = xBoundary + pad.l + (innerW - rowW[ri]) / 2;
      const rh = Math.max(...row.map((u) => elementSize(u, d).h));
      for (const u of row) {
        const s = elementSize(u, d);
        out[u.id] = { x: rx, y: ry + (rh - s.h) / 2 };
        rx += s.w + 36;
      }
      ry += rh + 30;
    });
    const totalInner = rows.length ? ry - 30 - (y + pad.t) : innerH;
    maxRight = Math.max(maxRight, xBoundary + pad.l + innerW + pad.r);
    y = y + pad.t + Math.max(totalInner, 60) + pad.b + 40;
  }
  if (!groups.length) y = MARGIN + 200;
  const totalH = Math.max(y - MARGIN, 200);
  const place = (list: DiagramElement[], x: number) => {
    const hs = list.map((a) => elementSize(a, d).h);
    const sum = hs.reduce((a, b) => a + b, 0) + Math.max(0, list.length - 1) * 40;
    let ay = MARGIN + Math.max(0, (totalH - sum) / 2);
    list.forEach((a, i) => {
      const s = elementSize(a, d);
      out[a.id] = { x: x + (actorW - s.w) / 2, y: ay };
      ay += hs[i] + 40;
    });
  };
  place(left, MARGIN);
  place(right, maxRight + 70);
  return out;
}

function normalise(p: Pos, routes: Routes = {}): { positions: Pos; routes: Routes } {
  const xs = Object.values(p).map((v) => v.x);
  const ys = Object.values(p).map((v) => v.y);
  const dx = xs.length ? MARGIN - Math.min(...xs) : 0;
  const dy = ys.length ? MARGIN - Math.min(...ys) : 0;
  const positions: Pos = {};
  for (const [k, v] of Object.entries(p)) positions[k] = { x: Math.round(v.x + dx), y: Math.round(v.y + dy) };
  const out: Routes = {};
  for (const [k, r] of Object.entries(routes)) out[k] = { points: r.points.map((q) => ({ x: Math.round(q.x + dx), y: Math.round(q.y + dy) })), s: { x: Math.round(r.s.x + dx), y: Math.round(r.s.y + dy) }, t: { x: Math.round(r.t.x + dx), y: Math.round(r.t.y + dy) } };
  return { positions, routes: out };
}

export const labelOf = (r: Relationship): string => {
  if (r.kind === 'transition') return [r.event, r.guard && `[${r.guard}]`, r.action && `/ ${r.action}`].filter(Boolean).join(' ') || r.label;
  if (r.kind === 'flow') return r.guard ? `[${r.guard}]` : r.label;
  if (r.kind === 'include') return '«include»';
  if (r.kind === 'extend') return r.label ? `«extend» ${r.label}` : '«extend»';
  if (r.kind === 'deploy') return '«deploy»';
  if (r.kind === 'dependency' && !r.label) return '';
  return r.label;
};

/** Absolute boxes for every element (containers sized around their children) and the canvas size. */
export function geometry(d: Diagram, partial = false): Geometry {
  if (d.type === 'sequence') return sequenceGeometry(d);
  const kids = childrenOf(d);
  const boxes: Record<string, Box> = {};
  const containers = new Set<string>();
  let fallbackY = MARGIN;
  for (const e of d.elements) {
    if (CONTAINER_KINDS.has(e.kind) && kids.get(e.id)?.length) {
      containers.add(e.id);
      continue;
    }
    const s = elementSize(e, d);
    const p = d.layout.positions[e.id];
    if (!p && partial) continue;
    boxes[e.id] = { x: p?.x ?? MARGIN, y: p?.y ?? fallbackY, w: s.w, h: s.h };
    if (!p) fallbackY += s.h + 20;
  }
  // containers: bottom-up bounding boxes
  const depth = (id: string): number => {
    let n = 0;
    let p = d.elements.find((e) => e.id === id)?.parent;
    while (p && n < 50) {
      n++;
      p = d.elements.find((e) => e.id === p)?.parent;
    }
    return n;
  };
  const order = [...containers].sort((a, b) => depth(b) - depth(a));
  for (const id of order) {
    const e = d.elements.find((x) => x.id === id)!;
    const cb = (kids.get(id) ?? []).map((c) => boxes[c.id]).filter(Boolean);
    if (!cb.length) continue;
    const pad = PAD[e.kind] ?? { t: 30, r: 20, b: 20, l: 20 };
    const x1 = Math.min(...cb.map((b) => b.x)) - pad.l;
    const y1 = Math.min(...cb.map((b) => b.y)) - pad.t;
    const x2 = Math.max(...cb.map((b) => b.x + b.w)) + pad.r;
    const y2 = Math.max(...cb.map((b) => b.y + b.h)) + pad.b;
    const minW = textWidth(e.name, FS, true) + 40;
    boxes[id] = { x: x1, y: y1, w: Math.max(x2 - x1, minW), h: y2 - y1 };
  }
  // swimlanes: equal height, side by side (lanes are drawn as columns spanning the diagram)
  const lanes = d.elements.filter((e) => e.kind === 'lane' && boxes[e.id]);
  if (lanes.length > 1) {
    const top = Math.min(...lanes.map((l) => boxes[l.id].y));
    const bottom = Math.max(...lanes.map((l) => boxes[l.id].y + boxes[l.id].h));
    for (const l of lanes) boxes[l.id] = { ...boxes[l.id], y: top, h: bottom - top };
  }
  const all = Object.values(boxes);
  const width = all.length ? Math.max(...all.map((b) => b.x + b.w)) + MARGIN : 600;
  const height = all.length ? Math.max(...all.map((b) => b.y + b.h)) + MARGIN : 400;
  // anything pushed into negative space is shifted back on screen by the renderer's viewBox
  const minX = all.length ? Math.min(0, ...all.map((b) => b.x - 10)) : 0;
  const minY = all.length ? Math.min(0, ...all.map((b) => b.y - 10)) : 0;
  if (minX < 0 || minY < 0) for (const b of all) ((b.x -= minX), (b.y -= minY));
  return { boxes, containers, width: Math.max(width - minX, 320), height: Math.max(height - minY, 240) };
}

const msgOrder = (d: Diagram) => (d.relationships.filter((r) => r.kind === 'message') as (Relationship & { kind: 'message'; order: number; messageKind: string })[]).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

function sequenceGeometry(d: Diagram): Geometry {
  const parts = d.elements.filter((e) => e.kind === 'participant');
  const msgs = msgOrder(d);
  const boxes: Record<string, Box> = {};
  const headerH = Math.max(38, ...parts.map((p) => elementSize(p, d).h));
  // horizontal spacing: wide enough for the widest message label between neighbours
  const idx = new Map(parts.map((p, i) => [p.id, i]));
  const gap: number[] = parts.map(() => 70);
  for (const m of msgs) {
    const a = idx.get(m.source);
    const b = idx.get(m.target);
    if (a === undefined || b === undefined) continue;
    const lw = textWidth(labelOf(m) || ' ', FS - 0.5) + 40;
    if (a === b) gap[a] = Math.max(gap[a], lw + 30);
    else {
      const lo = Math.min(a, b);
      const span = Math.abs(a - b);
      for (let k = lo; k < lo + span; k++) gap[k] = Math.max(gap[k], lw / span);
    }
  }
  // centre-to-centre spacing: boxes never touch and labels fit between neighbouring lifelines
  const centers = new Map<string, number>();
  let c = MARGIN + (parts[0] ? elementSize(parts[0], d).w / 2 : 0);
  let x = MARGIN;
  parts.forEach((p, i) => {
    const s = elementSize(p, d);
    boxes[p.id] = { x: c - s.w / 2, y: MARGIN, w: s.w, h: headerH };
    centers.set(p.id, c);
    x = c + s.w / 2;
    const next = parts[i + 1];
    if (next) c += Math.max(s.w / 2 + elementSize(next, d).w / 2 + 40, gap[i]);
  });
  // fragments starting / ending at a message add vertical room
  const startAt = new Map<number, number>();
  for (const f of d.fragments) for (const [i, o] of f.operands.entries()) startAt.set(o.from, (startAt.get(o.from) ?? 0) + (i === 0 ? 30 : 22));
  let y = MARGIN + headerH + 36;
  const messages: SequenceGeometry['messages'] = [];
  const yOfOrder = new Map<number, number>();
  for (const m of msgs) {
    y += startAt.get(m.order) ?? 0;
    const x1 = centers.get(m.source) ?? MARGIN;
    const x2 = centers.get(m.target) ?? MARGIN;
    const self = m.source === m.target;
    messages.push({ id: m.id, y, x1, x2, self });
    yOfOrder.set(m.order, y);
    y += self ? 54 : 42;
  }
  const lifelineBottom = y + 20;
  // activations: a synchronous call activates the receiver until its matching return
  const activations: SequenceGeometry['activations'] = [];
  const open = new Map<string, { y: number; depth: number }[]>();
  for (const [i, m] of msgs.entries()) {
    const g = messages[i];
    if (m.messageKind === 'sync' || m.messageKind === 'create') {
      const stack = open.get(m.target) ?? [];
      stack.push({ y: g.y, depth: stack.length });
      open.set(m.target, stack);
    } else if (m.messageKind === 'return') {
      const stack = open.get(m.source) ?? [];
      const top = stack.pop();
      if (top) activations.push({ participant: m.source, x: (centers.get(m.source) ?? 0) - 6 + top.depth * 6, y1: top.y, y2: g.y, depth: top.depth });
    }
  }
  for (const [pid, stack] of open) {
    for (const top of stack) {
      // no explicit return: active until the last message it sends, at least 24 px
      const last = messages.filter((g, i) => msgs[i].source === pid && g.y > top.y).map((g) => g.y).pop() ?? top.y + 24;
      activations.push({ participant: pid, x: (centers.get(pid) ?? 0) - 6 + top.depth * 6, y1: top.y, y2: Math.max(last + 8, top.y + 24), depth: top.depth });
    }
  }
  // fragments: span the participants used by their messages
  const fragments: SequenceGeometry['fragments'] = [];
  const nest = (f: (typeof d.fragments)[number]) => d.fragments.filter((o) => o !== f && o.operands[0].from <= f.operands[0].from && o.operands[o.operands.length - 1].to >= f.operands[f.operands.length - 1].to).length;
  for (const f of d.fragments) {
    const from = f.operands[0].from;
    const to = f.operands[f.operands.length - 1].to;
    const inside = msgs.filter((m) => m.order >= from && m.order <= to);
    if (!inside.length) continue;
    const xs = inside.flatMap((m) => [centers.get(m.source) ?? 0, centers.get(m.target) ?? 0]);
    const ys = inside.map((m) => messages[msgs.indexOf(m)].y);
    const n = nest(f);
    const fx = Math.min(...xs) - 50 + n * 8;
    const fw = Math.max(...xs) - Math.min(...xs) + 100 - n * 16 + (inside.some((m) => m.source === m.target) ? 60 : 0);
    const fy = Math.min(...ys) - 28 - (f.operands.length > 0 ? 6 : 0) + n * 6;
    const fh = Math.max(...ys) - fy + (inside.some((m) => m.source === m.target && messages[msgs.indexOf(m)].y === Math.max(...ys)) ? 40 : 18);
    const dividers = f.operands.slice(1).map((o) => {
      const first = msgs.find((m) => m.order >= o.from);
      return { y: (first ? messages[msgs.indexOf(first)].y : fy + fh) - 22, guard: o.guard };
    });
    fragments.push({ id: f.id, x: fx, y: fy, w: Math.max(fw, 140), h: fh, dividers, label: f.kind, guard: f.operands[0].guard });
  }
  for (const p of parts) boxes[p.id] = { ...boxes[p.id] };
  const width = Math.max(x + MARGIN, ...fragments.map((f) => f.x + f.w + MARGIN), ...messages.filter((m) => m.self).map((m) => m.x1 + 120));
  return { boxes, containers: new Set(), width: Math.max(width, 360), height: lifelineBottom + MARGIN, sequence: { lifelineTop: MARGIN + headerH, lifelineBottom, messages, activations, fragments } };
}

/** Intersection of the segment centre→(tx,ty) with the outline of an element box. */
export function clipToShape(b: Box, kind: string, tx: number, ty: number): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  if (kind === 'usecase') {
    const a = b.w / 2;
    const bb = b.h / 2;
    const t = 1 / Math.sqrt((dx * dx) / (a * a) + (dy * dy) / (bb * bb));
    return { x: cx + dx * t, y: cy + dy * t };
  }
  if (kind === 'initial' || kind === 'final' || kind === 'flowFinal' || kind === 'interface') {
    const r = kind === 'interface' ? 9 : b.w / 2;
    const ccy = kind === 'interface' ? b.y + 9 : cy;
    const ddy = ty - ccy;
    const len = Math.hypot(dx, ddy);
    return { x: cx + (dx / len) * r, y: ccy + (ddy / len) * r };
  }
  if (kind === 'decision' || kind === 'merge') {
    const t = 1 / (Math.abs(dx) / (b.w / 2) + Math.abs(dy) / (b.h / 2));
    return { x: cx + dx * t, y: cy + dy * t };
  }
  const tx1 = dx ? (b.w / 2) / Math.abs(dx) : Infinity;
  const ty1 = dy ? (b.h / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(tx1, ty1);
  return { x: cx + dx * t, y: cy + dy * t };
}
