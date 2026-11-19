import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowUpDown, Brackets, GitFork, Layers, Link2, ListOrdered, Repeat, Search, Share2, Table, Type, type LucideIcon, BookOpen, Bookmark, BookmarkPlus, CheckCircle2, Circle, Eye, GraduationCap, Lightbulb, ListChecks, MessageCircleQuestion, Play, RefreshCw, Target, Trash2, Trophy, XCircle, Code2, RotateCcw, Route } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select, Skeleton, Stat, Tabs } from '@/components/ui/primitives';
import { confirmAction, toast } from '@/components/ui/overlay';
import { EngineBadge, EngineNotice, Pre } from '@/components/common';
import { useHandoff } from '@/store';
import { cn, timeAgo } from '@/lib/utils';
import type { Engine } from '@/lib/types';

interface TopicSummary {
  id: string;
  name: string;
  icon: string;
  summary: string;
  counts: { viva: number; mcq: number; practice: number };
  algorithms: string[];
  category: string;
}
interface PathInfo {
  id: string;
  name: string;
  level: string;
  summary: string;
  topics: { id: string; name: string; status: Progress['status'] }[];
  completed: number;
  total: number;
  percent: number;
  next: { id: string; name: string } | null;
}
interface RevisionItem {
  topicId: string;
  question: string;
  lastChosen: number;
  wrongCount: number;
  lastAnsweredAt: string;
  mcq: { q: string; options: string[]; answer: number; explanation: string; level: string };
}
interface Progress {
  topicId: string;
  status: 'not_started' | 'in_progress' | 'completed';
  quizAttempts: number;
  quizCorrect: number;
  quizTotal: number;
}
interface Viva {
  q: string;
  a: string;
  level: string;
}
interface Mcq {
  q: string;
  options: string[];
  answer: number;
  explanation: string;
  level: string;
}
interface Practice {
  id: string;
  title: string;
  difficulty: string;
  statement: string;
  input: string;
  output: string;
  example: { input: string; output: string };
  constraints: string[];
  hints: string[];
  solution: string;
}
interface TopicDetail {
  id: string;
  name: string;
  summary: string;
  points: string[];
  algorithms: string[];
  practice: Practice[];
  progress: Progress | null;
  saved: { id: number; type: string; question: string; payload: any }[];
}
interface Stats {
  topics: number;
  completed: number;
  inProgress: number;
  quizAttempts: number;
  quizAccuracy: number | null;
  solved: number;
  practiceTotal: number;
  savedQuestions: number;
  toRevise: number;
  answers: { answered: number; correct: number; revisionAnswers: number };
  recentPractice: { id: number; topicId: string; problemId: string; status: string; createdAt: string }[];
}

const TOPIC_ICONS: Record<string, LucideIcon> = { search: Search, 'arrow-up-down': ArrowUpDown, brackets: Brackets, type: Type, link: Link2, layers: Layers, 'list-ordered': ListOrdered, 'git-fork': GitFork, 'share-2': Share2, repeat: Repeat, table: Table };
function TopicIcon({ name, size = 18 }: { name: string; size?: number }) {
  const I = TOPIC_ICONS[name] ?? BookOpen;
  return <I size={size} />;
}

