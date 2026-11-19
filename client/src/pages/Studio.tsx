import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, BookmarkPlus, Bookmark, Code, FileText, GitBranch, Library, ListOrdered, PlayCircle, Search, Sparkles, Trash2, Wand2, Workflow, Timer, Play } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Segmented, Skeleton, Tabs, Textarea, Select } from '@/components/ui/primitives';
import { confirmAction, toast } from '@/components/ui/overlay';
import { CodePanel, ComplexityChips, EngineBadge, EngineNotice, IssueList, LanguageSelect, Pre } from '@/components/common';
import { CodeEditor } from '@/components/code/CodeEditor';
import { MermaidDiagram } from '@/components/code/Mermaid';
import { Visualizer } from '@/components/Visualizer';
import { useHandoff, useSettings } from '@/store';
import { LANGS, langLabel, timeAgo, cn } from '@/lib/utils';
import type { AlgorithmEntry, AlgorithmSummary, Complexity, Engine, Issue, Lang } from '@/lib/types';

type Top = 'library' | 'analyze' | 'saved';

export default function Studio() {
  const [params, setParams] = useSearchParams();
  const top = (params.get('tab') as Top) ?? (params.get('saved') ? 'saved' : 'library');
  const setTop = (t: Top) => setParams(t === 'library' ? {} : { tab: t });
  return (
    <div>
      <PageHeader title="Algorithm Studio" icon={GitBranch} description="Explore algorithms with real step-by-step execution, or turn your own problem or code into an algorithm, pseudocode and a flowchart." />
      <Tabs
        className="mb-4"
        value={top}
        onChange={setTop}
        tabs={[
          { value: 'library', label: 'Algorithm library', icon: Library },
          { value: 'analyze', label: 'Problem / code → algorithm', icon: Wand2 },
          { value: 'saved', label: 'Saved algorithms', icon: Bookmark },
        ]}
      />
      {top === 'library' && <LibraryView />}
      {top === 'analyze' && <AnalyzeView />}
      {top === 'saved' && <SavedView />}
    </div>
  );
}

