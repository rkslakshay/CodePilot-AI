/**
 * UML canvas: renders the shared SVG renderer's output and handles selection, dragging (containers move
 * their contents), relationship creation, pan (drag the background), zoom (wheel / buttons) and fit.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { render, serialize, LIGHT, DARK, moveElement, type Diagram } from '@shared/uml/index';
import { cn } from '@/lib/utils';

export interface CanvasHandle {
  fit: () => void;
  reset: () => void;
  zoom: (factor: number) => void;
  scale: number;
}
export interface Selection {
  kind: 'element' | 'relationship';
  id: string;
}
interface Props {
  diagram: Diagram;
  selected: Selection | null;
  errorIds: string[];
  grid: boolean;
  dark: boolean;
  connecting: { kind: string; source: string | null } | null;
  onSelect: (s: Selection | null) => void;
  onConnectPick: (id: string) => void;
  /** transient = live drag preview (not recorded in history) */
  onChange: (d: Diagram, transient: boolean) => void;
  onScale?: (s: number) => void;
}

const GRID = 10;

export const UmlCanvas = forwardRef<CanvasHandle, Props>(function UmlCanvas({ diagram, selected, errorIds, grid, dark, connecting, onSelect, onConnectPick, onChange, onScale }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 24, y: 24 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const fitted = useRef(false);

  const r = useMemo(
    () => render(diagram, { palette: dark ? DARK : LIGHT, selected: selected ? [selected.id] : [], errors: errorIds, idPrefix: 'cv', background: false }),
    [diagram, dark, selected, errorIds],
  );
  const markup = useMemo(() => serialize(r.tree), [r]);

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    const s = Math.max(0.15, Math.min(1.5, Math.min((W - 40) / r.width, (H - 40) / r.height)));
    setView({ scale: s, x: (W - r.width * s) / 2, y: Math.max(16, (H - r.height * s) / 2) });
  }, [r.width, r.height]);
  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = wrap.current;
    if (!el) return;
    setView((v) => {
      const s = Math.max(0.15, Math.min(4, v.scale * factor));
      const px = cx ?? el.clientWidth / 2;
      const py = cy ?? el.clientHeight / 2;
      return { scale: s, x: px - ((px - v.x) * s) / v.scale, y: py - ((py - v.y) * s) / v.scale };
    });
  }, []);
  useImperativeHandle(ref, () => ({ fit, reset: () => setView({ scale: 1, x: 24, y: 24 }), zoom: (f) => zoomAt(f), scale: view.scale }), [fit, zoomAt, view.scale]);
  useEffect(() => onScale?.(view.scale), [view.scale, onScale]);

  // fit once per opened diagram
  useLayoutEffect(() => {
    if (!fitted.current && r.width > 0) {
      fitted.current = true;
      fit();
    }
  }, [fit, r.width]);

  // wheel zoom (non-passive so the page does not scroll)
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const drag = useRef<null | { mode: 'pan'; sx: number; sy: number; vx: number; vy: number } | { mode: 'move'; sx: number; sy: number; start: Diagram; ids: { id: string; x: number; y: number }[]; moved: boolean; last: Diagram }>(null);

  const descendantsLeaves = (id: string): string[] => {
    const kids = diagram.elements.filter((e) => e.parent === id);
    if (!kids.length) return [id];
    return kids.flatMap((k) => descendantsLeaves(k.id));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as Element;
    const elNode = t.closest('[data-el]');
    const relNode = t.closest('[data-rel]');
    wrap.current?.focus({ preventScroll: true });
    if (connecting) {
      if (elNode) onConnectPick(elNode.getAttribute('data-el')!);
      return;
    }
    if (relNode) {
      onSelect({ kind: 'relationship', id: relNode.getAttribute('data-rel')! });
      return;
    }
    if (elNode) {
      const id = elNode.getAttribute('data-el')!;
      onSelect({ kind: 'element', id });
      if (diagram.type === 'sequence') return;
      const ids = descendantsLeaves(id)
        .map((x) => ({ id: x, b: r.geo.boxes[x] }))
        .filter((x) => x.b)
        .map((x) => ({ id: x.id, x: x.b.x, y: x.b.y }));
      drag.current = { mode: 'move', sx: e.clientX, sy: e.clientY, start: diagram, ids, moved: false, last: diagram };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    onSelect(null);
    drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pan') {
      setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
      return;
    }
    const s = viewRef.current.scale;
    let dx = (e.clientX - d.sx) / s;
    let dy = (e.clientY - d.sy) / s;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    d.moved = true;
    if (grid && d.ids.length) {
      // snap the dragged element's top-left corner to the grid
      dx = Math.round((d.ids[0].x + dx) / GRID) * GRID - d.ids[0].x;
      dy = Math.round((d.ids[0].y + dy) / GRID) * GRID - d.ids[0].y;
    }
    let next = d.start;
    for (const p of d.ids) next = moveElement(next, p.id, Math.max(0, p.x + dx), Math.max(0, p.y + dy));
    d.last = next;
    onChange(next, true);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === 'move' && d.moved) onChange(d.last, false);
  };

  return (
    <div
      ref={wrap}
      tabIndex={0}
      role="application"
      aria-label="Diagram canvas. Drag the background to pan, use the mouse wheel to zoom, click an element to select it."
      data-testid="uml-canvas"
      className={cn('uml-canvas relative h-full w-full touch-none select-none overflow-hidden outline-none', connecting ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing')}
      style={
        grid
          ? {
              backgroundImage: `radial-gradient(circle, var(--border-strong) 1px, transparent 1.2px)`,
              backgroundSize: `${GRID * 2 * view.scale}px ${GRID * 2 * view.scale}px`,
              backgroundPosition: `${view.x}px ${view.y}px`,
            }
          : undefined
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className="absolute left-0 top-0 origin-top-left [&_.uml-el]:cursor-pointer [&_.uml-rel]:cursor-pointer"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, width: r.width, height: r.height }}
        dangerouslySetInnerHTML={{ __html: markup }}
      />
    </div>
  );
});
