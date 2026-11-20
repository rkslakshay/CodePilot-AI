import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { Activity, ArrowLeft, Bot, Bug, FileCode2, FileText, FolderGit2, Gauge, GitBranch, LayoutDashboard, ListChecks, Package, RefreshCw, Shapes, ShieldAlert, Timer, Trash2, Wrench, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, EmptyState, Skeleton } from '@/components/ui/primitives';
import { confirmAction, toast } from '@/components/ui/overlay';
import { cn, timeAgo } from '@/lib/utils';
import { fmtBytes, fmtNum, CATEGORY_LABEL, type RepoStats, type RepoSummary } from '@/lib/repo';
import { BarList, JobProgress, Panel, ScoreRing, SeverityBar, useJob } from '@/components/repo/ui';
import { FilesSection, FindingsSection, ReviewSection, ComplexitySection, DependenciesSection, DebtSection, GitSection, ReportsSection } from '@/components/repo/sections';

interface Overview {
  repo: RepoSummary;
  stats: RepoStats | null;
  events: { id: number; kind: string; message: string; createdAt: string }[];
}

export const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'files', label: 'File Explorer', icon: FileCode2 },
  { id: 'review', label: 'Code Review', icon: Bot },
  { id: 'bugs', label: 'Bug Detection', icon: Bug },
  { id: 'security', label: 'Security Scanner', icon: ShieldAlert },
  { id: 'complexity', label: 'Complexity', icon: Gauge },
  { id: 'dependencies', label: 'Dependencies', icon: Package },
  { id: 'debt', label: 'Technical Debt', icon: Wrench },
  { id: 'git', label: 'Git Changes', icon: GitBranch },
  { id: 'findings', label: 'All Findings', icon: ListChecks },
  { id: 'reports', label: 'Reports', icon: FileText },
];