// ------------------------------------------------------------------ library
function LibraryView() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('algo');
  const [list, setList] = useState<AlgorithmSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  useEffect(() => {
    api.get<AlgorithmSummary[]>('/algorithms').then(setList).catch(() => setList([]));
  }, []);
  const cats = useMemo(() => ['All', ...new Set((list ?? []).map((a) => a.category))], [list]);
  if (selected) return <AlgorithmDetail id={selected} onBack={() => setParams({})} />;
  if (!list)
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>
    );
  const filtered = list.filter((a) => (cat === 'All' || a.category === cat) && `${a.name} ${a.summary} ${a.category}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search algorithms…" className="pl-9" aria-label="Search algorithms" />
        </div>
        <div className="flex flex-wrap gap-1">
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={cn('rounded-full border px-3 py-1 text-xs transition-colors', cat === c ? 'border-primary/50 bg-primary-soft text-fg' : 'border-border text-muted hover:text-fg')}>
              {c}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 && <EmptyState icon={Search} title="No algorithms match your search" />}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {filtered.map((a) => (
          <button key={a.id} onClick={() => setParams({ algo: a.id })} className="text-left">
            <Card className="group h-full p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40">
              <div className="flex items-start justify-between gap-2">
                <Badge tone="info">{a.category}</Badge>
                <Badge tone={a.difficulty === 'Easy' ? 'success' : a.difficulty === 'Medium' ? 'warning' : 'danger'}>{a.difficulty}</Badge>
              </div>
              <p className="mt-3 text-[14px] font-semibold group-hover:text-primary">{a.name}</p>
              <p className="mt-1 line-clamp-2 text-[12.5px] text-muted">{a.summary}</p>
              <p className="mt-3 flex items-center gap-1.5 font-mono text-[11.5px] text-subtle">
                <Timer size={12} /> avg {a.complexity.average} · space {a.complexity.space}
              </p>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}

function AlgorithmDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [a, setA] = useState<AlgorithmEntry | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'visualize' | 'algorithm' | 'flowchart' | 'code'>('visualize');
  const defLang = useSettings((s) => s.settings.defaultLanguage);
  const [lang, setLang] = useState<Lang>(defLang);
  const send = useHandoff((s) => s.send);
  const nav = useNavigate();
  useEffect(() => {
    setA(null);
    api.get<AlgorithmEntry>(`/algorithms/${id}`).then(setA).catch((e) => setError(e.message));
  }, [id]);
  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!a) return <Skeleton className="h-[600px] rounded-xl" />;
  const save = async () => {
    try {
      await api.post('/saved-algorithms', { title: a.name, algorithmId: a.id, language: lang, code: a.code[lang], pseudocode: a.pseudocode, flowchart: a.flowchart, steps: a.steps, complexity: a.complexity });
      toast.success('Algorithm saved', 'Find it under “Saved algorithms”.');
    } catch (e) {
      toast.error('Could not save', (e as Error).message);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
          All algorithms
        </Button>
        <div className="flex gap-2">
          <Button icon={BookmarkPlus} onClick={save}>
            Save
          </Button>
          <Button variant="primary" icon={Play} onClick={() => { send({ target: 'compiler', code: a.code[lang], language: lang }); nav('/compiler'); }}>
            Run in compiler
          </Button>
        </div>
      </div>
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="info">{a.category}</Badge>
          <Badge tone={a.difficulty === 'Easy' ? 'success' : a.difficulty === 'Medium' ? 'warning' : 'danger'}>{a.difficulty}</Badge>
          <Badge tone="secondary">Built-in library · verified by tests</Badge>
        </div>
        <h2 className="mt-2 text-xl font-semibold">{a.name}</h2>
        <p className="mt-1 max-w-4xl text-[13.5px] leading-relaxed text-fg/85">{a.description}</p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[['Best', a.complexity.best], ['Average', a.complexity.average], ['Worst', a.complexity.worst], ['Space', a.complexity.space]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-panel px-3 py-2">
              <p className="text-[11px] text-muted">{k}</p>
              <p className="font-mono text-[15px] font-semibold">{v}</p>
            </div>
          ))}
        </div>
        {a.complexity.note && <p className="mt-2 text-xs text-subtle">{a.complexity.note}</p>}
        <div className="mt-4 grid gap-3 text-[13px] md:grid-cols-2">
          <p><span className="text-muted">Input: </span>{a.input}</p>
          <p><span className="text-muted">Output: </span>{a.output}</p>
        </div>
      </Card>
      <Card>
        <Tabs
          className="px-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'visualize', label: 'Dry-run visualiser', icon: PlayCircle },
            { value: 'algorithm', label: 'Steps & pseudocode', icon: ListOrdered },
            { value: 'flowchart', label: 'Flowchart', icon: Workflow },
            { value: 'code', label: 'Code', icon: Code },
          ]}
        />
        <div className="p-4">
          {tab === 'visualize' && <Visualizer algorithmId={a.id} defaultInput={a.defaultInput} visual={a.visual} />}
          {tab === 'algorithm' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Algorithm steps</h4>
                <ol className="space-y-2">
                  {a.steps.map((s, i) => (
                    <li key={i} className="flex gap-3 text-[13.5px]">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft font-mono text-xs text-primary">{i + 1}</span>
                      <span className="pt-0.5">{s}</span>
                    </li>
                  ))}
                </ol>
                <h4 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Worked example (dry run)</h4>
                <div className="space-y-1 rounded-lg border border-border bg-panel p-3 text-[13px]">
                  <p><span className="text-muted">Input:</span> <span className="font-mono">{a.example.input}</span></p>
                  <p>{a.example.explanation}</p>
                  <p><span className="text-muted">Output:</span> <span className="font-mono text-success">{a.example.output}</span></p>
                </div>
                <h4 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Sample test case</h4>
                <Pre>{`Program output:\n${a.expectedOutput}`}</Pre>
              </div>
              <div>
                <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Pseudocode</h4>
                <Pre className="max-h-[560px]">{a.pseudocode}</Pre>
              </div>
            </div>
          )}
          {tab === 'flowchart' && (
            <div>
              <p className="mb-2 text-xs text-muted">{a.source === 'python' ? `Generated from the reference implementation of ${a.focus}() by CodePilot's code → flowchart transformer.` : 'Hand-drawn flowchart of the core operation.'}</p>
              <MermaidDiagram code={a.flowchart} fileName={a.id} minHeight={460} />
            </div>
          )}
          {tab === 'code' && (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Segmented value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l.id, label: l.label }))} />
                {a.generated.includes(lang) && <Badge tone="secondary">Converted from Python by the offline translator · verified</Badge>}
              </div>
              <CodePanel className="h-[520px]" title={`${a.name} — ${langLabel(lang)}`} code={a.code[lang]} language={lang} readOnly fileBase={a.id.replace(/-/g, '_')} />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ analyze
