import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { BookOpen, Bug, Code2, GitBranch, History as HistoryIcon, MessageSquareCode, PlayCircle, RotateCcw, Search, Shuffle, Trash2, Activity } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '@/components/ui/primitives';
import { confirmAction, toast } from '@/components/ui/overlay';
import { LangTag, Pre } from '@/components/common';
import { CodeEditor } from '@/components/code/CodeEditor';
import { useHandoff } from '@/store';
import { LANGS, formatDateTime, langLabel, timeAgo, cn } from '@/lib/utils';
import type { HistoryItem, Lang } from '@/lib/types';

const KINDS: { id: HistoryItem['kind']; label: string; icon: typeof Code2 }[] = [
  { id: 'generation', label: 'Generations', icon: Code2 },
  { id: 'conversion', label: 'Conversions', icon: Shuffle },
  { id: 'explanation', label: 'Explanations', icon: MessageSquareCode },
  { id: 'algorithm', label: 'Algorithms', icon: GitBranch },
  { id: 'execution', label: 'Executions', icon: PlayCircle },
  { id: 'debug', label: 'Debugging', icon: Bug },
  { id: 'learning', label: 'Learning', icon: BookOpen },
];
const PAGE = 25;

interface Detail extends HistoryItem {
  input: any;
  output: any;
}

