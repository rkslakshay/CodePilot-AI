/** Repository Analyzer sections (rendered inside the repository workspace). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, Bot, ChevronDown, ChevronRight, Download, FileCode2, FileText, Folder, FolderOpen, GitBranch, GitCommit, Lock, MessageSquare, Package, RefreshCw, Search, Send, ShieldAlert, Sparkles, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Skeleton, Spinner, Textarea } from '@/components/ui/primitives';
import { toast } from '@/components/ui/overlay';
import { EngineBadge } from '@/components/common';
import { CodeEditor } from '@/components/code/CodeEditor';
import type { Lang } from '@/lib/types';
import { CATEGORY_LABEL, SEV_COLOR, SEVERITIES, monacoId, fmtNum, type Finding, type ReviewItem, type ReviewResult, type Severity, type TreeFile } from '@/lib/repo';
import { BarList, FindingDetail, JobProgress, Panel, SeverityBadge, ConfidenceBadge, SourceBadge, useJob } from './ui';

const useOpenFile = (repoId: number) => {
  const nav = useNavigate();
  return (path: string, line?: number | null) => nav(`/repos/${repoId}/files?path=${encodeURIComponent(path)}${line ? `&line=${line}` : ''}`);
};
const worst = (f: Partial<Record<Severity, number>>) => SEVERITIES.find((s) => (f[s] ?? 0) > 0) ?? null;

// =================================================================== File Explorer
interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
  file?: TreeFile;
  counts: Partial<Record<Severity, number>>;
}
function buildTree(files: TreeFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', dir: true, children: [], counts: {} };
  for (const f of files) {
    let cur = root;
    const parts = f.path.split('/');
    parts.forEach((part, i) => {
      for (const s of SEVERITIES) if (f.findings[s]) cur.counts[s] = (cur.counts[s] ?? 0) + f.findings[s]!;
      const last = i === parts.length - 1;
      let next = cur.children.find((c) => c.name === part && c.dir === !last);
      if (!next) {
        next = { name: part, path: parts.slice(0, i + 1).join('/'), dir: !last, children: [], counts: {}, file: last ? f : undefined };
        cur.children.push(next);
      }
      if (last) next.counts = { ...f.findings };
      cur = next;
    });
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

export function FilesSection({ repoId }: { repoId: number }) {
  const [files, setFiles] = useState<TreeFile[] | null>(null);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set(['']));
  const selected = params.get('path');
  const line = Number(params.get('line')) || null;
  useEffect(() => {
    api.get<TreeFile[]>(`/repos/${repoId}/files`).then(setFiles).catch(() => setFiles([]));
  }, [repoId]);
  useEffect(() => {
    if (!selected) return;
    const parts = selected.split('/');
    setOpen((o) => new Set([...o, ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))]));
  }, [selected]);
  const tree = useMemo(() => buildTree((files ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase()))), [files, filter]);
  if (!files) return <Skeleton className="h-96 rounded-xl" />;
  const select = (p: string) => setParams({ path: p });
  const renderNode = (n: TreeNode, depth: number): React.ReactNode =>
    n.children.map((c) => {
      const w = worst(c.counts);
      const isOpen = open.has(c.path) || !!filter;
      return (
        <li key={c.path}>
          <button
            onClick={() => (c.dir ? setOpen((o) => { const x = new Set(o); if (x.has(c.path)) x.delete(c.path); else x.add(c.path); return x; }) : select(c.path))}
            className={cn('flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[12.5px] hover:bg-elevated', selected === c.path && 'bg-primary-soft text-primary')}
            style={{ paddingLeft: 6 + depth * 12 }}
            aria-expanded={c.dir ? isOpen : undefined}
            title={c.file?.skipped ?? c.path}
          >
            {c.dir ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="w-[13px]" />}
            {c.dir ? (isOpen ? <FolderOpen size={14} className="text-warning" /> : <Folder size={14} className="text-warning" />) : c.file?.sensitive ? <Lock size={14} className="text-danger" /> : <FileCode2 size={14} className="text-muted" />}
            <span className={cn('min-w-0 flex-1 truncate', c.file?.skipped && 'text-subtle')}>{c.name}</span>
            {w && (
              <>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEV_COLOR[w] }} aria-hidden />
                <span className="sr-only">, most severe finding: {w}</span>
              </>
            )}
          </button>
          {c.dir && isOpen && <ul>{renderNode(c, depth + 1)}</ul>}
        </li>
      );
    });
  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
      <Card className="flex max-h-[75vh] min-h-[300px] flex-col overflow-hidden">
        <div className="border-b border-border p-2">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files…" aria-label="Filter files" className="h-8 text-[12.5px]" />
        </div>
        <ul className="min-h-0 flex-1 overflow-auto p-1.5" aria-label="Repository files">{renderNode(tree, 0)}</ul>
        <p className="border-t border-border px-3 py-2 text-[11px] text-subtle">{files.length} files · ignored folders are not listed</p>
      </Card>
      {selected ? <FileViewer repoId={repoId} path={selected} line={line} /> : <Card><EmptyState icon={FileCode2} title="Select a file" description="Source is shown read-only with findings marked in the editor." /></Card>}
    </div>
  );
}

interface FileData {
  path: string;
  language: string | null;
  lines: number;
  content: string;
  changedSinceAnalysis: boolean;
  metrics: { functions?: { name: string; line: number; endLine: number; complexity: number; nesting: number; length: number }[] };
  findings: Finding[];
}
function FileViewer({ repoId, path, line }: { repoId: number; path: string; line: number | null }) {
  const [file, setFile] = useState<FileData | null>(null);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Finding | null>(null);
  const [hl, setHl] = useState<number | null>(line);
  const nav = useNavigate();
  useEffect(() => {
    setFile(null);
    setError('');
    setSel(null);
    api.get<FileData>(`/repos/${repoId}/file?path=${encodeURIComponent(path)}`).then(setFile).catch((e) => setError(e.message));
  }, [repoId, path]);
  useEffect(() => setHl(line), [line, path]);
  if (error) return <Alert tone="warning" icon={Lock} title={path}>{error}</Alert>;
  if (!file) return <Skeleton className="h-96 rounded-xl" />;
  const markers = file.findings.filter((f) => f.line).map((f) => ({ line: f.line!, message: `[${f.severity}] ${f.title}: ${f.description}`, severity: (f.severity === 'critical' || f.severity === 'high' ? 'error' : f.severity === 'medium' ? 'warning' : 'info') as 'error' | 'warning' | 'info' }));
  return (
    <div className="min-w-0 space-y-3">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <FileCode2 size={15} className="text-muted" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{file.path}</span>
          <Badge>{file.language ?? 'text'}</Badge>
          <span className="text-[11.5px] text-subtle">{fmtNum(file.lines)} lines</span>
          <Button size="xs" icon={Bot} onClick={() => nav(`/repos/${repoId}/review?path=${encodeURIComponent(path)}`)}>Review with AI</Button>
        </div>
        {file.changedSinceAnalysis && <p className="border-b border-warning/30 bg-warning-soft px-3 py-1.5 text-[11.5px]">This file changed on disk after the last analysis; line numbers of findings may be out of date.</p>}
        <div className="h-[56vh] min-h-[320px]">
          <CodeEditor value={file.content} language={monacoId(file.language) as Lang} readOnly markers={markers} highlightLine={hl} ariaLabel={`Source of ${file.path}`} />
        </div>
      </Card>
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title={`Findings in this file (${file.findings.length})`} icon={ShieldAlert}>
          {file.findings.length ? (
            <ul className="max-h-80 space-y-1 overflow-auto">
              {file.findings.map((f) => (
                <li key={f.id}>
                  <button onClick={() => { setSel(f); setHl(f.line); }} className={cn('flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] hover:bg-elevated', sel?.id === f.id && 'bg-elevated')}>
                    <SeverityBadge severity={f.severity} />
                    <span className="min-w-0 flex-1"><span className="font-medium">{f.title}</span><span className="block truncate text-[11.5px] text-muted">{f.description}</span></span>
                    <span className="shrink-0 font-mono text-[11px] text-subtle">{f.line ? `L${f.line}` : '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted">No findings for this file.</p>
          )}
        </Panel>
        {sel ? (
          <Panel title="Finding" icon={AlertTriangle} actions={<Button size="xs" variant="ghost" onClick={() => setSel(null)}>Close</Button>}>
            <FindingDetail repoId={repoId} finding={sel} onChange={(f) => { setSel(f); setFile((x) => x && { ...x, findings: x.findings.map((y) => (y.id === f.id ? f : y)) }); }} />
          </Panel>
        ) : (
          <Panel title={`Functions (${file.metrics.functions?.length ?? 0})`} icon={FileCode2}>
            <ul className="max-h-80 overflow-auto text-[12.5px]">
              {(file.metrics.functions ?? []).map((fn) => (
                <li key={`${fn.name}${fn.line}`}>
                  <button className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-elevated" onClick={() => setHl(fn.line)}>
                    <span className="min-w-0 flex-1 truncate font-mono">{fn.name}()</span>
                    <span className={cn('font-mono text-[11px]', fn.complexity > 15 ? 'text-danger' : fn.complexity > 10 ? 'text-warning' : 'text-subtle')} title="cyclomatic complexity">cc {fn.complexity}</span>
                    <span className="w-12 text-right font-mono text-[11px] text-subtle">L{fn.line}</span>
                  </button>
                </li>
              ))}
              {!file.metrics.functions?.length && <li className="text-muted">No functions parsed in this file.</li>}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}

// =================================================================== Findings (bugs / security / all)
export function FindingsSection({ repoId, preset, title, description, security }: { repoId: number; preset?: { category?: string }; title: string; description: string; security?: boolean }) {
  const [items, setItems] = useState<Finding[] | null>(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [sev, setSev] = useState<Set<Severity>>(new Set());
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('open,reviewed');
  const [source, setSource] = useState('');
  const [confidence, setConfidence] = useState('');
  const [sort, setSort] = useState('severity');
  const [limit, setLimit] = useState(100);
  const [sel, setSel] = useState<Finding | null>(null);
  const [ask, setAsk] = useState<Finding | null>(null);
  const openFile = useOpenFile(repoId);
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const q = new URLSearchParams({ limit: String(limit), sort });
    if (search) q.set('search', search);
    if (sev.size) q.set('severity', [...sev].join(','));
    const cat = category || preset?.category;
    if (cat) q.set('category', cat);
    if (status) q.set('status', status);
    if (source) q.set('source', source);
    if (confidence) q.set('confidence', confidence);
    const t = setTimeout(() => {
      api.get<{ total: number; items: Finding[] }>(`/repos/${repoId}/findings?${q}`).then((r) => {
        setItems(r.items);
        setTotal(r.total);
      }).catch(() => setItems([]));
    }, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [repoId, search, sev, category, status, source, confidence, sort, limit, preset?.category]);
  const choose = (f: Finding) => {
    setSel(f);
    setTimeout(() => detailRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
  };
  return (
    <div className="min-w-0 space-y-3">
      <div>
        <h2 className="text-[17px] font-semibold">{title}</h2>
        <p className="text-[12.5px] text-muted">{description}</p>
      </div>
      {security && (
        <Alert tone="warning" icon={ShieldAlert} title="Static analysis cannot prove that code is secure">
          These rules find common dangerous patterns. They can miss vulnerabilities and report false positives — an empty list does not mean the repository is secure. Secret values are always redacted.
        </Alert>
      )}
      <Card className="space-y-2.5 p-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, description, file, rule, notes…" aria-label="Search findings" className="pl-8" />
          </div>
          {!preset?.category && (
            <Select aria-label="Filter by category" className="w-[170px]" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
          <Select aria-label="Filter by status" className="w-[170px]" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="open,reviewed">Open + reviewed</option>
            <option value="open">Open</option>
            <option value="reviewed">Reviewed</option>
            <option value="dismissed">Dismissed</option>
            <option value="fixed">Fixed</option>
            <option value="">Any status</option>
          </Select>
          <Select aria-label="Filter by source" className="w-[150px]" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            <option value="static">Static analysis</option>
            <option value="combined">Static + AI</option>
            <option value="ai">Local AI review</option>
            <option value="tool">External tools</option>
          </Select>
          <Select aria-label="Filter by confidence" className="w-[170px]" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            <option value="">Any confidence</option>
            <option value="high">High confidence</option>
            <option value="medium">Medium confidence</option>
            <option value="low">Low confidence</option>
          </Select>
          <Select aria-label="Sort findings" className="w-[150px]" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="severity">Sort: severity</option>
            <option value="confidence">Sort: confidence</option>
            <option value="path">Sort: file</option>
            <option value="newest">Sort: newest</option>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by severity">
          {SEVERITIES.map((s) => (
            <button key={s} aria-pressed={sev.has(s)} onClick={() => setSev((x) => { const n = new Set(x); if (n.has(s)) n.delete(s); else n.add(s); return n; })} className={cn('rounded-md transition-opacity', sev.size && !sev.has(s) && 'opacity-40')}>
              <SeverityBadge severity={s} />
            </button>
          ))}
          <span className="ml-auto text-[12px] text-muted">{total} finding{total === 1 ? '' : 's'}</span>
        </div>
      </Card>
      <div className="grid min-w-0 gap-3 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <Card className="min-w-0 overflow-hidden">
          {!items ? (
            <div className="space-y-2 p-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : !items.length ? (
            <EmptyState icon={ShieldAlert} title="No findings match" description={security ? 'No security patterns matched with these filters. This is not proof of security.' : 'Try clearing a filter.'} />
          ) : (
            <ul className="divide-y divide-border" aria-label="Findings">
              {items.map((f) => (
                <li key={f.id}>
                  <button onClick={() => choose(f)} className={cn('flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-elevated/60', sel?.id === f.id && 'bg-primary-soft/40')} style={{ borderLeft: `3px solid ${SEV_COLOR[f.severity]}` }}>
                    <SeverityBadge severity={f.severity} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{f.title}</span>
                      <span className="block truncate text-[12px] text-muted">{f.description}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[11px] text-subtle">{f.path}{f.line ? `:${f.line}` : ''}</span>
                        {f.source !== 'static' && <SourceBadge source={f.source} verified={f.userVerified} />}
                        {f.status !== 'open' && <Badge>{f.status}</Badge>}
                      </span>
                    </span>
                    <span className="hidden shrink-0 sm:block"><ConfidenceBadge confidence={f.confidence} /></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {items && items.length < total && (
            <div className="border-t border-border p-2 text-center">
              <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + 100)}>Show more ({total - items.length} remaining)</Button>
            </div>
          )}
        </Card>
        <div ref={detailRef} className="min-w-0">
          {sel ? (
            <Panel title="Finding details" icon={AlertTriangle} className="2xl:sticky 2xl:top-2" actions={<Button size="xs" variant="ghost" onClick={() => setSel(null)}>Close</Button>}>
              <FindingDetail
                repoId={repoId}
                finding={sel}
                onChange={(f) => {
                  setSel(f);
                  // a finding triaged out of the current status filter leaves the list
                  const hidden = !!status && !status.split(',').includes(f.status);
                  setItems((x) => x && (hidden ? x.filter((y) => y.id !== f.id) : x.map((y) => (y.id === f.id ? f : y))));
                  if (hidden) setTotal((t) => Math.max(0, t - 1));
                }}
                onOpenFile={openFile}
                onAsk={setAsk}
              />
            </Panel>
          ) : (
            <Card className="hidden 2xl:block"><EmptyState icon={AlertTriangle} title="Select a finding" description="See why it matters, the suggested fix, and mark it reviewed, fixed or a false positive." /></Card>
          )}
        </div>
      </div>
      {ask && <AskPanel repoId={repoId} finding={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// =================================================================== AI review + Q&A
interface Conversation {
  q: string;
  a: string | null;
  engine?: ReviewResult['engine'];
  sources: { path: string; startLine: number; endLine: number }[];
}
function useAsk(repoId: number) {
  const [log, setLog] = useState<Conversation[]>([]);
  const [busy, setBusy] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const ask = async (q: string, extra: { findingId?: number; path?: string } = {}) => {
    ctl.current = new AbortController();
    setBusy(true);
    try {
      const r = await api.post<{ answer: string | null; engine: ReviewResult['engine']; sources: Conversation['sources'] }>(`/repos/${repoId}/ask`, { question: q, ...extra }, ctl.current.signal);
      setLog((l) => [...l, { q, a: r.answer, engine: r.engine, sources: r.sources }]);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('Question failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { log, busy, ask, cancel: () => ctl.current?.abort() };
}
function Conversation({ log, openFile }: { log: Conversation[]; openFile: (p: string, l?: number | null) => void }) {
  return (
    <ul className="space-y-3">
      {log.map((c, i) => (
        <li key={i} className="space-y-1.5 text-[13px]">
          <p className="font-medium"><MessageSquare size={13} className="mr-1.5 inline text-primary" />{c.q}</p>
          {c.engine && <EngineBadge engine={c.engine} />}
          {c.a ? <p className="whitespace-pre-line rounded-lg border border-border bg-panel p-2.5 leading-relaxed">{c.a}</p> : <p className="rounded-lg border border-warning/30 bg-warning-soft p-2.5">{c.engine?.notice ?? 'Local AI is unavailable.'} The most relevant code locations are listed below.</p>}
          {!!c.sources.length && (
            <p className="flex flex-wrap gap-1.5 text-[11.5px] text-muted">
              Context used:
              {c.sources.map((s) => <button key={s.path} className="font-mono text-primary hover:underline" onClick={() => openFile(s.path, s.startLine)}>{s.path}:{s.startLine}–{s.endLine}</button>)}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
function AskPanel({ repoId, finding, onClose }: { repoId: number; finding: Finding; onClose: () => void }) {
  const { log, busy, ask, cancel } = useAsk(repoId);
  const [q, setQ] = useState('Is this a real problem here, and how should I fix it?');
  const openFile = useOpenFile(repoId);
  return (
    <Panel title={`Ask about: ${finding.title}`} icon={Bot} actions={<Button size="xs" variant="ghost" onClick={onClose}>Close</Button>}>
      <Conversation log={log} openFile={openFile} />
      <div className="mt-3 flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Follow-up question" onKeyDown={(e) => e.key === 'Enter' && !busy && q.trim().length > 2 && ask(q, { findingId: finding.id })} />
        {busy ? <Button icon={XCircle} onClick={cancel}>Cancel</Button> : <Button variant="primary" icon={Send} disabled={q.trim().length < 3} onClick={() => ask(q, { findingId: finding.id })}>Ask</Button>}
      </div>
    </Panel>
  );
}

const REVIEW_GROUPS: { key: 'bugs' | 'security' | 'performance' | 'maintainability'; label: string }[] = [
  { key: 'bugs', label: 'Potential bugs' },
  { key: 'security', label: 'Security concerns' },
  { key: 'performance', label: 'Performance' },
  { key: 'maintainability', label: 'Maintainability' },
];
export function ReviewSection({ repoId }: { repoId: number }) {
  const [files, setFiles] = useState<TreeFile[]>([]);
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState<'file' | 'function' | 'folder' | 'repo'>('file');
  const path = params.get('path') ?? '';
  const [fn, setFn] = useState('');
  const [fns, setFns] = useState<{ name: string; line: number }[]>([]);
  const [folder, setFolder] = useState('');
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [scopeResult, setScopeResult] = useState<any>(null);
  const ctl = useRef<AbortController | null>(null);
  const qa = useAsk(repoId);
  const [question, setQuestion] = useState('');
  const openFile = useOpenFile(repoId);
  useEffect(() => {
    api.get<TreeFile[]>(`/repos/${repoId}/files`).then(setFiles).catch(() => undefined);
    api.get<any>(`/repos/${repoId}/review/last`).then(setScopeResult).catch(() => undefined);
  }, [repoId]);
  useEffect(() => {
    setFn('');
    setResult(null);
    if (!path) return setFns([]);
    api.get<{ metrics: { functions?: { name: string; line: number }[] } }>(`/repos/${repoId}/file?path=${encodeURIComponent(path)}`).then((f) => setFns(f.metrics.functions ?? [])).catch(() => setFns([]));
    api.get<{ review: ReviewResult['review']; model: string; createdAt: string } | null>(`/repos/${repoId}/review/file?path=${encodeURIComponent(path)}`).then((c) => c && setResult({ engine: { kind: 'ollama', label: `Local AI (Ollama · ${c.model}) — saved ${timeAgo(c.createdAt)}` }, cached: true, aiAvailable: true, chunks: 0, review: c.review, staticFindings: [], path, scope: 'file' })).catch(() => undefined);
  }, [repoId, path]);
  const job = useJob(jobId, (j) => {
    setJobId(null);
    if (j.status === 'done') setScopeResult({ ...j.result, createdAt: new Date().toISOString() });
    else if (j.status === 'cancelled') toast.info('Review cancelled');
    else toast.error('Review failed', j.error ?? '');
  });
  const reviewable = files.filter((f) => (f.kind === 'source' || f.kind === 'test') && !f.sensitive && !f.binary && !f.skipped);
  const folders = [...new Set(reviewable.map((f) => f.path.split('/').slice(0, -1).join('/')).filter(Boolean))].sort();
  const run = async (force = false) => {
    if (scope === 'folder' || scope === 'repo') {
      try {
        const j = await api.post<{ id: string }>(`/repos/${repoId}/review/scope`, { folder: scope === 'folder' ? folder : undefined, maxFiles: 15 });
        setJobId(j.id);
      } catch (e) {
        toast.error('Could not start the review', (e as Error).message);
      }
      return;
    }
    ctl.current = new AbortController();
    setBusy(true);
    try {
      setResult(await api.post<ReviewResult>(`/repos/${repoId}/review/file`, { path, functionName: scope === 'function' ? fn : undefined, force }, ctl.current.signal));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('Review failed', (e as Error).message);
      else toast.info('Review cancelled');
    } finally {
      setBusy(false);
    }
  };
  const canRun = scope === 'repo' || (scope === 'folder' ? !!folder : scope === 'function' ? !!path && !!fn : !!path);
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold">AI code review</h2>
        <p className="text-[12.5px] text-muted">Reviews run on the local Ollama model, chunk by chunk, with secrets redacted. Results are cached until the code changes. The AI never edits your files; its suggestions are labelled and can be wrong.</p>
      </div>
      <Card className="space-y-3 p-3.5">
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Review scope" className="w-[170px]" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
            <option value="file">Single file</option>
            <option value="function">Single function</option>
            <option value="folder">Folder</option>
            <option value="repo">Whole repository</option>
          </Select>
          {(scope === 'file' || scope === 'function') && (
            <Select aria-label="File to review" className="min-w-[220px] flex-1" value={path} onChange={(e) => setParams(e.target.value ? { path: e.target.value } : {})}>
              <option value="">Choose a file…</option>
              {reviewable.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
            </Select>
          )}
          {scope === 'function' && (
            <Select aria-label="Function to review" className="w-[220px]" value={fn} onChange={(e) => setFn(e.target.value)}>
              <option value="">Choose a function…</option>
              {fns.map((f) => <option key={`${f.name}${f.line}`} value={f.name}>{f.name}() · L{f.line}</option>)}
            </Select>
          )}
          {scope === 'folder' && (
            <Select aria-label="Folder to review" className="min-w-[220px] flex-1" value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">Choose a folder…</option>
              {folders.map((f) => <option key={f} value={f}>{f}/</option>)}
            </Select>
          )}
          {busy ? <Button icon={XCircle} onClick={() => ctl.current?.abort()}>Cancel</Button> : <Button variant="primary" icon={Sparkles} disabled={!canRun || !!jobId} onClick={() => run(false)}>Run review</Button>}
          {result?.cached && !busy && (scope === 'file' || scope === 'function') && <Button variant="ghost" icon={RefreshCw} onClick={() => run(true)}>Review again</Button>}
        </div>
        {(scope === 'folder' || scope === 'repo') && <p className="text-[11.5px] text-subtle">Large scopes are never sent in one prompt: up to 15 files are reviewed one by one, highest-risk first (most severe findings and highest complexity).</p>}
        {busy && <p className="flex items-center gap-2 text-[12.5px] text-muted"><Spinner /> The local model is reviewing the code… small models can take a minute.</p>}
        {job?.status === 'running' && <JobProgress job={job} label="AI review" onCancel={() => api.post(`/repos/jobs/${job.id}/cancel`)} />}
      </Card>
      {result && (scope === 'file' || scope === 'function') && <ReviewView result={result} openFile={openFile} />}
      {(scope === 'folder' || scope === 'repo') && scopeResult && (
        <Panel title={`Last ${scopeResult.scope === 'folder' ? `folder review (${scopeResult.folder})` : 'repository review'}`} icon={Bot}>
          {!scopeResult.aiAvailable ? (
            <Alert tone="warning" title="AI review unavailable">{scopeResult.notice ?? 'Local AI is not available.'} The static analysis results are still available in the other sections.</Alert>
          ) : (
            <>
              <p className="mb-3 text-[12px] text-muted">Reviewed {scopeResult.reviewed} of {scopeResult.considered} candidate files{scopeResult.skipped ? ` (${scopeResult.skipped} lower-priority files skipped)` : ''}.</p>
              <ul className="space-y-2">
                {scopeResult.files.map((f: { path: string; summary: string; issues: number; cached: boolean }) => (
                  <li key={f.path} className="rounded-lg border border-border p-2.5 text-[12.5px]">
                    <button className="font-mono text-primary hover:underline" onClick={() => { setScope('file'); setParams({ path: f.path }); }}>{f.path}</button>
                    <span className="ml-2 text-subtle">{f.issues} issue(s){f.cached ? ' · cached' : ''}</span>
                    <p className="mt-1 text-muted">{f.summary}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      )}
      <Panel title="Ask about the repository" icon={MessageSquare}>
        <p className="mb-3 text-[12px] text-muted">Questions are answered from at most three relevant excerpts found by keyword search — never the whole repository.</p>
        <Conversation log={qa.log} openFile={openFile} />
        <div className="mt-3 flex gap-2">
          <Textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Where is user input validated? How does authentication work?" aria-label="Question about the repository" />
          {qa.busy ? <Button icon={XCircle} onClick={qa.cancel}>Cancel</Button> : <Button variant="primary" icon={Send} disabled={question.trim().length < 3} onClick={() => { void qa.ask(question); setQuestion(''); }}>Ask</Button>}
        </div>
      </Panel>
    </div>
  );
}

function ReviewView({ result, openFile }: { result: ReviewResult; openFile: (p: string, l?: number | null) => void }) {
  if (!result.aiAvailable || !result.review)
    return (
      <Panel title="Static analysis of this file (AI review unavailable)" icon={Bot}>
        <Alert tone="warning" className="mb-3" title="Local AI review was not available">{result.engine.notice ?? 'Enable Local AI in Settings to get an AI review.'}</Alert>
        <p className="mb-2 text-[12px] text-muted">{result.staticFindings.length} static finding(s) — produced by rules, not by AI:</p>
        <ul className="space-y-1">
          {result.staticFindings.map((f) => (
            <li key={f.id}><button className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] hover:bg-elevated" onClick={() => openFile(f.path, f.line)}><SeverityBadge severity={f.severity} /><span className="flex-1">{f.title}</span><span className="font-mono text-[11px] text-subtle">L{f.line ?? '—'}</span></button></li>
          ))}
        </ul>
      </Panel>
    );
  const r = result.review;
  return (
    <div className="space-y-3">
      <Panel title={`Local AI review · ${result.path}`} icon={Bot} actions={<EngineBadge engine={result.engine} />}>
        <p className="text-[13.5px] leading-relaxed">{r.summary || 'No summary returned.'}</p>
        {result.chunks > 1 && <p className="mt-1.5 text-[11.5px] text-subtle">Reviewed in {result.chunks} chunks to fit the model's context window.</p>}
        {!!r.quality.length && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Code quality observations</p>
            <ul className="list-disc space-y-0.5 pl-5 text-[13px]">{r.quality.map((q, i) => <li key={i}>{q}</li>)}</ul>
          </div>
        )}
      </Panel>
      <div className="grid gap-3 xl:grid-cols-2">
        {REVIEW_GROUPS.map((g) => (
          <Panel key={g.key} title={`${g.label} (${r[g.key].length})`} icon={g.key === 'security' ? ShieldAlert : AlertTriangle}>
            {r[g.key].length ? (
              <ul className="space-y-2">
                {r[g.key].map((it: ReviewItem, i: number) => (
                  <li key={i} className="text-[12.5px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SeverityBadge severity={it.severity} />
                      <span className="font-medium">{it.title}</span>
                      {it.line > 0 ? <button className="font-mono text-[11px] text-primary hover:underline" onClick={() => openFile(result.path, it.line)}>L{it.line}</button> : <span className="text-[11px] text-subtle">no specific line</span>}
                    </div>
                    <p className="mt-0.5 text-muted">{it.detail}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted">Nothing reported.</p>
            )}
          </Panel>
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Panel title="Best-practice recommendations" icon={Sparkles}>
          <ul className="list-disc space-y-1 pl-5 text-[12.5px]">{r.recommendations.map((x, i) => <li key={i}>{x}</li>)}{!r.recommendations.length && <li className="list-none text-muted">None.</li>}</ul>
        </Panel>
        <Panel title="Suggested improvements" icon={Sparkles}>
          <ul className="space-y-2 text-[12.5px]">{r.improvements.map((x, i) => <li key={i}><b>{x.title}</b><p className="text-muted">{x.detail}</p></li>)}{!r.improvements.length && <li className="text-muted">None.</li>}</ul>
          <p className="mt-3 text-[11.5px] text-subtle">Suggestions are never applied automatically.</p>
        </Panel>
      </div>
    </div>
  );
}

// =================================================================== Complexity
export function ComplexitySection({ repoId }: { repoId: number }) {
  const [d, setD] = useState<any>(null);
  const openFile = useOpenFile(repoId);
  useEffect(() => {
    api.get(`/repos/${repoId}/complexity`).then(setD).catch(() => setD({ error: true }));
  }, [repoId]);
  if (!d) return <Skeleton className="h-96 rounded-xl" />;
  const cc = (n: number) => <span className={cn('font-mono tabular-nums', n > 25 ? 'font-semibold text-danger' : n > 15 ? 'text-danger' : n > 10 ? 'text-warning' : '')}>{n}</span>;
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold">Complexity analysis</h2>
        <p className="text-[12.5px] text-muted">{d.method}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[['Functions', d.functions], ['Average complexity', d.averageComplexity], ['Median complexity', d.medianComplexity]].map(([k, v]) => (
          <Card key={k} className="p-3.5"><p className="text-[12px] text-muted">{k}</p><p className="font-mono text-[22px] font-semibold">{v}</p></Card>
        ))}
      </div>
      <Panel title="Distribution" icon={FileCode2}>
        <BarList label="Functions by complexity" data={d.distribution.map((b: any, i: number) => ({ label: b.label, value: b.count, color: ['var(--success)', 'var(--info)', 'var(--warning)', 'var(--sev-high)', 'var(--sev-critical)'][i] }))} />
      </Panel>
      <Panel title="Most complex functions" icon={FileCode2}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead><tr className="text-left text-[11px] text-muted uppercase"><th className="py-1.5 pr-3">Function</th><th className="pr-3">Location</th><th className="pr-3 text-right">Complexity</th><th className="pr-3 text-right">Nesting</th><th className="text-right">Lines</th></tr></thead>
            <tbody className="divide-y divide-border">
              {d.mostComplexFunctions.map((f: any) => (
                <tr key={`${f.path}${f.line}`}>
                  <td className="py-1.5 pr-3 font-mono">{f.name}()</td>
                  <td className="pr-3"><button className="font-mono text-[11.5px] text-primary hover:underline" onClick={() => openFile(f.path, f.line)}>{f.path}:{f.line}</button></td>
                  <td className="pr-3 text-right">{cc(f.complexity)}</td>
                  <td className={cn('pr-3 text-right font-mono', f.nesting > 4 && 'text-danger')}>{f.nesting}</td>
                  <td className="text-right font-mono">{f.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Most complex files (sum of function complexity)" icon={FileCode2}>
          <BarList label="Most complex files" data={d.mostComplexFiles.map((f: any) => ({ label: f.path, value: f.totalComplexity, hint: `${f.functions} functions, max ${f.maxComplexity}` }))} color="var(--warning)" />
        </Panel>
        <Panel title="Files with the most findings" icon={ShieldAlert}>
          <BarList label="Files with most findings" data={d.filesWithMostFindings.map((f: any) => ({ label: f.path, value: f.count }))} color="var(--danger)" />
        </Panel>
      </div>
      <Panel title="Potential maintainability problems" icon={AlertTriangle}>
        {d.maintainabilityConcerns.length ? (
          <ul className="space-y-1.5 text-[12.5px]">
            {d.maintainabilityConcerns.map((f: any) => (
              <li key={f.path} className="flex flex-wrap gap-2"><button className="font-mono text-primary hover:underline" onClick={() => openFile(f.path)}>{f.path}</button><span className="text-muted">{f.reasons.join(' · ')}</span></li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">No file crosses the thresholds (800 lines, complexity 15, nesting 4, 40 functions, 10 findings).</p>
        )}
      </Panel>
    </div>
  );
}

// =================================================================== Dependencies
export function DependenciesSection({ repoId }: { repoId: number }) {
  const [d, setD] = useState<any>(null);
  const [view, setView] = useState('direct');
  const [q, setQ] = useState('');
  const openFile = useOpenFile(repoId);
  useEffect(() => {
    api.get(`/repos/${repoId}/dependencies`).then(setD).catch(() => undefined);
  }, [repoId]);
  if (!d) return <Skeleton className="h-96 rounded-xl" />;
  const rows = d.dependencies.filter((x: any) => (view === 'all' || (view === 'direct' ? x.direct : view === 'dev' ? x.direct && x.dev : !x.direct)) && (!q || x.name.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold">Dependency analysis</h2>
        <p className="text-[12.5px] text-muted">Manifests: {d.manifests.join(', ') || 'none found'} · package managers: {d.managers.join(', ') || '—'}</p>
      </div>
      <Alert tone="info" icon={Package} title="Offline inspection — no vulnerability database was consulted">Versions are shown exactly as declared or locked. CodePilot does not call any package as vulnerable or outdated without a reliable source, and it does not contact package registries.</Alert>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {d.ecosystems.map((e: any) => <Card key={e.ecosystem} className="p-3.5"><p className="text-[12px] text-muted">{e.ecosystem}</p><p className="font-mono text-[20px] font-semibold">{e.direct}</p><p className="text-[11px] text-subtle">direct · {e.transitive} transitive</p></Card>)}
        {!d.ecosystems.length && <Card className="col-span-full p-4 text-[12.5px] text-muted">No dependency manifests were found.</Card>}
      </div>
      {!!d.issues.length && (
        <Panel title={`Dependency issues (${d.issues.length})`} icon={AlertTriangle}>
          <ul className="space-y-1.5 text-[12.5px]">
            {d.issues.map((i: Finding) => (
              <li key={i.id} className="flex flex-wrap items-start gap-2"><SeverityBadge severity={i.severity} /><span className="min-w-0 flex-1"><b>{i.title}</b> — {i.description}</span><button className="font-mono text-[11px] text-primary hover:underline" onClick={() => openFile(i.path, i.line)}>{i.path}{i.line ? `:${i.line}` : ''}</button><ConfidenceBadge confidence={i.confidence} /></li>
            ))}
          </ul>
        </Panel>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-border p-2.5">
          <Select aria-label="Dependency type" className="w-[170px]" value={view} onChange={(e) => setView(e.target.value)}>
            <option value="direct">Direct</option>
            <option value="dev">Development only</option>
            <option value="transitive">Transitive (lockfile)</option>
            <option value="all">All</option>
          </Select>
          <Input className="max-w-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter packages…" aria-label="Filter packages" />
          <span className="ml-auto self-center text-[12px] text-muted">{rows.length} packages</span>
        </div>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 bg-card"><tr className="text-left text-[11px] text-muted uppercase"><th className="px-3 py-2">Package</th><th className="pr-3">Declared</th><th className="pr-3">Resolved</th><th className="pr-3">Type</th><th className="pr-3">Ecosystem</th><th className="pr-3">Manifest</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.slice(0, 500).map((x: any, i: number) => (
                <tr key={`${x.manifest}${x.name}${i}`}>
                  <td className="px-3 py-1.5 font-mono">{x.name}</td>
                  <td className="pr-3 font-mono">{x.spec || '—'}</td>
                  <td className="pr-3 font-mono">{x.resolved ?? '—'}</td>
                  <td className="pr-3">{x.direct ? (x.dev ? <Badge>dev</Badge> : <Badge tone="primary">prod</Badge>) : <Badge>transitive</Badge>}</td>
                  <td className="pr-3">{x.ecosystem}</td>
                  <td className="pr-3 font-mono text-[11.5px] text-muted">{x.manifest}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// =================================================================== Technical debt
export function DebtSection({ repoId }: { repoId: number }) {
  const [d, setD] = useState<any>(null);
  const openFile = useOpenFile(repoId);
  useEffect(() => {
    api.get(`/repos/${repoId}/debt`).then(setD).catch(() => undefined);
  }, [repoId]);
  if (!d) return <Skeleton className="h-96 rounded-xl" />;
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold">Technical debt</h2>
        <p className="text-[12.5px] text-muted">{d.method}</p>
      </div>
      {!d.items.length && <Card><EmptyState icon={Sparkles} title="No technical-debt indicators found" /></Card>}
      <ol className="space-y-3">
        {d.items.map((it: any, i: number) => (
          <li key={it.id}>
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft font-mono text-[12px] font-semibold text-primary" aria-label={`Priority rank ${i + 1}`}>{i + 1}</span>
                <h3 className="min-w-0 flex-1 text-[14.5px] font-semibold">{it.title}</h3>
                <Badge tone={it.impact === 'high' ? 'danger' : it.impact === 'medium' ? 'warning' : 'neutral'}>{it.impact} impact</Badge>
                <span className="font-mono text-[11px] text-subtle" title="impact weight × log2(1 + occurrences)">priority {it.priority}</span>
              </div>
              <p className="mt-2 text-[13px]">{it.summary}</p>
              <p className="mt-1.5 text-[12.5px] text-muted"><b className="text-fg">Recommendation:</b> {it.recommendation}</p>
              <details className="mt-2">
                <summary className="cursor-pointer text-[12px] text-primary">Evidence ({it.evidence.length})</summary>
                <ul className="mt-1.5 space-y-1 text-[12px]">
                  {it.evidence.map((e: any, k: number) => (
                    <li key={k} className="flex gap-2"><button className="shrink-0 font-mono text-primary hover:underline" onClick={() => e.path !== '.' && e.path !== 'manifest' && openFile(e.path, e.line)}>{e.path}{e.line ? `:${e.line}` : ''}</button><span className="text-muted">{e.detail}</span></li>
                  ))}
                </ul>
              </details>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}

// =================================================================== Git
function DiffBlock({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="text-[12.5px] text-muted">No differences.</p>;
  return (
    <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-panel p-2.5 font-mono text-[11.5px] leading-[1.55]" aria-label="Diff">
      {diff.split('\n').map((l, i) => (
        <div key={i} className={cn(l.startsWith('+') && !l.startsWith('+++') ? 'bg-success-soft text-success' : l.startsWith('-') && !l.startsWith('---') ? 'bg-danger-soft text-danger' : l.startsWith('@@') ? 'text-info' : l.startsWith('diff ') ? 'mt-2 font-semibold text-fg' : 'text-muted')}>{l || ' '}</div>
      ))}
    </pre>
  );
}
export function GitSection({ repoId, isGit }: { repoId: number; isGit: boolean }) {
  const [g, setG] = useState<any>(null);
  const [diff, setDiff] = useState<{ title: string; text: string } | null>(null);
  const [review, setReview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [useAi, setUseAi] = useState(true);
  const ctl = useRef<AbortController | null>(null);
  const openFile = useOpenFile(repoId);
  const load = () => api.get(`/repos/${repoId}/git`).then(setG).catch((e) => setG({ available: false, reason: e.message }));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);
  const showDiff = async (title: string, q: string) => {
    try {
      const r = await api.get<{ diff: string }>(`/repos/${repoId}/git/diff?${q}`);
      setDiff({ title, text: r.diff });
    } catch (e) {
      toast.error('Could not load the diff', (e as Error).message);
    }
  };
  const runReview = async () => {
    ctl.current = new AbortController();
    setBusy(true);
    try {
      setReview(await api.post(`/repos/${repoId}/git/review`, { useAi }, ctl.current.signal));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast.error('Review failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!g) return <Skeleton className="h-96 rounded-xl" />;
  if (!g.available) return <Card><EmptyState icon={GitBranch} title="Git is not available for this repository" description={g.reason ?? (isGit ? '' : 'This repository is not a Git repository.')} /></Card>;
  const st = (c: any) => (c.untracked ? 'untracked' : [c.staged && `staged ${c.staged}`, c.unstaged && `unstaged ${c.unstaged}`].filter(Boolean).join(' · '));
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold">Git changes</h2>
          <p className="text-[12.5px] text-muted">Read-only: CodePilot never commits, checks out, resets or pushes. Repository-configured hooks, filters and diff tools are disabled for every Git call.</p>
        </div>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load}>Refresh</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['Branch', g.branch], ['Staged', g.summary.staged], ['Unstaged', g.summary.unstaged], ['Untracked', g.summary.untracked], ['Lines', `+${g.summary.added} −${g.summary.deleted}`]].map(([k, v]) => (
          <Card key={k} className="min-w-0 p-3"><p className="text-[12px] text-muted">{k}</p><p className="truncate font-mono text-[16px] font-semibold" title={String(v)}>{v}</p></Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title={`Changed files (${g.changes.length})`} icon={FileCode2} actions={g.changes.length ? <Button size="xs" onClick={() => showDiff('All uncommitted changes vs HEAD', '')}>Full diff</Button> : undefined}>
          {g.changes.length ? (
            <ul className="max-h-80 space-y-0.5 overflow-auto text-[12.5px]">
              {g.changes.map((c: any) => (
                <li key={c.path}>
                  <button className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-elevated" onClick={() => !c.untracked && showDiff(c.path, `path=${encodeURIComponent(c.path)}`)} disabled={c.untracked}>
                    <span className="min-w-0 flex-1 truncate font-mono">{c.path}</span>
                    <span className="shrink-0 text-[11px] text-subtle">{st(c)}</span>
                    {c.added !== null && <span className="w-20 shrink-0 text-right font-mono text-[11px]"><span className="text-success">+{c.added}</span> <span className="text-danger">−{c.deleted}</span></span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted">Working tree is clean.</p>
          )}
        </Panel>
        <Panel title="Recent commits" icon={GitCommit}>
          {g.commits.length ? (
            <ul className="max-h-80 space-y-0.5 overflow-auto text-[12.5px]">
              {g.commits.map((c: any) => (
                <li key={c.hash}>
                  <button className="flex w-full items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-elevated" onClick={() => showDiff(`${c.short} ${c.subject}`, `commit=${c.hash}`)}>
                    <span className="font-mono text-[11px] text-primary">{c.short}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate">{c.subject}</span><span className="text-[11px] text-subtle">{c.author} · {timeAgo(c.date.replace('T', ' ').slice(0, 19))} · {c.files} files</span></span>
                    <span className="shrink-0 font-mono text-[11px]"><span className="text-success">+{c.added}</span> <span className="text-danger">−{c.deleted}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted">No commits yet.</p>
          )}
        </Panel>
      </div>
      {diff && <Panel title={diff.title} icon={GitBranch} actions={<Button size="xs" variant="ghost" onClick={() => setDiff(null)}>Close</Button>}><DiffBlock diff={diff.text} /></Panel>}
      <Panel title="Change review" icon={ShieldAlert} actions={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-muted"><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> Explain with local AI</label>
          {busy ? <Button size="sm" icon={XCircle} onClick={() => ctl.current?.abort()}>Cancel</Button> : <Button size="sm" variant="primary" icon={Sparkles} disabled={!g.changes.length} onClick={runReview}>Review changes</Button>}
        </div>
      }>
        {!review ? (
          <p className="text-[12.5px] text-muted">{g.changes.length ? 'Analyses the modified files against HEAD: findings on changed lines, risky changes and missing tests.' : 'Nothing to review — there are no uncommitted changes.'}</p>
        ) : (
          <div className="space-y-3 text-[12.5px]">
            {review.risks.map((r: any) => (
              <div key={r.title} className="rounded-lg border border-border p-2.5" style={{ borderLeft: `3px solid ${SEV_COLOR[r.severity as Severity]}` }}>
                <p className="flex items-center gap-2 font-medium"><SeverityBadge severity={r.severity} />{r.title}</p>
                <p className="mt-1 text-muted">{r.detail}</p>
                <p className="mt-1 font-mono text-[11px] text-subtle">{r.paths.join(', ')}</p>
              </div>
            ))}
            <p className="font-semibold">Findings on changed lines ({review.introduced.length})</p>
            <ul className="space-y-1">
              {review.introduced.map((f: any, i: number) => (
                <li key={i} className="flex items-center gap-2"><SeverityBadge severity={f.severity} /><span className="flex-1">{f.title} — <span className="text-muted">{f.description}</span></span><button className="font-mono text-[11px] text-primary hover:underline" onClick={() => openFile(f.path, f.line)}>{f.path}{f.line ? `:${f.line}` : ''}</button></li>
              ))}
              {!review.introduced.length && <li className="text-muted">No static findings on the changed lines.</li>}
            </ul>
            <div className="rounded-lg border border-border bg-panel p-3">
              <div className="mb-1.5"><EngineBadge engine={review.engine} /></div>
              {review.ai ? (
                <div className="space-y-1.5">
                  <p><b>Purpose:</b> {review.ai.purpose}</p>
                  <p><b>Impact:</b> {review.ai.impact}</p>
                  {review.ai.risks.map((r: any, i: number) => <p key={i}><SeverityBadge severity={r.severity} /> <b>{r.title}</b> — {r.detail}</p>)}
                  {!!review.ai.testSuggestions.length && <ul className="list-disc pl-5">{review.ai.testSuggestions.map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>}
                  {review.diffTruncated && <p className="text-[11px] text-subtle">The diff was truncated to fit the model's context.</p>}
                </div>
              ) : (
                <p className="text-muted">{review.engine?.notice ?? 'AI explanation not requested.'}</p>
              )}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

// =================================================================== Reports
export function ReportsSection({ repoId, name }: { repoId: number; name: string }) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [caps, setCaps] = useState<{ pdf: { available: boolean; engine: string | null } } | null>(null);
  useEffect(() => {
    api.get<{ pdf: { available: boolean; engine: string | null } }>('/repos/capabilities').then(setCaps).catch(() => undefined);
  }, []);
  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      const res = await fetch(`/api/repos/${repoId}/report.pdf`);
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `PDF export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `Code_Quality_Report_${name.replace(/[^\w.-]+/g, '_')}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success('PDF report downloaded');
    } catch (e) {
      toast.error('PDF export failed', (e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  };
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-[17px] font-semibold">Reports</h2>
        <p className="text-[12.5px] text-muted">A professional summary of the analysis: overview, languages, metrics, security and quality findings, complexity, dependencies, technical debt, AI review summary, next steps and limitations. Secrets are always redacted.</p>
      </div>
      <Card className="flex flex-wrap items-center gap-2 p-3.5">
        <a href={`/api/repos/${repoId}/report.md`} download className="inline-flex"><span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-elevated px-3.5 text-sm font-medium hover:border-border-strong"><Download size={15} /> Markdown (.md)</span></a>
        <Button variant="primary" icon={FileText} loading={pdfBusy} disabled={caps ? !caps.pdf.available : false} onClick={downloadPdf}>PDF</Button>
        <a href={`/api/repos/${repoId}/report.html`} target="_blank" rel="noreferrer" className="text-[12.5px] text-primary hover:underline">Open printable view</a>
        <span className="ml-auto text-[11.5px] text-subtle">{caps?.pdf.available ? `PDF rendered locally by ${caps.pdf.engine}` : caps ? 'PDF needs Microsoft Edge or Chrome; use the printable view instead.' : ''}</span>
      </Card>
      <Card className="overflow-hidden">
        {/* the report page is served with CSP default-src 'none' (no scripts can run) and same-origin framing only */}
        <iframe title="Report preview" src={`/api/repos/${repoId}/report.html`} className="h-[70vh] w-full bg-white" />
      </Card>
    </div>
  );
}
