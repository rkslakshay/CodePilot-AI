import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Code2, MessageSquareCode, Play, RefreshCw, Sparkles, Lightbulb, ListChecks, Variable, Timer, FileQuestion, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Segmented, Select, Skeleton, Tabs, Textarea } from '@/components/ui/primitives';
import { toast } from '@/components/ui/overlay';
import { CodePanel, ComplexityChips, EngineBadge, EngineNotice, IssueList, LanguageSelect, Pre } from '@/components/common';
import { useHandoff, useSettings } from '@/store';
import type { Engine, Issue, Lang } from '@/lib/types';

interface GenResult {
  engine: Engine;
  matched: boolean;
  message?: string;
  suggestions?: { kind: string; id: string; title: string }[];
  code: string;
  codeIsSkeleton?: boolean;
  match?: { kind: string; id: string; title: string; difficulty: string } | null;
  alternatives?: { id: string; title: string; kind: string }[];
  understanding?: string;
  explanation?: string;
  steps?: string[];
  variables?: { name: string; type: string; scope: string; purpose: string }[];
  functions?: { name: string; params: string; returns: string; description: string }[];
  timeComplexity?: string;
  spaceComplexity?: string;
  complexityNote?: string;
  sampleInput?: string;
  sampleOutput?: string;
  testCases?: { input: string; expected: string }[];
  edgeCases?: string[];
  issues?: Issue[];
  notes?: string[];
}

const EXAMPLES = ['Check whether a number is prime', 'Sort an array using merge sort', 'Find the GCD and LCM of two numbers', 'Binary search in a sorted array', 'Print the Fibonacci series', 'Shortest path with Dijkstra', 'Check if a year is a leap year', 'Maximum subarray sum (Kadane)'];

