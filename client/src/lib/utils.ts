import { clsx, type ClassValue } from 'clsx';
import type { Lang } from './types';

export const cn = (...v: ClassValue[]) => clsx(v);

export const LANGS: { id: Lang; label: string; ext: string; color: string }[] = [
  { id: 'c', label: 'C', ext: 'c', color: '#6c8ebf' },
  { id: 'cpp', label: 'C++', ext: 'cpp', color: '#5b9dff' },
  { id: 'java', label: 'Java', ext: 'java', color: '#f3b65d' },
  { id: 'python', label: 'Python', ext: 'py', color: '#35c9a5' },
  { id: 'javascript', label: 'JavaScript', ext: 'js', color: '#e9d66b' },
];
export const langLabel = (l?: string | null) => LANGS.find((x) => x.id === l)?.label ?? (l === 'mixed' ? 'Mixed' : l ?? '—');
export const langExt = (l: Lang) => LANGS.find((x) => x.id === l)!.ext;
export const langColor = (l?: string | null) => LANGS.find((x) => x.id === l)?.color ?? '#929bad';
export const monacoLang = (l: Lang) => (l === 'c' ? 'c' : l === 'cpp' ? 'cpp' : l);
export const langFromFile = (name: string): Lang | null => {
  const ext = name.split('.').pop()?.toLowerCase();
  return LANGS.find((l) => l.ext === ext || (ext === 'h' && l.id === 'c') || (ext === 'hpp' && l.id === 'cpp') || (ext === 'cc' && l.id === 'cpp') || (ext === 'mjs' && l.id === 'javascript'))?.id ?? null;
};

/** SQLite timestamps are UTC without a zone marker. */
export function parseDate(s: string) {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
}
export function timeAgo(s: string) {
  const d = parseDate(s).getTime();
  const diff = Math.max(0, Date.now() - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return parseDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function formatDateTime(s: string) {
  return parseDate(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function downloadText(name: string, text: string, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function suggestedFileName(lang: Lang, base = 'main') {
  if (lang === 'java') return 'Main.java';
  return `${base}.${langExt(lang)}`;
}