export default function RepoWorkspace() {
  const { id: idParam, section = 'overview' } = useParams();
  const id = Number(idParam);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const nav = useNavigate();
  const load = useCallback(
    () =>
      api
        .get<Overview>(`/repos/${id}`)
        .then((d) => {
          setData(d);
          setError('');
          if (d.repo.job?.status === 'running') setJobId(d.repo.job.id);
        })
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const job = useJob(jobId, (j) => {
    setJobId(null);
    if (j.status === 'done') toast.success('Analysis complete');
    else if (j.status === 'cancelled') toast.info('Analysis cancelled', 'Previous results were kept.');
    else toast.error('Analysis failed', j.error ?? '');
    setVersion((v) => v + 1);
    void load();
  });
  const reanalyse = async () => {
    try {
      const j = await api.post<{ id: string }>(`/repos/${id}/analyze`);
      setJobId(j.id);
    } catch (e) {
      toast.error('Could not start the analysis', (e as Error).message);
    }
  };
  const remove = async () => {
    if (!data) return;
    const ok = await confirmAction({
      title: `Remove “${data.repo.name}” from CodePilot?`,
      description: data.repo.source === 'zip' ? 'Its findings, notes and CodePilot’s unpacked copy of the archive are deleted.' : 'Its findings and notes are deleted. Your project folder on disk is not touched.',
      confirmLabel: 'Remove repository',
    });
    if (!ok) return;
    await api.del(`/repos/${id}?confirm=yes`);
    toast.success('Repository removed');
    nav('/repos');
  };

  if (error) return <Alert tone="danger" title="Repository unavailable" action={<Button size="sm" onClick={() => nav('/repos')}>All repositories</Button>}>{error}</Alert>;
  if (!data) return <Skeleton className="h-96 rounded-xl" />;
  const { repo } = data;
  const running = job?.status === 'running' ? job : null;
  const valid = SECTIONS.some((s) => s.id === section);

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/repos" className="grid h-9 w-9 place-items-center rounded-lg border border-border text-muted hover:text-fg" aria-label="All repositories">
          <ArrowLeft size={16} />
        </Link>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary-soft text-primary"><FolderGit2 size={20} /></span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{repo.name}</h1>
          <p className="truncate font-mono text-[11.5px] text-subtle" title={repo.rootPath}>
            {repo.source === 'zip' ? 'ZIP archive · managed copy' : repo.rootPath} · {repo.analyzedAt ? `analysed ${timeAgo(repo.analyzedAt)}` : 'not analysed'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={RefreshCw} onClick={reanalyse} loading={!!running}>Re-run analysis</Button>
          <Button variant="ghost" icon={Trash2} aria-label="Remove repository" onClick={remove}>Remove</Button>
        </div>
      </div>
      {running && <div className="mb-4"><JobProgress job={running} label="Analysing" onCancel={() => api.post(`/repos/jobs/${running.id}/cancel`)} /></div>}
      {repo.status === 'error' && !running && <Alert tone="danger" className="mb-4" title="The last analysis failed">Check the activity log on the Overview, then re-run the analysis.</Alert>}
      {repo.analysis?.complete === false && <Alert tone="warning" className="mb-4" title="Partial analysis">Not every file could be analysed (file limit reached). Results do not cover the whole repository.</Alert>}

      <div className="grid gap-4 lg:grid-cols-[208px_minmax(0,1fr)]">
        <nav aria-label="Repository sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:sticky lg:top-2 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.id}
              to={`/repos/${id}/${s.id === 'overview' ? '' : s.id}`}
              end
              className={({ isActive }) => cn('flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors', isActive || (s.id === 'overview' && section === 'overview') ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-elevated hover:text-fg')}
            >
              <s.icon size={15} />
              {s.label}
              {s.id === 'security' && data.stats?.securityFindings ? <span className="ml-auto rounded-full bg-elevated px-1.5 font-mono text-[10.5px]">{data.stats.securityFindings}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0" key={version}>
          {!repo.analyzedAt && section !== 'overview' ? (
            <Card><EmptyState icon={Timer} title="Analysis not finished" description="Results appear here when the analysis has completed." /></Card>
          ) : !valid ? (
            <Card><EmptyState icon={FolderGit2} title="Unknown section" /></Card>
          ) : section === 'overview' ? (
            <OverviewSection data={data} />
          ) : section === 'files' ? (
            <FilesSection repoId={id} />
          ) : section === 'review' ? (
            <ReviewSection repoId={id} />
          ) : section === 'bugs' ? (
            <FindingsSection repoId={id} preset={{ category: 'bug,maintainability,performance,style' }} title="Bug detection" description="Correctness and maintainability findings from Tree-sitter rules, cross-file checks and the local AI review." />
          ) : section === 'security' ? (
            <FindingsSection repoId={id} preset={{ category: 'security' }} title="Security scanner" description="Hard-coded secrets, injection, unsafe execution, deserialisation, weak cryptography, XSS and unsafe configuration." security />
          ) : section === 'complexity' ? (
            <ComplexitySection repoId={id} />
          ) : section === 'dependencies' ? (
            <DependenciesSection repoId={id} />
          ) : section === 'debt' ? (
            <DebtSection repoId={id} />
          ) : section === 'git' ? (
            <GitSection repoId={id} isGit={repo.isGit} />
          ) : section === 'findings' ? (
            <FindingsSection repoId={id} title="All findings" description="Search, filter and triage every finding. Dismissed and fixed findings stay that way when the analysis is re-run." />
          ) : (
            <ReportsSection repoId={id} name={repo.name} />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewSection({ data }: { data: Overview }) {
  const { repo, stats, events } = data;
  const nav = useNavigate();
  if (!stats) return <Card><EmptyState icon={Timer} title="Waiting for the first analysis" description="The repository has been imported; statistics appear when the analysis finishes." /></Card>;
  const p = repo.profile ?? {};
  const kpi = [
    ['Files', fmtNum(stats.totalFiles), `${stats.directories} folders · ${fmtBytes(stats.totalBytes)}`],
    ['Source files', fmtNum(stats.sourceFiles), `${stats.testFiles} test · ${stats.docFiles} docs · ${stats.configFiles} config`],
    ['Lines of code', fmtNum(stats.linesOfCode), 'source + tests'],
    ['Functions · classes', `${fmtNum(stats.functions)} · ${fmtNum(stats.classes)}`, 'parsed with Tree-sitter'],
    ['Dependencies', fmtNum(stats.dependencies), `${stats.devDependencies} development`],
    ['Security findings', fmtNum(stats.securityFindings), 'open + reviewed'],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <Panel title="Code quality" icon={Gauge}>
          <div className="flex flex-col items-center text-center">
            <ScoreRing score={stats.quality.score} grade={stats.quality.grade} />
            <p className="mt-2 text-[12px] text-muted">{stats.quality.weighted} weighted findings over {stats.quality.kloc} KLOC</p>
            <details className="mt-2 text-left text-[11.5px] text-subtle">
              <summary className="cursor-pointer text-muted">How is this calculated?</summary>
              <p className="mt-1 font-mono">{stats.quality.formula}</p>
              <p className="mt-1">Dismissed and fixed findings are excluded. The score summarises static findings only; it is not a guarantee of quality or security.</p>
            </details>
          </div>
        </Panel>
        <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3">
          {kpi.map(([label, value, hint]) => (
            <Card key={label} className="p-3.5">
              <p className="text-[12px] text-muted">{label}</p>
              <p className="mt-1 font-mono text-[22px] font-semibold tabular-nums">{value}</p>
              <p className="truncate text-[11px] text-subtle" title={hint}>{hint}</p>
            </Card>
          ))}
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Issue severity" icon={ShieldAlert}>
          <SeverityBar counts={stats.findingsBySeverity} />
          <div className="mt-4">
            <BarList label="Findings by category" data={Object.entries(stats.findingsByCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: CATEGORY_LABEL[k] ?? k, value: v }))} color="var(--secondary)" />
          </div>
        </Panel>
        <Panel title="Languages (lines)" icon={FileCode2}>
          <BarList label="Lines by language" data={stats.languages.slice(0, 8).map((l) => ({ label: l.language, value: l.lines, hint: `${l.files} files` }))} />
        </Panel>
        <Panel title="Function complexity distribution" icon={Gauge}>
          <BarList label="Functions by cyclomatic complexity" data={stats.complexityDistribution.map((b, i) => ({ label: b.label, value: b.count, color: ['var(--success)', 'var(--info)', 'var(--warning)', 'var(--sev-high)', 'var(--sev-critical)'][i] }))} />
        </Panel>
        <Panel title="Files by type" icon={FolderGit2}>
          <BarList label="Files by type" data={stats.fileKinds.map((k) => ({ label: k.kind, value: k.count }))} color="var(--info)" />
          <p className="mt-3 text-[11.5px] text-subtle">{stats.binaryFiles} binary · {stats.sensitiveFiles} secret-bearing (not read) · {stats.skippedFiles} skipped (too large / unreadable) · {repo.scanInfo?.ignoredCount ?? 0} ignored paths</p>
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Project profile" icon={LayoutDashboard}>
          <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px]">
            <dt className="text-muted">Project type</dt>
            <dd>{(p.projectTypes ?? []).join(', ') || '—'}</dd>
            <dt className="text-muted">Frameworks</dt>
            <dd className="flex flex-wrap gap-1">{(p.frameworks ?? []).length ? p.frameworks.map((f: { name: string; evidence: string }) => <span key={f.name} title={f.evidence}><Badge>{f.name}</Badge></span>) : '—'}</dd>
            <dt className="text-muted">Package managers</dt>
            <dd>{(repo.analysis?.managers ?? []).join(', ') || '—'}</dd>
            <dt className="text-muted">Entry points</dt>
            <dd className="min-w-0">{(p.entryPoints ?? []).slice(0, 6).map((e: { path: string; reason: string }) => <p key={e.path + e.reason} className="truncate font-mono text-[11.5px]" title={e.reason}>{e.path}</p>)}{!(p.entryPoints ?? []).length && '—'}</dd>
            <dt className="text-muted">Tests</dt>
            <dd className="font-mono text-[11.5px]">{(p.testDirs ?? []).join(', ') || 'none found'}</dd>
            <dt className="text-muted">Build config</dt>
            <dd className="font-mono text-[11.5px] break-words">{(p.buildConfig ?? []).slice(0, 8).join(', ') || '—'}</dd>
            <dt className="text-muted">Documentation</dt>
            <dd className="font-mono text-[11.5px] break-words">{(p.docs ?? []).slice(0, 6).join(', ') || 'none'}</dd>
          </dl>
        </Panel>
        <Panel title="Recent activity" icon={Activity}>
          <ul className="space-y-2.5 text-[12.5px]">
            {events.map((e) => (
              <li key={e.id} className="flex gap-2.5">
                <Badge>{e.kind}</Badge>
                <span className="min-w-0 flex-1">{e.message}</span>
                <span className="shrink-0 text-[11px] text-subtle">{timeAgo(e.createdAt)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] text-subtle">Last analysis took {Math.round((repo.analysis?.durationMs ?? 0) / 100) / 10} s · {repo.analysis?.tools?.treeSitter} · {repo.analysis?.tools?.codepilotRules} rules</p>
        </Panel>
      </div>
      <Panel title="Quick actions" icon={ListChecks}>
        <div className="flex flex-wrap gap-2">
          <Button icon={ShieldAlert} onClick={() => nav(`/repos/${repo.id}/security`)}>Review security findings</Button>
          <Button icon={Bot} onClick={() => nav(`/repos/${repo.id}/review`)}>AI code review</Button>
          <Button icon={Wrench} onClick={() => nav(`/repos/${repo.id}/debt`)}>Technical debt</Button>
          {repo.isGit && <Button icon={GitBranch} onClick={() => nav(`/repos/${repo.id}/git`)}>Review Git changes</Button>}
          <Button icon={FileText} onClick={() => nav(`/repos/${repo.id}/reports`)}>Export report</Button>
          <Button icon={Shapes} onClick={() => nav(`/uml?generate=repository&repoId=${repo.id}`)}>UML diagrams</Button>
        </div>
      </Panel>
    </div>
  );
}
