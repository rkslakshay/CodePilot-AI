/** Shared Repository Analyzer components. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, Bot, CheckCircle2, CircleDot, Cpu, Eye, EyeOff, Info, Layers, ShieldAlert, Sparkles, UserCheck, Wrench, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge, Button, Spinner, Textarea } from '@/components/ui/primitives';
import { toast } from '@/components/ui/overlay';
import { CATEGORY_LABEL, SEV_COLOR, SEV_LABEL, SEVERITIES, SOURCE_LABEL, type Confidence, type Finding, type FindingSource, type Job, type Severity } from '@/lib/repo';

const SEV_ICON: Record<Severity, typeof Info> = { critical: AlertOctagon, high: ShieldAlert, medium: AlertTriangle, low: CircleDot, info: Info };

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const I = SEV_ICON[severity];
  const solid = severity === 'critical';
  return (
    <span
      className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[11px] font-semibold', className)}
      style={solid ? { background: SEV_COLOR[severity], borderColor: SEV_COLOR[severity], color: '#fff' } : { color: SEV_COLOR[severity], borderColor: `color-mix(in srgb, ${SEV_COLOR[severity]} 45%, transparent)`, background: `color-mix(in srgb, ${SEV_COLOR[severity]} 12%, transparent)` }}
    >
      <I size={11} aria-hidden />
      {SEV_LABEL[severity]}
    </span>
  );
}
export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const dots = confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1;
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-md border border-border px-1.5 text-[11px] text-muted" title={`${confidence} confidence`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3].map((d) => <span key={d} className={cn('h-1.5 w-1.5 rounded-full', d <= dots ? 'bg-fg/70' : 'bg-border-strong')} />)}
      </span>
      {confidence} confidence
    </span>
  );
}
const SOURCE_ICON: Record<FindingSource, typeof Info> = { static: Cpu, tool: Wrench, ai: Bot, combined: Layers };
export function SourceBadge({ source, verified }: { source: FindingSource; verified?: boolean }) {
  const I = SOURCE_ICON[source];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span className={cn('inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[11px]', source === 'ai' ? 'border-primary/40 bg-primary-soft text-primary' : source === 'combined' ? 'border-secondary/40 bg-secondary-soft text-secondary' : 'border-border text-muted')}>
        <I size={11} aria-hidden />
        {SOURCE_LABEL[source]}
      </span>
      {verified && (
        <span className="inline-flex h-5 items-center gap-1 rounded-md border border-success/40 bg-success-soft px-1.5 text-[11px] text-success">
          <UserCheck size={11} aria-hidden /> User-verified
        </span>
      )}
    </span>
  );
}
export function StatusBadge({ status }: { status: Finding['status'] }) {
  const map = { open: ['neutral', 'Open'], reviewed: ['info', 'Reviewed'], dismissed: ['neutral', 'Dismissed'], fixed: ['success', 'Fixed'] } as const;
  return <Badge tone={map[status][0]}>{map[status][1]}</Badge>;
}

/** Horizontal stacked bar for the severity distribution, with a legend. */
export function SeverityBar({ counts, className }: { counts: Record<Severity, number>; className?: string }) {
  const total = SEVERITIES.reduce((a, s) => a + (counts[s] ?? 0), 0);
  return (
    <div className={className}>
      <div className="flex h-3 overflow-hidden rounded-full bg-elevated" role="img" aria-label={`Findings by severity: ${SEVERITIES.map((s) => `${counts[s] ?? 0} ${s}`).join(', ')}`}>
        {total > 0 && SEVERITIES.map((s) => (counts[s] ? <div key={s} style={{ width: `${(counts[s] / total) * 100}%`, background: SEV_COLOR[s] }} className="border-r border-[var(--card)] last:border-0" /> : null))}
      </div>
      <div className="mt-2.5 grid grid-cols-5 gap-1 text-center">
        {SEVERITIES.map((s) => (
          <div key={s}>
            <p className="font-mono text-[15px] font-semibold tabular-nums" style={{ color: counts[s] ? SEV_COLOR[s] : undefined }}>
              {counts[s] ?? 0}
            </p>
            <p className="text-[10.5px] text-subtle">{SEV_LABEL[s]}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Simple labelled horizontal bars (language, file kind, complexity distributions). */
export function BarList({ data, color = 'var(--primary)', format = (n: number) => n.toLocaleString(), label }: { data: { label: string; value: number; hint?: string; color?: string }[]; color?: string; format?: (n: number) => string; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p className="text-[12.5px] text-subtle">No data.</p>;
  return (
    <ul className="space-y-2" aria-label={label}>
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2.5 text-[12.5px]">
          <span className="truncate" title={d.label}>{d.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-elevated">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, background: d.color ?? color }} />
          </span>
          <span className="font-mono text-[11.5px] tabular-nums text-muted" title={d.hint}>{format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Quality score ring. */
export function ScoreRing({ score, grade, size = 112 }: { score: number; grade: string; size?: number }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const color = score >= 75 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Quality score ${score} out of 100, grade ${grade}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--elevated)" strokeWidth="9" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.26} fontWeight="700" fill="var(--fg)">{score}</text>
      <text x="50%" y="70%" textAnchor="middle" fontSize={size * 0.11} fill="var(--muted)">grade {grade}</text>
    </svg>
  );
}

/** Polls a background job until it finishes. */
export function useJob(jobId: string | null | undefined, onDone?: (j: Job) => void) {
  const [job, setJob] = useState<Job | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await api.get<Job>(`/repos/jobs/${jobId}`);
        if (stop) return;
        setJob(j);
        if (j.status === 'running') setTimeout(tick, 400);
        else done.current?.(j);
      } catch {
        if (!stop) setTimeout(tick, 1000);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [jobId]);
  return job;
}

export function JobProgress({ job, onCancel, label }: { job: Job; onCancel?: () => void; label: string }) {
  const pct = job.progress.total ? Math.round((job.progress.done / job.progress.total) * 100) : 0;
  return (
    <div className="rounded-xl border border-primary/30 bg-primary-soft/40 p-3.5" role="status" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <Spinner />
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {label} <span className="font-normal text-muted">— {job.progress.message}</span>
        </p>
        <span className="font-mono text-xs text-muted">{job.progress.total ? `${job.progress.done}/${job.progress.total}` : ''}</span>
        {onCancel && (
          <Button size="xs" variant="ghost" icon={XCircle} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${job.progress.total ? pct : 8}%` }} />
      </div>
    </div>
  );
}

export function Panel({ title, icon: Icon, actions, children, className }: { title: ReactNode; icon?: typeof Info; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-border bg-card', className)}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        {Icon && <Icon size={15} className="text-muted" aria-hidden />}
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{title}</h3>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Renders `inline code` spans used in rule texts. */
export function RichText({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/g).map((part, i) => (part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={i} className="rounded bg-elevated px-1 font-mono text-[0.92em]">{part.slice(1, -1)}</code> : part))}</>;
}

/** Detail view of one finding with status management and notes. */
export function FindingDetail({ repoId, finding, onChange, onOpenFile, onAsk }: { repoId: number; finding: Finding; onChange: (f: Finding) => void; onOpenFile?: (path: string, line: number | null) => void; onAsk?: (f: Finding) => void }) {
  const [note, setNote] = useState(finding.note);
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(finding.note), [finding.id, finding.note]);
  const patch = async (body: Partial<Pick<Finding, 'status' | 'note' | 'userVerified'>>, msg: string) => {
    setBusy(true);
    try {
      const f = await api.patch<Finding>(`/repos/${repoId}/findings/${finding.id}`, body);
      onChange(f);
      toast.success(msg);
    } catch (e) {
      toast.error('Could not update the finding', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-1.5">
        <SeverityBadge severity={finding.severity} />
        <ConfidenceBadge confidence={finding.confidence} />
        <SourceBadge source={finding.source} verified={finding.userVerified} />
        <Badge>{CATEGORY_LABEL[finding.category] ?? finding.category}</Badge>
        <StatusBadge status={finding.status} />
        {!finding.present && <Badge tone="success">No longer detected</Badge>}
      </div>
      <div>
        <h4 className="text-[15px] font-semibold leading-snug">{finding.title}</h4>
        <button className="mt-0.5 font-mono text-[12px] text-primary hover:underline disabled:no-underline disabled:text-muted" disabled={!onOpenFile} onClick={() => onOpenFile?.(finding.path, finding.line)}>
          {finding.path}
          {finding.line ? `:${finding.line}${finding.col ? `:${finding.col}` : ''}` : ''}
        </button>
        <p className="mt-0.5 font-mono text-[11px] text-subtle">
          {finding.ruleId} · {finding.tool}
        </p>
      </div>
      <p className="whitespace-pre-line leading-relaxed"><RichText text={finding.description} /></p>
      {finding.snippet && <pre className="overflow-x-auto rounded-lg border border-border bg-panel p-2.5 font-mono text-[11.5px] leading-relaxed text-muted">{finding.snippet}</pre>}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-panel p-2.5">
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Why it matters</p>
          <p className="leading-relaxed"><RichText text={finding.why} /></p>
        </div>
        <div className="rounded-lg border border-secondary/30 bg-secondary-soft/40 p-2.5">
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-secondary uppercase">Suggested fix</p>
          <p className="leading-relaxed"><RichText text={finding.fix} /></p>
        </div>
      </div>
      {finding.source === 'ai' && <p className="rounded-lg border border-primary/30 bg-primary-soft/40 px-2.5 py-2 text-[12px]"><Sparkles size={12} className="mr-1 inline text-primary" />Suggested by the local AI model — not verified. Confirm it in the code before acting.</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={finding.status === 'reviewed' ? 'primary' : 'secondary'} icon={Eye} disabled={busy} onClick={() => patch({ status: 'reviewed' }, 'Marked as reviewed')}>Reviewed</Button>
        <Button size="sm" variant={finding.status === 'fixed' ? 'success' : 'secondary'} icon={CheckCircle2} disabled={busy} onClick={() => patch({ status: 'fixed' }, 'Marked as fixed')}>Fixed</Button>
        <Button size="sm" variant={finding.status === 'dismissed' ? 'primary' : 'secondary'} icon={EyeOff} disabled={busy} onClick={() => patch({ status: 'dismissed' }, 'Dismissed as false positive')}>False positive</Button>
        {finding.status !== 'open' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => patch({ status: 'open' }, 'Re-opened')}>Re-open</Button>}
        <Button size="sm" variant="ghost" icon={UserCheck} disabled={busy} onClick={() => patch({ userVerified: !finding.userVerified }, finding.userVerified ? 'Verification removed' : 'Marked as verified by you')}>{finding.userVerified ? 'Unverify' : 'I verified this'}</Button>
        {onAsk && <Button size="sm" variant="ghost" icon={Bot} onClick={() => onAsk(finding)}>Ask AI</Button>}
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-semibold tracking-wide text-muted uppercase" htmlFor={`note-${finding.id}`}>Notes</label>
        <Textarea id={`note-${finding.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why it was dismissed, who will fix it…" />
        {note !== finding.note && (
          <Button className="mt-1.5" size="xs" variant="primary" disabled={busy} onClick={() => patch({ note }, 'Note saved')}>Save note</Button>
        )}
      </div>
    </div>
  );
}
