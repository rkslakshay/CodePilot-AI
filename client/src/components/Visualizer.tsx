import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, SkipBack, SkipForward, Wand2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, Button, IconButton, Input, Spinner } from './ui/primitives';
import { cn } from '@/lib/utils';
import type { TraceStep } from '@/lib/types';

export function Visualizer({ algorithmId, defaultInput, visual }: { algorithmId: string; defaultInput: string; visual: string }) {
  const [input, setInput] = useState(defaultInput);
  const [steps, setSteps] = useState<TraceStep[]>([]);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(700);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(
    async (inp: string) => {
      setLoading(true);
      setError('');
      setPlaying(false);
      try {
        const r = await api.post<{ steps: TraceStep[]; truncated: boolean }>(`/algorithms/${algorithmId}/trace`, { input: inp });
        setSteps(r.steps);
        setTruncated(r.truncated);
        setI(0);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [algorithmId],
  );
  useEffect(() => {
    setInput(defaultInput);
    void load(defaultInput);
  }, [defaultInput, load]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!playing) return;
    if (i >= steps.length - 1) {
      setPlaying(false);
      return;
    }
    timer.current = setTimeout(() => setI((x) => Math.min(steps.length - 1, x + 1)), speed);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, i, steps.length, speed]);

  const step = steps[i];
  const hint = {
    sort: 'Comma-separated numbers, e.g. 5, 3, 8, 1',
    search: 'Numbers | target, e.g. 1, 4, 9, 16 | 9',
    graph: 'Start vertex (0–5)',
    stack: 'Operations: push 5, push 7, pop, peek',
    queue: 'Operations: enqueue 5, enqueue 7, dequeue',
    linkedlist: 'Operations: tail 10, head 5, delete 10',
    bst: 'Keys | search key, e.g. 50, 30, 70 | 30',
    hash: 'Keys, e.g. 10, 17, 24',
    recursion: 'n (small, e.g. 5)',
    hanoi: 'Number of disks (1–5)',
    kadane: 'Numbers (negatives allowed)',
    twosum: 'Numbers | target, e.g. 3, 2, 4 | 6',
    traversal: 'Tree values (level order) | preorder, inorder or postorder',
  }[visual];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <label className="mb-1 block text-xs font-medium text-muted" htmlFor="viz-input">
            Input
          </label>
          <Input id="viz-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder={hint} onKeyDown={(e) => e.key === 'Enter' && load(input)} className="font-mono text-[13px]" />
        </div>
        <Button icon={Wand2} onClick={() => load(input)} loading={loading}>
          Apply input
        </Button>
        <Button variant="ghost" onClick={() => { setInput(defaultInput); void load(defaultInput); }}>
          Default
        </Button>
      </div>
      {hint && <p className="-mt-1 text-[11.5px] text-subtle">{hint}</p>}
      {error && <Alert tone="danger">{error}</Alert>}
      {loading && !steps.length && (
        <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted">
          <Spinner /> Tracing execution…
        </div>
      )}
      {step && (
        <>
          <div className="rounded-xl border border-border bg-panel p-4">
            <div className="mb-3 flex items-start gap-3">
              <span className="grid h-6 min-w-6 place-items-center rounded-md bg-primary-soft px-1.5 font-mono text-[11px] text-primary">{i + 1}</span>
              <p className="text-[13.5px] font-medium" aria-live="polite">
                {step.message}
              </p>
            </div>
            <div className="min-h-[220px] overflow-x-auto">
              <StepView step={step} />
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <div className="flex flex-wrap items-center gap-1.5">
              <IconButton icon={SkipBack} label="First step" variant="secondary" onClick={() => { setPlaying(false); setI(0); }} disabled={i === 0} />
              <IconButton icon={ChevronLeft} label="Previous step" variant="secondary" onClick={() => { setPlaying(false); setI((x) => Math.max(0, x - 1)); }} disabled={i === 0} />
              <Button variant="primary" icon={playing ? Pause : Play} onClick={() => { if (i >= steps.length - 1) setI(0); setPlaying(!playing); }}>
                {playing ? 'Pause' : 'Play'}
              </Button>
              <IconButton icon={ChevronRight} label="Next step" variant="secondary" onClick={() => { setPlaying(false); setI((x) => Math.min(steps.length - 1, x + 1)); }} disabled={i >= steps.length - 1} />
              <IconButton icon={SkipForward} label="Last step" variant="secondary" onClick={() => { setPlaying(false); setI(steps.length - 1); }} disabled={i >= steps.length - 1} />
              <IconButton icon={RotateCcw} label="Reset" variant="secondary" onClick={() => { setPlaying(false); setI(0); }} />
              <label className="ml-2 flex items-center gap-2 text-xs text-muted">
                Speed
                <input type="range" min={100} max={1600} step={100} value={1700 - speed} onChange={(e) => setSpeed(1700 - Number(e.target.value))} aria-label="Playback speed" className="w-28 accent-[var(--primary)]" />
              </label>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span>
                Step <b className="text-fg">{i + 1}</b> / {steps.length}
              </span>
              <span>Comparisons <b className="text-fg">{step.counters.comparisons}</b></span>
              <span>Swaps/moves <b className="text-fg">{step.counters.swaps}</b></span>
              <span>Iterations <b className="text-fg">{step.counters.iterations}</b></span>
            </div>
          </div>
          <input type="range" min={0} max={steps.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} className="w-full accent-[var(--primary)]" aria-label="Step slider" />
          {truncated && <p className="text-xs text-warning">Trace limited to the first {steps.length} steps.</p>}
          <div className="grid gap-2 rounded-xl border border-border bg-panel p-3 text-[12.5px] sm:grid-cols-[auto_1fr]" role="group" aria-label="Sample input and final output">
            <span className="font-medium text-muted">Sample input</span>
            <code className="min-w-0 break-words font-mono text-fg">{input.trim() || defaultInput}</code>
            <span className="font-medium text-muted">Final output</span>
            <span className="min-w-0 break-words text-fg">{steps[steps.length - 1].message}</span>
          </div>
        </>
      )}
    </div>
  );
}

