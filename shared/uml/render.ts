/**
 * UML notation renderer: diagram + geometry → virtual SVG tree.
 * The same tree is serialised to an SVG string (exports, PDF) and converted to React elements
 * (interactive canvas), so what you edit is exactly what you export.
 */
import type { Diagram, DiagramElement, Relationship } from './model.js';
import { geometry, clipToShape, labelOf, memberText, methodText, objectTitle, nodeStereo, wrap, textWidth, FONT, FS, type Box, type Geometry } from './layout.js';

export interface VNode {
  t: string;
  a: Record<string, string | number>;
  c?: (VNode | string)[];
}
export interface Palette {
  bg: string;
  fg: string;
  muted: string;
  line: string;
  fill: string;
  fillHeader: string;
  container: string;
  accent: string;
  accentSoft: string;
  error: string;
}
export const LIGHT: Palette = { bg: '#ffffff', fg: '#1b1f2a', muted: '#5a6270', line: '#3b4352', fill: '#fbfbfe', fillHeader: '#eeedfb', container: 'rgba(110,100,220,0.045)', accent: '#6b5cff', accentSoft: 'rgba(107,92,255,0.14)', error: '#d1243b' };
export const DARK: Palette = { bg: '#0f131b', fg: '#e8eaf2', muted: '#98a1b3', line: '#a9b1c2', fill: '#171c27', fillHeader: '#231f3d', container: 'rgba(139,124,255,0.06)', accent: '#8b7cff', accentSoft: 'rgba(139,124,255,0.18)', error: '#ff6b81' };

export interface RenderOptions {
  palette?: Palette;
  selected?: string[];
  errors?: string[]; // ids with validation errors
  idPrefix?: string;
  background?: boolean;
  title?: boolean;
}

const h = (t: string, a: Record<string, string | number | undefined>, c?: (VNode | string)[]): VNode => {
  const attrs: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(a)) if (v !== undefined) attrs[k] = v;
  return c ? { t, a: attrs, c } : { t, a: attrs };
};
const text = (x: number, y: number, s: string, a: Record<string, string | number | undefined> = {}) => h('text', { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, ...a }, [s]);