interface StudioResult {
  engine: Engine;
  matched?: boolean;
  message?: string;
  suggestions?: { id: string; title: string; category: string }[];
  algorithmId?: string;
  title: string;
  understanding?: string;
  steps: string[];
  pseudocode: string;
  flowchart: string;
  flowTargets?: string[];
  flowTarget?: string;
  code?: string | null;
  complexity: Complexity;
  explanation: string;
  dryRun?: string[];
  testCases?: { input: string; expected: string | null; note?: string }[];
  conversions?: Record<Lang, string>;
  issues?: Issue[];
  visual?: string;
  sections?: Record<string, 'ollama' | 'offline'>;
  aiExplanation?: string;
}

const SAMPLE_CODE = `def gcd(a, b):
    while b != 0:
        r = a % b
        a = b
        b = r
    return a


x = int(input())
y = int(input())
if x <= 0 or y <= 0:
    print("Enter positive numbers")
else:
    print("GCD:", gcd(x, y))
`;

function AnalyzeView() {
  const [mode, setMode] = useState<'problem' | 'code'>('problem');
  const [problem, setProblem] = useState('Find the shortest path from a source vertex to all other vertices in a weighted graph');
  const [code, setCode] = useState(SAMPLE_CODE);
  const [lang, setLang] = useState<Lang>('python');
  const [res, setRes] = useState<StudioResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'steps' | 'pseudo' | 'flow' | 'code' | 'tests'>('steps');
  const [convLang, setConvLang] = useState<Lang>('java');
  const take = useHandoff((s) => s.take);
  const nav = useNavigate();
  useEffect(() => {
    const h = take('studio');
    if (h) {
      setMode('code');
      setCode(h.code);
      setLang(h.language);
    }
  }, [take]);

  const run = async (target?: string) => {
    setLoading(true);
    setError('');
    try {
      const r = mode === 'problem' ? await api.post<StudioResult>('/studio/problem', { problem, language: lang }) : await api.post<StudioResult>('/studio/code', { code, language: lang, target });
      setRes(r);
      if (!target) setTab('steps');
      const other = LANGS.find((l) => l.id !== lang)!.id;
      setConvLang(other);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const save = async () => {
    if (!res) return;
    try {
      await api.post('/saved-algorithms', { title: res.title === 'Your program' ? `Algorithm (${langLabel(lang)})` : res.title, algorithmId: res.algorithmId ?? null, language: lang, code: mode === 'code' ? code : res.code ?? '', pseudocode: res.pseudocode, flowchart: res.flowchart, steps: res.steps, complexity: res.complexity });
      toast.success('Saved to your algorithms');
    } catch (e) {
      toast.error('Could not save', (e as Error).message);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[440px_1fr]">
      <Card className="h-fit p-4">
        <Segmented className="mb-4" value={mode} onChange={setMode} options={[{ value: 'problem', label: 'Problem statement', icon: FileText }, { value: 'code', label: 'Source code', icon: Code }]} />
        {mode === 'problem' ? (
          <Textarea value={problem} onChange={(e) => setProblem(e.target.value)} rows={6} aria-label="Problem statement" placeholder="Describe the problem…" />
        ) : (
          <div className="h-[340px] overflow-hidden rounded-lg border border-border">
            <CodeEditor value={code} onChange={setCode} language={lang} compact />
          </div>
        )}
        <div className="mt-3 flex items-center gap-2">
          <LanguageSelect value={lang} onChange={setLang} ariaLabel={mode === 'code' ? 'Code language' : 'Output language'} />
          <Button variant="primary" className="flex-1 justify-center" icon={Sparkles} loading={loading} onClick={() => run()}>
            Generate algorithm
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-subtle">
          {mode === 'problem' ? 'Offline, problem statements are matched to the verified algorithm library and templates. Local AI can design algorithms for new problems.' : 'Code is parsed into a language-neutral representation, then rendered as steps, pseudocode, a flowchart and the four other languages — fully offline.'}
        </p>
      </Card>
      <div className="min-w-0 space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {loading && !res && <Skeleton className="h-[520px] rounded-xl" />}
        {!res && !loading && (
          <Card>
            <EmptyState icon={Workflow} title="Algorithm, pseudocode and flowchart appear here" description="Move freely between problem statement, source code, algorithm steps, pseudocode and flowchart." />
          </Card>
        )}
        {res && res.matched === false && (
          <Alert tone="warning" title="Problem not recognised offline">
            <p>{res.message}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {res.suggestions?.slice(0, 12).map((s) => (
                <button key={s.id} onClick={() => nav(`/studio?algo=${s.id}`)} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs hover:border-primary/40">
                  {s.title}
                </button>
              ))}
            </div>
          </Alert>
        )}
        {res && res.matched !== false && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <EngineBadge engine={res.engine} />
                <span className="text-[15px] font-semibold">{res.title}</span>
              </div>
              <div className="flex gap-2">
                {res.algorithmId && (
                  <Button size="sm" icon={PlayCircle} onClick={() => nav(`/studio?algo=${res.algorithmId}`)}>
                    Open visualiser
                  </Button>
                )}
                <Button size="sm" icon={BookmarkPlus} onClick={save}>
                  Save
                </Button>
              </div>
            </div>
            <EngineNotice engine={res.engine} />
            {res.sections && (
              <div className="flex flex-wrap gap-1.5 text-[11.5px]">
                {Object.entries(res.sections).map(([k, v]) => (
                  <Badge key={k} tone={v === 'ollama' ? 'primary' : 'neutral'}>
                    {k}: {v === 'ollama' ? 'local AI' : 'offline analysis'}
                  </Badge>
                ))}
              </div>
            )}
            <Card className="p-4">
              {res.aiExplanation && <p className="mb-2 text-[13.5px]">{res.aiExplanation}</p>}
              {res.understanding && <p className="mb-2 text-[13.5px]">{res.understanding}</p>}
              <ComplexityChips time={res.complexity.time} space={res.complexity.space} confidence={res.complexity.confidence} pattern={res.complexity.pattern} />
              <ul className="mt-2 space-y-0.5 text-xs text-muted">
                {res.complexity.reasons.map((r) => (
                  <li key={r}>– {r}</li>
                ))}
              </ul>
            </Card>
            <Card>
              <Tabs
                className="px-2"
                value={tab}
                onChange={setTab}
                tabs={[
                  { value: 'steps', label: 'Steps', icon: ListOrdered },
                  { value: 'pseudo', label: 'Pseudocode', icon: FileText },
                  { value: 'flow', label: 'Flowchart', icon: Workflow },
                  { value: 'code', label: mode === 'code' ? 'Other languages' : 'Code', icon: Code },
                  { value: 'tests', label: 'Dry run & tests', icon: PlayCircle },
                ]}
              />
              <div className="p-4">
                {tab === 'steps' && (
                  <ol className="space-y-2">
                    {res.steps.map((s, i) => (
                      <li key={i} className="flex gap-3 text-[13.5px]">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary-soft font-mono text-xs text-primary">{i + 1}</span>
                        <span className="pt-0.5">{s}</span>
                      </li>
                    ))}
                    {res.explanation && <p className="pt-2 text-[13px] text-muted">{res.explanation}</p>}
                    {!!res.issues?.length && <div className="pt-3"><IssueList issues={res.issues} /></div>}
                  </ol>
                )}
                {tab === 'pseudo' && <Pre className="max-h-[560px]">{res.pseudocode || 'No pseudocode available.'}</Pre>}
                {tab === 'flow' && (
                  <div>
                    {res.flowTargets && res.flowTargets.length > 1 && (
                      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
                        Flowchart for
                        <Select value={res.flowTarget} onChange={(e) => run(e.target.value)} className="h-8 w-48" aria-label="Flowchart function">
                          {res.flowTargets.map((t) => (
                            <option key={t} value={t}>
                              {t === 'main' ? 'main program' : `${t}()`}
                            </option>
                          ))}
                        </Select>
                      </div>
                    )}
                    <MermaidDiagram code={res.flowchart} minHeight={460} />
                  </div>
                )}
                {tab === 'code' &&
                  (mode === 'code' && res.conversions ? (
                    <div>
                      <Segmented className="mb-3" value={convLang} onChange={setConvLang} options={LANGS.filter((l) => l.id !== lang).map((l) => ({ value: l.id, label: l.label }))} />
                      <CodePanel className="h-[480px]" title={`${langLabel(convLang)} (offline translation — review before use)`} code={res.conversions[convLang]} language={convLang} readOnly />
                    </div>
                  ) : res.code ? (
                    <CodePanel className="h-[480px]" title={res.title} code={res.code} language={lang} readOnly />
                  ) : (
                    <p className="text-muted">No code available.</p>
                  ))}
                {tab === 'tests' && (
                  <div className="space-y-4 text-[13px]">
                    {!!res.dryRun?.length && (
                      <div>
                        <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Sample dry run</h4>
                        <ol className="list-decimal space-y-1 pl-5">
                          {res.dryRun.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    <div>
                      <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Sample test cases</h4>
                      {res.testCases?.length ? (
                        <div className="space-y-2">
                          {res.testCases.map((t, i) => (
                            <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr]">
                              <Pre className="text-xs">{t.input || '(no input)'}</Pre>
                              <Pre className="text-xs">{t.expected ?? `Expected output unknown${t.note ? ` — ${t.note}` : ''}`}</Pre>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-muted">No test cases.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ saved
interface Saved {
  id: number;
  title: string;
  algorithmId: string | null;
  language: Lang | null;
  isDemo: boolean;
  createdAt: string;
  code?: string;
  pseudocode?: string;
  flowchart?: string;
  steps?: string[];
  complexity?: Record<string, string>;
  notes?: string;
}

function SavedView() {
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<Saved[] | null>(null);
  const [cur, setCur] = useState<Saved | null>(null);
  const sel = Number(params.get('saved')) || null;
  const load = () => api.get<Saved[]>('/saved-algorithms').then(setList).catch(() => setList([]));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (sel) api.get<Saved>(`/saved-algorithms/${sel}`).then(setCur).catch(() => setCur(null));
    else setCur(null);
  }, [sel]);
  const remove = async (s: Saved) => {
    if (!(await confirmAction({ title: `Delete “${s.title}”?`, description: 'This saved algorithm will be permanently removed.' }))) return;
    await api.del(`/saved-algorithms/${s.id}`);
    toast.success('Deleted');
    if (sel === s.id) setParams({ tab: 'saved' });
    void load();
  };
  if (!list) return <Skeleton className="h-64 rounded-xl" />;
  if (!list.length) return <Card><EmptyState icon={Bookmark} title="No saved algorithms yet" description="Save algorithms from the library or from your own code to build a personal collection." /></Card>;
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Card className="h-fit">
        <CardHeader title="Your collection" subtitle={`${list.length} saved`} icon={Bookmark} />
        <ul className="divide-y divide-border">
          {list.map((s) => (
            <li key={s.id} className={cn('flex items-center gap-2 px-3 py-2', sel === s.id && 'bg-primary-soft')}>
              <button className="min-w-0 flex-1 text-left" onClick={() => setParams({ tab: 'saved', saved: String(s.id) })}>
                <p className="truncate text-[13px] font-medium">{s.title}</p>
                <p className="text-[11px] text-subtle">{langLabel(s.language)} · {timeAgo(s.createdAt)} {s.isDemo && '· demo'}</p>
              </button>
              <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label={`Delete ${s.title}`} onClick={() => remove(s)} />
            </li>
          ))}
        </ul>
      </Card>
      {cur ? (
        <div className="min-w-0 space-y-4">
          <Card className="p-4">
            <h3 className="text-lg font-semibold">{cur.title}</h3>
            {cur.complexity?.average || cur.complexity?.time ? <div className="mt-2"><ComplexityChips time={cur.complexity.average ?? cur.complexity.time} space={cur.complexity.space} /></div> : null}
            {cur.notes && <p className="mt-2 text-xs text-muted">{cur.notes}</p>}
            {!!cur.steps?.length && (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px]">
                {cur.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            )}
          </Card>
          {cur.flowchart && <MermaidDiagram code={cur.flowchart} fileName={cur.title.replace(/\W+/g, '_')} minHeight={380} />}
          <div className="grid gap-4 lg:grid-cols-2">
            {cur.pseudocode && <Pre className="max-h-[460px]">{cur.pseudocode}</Pre>}
            {cur.code && cur.language && <CodePanel className="h-[460px]" title="Code" code={cur.code} language={cur.language} readOnly />}
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState icon={Bookmark} title="Select a saved algorithm" />
        </Card>
      )}
    </div>
  );
}