function StepView({ step }: { step: TraceStep }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
      <div className="min-w-0">
        {step.array && <ArrayView step={step} />}
        {step.graph && <GraphView g={step.graph} />}
        {step.list && <ListView l={step.list} />}
        {step.tree && <TreeView t={step.tree} />}
        {step.buckets && <BucketView b={step.buckets} />}
        {step.hanoi && <HanoiView h={step.hanoi} />}
        {step.map && !step.array && <MapView map={step.map} />}
        {step.map && step.array && <div className="mt-4"><MapView map={step.map} /></div>}
      </div>
      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Variables</p>
          <div className="space-y-1">
            {Object.entries(step.vars).length ? (
              Object.entries(step.vars).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between rounded-md border border-border bg-card px-2 py-1 font-mono text-[12px]">
                  <span className="text-muted">{k}</span>
                  <span className="text-fg">{String(v)}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-subtle">—</p>
            )}
          </div>
        </div>
        {!!step.callStack?.length && (
          <div>
            <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Call stack</p>
            <div className="flex flex-col-reverse gap-1">
              {step.callStack.map((c, i) => (
                <div key={i} className={cn('rounded-md border px-2 py-1 font-mono text-[11.5px]', i === step.callStack!.length - 1 ? 'border-primary/40 bg-primary-soft text-fg' : 'border-border bg-card text-muted')}>
                  {c}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ArrayView({ step }: { step: TraceStep }) {
  const arr = step.array!.map(Number);
  const hl = step.hl ?? {};
  const max = Math.max(1, ...arr.map((x) => Math.abs(x)));
  const hasNeg = arr.some((x) => x < 0);
  const color = (i: number) => {
    if (hl.found?.includes(i)) return 'bg-success';
    if (hl.swap?.includes(i)) return 'bg-danger';
    if (hl.compare?.includes(i)) return 'bg-warning';
    if (hl.pivot === i) return 'bg-info';
    if (hl.active?.includes(i)) return 'bg-primary';
    if (hl.sorted?.includes(i)) return 'bg-secondary/70';
    return 'bg-border-strong';
  };
  const inRange = (i: number) => !hl.range || (i >= hl.range[0] && i <= hl.range[1]);
  return (
    <div>
      <div className={cn('flex gap-1.5', hasNeg ? 'h-[200px] items-center' : 'h-[180px] items-end')}>
        {arr.map((v, i) => (
          <div key={i} className={cn('flex min-w-[28px] flex-1 flex-col items-center', hasNeg ? 'h-full justify-center' : 'justify-end', hl.dim?.includes(i) && 'opacity-30', !inRange(i) && 'opacity-40')}>
            {hasNeg ? (
              <div className="flex h-full w-full flex-col">
                <div className="flex flex-1 items-end">{v >= 0 && <div className={cn('bar w-full rounded-t-md', color(i))} style={{ height: `${(v / max) * 100}%` }} />}</div>
                <div className="h-px bg-border" />
                <div className="flex flex-1 items-start">{v < 0 && <div className={cn('bar w-full rounded-b-md', color(i))} style={{ height: `${(-v / max) * 100}%` }} />}</div>
              </div>
            ) : (
              <div className={cn('bar w-full rounded-t-md', color(i))} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5">
        {arr.map((v, i) => (
          <div key={i} className={cn('flex min-w-[28px] flex-1 flex-col items-center rounded-md border py-1', hl.compare?.includes(i) || hl.swap?.includes(i) || hl.active?.includes(i) || hl.found?.includes(i) ? 'border-primary/50 bg-primary-soft' : 'border-border bg-card', hl.dim?.includes(i) && 'opacity-40')}>
            <span className="font-mono text-[12.5px] font-semibold">{v}</span>
            <span className="font-mono text-[10px] text-subtle">{i}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted">
        {[['bg-warning', 'compare'], ['bg-danger', 'swap / shift'], ['bg-primary', 'active'], ['bg-info', 'pivot'], ['bg-secondary/70', 'sorted'], ['bg-success', 'found / result']].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className={cn('h-2.5 w-2.5 rounded-sm', c)} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function GraphView({ g }: { g: NonNullable<TraceStep['graph']> }) {
  const fill = (id: number) => ({ current: 'var(--primary)', visited: 'var(--info)', queued: 'var(--warning)', done: 'var(--secondary)' })[g.state[id]] ?? 'var(--elevated)';
  const pos = (id: number) => g.nodes.find((n) => n.id === id)!;
  const isActive = (a: number, b: number) => !!g.activeEdge && ((g.activeEdge[0] === a && g.activeEdge[1] === b) || (g.activeEdge[0] === b && g.activeEdge[1] === a));
  return (
    <div>
      <svg viewBox="0 0 620 300" className="w-full max-w-[640px]" role="img" aria-label="Graph state">
        {g.edges.map((e, k) => {
          const a = pos(e.from);
          const b = pos(e.to);
          return (
            <g key={k}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={isActive(e.from, e.to) ? 'var(--primary)' : 'var(--border-strong)'} strokeWidth={isActive(e.from, e.to) ? 3.5 : 2} />
              {e.w !== undefined && (
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} fill="var(--muted)" fontSize="12" textAnchor="middle" fontFamily="JetBrains Mono">
                  {e.w}
                </text>
              )}
            </g>
          );
        })}
        {g.nodes.map((n) => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={22} fill={fill(n.id)} stroke={g.state[n.id] === 'current' ? 'var(--fg)' : 'var(--border-strong)'} strokeWidth={2} style={{ transition: 'fill .25s' }} />
            <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize="14" fontWeight="600" fill={g.state[n.id] ? '#0b0d12' : 'var(--fg)'}>
              {n.id}
            </text>
            {g.dist && (
              <text x={n.x} y={n.y + 40} textAnchor="middle" fontSize="12" fill="var(--secondary)" fontFamily="JetBrains Mono">
                d={g.dist[n.id]}
              </text>
            )}
          </g>
        ))}
      </svg>
      {g.container && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-muted">{g.container.label}:</span>
          {g.container.items.length ? g.container.items.map((x, k) => <span key={k} className="rounded-md border border-warning/40 bg-warning-soft px-2 py-0.5 font-mono">{x}</span>) : <span className="text-subtle">empty</span>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
        {[['var(--primary)', 'current'], ['var(--warning)', 'discovered / queued'], ['var(--info)', 'on path'], ['var(--secondary)', 'finished']].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function ListView({ l }: { l: NonNullable<TraceStep['list']> }) {
  if (l.kind === 'stack')
    return (
      <div className="flex items-end gap-6">
        <div className="flex w-40 flex-col-reverse gap-1 rounded-b-xl border-x-2 border-b-2 border-border-strong p-2" style={{ minHeight: 210 }}>
          {l.items.map((x, k) => (
            <div key={k} className={cn('rounded-md border py-2 text-center font-mono text-[13px] animate-fade-in', k === l.highlight ? 'border-primary bg-primary-soft' : 'border-border bg-card')}>
              {x}
            </div>
          ))}
        </div>
        <div className="text-xs text-muted">{l.items.length ? `top → ${l.items[l.items.length - 1]}` : 'empty stack'}{l.op && <p className={cn('mt-1 font-medium', /flow/.test(l.op) ? 'text-danger' : 'text-primary')}>{l.op}</p>}</div>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 py-8">
      {l.kind === 'queue' && <span className="text-xs text-muted">front →</span>}
      {l.kind === 'linked' && <span className="rounded-md border border-border px-2 py-1 font-mono text-xs text-muted">head</span>}
      {l.items.length === 0 && <span className="text-sm text-subtle">{l.kind === 'linked' ? 'NULL' : 'empty queue'}</span>}
      {l.items.map((x, k) => (
        <div key={k} className="flex items-center gap-2 animate-fade-in">
          <span className="text-subtle">{l.kind === 'linked' || k > 0 ? '→' : ''}</span>
          <div className={cn('flex overflow-hidden rounded-lg border font-mono text-[13px]', k === l.highlight ? 'border-primary bg-primary-soft' : 'border-border bg-card')}>
            <span className="px-3 py-2">{x}</span>
            {l.kind === 'linked' && <span className="border-l border-border px-2 py-2 text-[10px] text-subtle">next</span>}
          </div>
        </div>
      ))}
      {l.kind === 'linked' && l.items.length > 0 && <span className="text-subtle">→ NULL</span>}
      {l.kind === 'queue' && l.items.length > 0 && <span className="text-xs text-muted">← rear</span>}
    </div>
  );
}

function TreeView({ t }: { t: NonNullable<TraceStep['tree']> }) {
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const h = Math.max(120, ...t.nodes.map((n) => n.y + 40));
  return (
    <svg viewBox={`0 0 600 ${h}`} className="w-full max-w-[640px]" role="img" aria-label="Binary search tree">
      {t.nodes.filter((n) => n.parent !== null).map((n) => {
        const p = byId.get(n.parent!)!;
        const onPath = t.path?.includes(n.id) && t.path?.includes(p.id);
        return <line key={n.id} x1={p.x} y1={p.y} x2={n.x} y2={n.y} stroke={onPath ? 'var(--primary)' : 'var(--border-strong)'} strokeWidth={onPath ? 3 : 2} />;
      })}
      {t.nodes.map((n) => {
        const f = t.found === n.id ? 'var(--success)' : t.highlight === n.id ? 'var(--primary)' : t.path?.includes(n.id) ? 'var(--primary-soft)' : 'var(--elevated)';
        return (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={19} fill={f} stroke="var(--border-strong)" strokeWidth={2} />
            <text x={n.x} y={n.y + 4.5} textAnchor="middle" fontSize="13" fontWeight="600" fill={t.found === n.id || t.highlight === n.id ? '#0b0d12' : 'var(--fg)'}>
              {n.key}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function BucketView({ b }: { b: NonNullable<TraceStep['buckets']> }) {
  return (
    <div className="space-y-1.5">
      {b.hashOf && <p className="mb-2 font-mono text-xs text-primary">hash: {b.hashOf}</p>}
      {b.slots.map((s, k) => (
        <div key={k} className="flex items-center gap-2">
          <span className={cn('w-14 rounded-md border px-2 py-1.5 text-center font-mono text-xs', k === b.highlight ? 'border-primary bg-primary-soft' : 'border-border bg-card text-muted')}>[{k}]</span>
          {s.length === 0 && <span className="text-xs text-subtle">∅</span>}
          {s.map((v, j) => (
            <span key={j} className="flex items-center gap-2">
              {j > 0 && <span className="text-subtle">→</span>}
              <span className={cn('rounded-md border px-2.5 py-1 font-mono text-[12.5px]', k === b.highlight && j === s.length - 1 ? 'border-secondary bg-secondary-soft' : 'border-border bg-card')}>{v}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function HanoiView({ h }: { h: NonNullable<TraceStep['hanoi']> }) {
  const n = Math.max(1, ...h.rods.flat());
  return (
    <div className="grid grid-cols-3 gap-4 pt-4">
      {h.rods.map((rod, k) => (
        <div key={k} className="flex flex-col items-center">
          <div className="relative flex h-40 w-full flex-col-reverse items-center">
            <div className="absolute bottom-0 h-full w-1.5 rounded bg-border-strong" />
            {rod.map((d) => (
              <div key={d} className={cn('relative z-10 mb-0.5 h-5 rounded-md transition-all', h.move?.[1] === k && d === rod[rod.length - 1] ? 'bg-primary' : 'bg-secondary/80')} style={{ width: `${30 + (d / n) * 65}%` }} />
            ))}
          </div>
          <div className="h-1.5 w-full rounded bg-border-strong" />
          <span className="mt-1 font-mono text-xs text-muted">{'ABC'[k]}</span>
        </div>
      ))}
    </div>
  );
}

function MapView({ map }: { map: Record<string, number> }) {
  const e = Object.entries(map);
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase">Hash map</p>
      <div className="flex flex-wrap gap-1.5">
        {e.length ? e.map(([k, v]) => <span key={k} className="rounded-md border border-border bg-card px-2 py-1 font-mono text-xs"><span className="text-primary">{k}</span> → {v}</span>) : <span className="text-xs text-subtle">empty</span>}
      </div>
    </div>
  );
}