export default function Learning() {
  const [params, setParams] = useSearchParams();
  const topic = params.get('topic');
  const [data, setData] = useState<{ topics: TopicSummary[]; progress: Progress[]; categories: string[] } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [paths, setPaths] = useState<PathInfo[] | null>(null);
  const [category, setCategory] = useState('all');
  const view = (['paths', 'topics', 'revision', 'saved'] as const).find((v) => v === params.get('view')) ?? 'paths';
  const setView = (v: 'paths' | 'topics' | 'revision' | 'saved') => setParams(v === 'paths' ? {} : { view: v });
  const load = () => {
    api.get<{ topics: TopicSummary[]; progress: Progress[]; categories: string[] }>('/learning/topics').then(setData).catch(() => undefined);
    api.get<Stats>('/learning/stats').then(setStats).catch(() => undefined);
    api.get<PathInfo[]>('/learning/paths').then(setPaths).catch(() => setPaths([]));
  };
  useEffect(load, [topic]);
  if (topic) return <TopicView id={topic} onBack={() => setParams(params.get('view') ? { view: params.get('view')! } : {})} onChange={load} />;
  const openTopic = (id: string) => setParams({ topic: id, ...(view !== 'paths' ? { view } : {}) });
  const shown = data ? data.topics.filter((t) => category === 'all' || t.category === category) : [];
  return (
    <div>
      <PageHeader title="Learning Hub" icon={GraduationCap} description="Prepare for programming exams and interviews: DSA lessons, viva questions, MCQ quizzes and practice problems." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Topics completed" value={stats ? `${stats.completed}/${stats.topics}` : '—'} icon={Trophy} hint={stats ? `${stats.inProgress} in progress` : undefined} />
        <Stat label="Quiz accuracy" value={stats?.quizAccuracy !== null && stats?.quizAccuracy !== undefined ? `${stats.quizAccuracy}%` : '—'} icon={Target} tone="secondary" hint={`${stats?.quizAttempts ?? 0} quizzes taken`} />
        <Stat label="Problems solved" value={stats ? `${stats.solved}/${stats.practiceTotal}` : '—'} icon={ListChecks} tone="info" />
        <Stat label="To revise" value={stats?.toRevise ?? '—'} icon={RotateCcw} tone="warning" hint={stats ? `${stats.savedQuestions} saved questions` : undefined} />
      </div>
      <Tabs
        className="mb-4"
        value={view}
        onChange={setView}
        tabs={[
          { value: 'paths', label: 'Learning paths', icon: Route },
          { value: 'topics', label: 'DSA topics', icon: BookOpen },
          { value: 'revision', label: 'Revision', icon: RotateCcw, count: stats?.toRevise || undefined },
          { value: 'saved', label: 'Saved questions', icon: Bookmark },
        ]}
      />
      {view === 'saved' ? (
        <SavedQuestions onChange={load} />
      ) : view === 'revision' ? (
        <RevisionPanel onChange={load} />
      ) : view === 'paths' ? (
        <PathsView paths={paths} onOpen={openTopic} />
      ) : !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      ) : (
        <>
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter topics by category">
          {['all', ...data.categories].map((c) => (
            <Button key={c} size="sm" variant={category === c ? 'primary' : 'secondary'} aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c === 'all' ? 'All categories' : c}
            </Button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((t) => {
            const p = data.progress.find((x) => x.topicId === t.id);
            const status = p?.status ?? 'not_started';
            return (
              <button key={t.id} className="text-left" onClick={() => openTopic(t.id)}>
                <Card className="group h-full p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40">
                  <div className="flex items-start justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary">
                      <TopicIcon name={t.icon} />
                    </span>
                    <Badge tone={status === 'completed' ? 'success' : status === 'in_progress' ? 'warning' : 'neutral'}>{status === 'completed' ? 'Completed' : status === 'in_progress' ? 'In progress' : 'Not started'}</Badge>
                  </div>
                  <p className="mt-3 text-[15px] font-semibold group-hover:text-primary">{t.name}</p>
                  <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">{t.category}</p>
                  <p className="mt-1 text-[12.5px] text-muted">{t.summary}</p>
                  <p className="mt-3 text-[11.5px] text-subtle">
                    {t.counts.viva} viva · {t.counts.mcq} MCQs · {t.counts.practice} problems
                    {p?.quizTotal ? ` · quiz ${Math.round((p.quizCorrect / p.quizTotal) * 100)}%` : ''}
                  </p>
                </Card>
              </button>
            );
          })}
        </div>
        </>
      )}
      {stats && stats.recentPractice.length > 0 && view === 'topics' && (
        <Card className="mt-5">
          <CardHeader title="Practice history" icon={ListChecks} />
          <ul className="divide-y divide-border">
            {stats.recentPractice.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                {r.status === 'solved' ? <CheckCircle2 size={15} className="text-success" /> : <Circle size={15} className="text-warning" />}
                <span className="flex-1">{r.problemId.replace(/-/g, ' ')}</span>
                <span className="text-xs text-muted">{r.topicId}</span>
                <span className="w-20 text-right text-xs text-subtle">{timeAgo(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function TopicView({ id, onBack, onChange }: { id: string; onBack: () => void; onChange: () => void }) {
  const [t, setT] = useState<TopicDetail | null>(null);
  const [tab, setTab] = useState<'learn' | 'viva' | 'mcq' | 'practice'>('learn');
  const nav = useNavigate();
  const load = () => api.get<TopicDetail>(`/learning/topics/${id}`).then(setT).catch(() => undefined);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!t) return <Skeleton className="h-96 rounded-xl" />;
  const setStatus = async (status: Progress['status']) => {
    await api.put(`/learning/topics/${id}/status`, { status });
    toast.success(status === 'completed' ? `${t.name} marked as completed` : 'Progress updated');
    void load();
    onChange();
  };
  const status = t.progress?.status ?? 'not_started';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
          All topics
        </Button>
        <div className="flex items-center gap-2">
          <Select aria-label="Topic status" value={status} onChange={(e) => setStatus(e.target.value as Progress['status'])} className="w-[160px]">
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </Select>
          {status !== 'completed' && (
            <Button variant="success" icon={CheckCircle2} onClick={() => setStatus('completed')}>
              Mark complete
            </Button>
          )}
        </div>
      </div>
      <Card className="p-5">
        <h2 className="text-xl font-semibold">{t.name}</h2>
        <p className="mt-1 text-[13.5px] text-muted">{t.summary}</p>
        {t.progress?.quizTotal ? <p className="mt-2 text-xs text-subtle">Quiz record: {t.progress.quizCorrect}/{t.progress.quizTotal} correct over {t.progress.quizAttempts} attempt(s)</p> : null}
      </Card>
      <Card>
        <Tabs
          className="px-2"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'learn', label: 'Lesson', icon: BookOpen },
            { value: 'viva', label: 'Viva questions', icon: MessageCircleQuestion },
            { value: 'mcq', label: 'MCQ quiz', icon: ListChecks },
            { value: 'practice', label: 'Practice problems', icon: Code2, count: t.practice.length },
          ]}
        />
        <div className="p-4">
          {tab === 'learn' && (
            <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
              <ul className="space-y-2.5">
                {t.points.map((p, i) => (
                  <li key={i} className="flex gap-3 text-[14px] leading-relaxed">
                    <Lightbulb size={16} className="mt-1 shrink-0 text-warning" />
                    {p}
                  </li>
                ))}
              </ul>
              <div>
                <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Visual dry runs</h4>
                {t.algorithms.length ? (
                  <div className="space-y-1.5">
                    {t.algorithms.map((a) => (
                      <button key={a} onClick={() => nav(`/studio?algo=${a}`)} className="flex w-full items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-left text-[13px] capitalize hover:border-primary/40">
                        <Play size={14} className="text-primary" />
                        {a.replace(/-/g, ' ')}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-subtle">No visualisation for this topic yet — try the practice problems.</p>
                )}
              </div>
            </div>
          )}
          {tab === 'viva' && <VivaPanel topicId={id} onSaved={load} />}
          {tab === 'mcq' && <QuizPanel topicId={id} onDone={() => { void load(); onChange(); }} />}
          {tab === 'practice' && <PracticePanel topicId={id} problems={t.practice} onChange={onChange} />}
        </div>
      </Card>
    </div>
  );
}

function useQuestions<T>(topicId: string, type: 'viva' | 'mcq') {
  const [level, setLevel] = useState<'mixed' | 'beginner' | 'advanced'>('mixed');
  const [count, setCount] = useState(4);
  const [res, setRes] = useState<{ engine: Engine; questions: T[]; bankSize: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const generate = async () => {
    setLoading(true);
    try {
      setRes(await api.post('/learning/questions', { topicId, type, level, count, seed: Math.floor(Math.random() * 1e9) }));
    } catch (e) {
      toast.error('Could not generate questions', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);
  const controls = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Select aria-label="Level" className="w-[140px]" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
        <option value="mixed">All levels</option>
        <option value="beginner">Beginner</option>
        <option value="advanced">Advanced</option>
      </Select>
      <Select aria-label="Number of questions" className="w-[130px]" value={count} onChange={(e) => setCount(Number(e.target.value))}>
        {[3, 4, 5, 8, 10].map((n) => <option key={n} value={n}>{n} questions</option>)}
      </Select>
      <Button variant="primary" icon={RefreshCw} loading={loading} onClick={generate}>
        Generate
      </Button>
      {res && <EngineBadge engine={res.engine} />}
    </div>
  );
  return { res, loading, controls };
}

async function saveQ(topicId: string, type: 'viva' | 'mcq' | 'practice', question: string, payload: unknown) {
  try {
    const r = await api.post<{ duplicate: boolean }>('/learning/saved', { topicId, type, question, payload });
    toast.success(r.duplicate ? 'Already saved' : 'Question saved');
  } catch (e) {
    toast.error('Could not save', (e as Error).message);
  }
}

function VivaPanel({ topicId, onSaved }: { topicId: string; onSaved: () => void }) {
  const { res, controls } = useQuestions<Viva>(topicId, 'viva');
  const [open, setOpen] = useState<Set<number>>(new Set());
  return (
    <div>
      {controls}
      {res && <EngineNotice engine={res.engine} />}
      <div className="mt-2 space-y-2">
        {res?.questions.map((q, i) => (
          <div key={q.q} className="rounded-xl border border-border bg-panel p-3.5">
            <div className="flex items-start gap-3">
              <span className="font-mono text-xs text-primary">Q{i + 1}</span>
              <p className="flex-1 text-[14px] font-medium">{q.q}</p>
              <Badge tone={q.level === 'advanced' ? 'warning' : 'info'}>{q.level}</Badge>
              <Button size="icon-sm" variant="ghost" icon={BookmarkPlus} aria-label="Save question" onClick={async () => { await saveQ(topicId, 'viva', q.q, q); onSaved(); }} />
            </div>
            {open.has(i) ? (
              <p className="mt-2 ml-7 rounded-lg border-l-2 border-secondary bg-secondary-soft px-3 py-2 text-[13.5px] leading-relaxed">{q.a}</p>
            ) : (
              <Button size="xs" variant="ghost" icon={Eye} className="mt-1 ml-5" onClick={() => setOpen(new Set(open).add(i))}>
                Show answer
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuizPanel({ topicId, onDone }: { topicId: string; onDone: () => void }) {
  const { res, controls } = useQuestions<Mcq>(topicId, 'mcq');
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    setAnswers({});
    setSubmitted(false);
  }, [res]);
  if (!res) return controls;
  const qs = res.questions;
  const correct = qs.filter((q, i) => answers[i] === q.answer).length;
  const submit = async () => {
    setSubmitted(true);
    try {
      await api.post('/learning/quiz', {
        topicId,
        correct,
        total: qs.length,
        answers: qs.map((q, i) => ({ question: q.q, options: q.options, answer: q.answer, chosen: answers[i], explanation: q.explanation, level: q.level })),
      });
      toast.success(`You scored ${correct}/${qs.length}`, 'Your result was saved to learning progress.');
      onDone();
    } catch (e) {
      toast.error('Could not record result', (e as Error).message);
    }
  };
  return (
    <div>
      {controls}
      <EngineNotice engine={res.engine} />
      {submitted && (
        <Alert tone={correct === qs.length ? 'success' : correct >= qs.length / 2 ? 'info' : 'warning'} icon={Trophy} title={`Score: ${correct} / ${qs.length}`} className="my-3">
          {correct === qs.length ? 'Perfect — every answer correct!' : 'Review the explanations below. Questions you missed are added to the Revision tab.'}
        </Alert>
      )}
      <div className="mt-2 space-y-3">
        {qs.map((q, i) => (
          <div key={q.q} className="rounded-xl border border-border bg-panel p-4">
            <div className="flex items-start gap-3">
              <span className="font-mono text-xs text-primary">{i + 1}.</span>
              <p className="flex-1 text-[14px] font-medium">{q.q}</p>
              <Button size="icon-sm" variant="ghost" icon={BookmarkPlus} aria-label="Save question" onClick={() => saveQ(topicId, 'mcq', q.q, q)} />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {q.options.map((o, k) => {
                const chosen = answers[i] === k;
                const right = submitted && k === q.answer;
                const wrong = submitted && chosen && k !== q.answer;
                return (
                  <button
                    key={k}
                    disabled={submitted}
                    onClick={() => setAnswers((a) => ({ ...a, [i]: k }))}
                    className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors', right ? 'border-success bg-success-soft' : wrong ? 'border-danger bg-danger-soft' : chosen ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong')}
                    aria-pressed={chosen}
                  >
                    <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[10px]', chosen ? 'border-primary text-primary' : 'border-border-strong text-muted')}>{'ABCD'[k]}</span>
                    {o}
                    {right && <CheckCircle2 size={15} className="ml-auto text-success" />}
                    {wrong && <XCircle size={15} className="ml-auto text-danger" />}
                  </button>
                );
              })}
            </div>
            {submitted && <WhyBox q={q} chosen={answers[i]} />}
          </div>
        ))}
      </div>
      {!submitted && (
        <Button className="mt-4" variant="primary" icon={CheckCircle2} disabled={Object.keys(answers).length < qs.length} onClick={submit}>
          Submit answers ({Object.keys(answers).length}/{qs.length})
        </Button>
      )}
    </div>
  );
}

function PracticePanel({ topicId, problems: all, onChange }: { topicId: string; problems: Practice[]; onChange: () => void }) {
  const [diff, setDiff] = useState('all');
  const problems = all.filter((x) => diff === 'all' || x.difficulty === diff);
  const [sel, setSel] = useState(0);
  const [hints, setHints] = useState(0);
  const [showSol, setShowSol] = useState(false);
  const send = useHandoff((s) => s.send);
  const nav = useNavigate();
  const p = problems[sel];
  useEffect(() => {
    setHints(0);
    setShowSol(false);
  }, [sel, diff]);
  const diffSelect = (
    <Select aria-label="Practice difficulty" className="mb-2 w-full" value={diff} onChange={(e) => { setDiff(e.target.value); setSel(0); }}>
      <option value="all">All difficulties</option>
      {['Easy', 'Medium', 'Hard'].filter((d) => all.some((x) => x.difficulty === d)).map((d) => <option key={d} value={d}>{d}</option>)}
    </Select>
  );
  if (!p) return <div className="max-w-xs">{diffSelect}<EmptyState icon={Code2} title="No practice problems at this difficulty" /></div>;
  const mark = async (status: 'attempted' | 'solved') => {
    await api.post('/learning/practice', { topicId, problemId: p.id, status, language: 'python' });
    toast.success(status === 'solved' ? 'Marked as solved 🎉' : 'Attempt recorded');
    onChange();
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <div className="space-y-1.5">
        {diffSelect}
        {problems.map((x, i) => (
          <button key={x.id} onClick={() => setSel(i)} className={cn('w-full rounded-lg border px-3 py-2 text-left', i === sel ? 'border-primary/50 bg-primary-soft' : 'border-border hover:border-border-strong')}>
            <p className="text-[13px] font-medium">{x.title}</p>
            <Badge tone={x.difficulty === 'Easy' ? 'success' : x.difficulty === 'Medium' ? 'warning' : 'danger'} className="mt-1">{x.difficulty}</Badge>
          </button>
        ))}
      </div>
      <div className="min-w-0 space-y-3 text-[13.5px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[16px] font-semibold">{p.title}</h3>
          <div className="flex gap-2">
            <Button size="sm" icon={BookmarkPlus} onClick={() => saveQ(topicId, 'practice', p.title, p)}>Save</Button>
            <Button size="sm" onClick={() => mark('attempted')}>Mark attempted</Button>
            <Button size="sm" variant="success" icon={CheckCircle2} onClick={() => mark('solved')}>Mark solved</Button>
          </div>
        </div>
        <p className="leading-relaxed">{p.statement}</p>
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="mb-1 text-xs text-muted">Input format</p><p>{p.input}</p></div>
          <div><p className="mb-1 text-xs text-muted">Output format</p><p>{p.output}</p></div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="mb-1 text-xs text-muted">Example input</p><Pre>{p.example.input}</Pre></div>
          <div><p className="mb-1 text-xs text-muted">Example output</p><Pre>{p.example.output}</Pre></div>
        </div>
        <div><p className="mb-1 text-xs text-muted">Constraints</p><ul className="list-disc pl-5">{p.constraints.map((c) => <li key={c}>{c}</li>)}</ul></div>
        <div className="space-y-1.5">
          {p.hints.slice(0, hints).map((h, i) => (
            <p key={i} className="rounded-lg border border-warning/25 bg-warning-soft px-3 py-2"><Lightbulb size={13} className="mr-1.5 inline text-warning" />Hint {i + 1}: {h}</p>
          ))}
          <div className="flex flex-wrap gap-2">
            {hints < p.hints.length && <Button size="sm" variant="outline" icon={Lightbulb} onClick={() => setHints(hints + 1)}>Show hint ({hints + 1}/{p.hints.length})</Button>}
            <Button size="sm" variant="outline" icon={Eye} onClick={() => setShowSol(!showSol)}>{showSol ? 'Hide solution' : 'Show solution'}</Button>
            <Button size="sm" variant="outline" icon={Play} onClick={() => { send({ target: 'compiler', code: '# Write your solution here\n', language: 'python', stdin: p.example.input + '\n', extra: { tests: [{ input: p.example.input + '\n', expected: p.example.output }] } }); nav('/compiler'); }}>Solve in compiler</Button>
          </div>
        </div>
        {showSol && (
          <div>
            <p className="mb-1 text-xs text-muted">Reference solution (Python) — verified against the example</p>
            <Pre>{p.solution}</Pre>
          </div>
        )}
      </div>
    </div>
  );
}

function WhyBox({ q, chosen }: { q: Mcq; chosen: number | undefined }) {
  const right = chosen === q.answer;
  return (
    <div className={cn('mt-3 rounded-lg border-l-2 px-3 py-2 text-[13px] leading-relaxed', right ? 'border-success bg-success-soft' : 'border-danger bg-danger-soft')}>
      {right ? (
        <p className="font-medium text-success">Correct.</p>
      ) : (
        <p>
          <span className="font-medium text-danger">Not quite.</span> You chose <b>{chosen !== undefined ? q.options[chosen] : 'nothing'}</b>; the answer is <b>{q.options[q.answer]}</b>.
        </p>
      )}
      <p className="mt-1 text-muted">
        <Lightbulb size={13} className="mr-1 inline text-warning" />
        {q.explanation}
      </p>
    </div>
  );
}

function PathsView({ paths, onOpen }: { paths: PathInfo[] | null; onOpen: (id: string) => void }) {
  if (!paths) return <div className="grid gap-3 lg:grid-cols-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)}</div>;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {paths.map((p) => (
        <Card key={p.id} className="flex flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">{p.name}</p>
              <p className="mt-0.5 text-[12.5px] text-muted">{p.summary}</p>
            </div>
            <Badge tone={p.level === 'Beginner' ? 'success' : p.level === 'Intermediate' ? 'warning' : 'danger'}>{p.level}</Badge>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-elevated" role="progressbar" aria-label={`${p.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent}>
              <div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-500" style={{ width: `${p.percent}%` }} />
            </div>
            <span className="font-mono text-xs text-muted">
              {p.completed}/{p.total}
            </span>
          </div>
          <ol className="mt-3 flex flex-wrap gap-1.5">
            {p.topics.map((t, i) => (
              <li key={t.id + i}>
                <button onClick={() => onOpen(t.id)} className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition-colors hover:border-primary/50', t.status === 'completed' ? 'border-success/40 bg-success-soft' : t.status === 'in_progress' ? 'border-warning/40 bg-warning-soft' : 'border-border')}>
                  {t.status === 'completed' ? <CheckCircle2 size={12} className="text-success" /> : <Circle size={12} className={t.status === 'in_progress' ? 'text-warning' : 'text-subtle'} />}
                  {t.name}
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-auto pt-3">
            {p.next ? (
              <Button size="sm" variant="primary" icon={Play} onClick={() => onOpen(p.next!.id)}>
                {p.topics.some((t) => t.status !== 'not_started') ? 'Continue' : 'Start'}: {p.next.name}
              </Button>
            ) : (
              <Badge tone="success" icon={Trophy}>Path completed</Badge>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function RevisionPanel({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<RevisionItem[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const load = () => api.get<{ items: RevisionItem[] }>('/learning/revision').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => {
    void load();
  }, []);
  if (!items) return <Skeleton className="h-40 rounded-xl" />;
  if (!items.length)
    return (
      <Card>
        <EmptyState icon={RotateCcw} title="Nothing to revise" description="Questions you answer incorrectly in MCQ quizzes appear here until you get them right." />
      </Card>
    );
  const check = async (it: RevisionItem) => {
    const chosen = answers[it.question];
    if (chosen === undefined) return;
    try {
      const r = await api.post<{ correct: boolean; remaining: number }>('/learning/revision', { topicId: it.topicId, question: it.question, options: it.mcq.options, answer: it.mcq.answer, chosen, explanation: it.mcq.explanation, level: it.mcq.level });
      setChecked((c) => ({ ...c, [it.question]: r.correct }));
      if (r.correct) toast.success('Correct — removed from your revision list');
      onChange();
    } catch (e) {
      toast.error('Could not record answer', (e as Error).message);
    }
  };
  return (
    <div className="space-y-3">
      <Alert tone="info" icon={RotateCcw} title={`${items.length} question${items.length === 1 ? '' : 's'} to revise`} action={<Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => { setAnswers({}); setChecked({}); void load(); }}>Refresh list</Button>}>
        Answer each question again. A correct answer removes it from the list; a wrong one keeps it here with the explanation.
      </Alert>
      {items.map((it) => {
        const done = it.question in checked;
        const chosen = answers[it.question];
        return (
          <Card key={it.question} className="p-4" role="group" aria-label={`Revision question: ${it.question}`}>
            <div className="flex flex-wrap items-start gap-2">
              <p className="min-w-0 flex-1 text-[14px] font-medium">{it.question}</p>
              <Badge>{it.topicId.replace(/-/g, ' ')}</Badge>
              <Badge tone="danger">missed {it.wrongCount}×</Badge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {it.mcq.options.map((o, k) => {
                const isChosen = chosen === k;
                const right = done && k === it.mcq.answer;
                const wrong = done && isChosen && k !== it.mcq.answer;
                return (
                  <button
                    key={k}
                    disabled={done && checked[it.question]}
                    onClick={() => { setAnswers((a) => ({ ...a, [it.question]: k })); setChecked((c) => { const n = { ...c }; delete n[it.question]; return n; }); }}
                    aria-pressed={isChosen}
                    className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors', right ? 'border-success bg-success-soft' : wrong ? 'border-danger bg-danger-soft' : isChosen ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong')}
                  >
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border-strong font-mono text-[10px] text-muted">{'ABCDEF'[k]}</span>
                    {o}
                  </button>
                );
              })}
            </div>
            {done ? (
              <WhyBox q={{ ...it.mcq, q: it.question }} chosen={chosen} />
            ) : (
              <Button className="mt-3" size="sm" variant="primary" icon={CheckCircle2} disabled={chosen === undefined} onClick={() => check(it)}>
                Check answer
              </Button>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function SavedQuestions({ onChange }: { onChange: () => void }) {
  const [items, setItems] = useState<{ id: number; topicId: string; type: string; question: string; payload: any; isDemo: boolean; createdAt: string }[] | null>(null);
  const load = () => api.get<typeof items>('/learning/saved').then(setItems).catch(() => setItems([]));
  useEffect(() => {
    void load();
  }, []);
  if (!items) return <Skeleton className="h-40 rounded-xl" />;
  if (!items.length) return <Card><EmptyState icon={Bookmark} title="No saved questions" description="Use the bookmark button on viva questions, MCQs or practice problems to build a revision list." /></Card>;
  return (
    <div className="space-y-2">
      {items.map((s) => (
        <Card key={s.id} className="p-3.5">
          <div className="flex items-start gap-3">
            <Badge tone={s.type === 'mcq' ? 'primary' : s.type === 'viva' ? 'info' : 'secondary'}>{s.type}</Badge>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium">{s.question}</p>
              {s.type === 'viva' && s.payload?.a && <p className="mt-1 text-[13px] text-muted">{s.payload.a}</p>}
              {s.type === 'mcq' && s.payload?.options && <p className="mt-1 text-[13px] text-muted">Answer: {s.payload.options[s.payload.answer]} — {s.payload.explanation}</p>}
              {s.type === 'practice' && s.payload?.statement && <p className="mt-1 text-[13px] text-muted">{s.payload.statement}</p>}
              <p className="mt-1 text-[11px] text-subtle">{s.topicId} · {timeAgo(s.createdAt)}{s.isDemo ? ' · demo' : ''}</p>
            </div>
            <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label="Delete saved question" onClick={async () => {
              if (!(await confirmAction({ title: 'Remove saved question?', confirmLabel: 'Remove' }))) return;
              await api.del(`/learning/saved/${s.id}`);
              void load();
              onChange();
            }} />
          </div>
        </Card>
      ))}
    </div>
  );
}
