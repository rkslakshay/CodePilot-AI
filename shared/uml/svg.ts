/** Serialises the virtual SVG tree to a standalone SVG document string. */
import type { Diagram } from './model.js';
import { render, LIGHT, DARK, type VNode, type RenderOptions } from './render.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

export function serialize(n: VNode | string): string {
  if (typeof n === 'string') return esc(n);
  const attrs = Object.entries(n.a)
    .map(([k, v]) => ` ${k}="${escAttr(String(v))}"`)
    .join('');
  if (!n.c || !n.c.length) return `<${n.t}${attrs}/>`;
  return `<${n.t}${attrs}>${n.c.map(serialize).join('')}</${n.t}>`;
}

/** A standalone SVG file for export (light palette and title by default). */
export function toSvg(d: Diagram, opts: RenderOptions & { theme?: 'light' | 'dark' } = {}): { svg: string; width: number; height: number } {
  const r = render(d, { palette: opts.theme === 'dark' ? DARK : LIGHT, title: true, idPrefix: 'x', ...opts, selected: [], errors: [] });
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(r.tree)}`, width: r.width, height: r.height };
}