export default function History() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [language, setLanguage] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ items: HistoryItem[]; total: number } | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const selected = Number(params.get('id')) || null;
  const send = useHandoff((s) => s.send);
  const nav = useNavigate();

  const load = async () => {
    const q = new URLSearchParams({ sort, limit: String(PAGE), offset: String(page * PAGE) });
    if (search) q.set('search', search);
    if (kind) q.set('kind', kind);
    if (language) q.set('language', language);
    try {
      setData(await api.get(`/history?${q}`));
    } catch (e) {
      toast.error('Could not load history', (e as Error).message);
    }
  };
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, kind, language, sort, page]);
  useEffect(() => {
    if (!selected) return setDetail(null);
    api.get<Detail>(`/history/${selected}`).then(setDetail).catch(() => setDetail(null));
  }, [selected]);

  const remove = async (id: number) => {
    if (!(await confirmAction({ title: 'Delete this record?', description: 'The history entry will be permanently removed.' }))) return;
    await api.del(`/history/${id}`);
    toast.success('Record deleted');
    if (selected === id) setParams({});
    void load();
  };
  const clearAll = async () => {
    const label = kind ? KINDS.find((k) => k.id === kind)?.label.toLowerCase() : 'all history';
    if (!(await confirmAction({ title: `Clear ${label}?`, description: `This permanently deletes ${kind ? 'every record of this type' : `all ${data?.total ?? ''} history records, including demo records`}. Projects and saved files are not affected.`, confirmLabel: 'Clear history' }))) return;
    const r = await api.del<{ deleted: number }>(`/history?confirm=yes${kind ? `&kind=${kind}` : ''}`);
    toast.success(`Deleted ${r.deleted} record(s)`);
    setParams({});
    void load();
  };

  const restore = (d: Detail) => {
    const i = d.input ?? {};
    const o = d.output ?? {};
    switch (d.kind) {
      case 'generation':
        if (o.code) {
          send({ target: 'compiler', code: o.code, language: (i.language ?? d.language) as Lang });
          return nav('/compiler');
        }
        send({ target: 'generator', code: '', language: i.language, extra: { prompt: i.prompt } });
        return nav('/generator');
      case 'conversion':
        send({ target: 'converter', code: i.code ?? '', language: i.from, extra: { output: o.code, to: i.to } });
        return nav('/converter');
      case 'explanation':
        send({ target: 'explainer', code: i.code ?? '', language: i.language });
        return nav('/explainer');
      case 'algorithm':
        if (i.code) {
          send({ target: 'studio', code: i.code, language: i.language });
          return nav('/studio?tab=analyze');
        }
        return nav('/studio');
      case 'execution':
      case 'debug':
        send({ target: 'compiler', code: i.code ?? '', language: (i.language ?? d.language ?? 'python') as Lang, stdin: i.stdin, extra: { tests: i.tests } });
        return nav('/compiler');
      case 'learning':
        return nav(i.topicId ? `/learning?topic=${i.topicId}` : '/learning');
    }
  };

  const codeOf = (d: Detail) => d.output?.code ?? d.input?.code ?? null;

  return (
    <div>
      <PageHeader
        title="History"
        icon={HistoryIcon}
        description="A persistent local log of everything you generate, convert, explain, visualise, run and debug."
        actions={<Button variant="danger" icon={Trash2} onClick={clearAll} disabled={!data?.total}>{kind ? 'Clear this type' : 'Clear history'}</Button>}
      />
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Search titles and inputs…" className="pl-8" aria-label="Search history" />
        </div>
        <Select aria-label="Filter by type" className="w-[160px]" value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }}>
          <option value="">All types</option>
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </Select>
        <Select aria-label="Filter by language" className="w-[150px]" value={language} onChange={(e) => { setLanguage(e.target.value); setPage(0); }}>
          <option value="">All languages</option>
          {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </Select>
        <Select aria-label="Sort order" className="w-[140px]" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </Select>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          {!data && <div className="space-y-2 p-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-12" />)}</div>}
          {data?.items.length === 0 && <EmptyState icon={Activity} title={search || kind || language ? 'No records match these filters' : 'No history yet'} description="Every operation is recorded locally in SQLite." className="py-16" />}
          <ul className="divide-y divide-border">
            {data?.items.map((h) => {
              const K = KINDS.find((k) => k.id === h.kind)!;
              return (
                <li key={h.id} className={cn('group flex items-center gap-3 px-3 py-2.5', selected === h.id ? 'bg-primary-soft' : 'hover:bg-elevated/50')}>
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-elevated text-muted">
                    <K.icon size={15} />
                  </span>
                  <button className="min-w-0 flex-1 text-left" onClick={() => setParams({ id: String(h.id) })}>
                    <p className="truncate text-[13px] font-medium">{h.title}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-subtle">
                      {K.label.replace(/s$/, '')} · {langLabel(h.language)}{h.targetLanguage ? ` → ${langLabel(h.targetLanguage)}` : ''} · {timeAgo(h.createdAt)}
                    </p>
                  </button>
                  {h.status !== 'success' && <Badge tone={/error|fail/.test(h.status) ? 'danger' : 'warning'}>{h.status.replace(/_/g, ' ')}</Badge>}
                  {h.isDemo && <Badge>demo</Badge>}
                  <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label="Delete record" className="opacity-50 group-hover:opacity-100" onClick={() => remove(h.id)} />
                </li>
              );
            })}
          </ul>
          {data && data.total > PAGE && (
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted">
              <span>
                {page * PAGE + 1}–{Math.min(data.total, (page + 1) * PAGE)} of {data.total}
              </span>
              <div className="flex gap-1">
                <Button size="xs" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size="xs" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
        <Card className="min-w-0 overflow-hidden xl:sticky xl:top-0 xl:self-start">
          {!detail ? (
            <EmptyState icon={HistoryIcon} title="Select a record" description="View the details of an operation and restore it to the matching tool." className="py-20" />
          ) : (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border p-4">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold">{detail.title}</p>
                  <p className="mt-0.5 text-xs text-subtle">{formatDateTime(detail.createdAt)} · engine: {detail.engine} · status: {detail.status}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detail.language && <LangTag lang={detail.language} />}
                    {detail.targetLanguage && <LangTag lang={detail.targetLanguage} />}
                    {detail.isDemo && <Badge>demo record</Badge>}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="primary" icon={RotateCcw} onClick={() => restore(detail)}>Restore to editor</Button>
                  <Button size="sm" variant="danger" icon={Trash2} onClick={() => remove(detail.id)} aria-label="Delete" />
                </div>
              </div>
              <div className="space-y-3 p-4 text-[13px]">
                {detail.input?.prompt && <div><p className="mb-1 text-xs text-muted">Prompt</p><p>{detail.input.prompt}</p></div>}
                {detail.input?.problem && <div><p className="mb-1 text-xs text-muted">Problem</p><p>{detail.input.problem}</p></div>}
                {codeOf(detail) && detail.language && (
                  <div>
                    <p className="mb-1 text-xs text-muted">{detail.output?.code ? 'Result code' : 'Code'}</p>
                    <div className="h-[300px] overflow-hidden rounded-lg border border-border">
                      <CodeEditor value={codeOf(detail)} language={(detail.kind === 'conversion' && detail.output?.code ? detail.targetLanguage : detail.language) as Lang} readOnly compact />
                    </div>
                  </div>
                )}
                {detail.output?.stdout !== undefined && <div><p className="mb-1 text-xs text-muted">Program output</p><Pre className="max-h-48">{detail.output.stdout || '(no output)'}</Pre></div>}
                {detail.output?.compileOutput && <div><p className="mb-1 text-xs text-muted">Compiler output</p><Pre className="max-h-40 text-danger/90">{detail.output.compileOutput}</Pre></div>}
                {detail.output?.summary && <div><p className="mb-1 text-xs text-muted">Summary</p><p>{detail.output.summary}</p></div>}
                {detail.output?.steps && <div><p className="mb-1 text-xs text-muted">Algorithm steps</p><ol className="list-decimal space-y-0.5 pl-5">{detail.output.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol></div>}
                {detail.output?.passed !== undefined && <p>Tests passed: <b>{detail.output.passed}/{detail.output.total}</b></p>}
                <details>
                  <summary className="cursor-pointer text-xs text-subtle">Raw record</summary>
                  <Pre className="mt-1 max-h-64 text-[11px]">{JSON.stringify({ input: detail.input, output: detail.output }, null, 2)}</Pre>
                </details>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