export function render(d: Diagram, opts: RenderOptions = {}): { tree: VNode; geo: Geometry; width: number; height: number } {
  const P = opts.palette ?? LIGHT;
  const pre = opts.idPrefix ?? 'u';
  const sel = new Set(opts.selected ?? []);
  const bad = new Set(opts.errors ?? []);
  const geo = geometry(d);
  const titleH = opts.title && d.title ? 34 : 0;
  const width = Math.ceil(geo.width);
  const height = Math.ceil(geo.height + titleH);
  const byId = new Map(d.elements.map((e) => [e.id, e]));
  const stroke = (id: string) => (sel.has(id) ? P.accent : bad.has(id) ? P.error : P.line);
  const sw = (id: string, base = 1.3) => (sel.has(id) ? base + 1.2 : bad.has(id) ? base + 0.6 : base);

  const defs = h('defs', {}, [
    marker(`${pre}-tri`, 'M1,1 L13,7 L1,13 Z', P.bg, P.line, 14, 14, 13, 7),
    marker(`${pre}-open`, 'M1,1 L12,7 L1,13', 'none', P.line, 14, 14, 12, 7),
    marker(`${pre}-filled`, 'M1,1 L12,7 L1,13 Z', P.line, P.line, 14, 14, 12, 7),
    marker(`${pre}-dfill`, 'M1,7 L8,2 L15,7 L8,12 Z', P.line, P.line, 16, 14, 15, 7),
    marker(`${pre}-dhollow`, 'M1,7 L8,2 L15,7 L8,12 Z', P.bg, P.line, 16, 14, 15, 7),
  ]);
  const layers: { containers: VNode[]; edges: VNode[]; nodes: VNode[]; overlay: VNode[] } = { containers: [], edges: [], nodes: [], overlay: [] };

  if (d.type === 'sequence') renderSequence(d, geo, P, pre, sel, bad, layers);
  else {
    // containers (outermost first)
    const depth = (e: DiagramElement) => {
      let n = 0;
      let p = e.parent;
      while (p && n < 50) {
        n++;
        p = byId.get(p)?.parent ?? null;
      }
      return n;
    };
    for (const e of [...d.elements].filter((x) => geo.containers.has(x.id) && geo.boxes[x.id]).sort((a, b) => depth(a) - depth(b))) layers.containers.push(renderContainer(e, geo.boxes[e.id], P, stroke(e.id), sw(e.id)));
    for (const e of d.elements) if (!geo.containers.has(e.id) && geo.boxes[e.id]) layers.nodes.push(renderElement(e, geo.boxes[e.id], d, P, stroke(e.id), sw(e.id), sel.has(e.id)));
    renderEdges(d, geo, P, pre, sel, bad, layers);
  }
  const children: VNode[] = [defs];
  if (opts.background !== false) children.push(h('rect', { x: 0, y: 0, width, height, fill: P.bg }));
  if (titleH) children.push(text(16, 22, d.title, { 'font-size': 15, 'font-weight': 700, fill: P.fg }));
  children.push(h('g', { transform: titleH ? `translate(0 ${titleH})` : undefined }, [h('g', { class: 'uml-containers' }, layers.containers), h('g', { class: 'uml-edges' }, layers.edges), h('g', { class: 'uml-nodes' }, layers.nodes), h('g', { class: 'uml-overlay' }, layers.overlay)]));
  const tree = h('svg', { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${width} ${height}`, width, height, 'font-family': FONT, 'font-size': FS, fill: P.fg, role: 'img', 'aria-label': `${d.type} diagram${d.title ? `: ${d.title}` : ''}` }, children);
  return { tree, geo, width, height };
}

function marker(id: string, path: string, fill: string, strokeC: string, w: number, hh: number, refX: number, refY: number): VNode {
  return h('marker', { id, viewBox: `0 0 ${w} ${hh}`, markerWidth: w, markerHeight: hh, refX, refY, orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse' }, [h('path', { d: path, fill, stroke: strokeC, 'stroke-width': 1.3, 'stroke-linejoin': 'round' })]);
}

// ------------------------------------------------------------------ containers
function renderContainer(e: DiagramElement, b: Box, P: Palette, s: string, w: number): VNode {
  const g: VNode[] = [];
  const a = { 'data-el': e.id, class: 'uml-el uml-container' };
  if (e.kind === 'node') {
    const k = 12;
    const fw = b.w - k;
    g.push(h('path', { d: `M${b.x},${b.y + k} L${b.x + k},${b.y} L${b.x + b.w},${b.y} L${b.x + fw},${b.y + k} Z`, fill: P.fillHeader, stroke: s, 'stroke-width': w, 'stroke-linejoin': 'round' }));
    g.push(h('path', { d: `M${b.x + fw},${b.y + k} L${b.x + b.w},${b.y} L${b.x + b.w},${b.y + b.h - k} L${b.x + fw},${b.y + b.h} Z`, fill: P.fillHeader, stroke: s, 'stroke-width': w, 'stroke-linejoin': 'round' }));
    g.push(h('rect', { x: b.x, y: b.y + k, width: fw, height: b.h - k, fill: P.container, stroke: s, 'stroke-width': w }));
    g.push(text(b.x + 12, b.y + k + 17, `«${e.stereotype || nodeStereo(e.nodeType)}»`, { 'font-size': FS - 1.5, fill: P.muted }));
    g.push(text(b.x + 12, b.y + k + 33, e.name, { 'font-weight': 700 }));
  } else if (e.kind === 'boundary') {
    g.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 4, fill: P.container, stroke: s, 'stroke-width': w }));
    g.push(text(b.x + b.w / 2, b.y + 24, e.name, { 'font-weight': 700, 'text-anchor': 'middle' }));
  } else if (e.kind === 'lane') {
    g.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: P.container, stroke: s, 'stroke-width': w }));
    g.push(h('line', { x1: b.x, y1: b.y + 30, x2: b.x + b.w, y2: b.y + 30, stroke: s, 'stroke-width': w }));
    g.push(text(b.x + b.w / 2, b.y + 20, e.name, { 'font-weight': 700, 'text-anchor': 'middle' }));
  } else if (e.kind === 'state') {
    g.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 14, fill: P.container, stroke: s, 'stroke-width': w }));
    g.push(text(b.x + 14, b.y + 22, e.name, { 'font-weight': 700 }));
    g.push(h('line', { x1: b.x, y1: b.y + 30, x2: b.x + b.w, y2: b.y + 30, stroke: s, 'stroke-width': 0.8 }));
  } else {
    g.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: P.container, stroke: s, 'stroke-width': w }));
    g.push(componentIcon(b.x + b.w - 26, b.y + 10, P));
    if (e.kind === 'component' && e.stereotype) g.push(text(b.x + 12, b.y + 18, `«${e.stereotype}»`, { 'font-size': FS - 1.5, fill: P.muted }));
    g.push(text(b.x + 12, b.y + (e.kind === 'component' && e.stereotype ? 34 : 24), e.name, { 'font-weight': 700 }));
  }
  return h('g', a, [h('title', {}, [`${e.kind}: ${e.name}`]), ...g]);
}
const componentIcon = (x: number, y: number, P: Palette): VNode =>
  h('g', {}, [h('rect', { x, y, width: 16, height: 18, fill: P.fill, stroke: P.line, 'stroke-width': 1 }), h('rect', { x: x - 4, y: y + 3, width: 8, height: 4, fill: P.fill, stroke: P.line, 'stroke-width': 1 }), h('rect', { x: x - 4, y: y + 11, width: 8, height: 4, fill: P.fill, stroke: P.line, 'stroke-width': 1 })]);

// ------------------------------------------------------------------ leaf elements
function renderElement(e: DiagramElement, b: Box, d: Diagram, P: Palette, s: string, w: number, selected: boolean): VNode {
  const c: VNode[] = [h('title', {}, [`${e.kind}: ${e.name || e.kind}`])];
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  switch (e.kind) {
    case 'class': {
      const sub = e.classKind === 'interface' ? '«interface»' : e.classKind === 'enum' ? '«enumeration»' : e.stereotype ? `«${e.stereotype}»` : e.classKind === 'abstract' ? '' : '';
      const headerH = 10 + (sub ? 2 : 1) * 18;
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: P.fill, stroke: s, 'stroke-width': w, rx: 3 }));
      c.push(h('rect', { x: b.x + 0.5, y: b.y + 0.5, width: b.w - 1, height: headerH, fill: P.fillHeader, rx: 3 }));
      let y = b.y + 22;
      if (sub) {
        c.push(text(cx, y, sub, { 'text-anchor': 'middle', 'font-size': FS - 1.5, fill: P.muted }));
        y += 18;
      }
      c.push(text(cx, y, e.name, { 'text-anchor': 'middle', 'font-weight': 700, 'font-size': FS + 1, 'font-style': e.classKind === 'abstract' ? 'italic' : undefined }));
      let ly = b.y + headerH + 4;
      c.push(h('line', { x1: b.x, y1: b.y + headerH, x2: b.x + b.w, y2: b.y + headerH, stroke: s, 'stroke-width': w }));
      for (const a of e.attributes) {
        ly += 18;
        c.push(text(b.x + 10, ly - 4, memberText(a), { 'text-decoration': a.isStatic ? 'underline' : undefined, 'font-size': FS - 0.5 }));
      }
      if (!e.attributes.length) ly += 18;
      ly += 8;
      if (!(e.classKind === 'enum' && !e.methods.length)) {
        c.push(h('line', { x1: b.x, y1: ly - 4, x2: b.x + b.w, y2: ly - 4, stroke: s, 'stroke-width': w }));
        for (const m of e.methods) {
          ly += 18;
          c.push(text(b.x + 10, ly - 4, methodText(m), { 'text-decoration': m.isStatic ? 'underline' : undefined, 'font-style': m.isAbstract ? 'italic' : undefined, 'font-size': FS - 0.5 }));
        }
      }
      break;
    }
    case 'actor': {
      const ax = cx;
      const top = b.y + 4;
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }));
      c.push(h('circle', { cx: ax, cy: top + 9, r: 9, fill: P.fill, stroke: s, 'stroke-width': w + 0.2 }));
      c.push(h('path', { d: `M${ax},${top + 18} L${ax},${top + 38} M${ax - 16},${top + 25} L${ax + 16},${top + 25} M${ax},${top + 38} L${ax - 13},${top + 55} M${ax},${top + 38} L${ax + 13},${top + 55}`, stroke: s, 'stroke-width': w + 0.2, fill: 'none', 'stroke-linecap': 'round' }));
      wrap(e.name, 130).forEach((l, i) => c.push(text(ax, top + 72 + i * 18, l, { 'text-anchor': 'middle', 'font-weight': 600 })));
      if (e.role === 'secondary') c.push(text(ax, b.y + b.h + 12, '(secondary)', { 'text-anchor': 'middle', 'font-size': FS - 2.5, fill: P.muted }));
      break;
    }
    case 'usecase': {
      c.push(h('ellipse', { cx, cy, rx: b.w / 2, ry: b.h / 2, fill: P.fill, stroke: s, 'stroke-width': w }));
      const lines = wrap(e.name, 150);
      lines.forEach((l, i) => c.push(text(cx, cy + 4 + (i - (lines.length - 1) / 2) * 18, l, { 'text-anchor': 'middle' })));
      break;
    }
    case 'initial':
      c.push(h('circle', { cx, cy, r: b.w / 2, fill: s === P.line ? P.fg : s }));
      break;
    case 'final':
      c.push(h('circle', { cx, cy, r: b.w / 2, fill: P.bg, stroke: s, 'stroke-width': w + 0.4 }), h('circle', { cx, cy, r: b.w / 2 - 6, fill: s === P.line ? P.fg : s }));
      break;
    case 'flowFinal':
      c.push(h('circle', { cx, cy, r: b.w / 2, fill: P.bg, stroke: s, 'stroke-width': w + 0.4 }), h('path', { d: `M${cx - 8},${cy - 8} L${cx + 8},${cy + 8} M${cx + 8},${cy - 8} L${cx - 8},${cy + 8}`, stroke: s, 'stroke-width': w + 0.4 }));
      break;
    case 'decision':
    case 'merge':
      c.push(h('path', { d: `M${cx},${b.y} L${b.x + b.w},${cy} L${cx},${b.y + b.h} L${b.x},${cy} Z`, fill: P.fill, stroke: s, 'stroke-width': w }));
      if (e.name) c.push(text(b.x + b.w + 6, b.y + 2, e.name, { 'font-size': FS - 1, fill: P.muted }));
      break;
    case 'fork':
    case 'join':
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 2, fill: s === P.line ? P.fg : s }));
      break;
    case 'action': {
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 14, fill: P.fill, stroke: s, 'stroke-width': w }));
      const lines = wrap(e.name, 180);
      lines.forEach((l, i) => c.push(text(cx, cy + 4 + (i - (lines.length - 1) / 2) * 18, l, { 'text-anchor': 'middle' })));
      break;
    }
    case 'state': {
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 12, fill: P.fill, stroke: s, 'stroke-width': w }));
      c.push(text(cx, b.y + 24, e.name, { 'text-anchor': 'middle', 'font-weight': 700 }));
      const lines = [e.entry && `entry / ${e.entry}`, e.doActivity && `do / ${e.doActivity}`, e.exit && `exit / ${e.exit}`].filter(Boolean) as string[];
      const desc = e.description ? wrap(e.description, 200, FS - 1) : [];
      if (lines.length || desc.length) {
        c.push(h('line', { x1: b.x, y1: b.y + 34, x2: b.x + b.w, y2: b.y + 34, stroke: s, 'stroke-width': 0.9 }));
        [...lines, ...desc].forEach((l, i) => c.push(text(b.x + 12, b.y + 52 + i * 16, l, { 'font-size': FS - 1, fill: i < lines.length ? P.fg : P.muted })));
      }
      break;
    }
    case 'component': {
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: P.fill, stroke: s, 'stroke-width': w, rx: 2 }));
      c.push(componentIcon(b.x + b.w - 26, b.y + 10, P));
      if (e.stereotype) c.push(text(b.x + (b.w - 30) / 2, b.y + 24, `«${e.stereotype}»`, { 'text-anchor': 'middle', 'font-size': FS - 1.5, fill: P.muted }));
      c.push(text(b.x + (b.w - 30) / 2, b.y + (e.stereotype ? 44 : 33), e.name, { 'text-anchor': 'middle', 'font-weight': 700 }));
      break;
    }
    case 'interface':
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }));
      c.push(h('circle', { cx, cy: b.y + 9, r: 9, fill: P.fill, stroke: s, 'stroke-width': w + 0.3 }));
      c.push(text(cx, b.y + 38, e.name, { 'text-anchor': 'middle', 'font-size': FS - 0.5 }));
      break;
    case 'port':
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: P.fill, stroke: s, 'stroke-width': w }));
      if (e.name) c.push(text(b.x + b.w + 4, b.y - 2, e.name, { 'font-size': FS - 2, fill: P.muted }));
      break;
    case 'node': {
      const k = 12;
      c.push(h('path', { d: `M${b.x},${b.y + k} L${b.x + k},${b.y} L${b.x + b.w + k - 12},${b.y} L${b.x + b.w},${b.y + k} Z`, fill: P.fillHeader, stroke: s, 'stroke-width': w }));
      c.push(h('rect', { x: b.x, y: b.y + k, width: b.w - 12, height: b.h - k, fill: P.fill, stroke: s, 'stroke-width': w }));
      c.push(h('path', { d: `M${b.x + b.w - 12},${b.y + k} L${b.x + b.w},${b.y} L${b.x + b.w},${b.y + b.h - k} L${b.x + b.w - 12},${b.y + b.h}`, fill: P.fillHeader, stroke: s, 'stroke-width': w }));
      c.push(text(b.x + (b.w - 12) / 2, b.y + k + 22, `«${e.stereotype || nodeStereo(e.nodeType)}»`, { 'text-anchor': 'middle', 'font-size': FS - 1.5, fill: P.muted }));
      c.push(text(b.x + (b.w - 12) / 2, b.y + k + 42, e.name, { 'text-anchor': 'middle', 'font-weight': 700 }));
      break;
    }
    case 'artifact': {
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: P.fill, stroke: s, 'stroke-width': w }));
      const ix = b.x + b.w - 24;
      const iy = b.y + 8;
      c.push(h('path', { d: `M${ix},${iy} L${ix + 9},${iy} L${ix + 14},${iy + 5} L${ix + 14},${iy + 17} L${ix},${iy + 17} Z M${ix + 9},${iy} L${ix + 9},${iy + 5} L${ix + 14},${iy + 5}`, fill: 'none', stroke: P.line, 'stroke-width': 1 }));
      c.push(text(b.x + (b.w - 24) / 2, b.y + 18, '«artifact»', { 'text-anchor': 'middle', 'font-size': FS - 2, fill: P.muted }));
      c.push(text(b.x + (b.w - 24) / 2, b.y + 35, e.name, { 'text-anchor': 'middle' }));
      break;
    }
    case 'object': {
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: P.fill, stroke: s, 'stroke-width': w, rx: 2 }));
      c.push(h('rect', { x: b.x + 0.5, y: b.y + 0.5, width: b.w - 1, height: 29, fill: P.fillHeader }));
      c.push(text(cx, b.y + 20, objectTitle(e), { 'text-anchor': 'middle', 'font-weight': 700, 'text-decoration': 'underline' }));
      c.push(h('line', { x1: b.x, y1: b.y + 30, x2: b.x + b.w, y2: b.y + 30, stroke: s, 'stroke-width': w }));
      e.slots.forEach((sl, i) => c.push(text(b.x + 10, b.y + 48 + i * 18, `${sl.name} = ${sl.value}`, { 'font-size': FS - 0.5 })));
      break;
    }
    case 'boundary':
    case 'lane':
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: P.container, stroke: s, 'stroke-width': w, rx: 4 }));
      c.push(text(cx, b.y + 22, e.name, { 'text-anchor': 'middle', 'font-weight': 700 }));
      break;
    case 'participant':
      break;
  }
  if (selected) c.push(h('rect', { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, fill: 'none', stroke: P.accent, 'stroke-width': 1, 'stroke-dasharray': '4 3', rx: 4, class: 'uml-selection' }));
  return h('g', { 'data-el': e.id, class: 'uml-el', 'data-kind': e.kind }, c);
}

// ------------------------------------------------------------------ edges
function edgeStyle(r: Relationship, pre: string): { dash?: string; start?: string; end?: string } {
  switch (r.kind) {
    case 'inheritance':
    case 'generalization':
      return { end: `url(#${pre}-tri)` };
    case 'realization':
      return { dash: '7 5', end: `url(#${pre}-tri)` };
    case 'composition':
      return { start: `url(#${pre}-dfill)`, end: r.navigable ? `url(#${pre}-open)` : undefined };
    case 'aggregation':
      return { start: `url(#${pre}-dhollow)`, end: r.navigable ? `url(#${pre}-open)` : undefined };
    case 'association':
      return { end: r.navigable ? `url(#${pre}-open)` : undefined };
    case 'dependency':
    case 'include':
    case 'extend':
    case 'deploy':
      return { dash: '7 5', end: `url(#${pre}-open)` };
    case 'flow':
    case 'transition':
      return { end: `url(#${pre}-open)` };
    case 'message':
      return r.messageKind === 'return' || r.messageKind === 'create' ? { dash: '7 5', end: `url(#${pre}-open)` } : r.messageKind === 'async' ? { end: `url(#${pre}-open)` } : { end: `url(#${pre}-filled)` };
    default:
      return {};
  }
}

function renderEdges(d: Diagram, geo: Geometry, P: Palette, pre: string, sel: Set<string>, bad: Set<string>, layers: { edges: VNode[] }) {
  const byId = new Map(d.elements.map((e) => [e.id, e]));
  const pairCount = new Map<string, number>();
  const pairIndex = new Map<string, number>();
  for (const r of d.relationships) {
    const k = [r.source, r.target].sort().join('|');
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }
  for (const r of d.relationships) {
    const sb = geo.boxes[r.source];
    const tb = geo.boxes[r.target];
    const se = byId.get(r.source);
    const te = byId.get(r.target);
    if (!sb || !tb || !se || !te) continue;
    const s = sel.has(r.id) ? P.accent : bad.has(r.id) ? P.error : P.line;
    const width = sel.has(r.id) ? 2.4 : 1.3;
    const st = edgeStyle(r, pre);
    const lbl = labelOf(r);
    const c: VNode[] = [h('title', {}, [`${r.kind}${lbl ? `: ${lbl}` : ''}`])];
    let pathD: string;
    let mid: { x: number; y: number };
    let p1: { x: number; y: number };
    let p2: { x: number; y: number };
    if (r.source === r.target) {
      // self loop on the right side
      const x = sb.x + sb.w;
      const y = sb.y + sb.h / 2;
      p1 = { x, y: y - 10 };
      p2 = { x, y: y + 10 };
      pathD = `M${x},${y - 10} C${x + 46},${y - 34} ${x + 46},${y + 34} ${x},${y + 10}`;
      mid = { x: x + 40, y };
    } else if (routeFor(d, r)) {
      // dagre route from the last auto layout (only while both ends are still where layout put them)
      const pts = routeFor(d, r)!.points;
      const inner = pts.length > 2 ? pts.slice(1, -1) : pts;
      p1 = clipToShape(sb, se.kind, inner[0].x, inner[0].y);
      p2 = clipToShape(tb, te.kind, inner[inner.length - 1].x, inner[inner.length - 1].y);
      const all = [p1, ...(pts.length > 2 ? inner : []), p2];
      let dd = `M${p1.x},${p1.y}`;
      for (let i = 1; i < all.length - 1; i++) {
        const m = { x: (all[i].x + all[i + 1].x) / 2, y: (all[i].y + all[i + 1].y) / 2 };
        dd += ` Q${all[i].x},${all[i].y} ${i === all.length - 2 ? `${p2.x},${p2.y}` : `${m.x},${m.y}`}`;
      }
      if (all.length === 2) dd += ` L${p2.x},${p2.y}`;
      pathD = dd;
      mid = pts[Math.floor(pts.length / 2)];
      if (r.kind === 'requires') {
        const prev = all[all.length - 2];
        const dx = p2.x - prev.x;
        const dy = p2.y - prev.y;
        const l = Math.hypot(dx, dy) || 1;
        const ang = Math.atan2(dy, dx);
        const r0 = 14;
        const ox = p2.x - (dx / l) * 6;
        const oy = p2.y - (dy / l) * 6;
        c.push(h('path', { d: `M${ox + r0 * Math.cos(ang - Math.PI / 2)},${oy + r0 * Math.sin(ang - Math.PI / 2)} A${r0},${r0} 0 0 0 ${ox + r0 * Math.cos(ang + Math.PI / 2)},${oy + r0 * Math.sin(ang + Math.PI / 2)}`, fill: 'none', stroke: s, 'stroke-width': width }));
      }
    } else {
      const k = [r.source, r.target].sort().join('|');
      const n = pairCount.get(k) ?? 1;
      const i = pairIndex.get(k) ?? 0;
      pairIndex.set(k, i + 1);
      const scx = sb.x + sb.w / 2;
      const scy = sb.y + sb.h / 2;
      const tcx = tb.x + tb.w / 2;
      const tcy = tb.y + tb.h / 2;
      const offset = n > 1 ? (i - (n - 1) / 2) * 26 * (r.source < r.target ? 1 : -1) : 0;
      const len = Math.hypot(tcx - scx, tcy - scy) || 1;
      const nx = -(tcy - scy) / len;
      const ny = (tcx - scx) / len;
      const ctrl = { x: (scx + tcx) / 2 + nx * offset * 1.6, y: (scy + tcy) / 2 + ny * offset * 1.6 };
      p1 = clipToShape(sb, se.kind, offset ? ctrl.x : tcx, offset ? ctrl.y : tcy);
      p2 = clipToShape(tb, te.kind, offset ? ctrl.x : scx, offset ? ctrl.y : scy);
      if (r.kind === 'requires') {
        // socket: stop short of the lollipop and draw a half circle facing it
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const l = Math.hypot(dx, dy) || 1;
        p2 = { x: p2.x - (dx / l) * 6, y: p2.y - (dy / l) * 6 };
        const ang = Math.atan2(dy, dx);
        const r0 = 14;
        const ox = p2.x + Math.cos(ang) * r0 * 0.15;
        const oy = p2.y + Math.sin(ang) * r0 * 0.15;
        c.push(h('path', { d: `M${ox + r0 * Math.cos(ang - Math.PI / 2)},${oy + r0 * Math.sin(ang - Math.PI / 2)} A${r0},${r0} 0 0 0 ${ox + r0 * Math.cos(ang + Math.PI / 2)},${oy + r0 * Math.sin(ang + Math.PI / 2)}`, fill: 'none', stroke: s, 'stroke-width': width }));
      }
      pathD = offset ? `M${p1.x},${p1.y} Q${ctrl.x},${ctrl.y} ${p2.x},${p2.y}` : `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
      mid = offset ? { x: (p1.x + 2 * ctrl.x + p2.x) / 4, y: (p1.y + 2 * ctrl.y + p2.y) / 4 } : { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    }
    c.push(h('path', { d: pathD, fill: 'none', stroke: 'transparent', 'stroke-width': 14, class: 'uml-hit' }));
    c.push(h('path', { d: pathD, fill: 'none', stroke: s, 'stroke-width': width, 'stroke-dasharray': st.dash, 'marker-start': st.start, 'marker-end': st.end, 'stroke-linejoin': 'round' }));
    if (lbl) c.push(...labelBox(mid.x, mid.y, lbl, P, r.kind === 'include' || r.kind === 'extend' || r.kind === 'deploy'));
    if ('sourceMultiplicity' in r || 'sourceRole' in r) {
      const rr = r as { sourceMultiplicity?: string; targetMultiplicity?: string; sourceRole?: string; targetRole?: string };
      endText(p1, p2, [rr.sourceRole, rr.sourceMultiplicity].filter(Boolean).join('  '), P, c);
      endText(p2, p1, [rr.targetRole, rr.targetMultiplicity].filter(Boolean).join('  '), P, c);
    }
    layers.edges.push(h('g', { 'data-rel': r.id, class: 'uml-rel', 'data-kind': r.kind }, c));
  }
}
function routeFor(d: Diagram, r: Relationship) {
  const route = d.layout.routes?.[r.id];
  if (!route || route.points.length < 2) return null;
  const a = d.layout.positions[r.source];
  const b = d.layout.positions[r.target];
  if (!a || !b || a.x !== route.s.x || a.y !== route.s.y || b.x !== route.t.x || b.y !== route.t.y) return null;
  return route;
}
function labelBox(x: number, y: number, s: string, P: Palette, muted = false): VNode[] {
  const lines = wrap(s, 200, FS - 1);
  const w = Math.max(...lines.map((l) => textWidth(l, FS - 1))) + 10;
  const hh = lines.length * 15 + 5;
  return [h('rect', { x: x - w / 2, y: y - hh / 2, width: w, height: hh, rx: 3, fill: P.bg, opacity: 0.92 }), ...lines.map((l, i) => text(x, y - hh / 2 + 14 + i * 15, l, { 'text-anchor': 'middle', 'font-size': FS - 1, fill: muted ? P.muted : P.fg }))];
}
function endText(at: { x: number; y: number }, from: { x: number; y: number }, s: string | undefined, P: Palette, out: VNode[]) {
  if (!s) return;
  const dx = from.x - at.x;
  const dy = from.y - at.y;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const x = at.x + ux * 20 - uy * 12;
  const y = at.y + uy * 20 + ux * 12;
  out.push(text(x, y + 4, s, { 'text-anchor': 'middle', 'font-size': FS - 1.5, fill: P.muted }));
}

// ------------------------------------------------------------------ sequence
function renderSequence(d: Diagram, geo: Geometry, P: Palette, pre: string, sel: Set<string>, bad: Set<string>, layers: { containers: VNode[]; edges: VNode[]; nodes: VNode[]; overlay: VNode[] }) {
  const sq = geo.sequence!;
  const byId = new Map(d.elements.map((e) => [e.id, e]));
  for (const f of sq.fragments) {
    const fr = d.fragments.find((x) => x.id === f.id)!;
    const tagW = textWidth(f.label, FS - 0.5, true) + 18;
    const s = sel.has(f.id) ? P.accent : P.muted;
    const c: VNode[] = [
      h('rect', { x: f.x, y: f.y, width: f.w, height: f.h, fill: P.container, stroke: s, 'stroke-width': sel.has(f.id) ? 2 : 1.1 }),
      h('path', { d: `M${f.x},${f.y} L${f.x + tagW},${f.y} L${f.x + tagW},${f.y + 12} L${f.x + tagW - 8},${f.y + 20} L${f.x},${f.y + 20} Z`, fill: P.fillHeader, stroke: s, 'stroke-width': 1.1 }),
      text(f.x + 7, f.y + 14, f.label, { 'font-weight': 700, 'font-size': FS - 0.5 }),
    ];
    const guards: VNode[] = [];
    const guardAt = (gx: number, gy: number, g0: string) => {
      const gw = textWidth(`[${g0}]`, FS - 1) + 8;
      guards.push(h('rect', { x: gx - 4, y: gy - 11, width: gw, height: 15, rx: 2, fill: P.bg, opacity: 0.95 }), text(gx, gy, `[${g0}]`, { 'font-size': FS - 1, fill: P.muted }));
    };
    if (f.guard) guardAt(f.x + tagW + 8, f.y + 14, f.guard);
    for (const dv of f.dividers) {
      c.push(h('line', { x1: f.x, y1: dv.y, x2: f.x + f.w, y2: dv.y, stroke: s, 'stroke-width': 1, 'stroke-dasharray': '6 4' }));
      if (dv.guard) guardAt(f.x + 8, dv.y + 14, dv.guard);
    }
    layers.containers.push(h('g', { 'data-frag': fr.id, class: 'uml-frag' }, c));
    layers.overlay.push(h('g', { class: 'uml-frag-guards' }, guards));
  }
  for (const e of d.elements) {
    if (e.kind !== 'participant') continue;
    const b = geo.boxes[e.id];
    if (!b) continue;
    const s = sel.has(e.id) ? P.accent : bad.has(e.id) ? P.error : P.line;
    const w = sel.has(e.id) ? 2.4 : 1.3;
    const cx = b.x + b.w / 2;
    const c: VNode[] = [h('title', {}, [`participant: ${e.name}`])];
    c.push(h('line', { x1: cx, y1: b.y + b.h, x2: cx, y2: sq.lifelineBottom, stroke: P.muted, 'stroke-width': 1, 'stroke-dasharray': '6 5' }));
    const t = e.participantType;
    if (t === 'participant') {
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: P.fillHeader, stroke: s, 'stroke-width': w, rx: 3 }));
      c.push(text(cx, b.y + b.h / 2 + 4.5, e.name, { 'text-anchor': 'middle', 'font-weight': 700 }));
    } else {
      const iy = b.y + 4;
      c.push(h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent' }));
      if (t === 'actor') {
        c.push(h('circle', { cx, cy: iy + 7, r: 7, fill: P.fill, stroke: s, 'stroke-width': w }));
        c.push(h('path', { d: `M${cx},${iy + 14} L${cx},${iy + 30} M${cx - 13},${iy + 19} L${cx + 13},${iy + 19} M${cx},${iy + 30} L${cx - 11},${iy + 44} M${cx},${iy + 30} L${cx + 11},${iy + 44}`, stroke: s, 'stroke-width': w, fill: 'none', 'stroke-linecap': 'round' }));
      } else if (t === 'database') {
        c.push(h('path', { d: `M${cx - 16},${iy + 6} L${cx - 16},${iy + 38} A16,6 0 0 0 ${cx + 16},${iy + 38} L${cx + 16},${iy + 6}`, fill: P.fill, stroke: s, 'stroke-width': w }));
        c.push(h('ellipse', { cx, cy: iy + 6, rx: 16, ry: 6, fill: P.fillHeader, stroke: s, 'stroke-width': w }));
      } else {
        c.push(h('circle', { cx, cy: iy + 22, r: 16, fill: P.fill, stroke: s, 'stroke-width': w }));
        if (t === 'boundary') c.push(h('path', { d: `M${cx - 26},${iy + 8} L${cx - 26},${iy + 36} M${cx - 26},${iy + 22} L${cx - 16},${iy + 22}`, stroke: s, 'stroke-width': w }));
        if (t === 'control') c.push(h('path', { d: `M${cx - 2},${iy + 6} L${cx + 5},${iy + 2} M${cx - 2},${iy + 6} L${cx + 5},${iy + 10}`, stroke: s, 'stroke-width': w, fill: 'none' }));
        if (t === 'entity') c.push(h('line', { x1: cx - 16, y1: iy + 40, x2: cx + 16, y2: iy + 40, stroke: s, 'stroke-width': w }));
      }
      c.push(text(cx, b.y + b.h - 4, e.name, { 'text-anchor': 'middle', 'font-weight': 700 }));
    }
    layers.nodes.push(h('g', { 'data-el': e.id, class: 'uml-el', 'data-kind': 'participant' }, c));
  }
  for (const a of sq.activations) layers.nodes.push(h('rect', { x: a.x, y: a.y1, width: 12, height: Math.max(8, a.y2 - a.y1), fill: P.fillHeader, stroke: P.line, 'stroke-width': 1, class: 'uml-activation' }));
  const msgs = new Map(d.relationships.filter((r) => r.kind === 'message').map((r) => [r.id, r]));
  for (const m of sq.messages) {
    const r = msgs.get(m.id)!;
    const s = sel.has(r.id) ? P.accent : bad.has(r.id) ? P.error : P.line;
    const st = edgeStyle(r, pre);
    const lbl = r.kind === 'message' && r.messageKind === 'create' ? `«create» ${r.label}`.trim() : r.label;
    const c: VNode[] = [h('title', {}, [`message: ${lbl}`])];
    const dir = m.x2 >= m.x1 ? 1 : -1;
    const x1 = m.self ? m.x1 + 6 : m.x1 + 6 * dir;
    const x2 = m.self ? m.x1 + 6 : m.x2 - 6 * dir;
    const pathD = m.self ? `M${x1},${m.y} L${x1 + 42},${m.y} L${x1 + 42},${m.y + 22} L${x1 + 2},${m.y + 22}` : `M${x1},${m.y} L${x2},${m.y}`;
    c.push(h('path', { d: pathD, fill: 'none', stroke: 'transparent', 'stroke-width': 14, class: 'uml-hit' }));
    c.push(h('path', { d: pathD, fill: 'none', stroke: s, 'stroke-width': sel.has(r.id) ? 2.3 : 1.3, 'stroke-dasharray': st.dash, 'marker-end': st.end }));
    if (lbl) c.push(text(m.self ? x1 + 48 : (x1 + x2) / 2, m.self ? m.y + 14 : m.y - 7, lbl, { 'text-anchor': m.self ? 'start' : 'middle', 'font-size': FS - 0.5 }));
    layers.edges.push(h('g', { 'data-rel': r.id, class: 'uml-rel', 'data-kind': 'message' }, c));
  }
  void byId;
}
