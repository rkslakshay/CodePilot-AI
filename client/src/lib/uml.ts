/** UML Studio client helpers: API types, local exports (SVG / PNG / PlantUML / Mermaid) and server PDF export. */
import { ApiError } from './api';
import { downloadText } from './utils';
import { toSvg, toPlantUml, toMermaid, type Diagram, type DiagramType, type Issue } from '@shared/uml/index';
import type { Engine } from './types';

export interface UmlValidation {
  valid: boolean;
  errors: Issue[];
  warnings: Issue[];
}
export interface UmlDiagramSummary {
  id: number;
  name: string;
  type: DiagramType;
  generation: string;
  repoId: number | null;
  projectId: number | null;
  sourcePath: string | null;
  createdAt: string;
  updatedAt: string;
  elementCount?: number;
  relationshipCount?: number;
}
export interface UmlDiagramDto extends UmlDiagramSummary {
  model: Diagram;
  validation: UmlValidation;
}
export interface UmlGenResult {
  diagram: Diagram;
  engine: Engine;
  method?: 'ai' | 'rules';
  warnings: string[];
  repaired?: boolean;
  validation: UmlValidation;
}
/** What produced a diagram, so "Regenerate" can repeat it. */
export type UmlGenRequest =
  | { mode: 'text'; body: { type: DiagramType; text: string; useAi?: boolean } }
  | { mode: 'source'; body: Record<string, unknown> }
  | { mode: 'repository'; body: { repoId: number; kind: 'class' | 'modules' | 'architecture' | 'deployment'; folder?: string } };
export const GEN_URL: Record<UmlGenRequest['mode'], string> = { text: '/uml/generate/text', source: '/uml/generate/source', repository: '/uml/generate/repository' };

export const fileBase = (s: string) => s.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'diagram';

function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportSvg(d: Diagram, name: string) {
  downloadText(`${fileBase(name)}.svg`, toSvg(d).svg, 'image/svg+xml');
}

/** Rasterises the light-theme SVG in the browser (no server, no network). */
/**
 * Raster scale for PNG export: 2× by default, reduced when the image would exceed browser canvas limits
 * (Chromium / Edge: at most 65 535 px per side and about 268 million pixels), so very large diagrams
 * still export, at a lower resolution, instead of failing.
 */
export function pngScale(width: number, height: number, preferred = 2): number {
  const MAX_SIDE = 32_000;
  const MAX_AREA = 120_000_000;
  return Math.min(preferred, MAX_SIDE / Math.max(1, width), MAX_SIDE / Math.max(1, height), Math.sqrt(MAX_AREA / Math.max(1, width * height)));
}

export async function svgToPng(d: Diagram, preferred = 2): Promise<Blob> {
  const { svg, width, height } = toSvg(d);
  const scale = pngScale(width, height, preferred);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('The diagram could not be rasterised.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encoding failed.'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function exportPng(d: Diagram, name: string) {
  downloadBlob(`${fileBase(name)}.png`, await svgToPng(d));
}

/** Vector PDF rendered by the local server with the installed Edge/Chrome (offline). */
export async function exportPdf(d: Diagram, name: string) {
  let res: Response;
  try {
    res = await fetch('/api/uml/export/pdf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: d, name: fileBase(name) }) });
  } catch {
    throw new ApiError(0, 'network_error', 'Cannot reach the local CodePilot server.');
  }
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new ApiError(res.status, j?.error?.code ?? 'error', j?.error?.message ?? `PDF export failed (${res.status})`);
  }
  downloadBlob(`${fileBase(name)}.pdf`, await res.blob());
}

export function exportPlantUml(d: Diagram, name: string) {
  downloadText(`${fileBase(name)}.puml`, toPlantUml(d));
}
export function exportMermaid(d: Diagram, name: string): boolean {
  const m = toMermaid(d);
  if (!m) return false;
  downloadText(`${fileBase(name)}.mmd`, m);
  return true;
}

/**
 * Hand-off of a generated / template diagram to the editor's unsaved draft (/uml/new).
 * Reading is idempotent (React StrictMode mounts twice in development); each draft has a sequence number.
 */
type Draft = { diagram: Diagram; name?: string; request?: UmlGenRequest; result?: Omit<UmlGenResult, 'diagram'> };
let pending: (Draft & { seq: number }) | null = null;
let seq = 0;
export const draftSeq = () => seq;
export const setDraft = (p: Draft) => {
  seq++;
  pending = { ...p, seq };
  return seq;
};
/** The draft for editor instance `n`, or null when /uml/new was opened directly. */
export const getDraft = (n: number) => (pending && pending.seq === n ? pending : null);