export default function Generator() {
  const defaultLang = useSettings((s) => s.settings.defaultLanguage);
  const [prompt, setPrompt] = useState('');
  const [language, setLanguage] = useState<Lang>(defaultLang);
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('easy');
  const [style, setStyle] = useState<'standard' | 'commented' | 'compact'>('standard');
  const [requirements, setRequirements] = useState('');
  const [variant, setVariant] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState<GenResult | null>(null);
  const [code, setCode] = useState('');
  const [tab, setTab] = useState<'overview' | 'variables' | 'complexity' | 'tests' | 'issues'>('overview');
  const { send, take } = useHandoff();
  const nav = useNavigate();

  useEffect(() => {
    const h = take('generator');
    if (h?.extra?.prompt) setPrompt(String(h.extra.prompt));
    if (h) setLanguage(h.language);
  }, [take]);

  const generate = async (v = 0, p = prompt) => {
    if (p.trim().length < 3) {
      setError('Describe the programming problem in a few words.');
      return;
    }
    setLoading(true);
    setError('');
    setVariant(v);
    try {
      const r = await api.post<GenResult>('/generate', { prompt: p, language, difficulty, style, requirements: requirements || undefined, variant: v });
      setRes(r);
      setCode(r.code);
      setTab('overview');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handTo = (target: 'compiler' | 'explainer') => {
    send({ target, code, language, stdin: res?.sampleInput ?? '', extra: { tests: res?.testCases } });
    nav(target === 'compiler' ? '/compiler' : '/explainer');
  };

  return (
    <div>
      <PageHeader title="AI Code Generator" icon={Code2} description="Describe a problem in plain English and get a complete program with explanation, complexity and tests." />
      <div className="grid gap-4 xl:grid-cols-[400px_1fr]">
        <Card className="h-fit p-4">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void generate(0);
            }}
          >
            <Field label="Problem description" htmlFor="gen-prompt" error={error && !res ? error : undefined}>
              <Textarea
                id="gen-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={5}
                placeholder="e.g. Write a program that reads n numbers and prints their sum, average, minimum and maximum."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void generate(0);
                }}
              />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" onClick={() => setPrompt(x)} className="rounded-full border border-border bg-panel px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:border-primary/40 hover:text-fg">
                  {x}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Language">
                <LanguageSelect value={language} onChange={setLanguage} className="w-full" />
              </Field>
              <Field label="Difficulty">
                <Select aria-label="Difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </Select>
              </Field>
            </div>
            <Field label="Coding style">
              <Segmented value={style} onChange={setStyle} options={[{ value: 'standard', label: 'Standard' }, { value: 'commented', label: 'Commented' }, { value: 'compact', label: 'Compact' }]} />
            </Field>
            <Field label="Additional requirements (optional)" hint="Applied by Local AI. The offline engine shows the matching template unchanged.">
              <Textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} rows={2} placeholder="e.g. use recursion, handle negative input" />
            </Field>
            <Button type="submit" variant="primary" size="lg" className="w-full justify-center" icon={Sparkles} loading={loading}>
              Generate code
            </Button>
          </form>
        </Card>

        <div className="min-w-0 space-y-4">
          {error && res && <Alert tone="danger">{error}</Alert>}
          {loading && !res && <ResultSkeleton />}
          {!loading && !res && (
            <Card>
              <EmptyState icon={Sparkles} title="Your generated program will appear here" description="Try one of the example prompts. With Local AI (Ollama) enabled any problem can be attempted; offline, CodePilot uses verified built-in templates and the algorithm library." />
            </Card>
          )}
          {res && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <EngineBadge engine={res.engine} />
                {res.match && <Badge tone="info">Matched: {res.match.title}</Badge>}
                {res.codeIsSkeleton && <Badge tone="warning" icon={AlertTriangle}>Starter skeleton — not a solution</Badge>}
              </div>
              <EngineNotice engine={res.engine} />
              {!res.matched && (
                <Alert tone="warning" icon={FileQuestion} title="No offline solution for this problem">
                  <p>{res.message}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {res.suggestions?.map((s) => (
                      <button key={s.id} onClick={() => { setPrompt(s.title); void generate(0, s.title); }} className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-fg hover:border-primary/40">
                        {s.title}
                      </button>
                    ))}
                  </div>
                </Alert>
              )}
              <CodePanel
                className="h-[460px]"
                title={res.match?.title ?? 'Generated program'}
                code={code}
                onChange={setCode}
                language={language}
                fileBase={res.match?.id?.replace(/-/g, '_') ?? 'main'}
                onRun={() => handTo('compiler')}
                actions={
                  <>
                    <Button size="xs" variant="ghost" icon={Play} onClick={() => handTo('compiler')}>
                      Run
                    </Button>
                    <Button size="xs" variant="ghost" icon={MessageSquareCode} onClick={() => handTo('explainer')}>
                      Explain
                    </Button>
                    <Button size="xs" variant="ghost" icon={RefreshCw} loading={loading} onClick={() => generate(variant + 1)} title="Regenerate (alternative approach or next match)">
                      Regenerate
                    </Button>
                  </>
                }
              />
              {res.matched && (
                <Card>
                  <Tabs
                    className="px-2"
                    value={tab}
                    onChange={setTab}
                    tabs={[
                      { value: 'overview', label: 'Explanation', icon: Lightbulb },
                      { value: 'variables', label: 'Variables & functions', icon: Variable },
                      { value: 'complexity', label: 'Complexity', icon: Timer },
                      { value: 'tests', label: 'Tests & edge cases', icon: ListChecks, count: res.testCases?.length },
                      { value: 'issues', label: 'Checks', icon: AlertTriangle, count: res.issues?.length },
                    ]}
                  />
                  <div className="p-4 text-[13.5px] leading-relaxed">
                    {tab === 'overview' && (
                      <div className="space-y-3">
                        {res.understanding && (
                          <div>
                            <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Problem understanding</h4>
                            <p>{res.understanding}</p>
                          </div>
                        )}
                        <div>
                          <h4 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">How it works</h4>
                          <p>{res.explanation}</p>
                        </div>
                        {!!res.steps?.length && (
                          <ol className="list-decimal space-y-1 pl-5 text-fg/90">
                            {res.steps.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ol>
                        )}
                        {res.notes?.map((n) => (
                          <p key={n} className="text-xs text-subtle">
                            ⓘ {n}
                          </p>
                        ))}
                        {!!res.alternatives?.length && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-xs text-muted">Other matches:</span>
                            {res.alternatives.map((a, i) => (
                              <button key={a.id} onClick={() => generate(variant + i + 1)} className="rounded-full border border-border px-2 py-0.5 text-xs hover:border-primary/40">
                                {a.title}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {tab === 'variables' && (
                      <div className="space-y-4">
                        {!!res.functions?.length && (
                          <div className="space-y-2">
                            {res.functions.map((f) => (
                              <div key={f.name} className="rounded-lg border border-border bg-panel px-3 py-2">
                                <p className="font-mono text-[12.5px] text-primary">
                                  {f.name}({f.params}) → {f.returns}
                                </p>
                                <p className="text-[13px] text-muted">{f.description}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[13px]">
                            <thead className="text-xs text-muted">
                              <tr className="border-b border-border">
                                <th className="py-2 pr-3 font-medium">Name</th>
                                <th className="py-2 pr-3 font-medium">Type</th>
                                <th className="py-2 pr-3 font-medium">Scope</th>
                                <th className="py-2 font-medium">Purpose</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(res.variables ?? []).map((v) => (
                                <tr key={v.scope + v.name} className="border-b border-border/60">
                                  <td className="py-1.5 pr-3 font-mono text-primary">{v.name}</td>
                                  <td className="py-1.5 pr-3 text-muted">{v.type}</td>
                                  <td className="py-1.5 pr-3 text-muted">{v.scope}</td>
                                  <td className="py-1.5">{v.purpose}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                    {tab === 'complexity' && <ComplexityChips time={res.timeComplexity ?? '—'} space={res.spaceComplexity ?? '—'} note={res.complexityNote} />}
                    {tab === 'tests' && (
                      <div className="space-y-4">
                        {(res.sampleInput || res.sampleOutput) && (
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <h4 className="mb-1 text-xs font-medium text-muted">Sample input</h4>
                              <Pre>{res.sampleInput || '(no input)'}</Pre>
                            </div>
                            <div>
                              <h4 className="mb-1 text-xs font-medium text-muted">Sample output</h4>
                              <Pre>{res.sampleOutput}</Pre>
                            </div>
                          </div>
                        )}
                        {!!res.testCases?.length && (
                          <div>
                            <h4 className="mb-1.5 text-xs font-medium text-muted">Test cases</h4>
                            <div className="space-y-2">
                              {res.testCases.map((t, i) => (
                                <div key={i} className="grid gap-2 md:grid-cols-2">
                                  <Pre className="text-xs">{t.input || '(empty)'}</Pre>
                                  <Pre className="text-xs">{t.expected}</Pre>
                                </div>
                              ))}
                            </div>
                            <Button className="mt-3" size="sm" icon={Play} onClick={() => handTo('compiler')}>
                              Run these tests in the Compiler
                            </Button>
                          </div>
                        )}
                        {!!res.edgeCases?.length && (
                          <div>
                            <h4 className="mb-1.5 text-xs font-medium text-muted">Edge cases to consider</h4>
                            <ul className="list-disc space-y-1 pl-5">
                              {res.edgeCases.map((e) => (
                                <li key={e}>{e}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                    {tab === 'issues' && <IssueList issues={res.issues ?? []} />}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-[460px] rounded-xl" />
    </div>
  );
}
