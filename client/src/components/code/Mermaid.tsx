import { useEffect, useRef, useState } from 'react';
import { Download, ImageDown, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { IconButton, Spinner } from '../ui/primitives';
import { toast } from '../ui/overlay';
import { downloadText, cn } from '@/lib/utils';
import { useSettings } from '@/store';

let initialized = '';
let counter = 0;

async function getMermaid(theme: string) {
  const m = (await import('mermaid')).default;
  if (initialized !== theme) {
    const dark = theme !== 'light';
    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Inter Variable, Inter, sans-serif',
      flowchart: { curve: 'basis', htmlLabels: true, padding: 12, nodeSpacing: 36, rankSpacing: 42, useMaxWidth: false },
      themeVariables: dark
        ? { background: '#151b26', primaryColor: '#1b2230', primaryTextColor: '#f1f3f8', primaryBorderColor: '#3b4456', lineColor: '#6b7488', secondaryColor: '#2a2350', tertiaryColor: '#123a33', fontSize: '13px', edgeLabelBackground: '#151b26' }
        : { background: '#ffffff', primaryColor: '#f0f2f7', primaryTextColor: '#151a24', primaryBorderColor: '#cdd2de', lineColor: '#8b94a7', fontSize: '13px', edgeLabelBackground: '#ffffff' },
    });
    initialized = theme;
  }
  return m;
}

/** Lighten the dark node class colours produced by the server when the light theme is active. */
function adaptForTheme(code: string, theme: string) {
  if (theme !== 'light') return code;
  return code
    .replace('fill:#2a2350,stroke:#8B7CFF,color:#F1F3F8', 'fill:#ece9ff,stroke:#6c5ce7,color:#151a24')
    .replace('fill:#123a33,stroke:#35C9A5,color:#F1F3F8', 'fill:#dff6ef,stroke:#129b7c,color:#151a24')
    .replace('fill:#1d2433,stroke:#929BAD,color:#F1F3F8', 'fill:#f0f2f7,stroke:#8b94a7,color:#151a24');
}

export function MermaidDiagram({ code, className, fileName = 'flowchart', minHeight = 320 }: { code: string; className?: string; fileName?: string; minHeight?: number }) {
  const theme = useSettings((s) => s.settings.theme);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const m = await getMermaid(theme);
        const { svg } = await m.render(`mmd-${++counter}`, adaptForTheme(code, theme));
        if (!cancelled) setSvg(svg);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message?.split('\n')[0] ?? 'Could not render diagram');
          setSvg('');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  const exportSvg = () => svg && downloadText(`${fileName}.svg`, svg, 'image/svg+xml');
  const exportPng = async () => {
    const el = hostRef.current?.querySelector('svg');
    if (!el) return;
    const vb = el.viewBox.baseVal;
    const w = Math.ceil(vb?.width || el.getBoundingClientRect().width);
    const h = Math.ceil(vb?.height || el.getBoundingClientRect().height);
    const clone = el.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    const data = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    const scale = 2;
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = w * scale;
      c.height = h * scale;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = theme === 'light' ? '#ffffff' : '#151b26';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, w, h);
      c.toBlob((b) => {
        if (!b) return toast.error('PNG export failed');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = `${fileName}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    };
    img.onerror = () => toast.error('PNG export failed', 'Your browser blocked rendering the SVG. Use SVG export instead.');
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(data)));
  };

  return (
    <div className={cn('relative flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card', className)} style={{ minHeight }}>
      <div className="absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-elevated/90 p-0.5 backdrop-blur">
        <IconButton icon={Minus} label="Zoom out" size="icon-sm" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.15).toFixed(2)))} />
        <span className="w-10 text-center font-mono text-[11px] text-muted">{Math.round(zoom * 100)}%</span>
        <IconButton icon={Plus} label="Zoom in" size="icon-sm" onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))} />
        <IconButton icon={RotateCcw} label="Reset zoom" size="icon-sm" onClick={() => setZoom(1)} />
        <IconButton icon={Maximize2} label="Fit to width" size="icon-sm" onClick={() => {
          const el = hostRef.current?.querySelector('svg');
          const box = hostRef.current?.parentElement;
          if (el && box) setZoom(Math.max(0.3, Math.min(2, (box.clientWidth - 40) / (el.viewBox.baseVal?.width || el.clientWidth || 1))));
        }} />
        <IconButton icon={Download} label="Export SVG" size="icon-sm" onClick={exportSvg} disabled={!svg} />
        <IconButton icon={ImageDown} label="Export PNG" size="icon-sm" onClick={exportPng} disabled={!svg} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        {loading && (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted">
            <Spinner /> Rendering flowchart…
          </div>
        )}
        {error && !loading && <p className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">Flowchart could not be rendered: {error}</p>}
        <div ref={hostRef} className="mermaid-host inline-block origin-top-left transition-transform" style={{ transform: `scale(${zoom})` }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}
