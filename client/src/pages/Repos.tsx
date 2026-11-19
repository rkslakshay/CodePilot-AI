import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FileArchive, FolderGit2, FolderOpen, GitBranch, HardDrive, Import, Lock, Plus, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Segmented, Skeleton } from '@/components/ui/primitives';
import { Dialog, toast } from '@/components/ui/overlay';
import { cn, timeAgo } from '@/lib/utils';
import { fmtBytes, fmtNum, type Job, type RepoSummary } from '@/lib/repo';
import { SeverityBar, useJob, JobProgress } from '@/components/repo/ui';

interface Capabilities {
  tools: { id: string; name: string; available: boolean; version: string | null; runs: boolean; note: string; install: string }[];
  git: { available: boolean; version: string | null };
  pdf: { available: boolean; engine: string | null };
  limits: { zipMaxMb: number; maxFiles: number; maxFileKb: number };
  defaultIgnores: string[];
}

export default function Repos() {
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const load = () => api.get<RepoSummary[]>('/repos').then(setRepos).catch(() => setRepos([]));
  useEffect(() => {
    void load();
    api.get<Capabilities>('/repos/capabilities').then(setCaps).catch(() => undefined);
  }, []);
  return (
    <div>
      <PageHeader
        title="Repository Analyzer"
        icon={FolderGit2}
        description="Import a whole project and get code review, bug and security findings, complexity, dependencies, technical debt, Git change review and reports — all on this computer."
        actions={<Button variant="primary" icon={Import} onClick={() => setImportOpen(true)}>Import repository</Button>}
      />
      <Alert tone="info" icon={ShieldCheck} className="mb-4" title="Imported code is never executed">
        CodePilot only reads files. Folders are analysed in place and never modified; ZIP archives are unpacked into CodePilot's own storage. Secret files (.env, keys) are never displayed, sent to the AI model or copied into reports.
      </Alert>
      {!repos ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>
      ) : repos.length === 0 ? (
        <Card>
          <EmptyState icon={FolderGit2} title="No repositories yet" description="Import a local project folder or a ZIP archive (for example GitHub's “Download ZIP”) to start the analysis." action={<Button variant="primary" icon={Plus} onClick={() => setImportOpen(true)}>Import repository</Button>} />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {repos.map((r) => (
            <Link key={r.id} to={`/repos/${r.id}`} className="group block min-w-0" aria-label={`Open ${r.name}`}>
              <Card className="flex h-full flex-col p-4 transition-colors group-hover:border-primary/40">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">{r.source === 'zip' ? <FileArchive size={17} /> : <FolderOpen size={17} />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-semibold group-hover:text-primary">{r.name}</p>
                    <p className="truncate font-mono text-[11px] text-subtle" title={r.rootPath}>{r.source === 'zip' ? 'ZIP archive (managed copy)' : r.rootPath}</p>
                  </div>
                  {r.analysis?.stats && <QualityPill score={r.analysis.stats.quality.score} grade={r.analysis.stats.quality.grade} />}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.status === 'analyzing' && <Badge tone="info">Analysing…</Badge>}
                  {r.status === 'error' && <Badge tone="danger">Analysis failed</Badge>}
                  {r.isGit && <Badge icon={GitBranch}>Git</Badge>}
                  {(r.analysis?.stats?.languages ?? []).slice(0, 3).map((l: { language: string }) => <Badge key={l.language}>{l.language}</Badge>)}
                </div>
                <p className="mt-3 text-[12px] text-muted">
                  {fmtNum(r.fileCount)} files · {fmtNum(r.linesOfCode)} lines · {fmtBytes(r.sizeBytes)}
                </p>
                {r.analysis?.stats && <SeverityBar className="mt-3" counts={r.analysis.stats.findingsBySeverity} />}
                <p className="mt-auto pt-3 text-[11px] text-subtle">{r.analyzedAt ? `Analysed ${timeAgo(r.analyzedAt)}` : 'Not analysed yet'}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {caps && <ToolsCard caps={caps} />}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} limits={caps?.limits} onImported={load} />
    </div>
  );
}

export function QualityPill({ score, grade }: { score: number; grade: string }) {
  const tone = score >= 75 ? 'text-success border-success/40 bg-success-soft' : score >= 50 ? 'text-warning border-warning/40 bg-warning-soft' : 'text-danger border-danger/40 bg-danger-soft';
  return (
    <span className={cn('shrink-0 rounded-lg border px-2 py-1 text-center leading-none', tone)} title="Quality score (see Overview for the formula)">
      <span className="block font-mono text-[15px] font-bold">{score}</span>
      <span className="text-[10px]">grade {grade}</span>
    </span>
  );
}

function ToolsCard({ caps }: { caps: Capabilities }) {
  return (
    <Card className="mt-5 p-4">
      <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold"><HardDrive size={15} className="text-muted" /> Analysis engines on this computer</p>
      <ul className="grid gap-2 text-[12.5px] sm:grid-cols-2 xl:grid-cols-3">
        <li className="rounded-lg border border-border p-2.5"><b>CodePilot static analysis</b> — Tree-sitter rules for JS, TS, Python, Java, C and C++ plus security patterns. <Badge tone="success">built in</Badge></li>
        <li className="rounded-lg border border-border p-2.5"><b>Git</b> — {caps.git.available ? <>{caps.git.version} <Badge tone="success">available</Badge></> : <>not found. Install Git for Windows (free) for the Git Changes section.</>}</li>
        <li className="rounded-lg border border-border p-2.5"><b>PDF reports</b> — {caps.pdf.available ? <>{caps.pdf.engine} <Badge tone="success">available</Badge></> : 'Microsoft Edge / Chrome not found; Markdown export still works.'}</li>
        {caps.tools.map((t) => (
          <li key={t.id} className="rounded-lg border border-border p-2.5">
            <b>{t.name}</b> — {t.available ? <>{t.version} <Badge tone={t.runs ? 'success' : 'neutral'}>{t.runs ? 'used' : 'detected, not run'}</Badge></> : <>not installed (optional: <code className="font-mono text-[11.5px]">{t.install}</code>)</>}
            <p className="mt-1 text-[11.5px] text-subtle">{t.note}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ImportDialog({ open, onClose, onImported, limits }: { open: boolean; onClose: () => void; onImported: () => void; limits?: Capabilities['limits'] }) {
  const [mode, setMode] = useState<'folder' | 'zip'>('folder');
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const [job, setJob] = useState<{ id: string; repoId: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const live = useJob(job?.id, (j: Job) => {
    if (j.status === 'done') toast.success('Analysis complete');
    onImported();
    if (job) nav(`/repos/${job.repoId}`);
  });
  useEffect(() => {
    if (!open) {
      setError('');
      setJob(null);
      setBusy(false);
    }
  }, [open]);
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r =
        mode === 'folder'
          ? await api.post<{ repo: RepoSummary; job: Job }>('/repos/import/folder', { path, name: name || undefined })
          : await api.upload<{ repo: RepoSummary; job: Job }>(`/repos/import/zip${name ? `?name=${encodeURIComponent(name)}` : ''}`, file!);
      setJob({ id: r.job.id, repoId: r.repo.id });
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'already_imported' ? `${e.message}` : (e as Error).message);
      setBusy(false);
    }
  };
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/\.zip$/i.test(f.name)) return setError('Choose a .zip archive.');
    if (limits && f.size > limits.zipMaxMb * 1024 * 1024) return setError(`The archive is larger than ${limits.zipMaxMb} MB.`);
    setError('');
    setFile(f);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Import a repository"
      description="Analysis starts automatically after the import."
      footer={
        !job && (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" icon={Upload} loading={busy} disabled={mode === 'folder' ? !path.trim() : !file} onClick={submit}>Import and analyse</Button>
          </>
        )
      }
    >
      {live && live.status === 'running' ? (
        <JobProgress job={live} label="Analysing repository" />
      ) : (
        <div className="space-y-4">
          <Segmented value={mode} onChange={setMode} options={[{ value: 'folder', label: 'Local folder', icon: FolderOpen }, { value: 'zip', label: 'ZIP archive', icon: FileArchive }]} />
          {mode === 'folder' ? (
            <Field label="Folder path" htmlFor="repo-path" hint="Paste the full path, e.g. C:\Users\you\projects\my-app (in Explorer: Shift + right-click the folder → Copy as path). The folder is read in place and never modified.">
              <Input id="repo-path" value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\Users\you\projects\my-app" className="font-mono text-[13px]" autoFocus onKeyDown={(e) => e.key === 'Enter' && path.trim() && submit()} />
            </Field>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose or drop a ZIP archive"
              onClick={() => input.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                pick(e.dataTransfer.files[0]);
              }}
              className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors', drag ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong')}
            >
              <FileArchive size={26} className="text-muted" />
              {file ? <p className="text-[13px] font-medium">{file.name} <span className="text-muted">({fmtBytes(file.size)})</span></p> : <p className="text-[13px]">Drop a .zip here or <span className="text-primary">browse</span></p>}
              <p className="text-[11.5px] text-subtle">Up to {limits?.zipMaxMb ?? 100} MB. Unsafe entries (path traversal, links, encryption) reject the whole archive.</p>
              <input ref={input} type="file" accept=".zip,application/zip" className="hidden" aria-hidden tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
            </div>
          )}
          <Field label="Display name (optional)" htmlFor="repo-name">
            <Input id="repo-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the folder / archive name" />
          </Field>
          <p className="flex items-start gap-1.5 text-[11.5px] text-subtle"><Lock size={12} className="mt-0.5 shrink-0" />Skipped automatically: .git, node_modules, dist, build, virtualenvs, caches, files ignored by .gitignore, binaries and files over {limits?.maxFileKb ?? 1024} KB.</p>
          {error && <Alert tone="danger" title="Import failed">{error}</Alert>}
          {live && live.status !== 'running' && live.status !== 'done' && <Alert tone="warning" icon={RefreshCw} title={`Analysis ${live.status}`}>{live.error}</Alert>}
        </div>
      )}
    </Dialog>
  );
}
