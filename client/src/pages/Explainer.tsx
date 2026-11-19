import { Children, useEffect, useState } from 'react';
import { BookText, Boxes, GitBranch, ListTree, MessageSquareCode, Repeat, ShieldAlert, Sparkles, Split, Timer, Variable } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Segmented, Skeleton, Tabs } from '@/components/ui/primitives';
import { CodePanel, ComplexityChips, EngineBadge, EngineNotice, IssueList, LanguageSelect } from '@/components/common';
import { useHandoff, useSettings } from '@/store';
import { cn } from '@/lib/utils';
import type { Complexity, Engine, Issue, Lang } from '@/lib/types';

interface Explanation {
  engine: Engine;
  parsed: boolean;
  parseError?: string;
  summary: string;
  overview: string[];
  lines: { line: number; code: string; kind: string; text: string }[];
  functions: { name: string; params: string; returns: string; line: number | null; description: string; recursive: boolean; kind?: string; complexity?: { time: string; space: string; confidence: string; pattern: string | null } }[];
  classes?: { name: string; line: number; base: string | null; methods: string[]; fields: string[] }[];
  syntaxErrors?: { line: number; column: number; message: string }[];
  analysisEngine?: string;
  variables: { name: string; type: string; scope: string }[];
  loops: { line: number | null; kind: string; description: string; depth: number }[];
  conditions: { line: number | null; condition: string; description: string }[];
  dataStructures: { name: string; kind: string; description: string }[];
  concepts: { name: string; description: string }[];
  complexity: Complexity;
  issues: Issue[];
  stats: { lines: number; codeLines: number; comments: number; functions: number };
}

const SAMPLE = `#include <stdio.h>

int binarySearch(int arr[], int n, int target) {
    int low = 0, high = n - 1;
    while (low <= high) {
        int mid = (low + high) / 2;
        if (arr[mid] == target)
            return mid;
        else if (arr[mid] < target)
            low = mid + 1;
        else
            high = mid - 1;
    }
    return -1;
}

int main() {
    int arr[] = {3, 8, 15, 21, 40, 57};
    int target;
    scanf("%d", &target);
    int pos = binarySearch(arr, 6, target);
    if (pos != -1)
        printf("Found at index %d\\n", pos);
    else
        printf("Not found\\n");
    return 0;
}
`;

const KIND_TONE: Record<string, string> = {
  function: 'text-primary', loop: 'text-secondary', condition: 'text-warning', input: 'text-info', output: 'text-info', return: 'text-primary', declaration: 'text-fg', assignment: 'text-fg', comment: 'text-subtle', include: 'text-subtle', brace: 'text-subtle',
};

export default function Explainer() {
  const settings = useSettings((s) => s.settings);
  const [code, setCode] = useState(SAMPLE);
  const [language, setLanguage] = useState<Lang>('c');
  const [mode, setMode] = useState<'beginner' | 'advanced'>(settings.explanationMode);
  const [res, setRes] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'lines' | 'structure' | 'concepts' | 'issues'>('lines');
  const [hl, setHl] = useState<number | null>(null);
  const [showBraces, setShowBraces] = useState(false);
  const take = useHandoff((s) => s.take);

  useEffect(() => {
    const h = take('explainer');
    if (h) {
      setCode(h.code);
      setLanguage(h.language);
      void explain(h.code, h.language);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const explain = async (c = code, l = language, m = mode) => {
    if (!c.trim()) return setError('Paste or write some code first.');
    setLoading(true);
    setError('');
    try {
      setRes(await api.post<Explanation>('/explain', { code: c, language: l, mode: m }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const lines = res?.lines.filter((l) => showBraces || (l.kind !== 'brace' && l.kind !== 'comment')) ?? [];

  return (
    <div>
      <PageHeader
        title="Code Explainer"
        icon={MessageSquareCode}
        description="Understand any program: summary, line-by-line walkthrough, functions, loops, data structures, complexity and potential bugs."
        actions={
          <>
            <Segmented value={mode} onChange={(m) => { setMode(m); if (res) void explain(code, language, m); }} options={[{ value: 'beginner', label: 'Beginner' }, { value: 'advanced', label: 'Advanced' }]} />
            <LanguageSelect value={language} onChange={setLanguage} />
            <Button variant="primary" icon={Sparkles} loading={loading} onClick={() => explain()}>
              Explain code
            </Button>
          </>
        }
      />
      {error && <Alert tone="danger" className="mb-4">{error}</Alert>}
      <div className="grid gap-4 xl:grid-cols-2">
        <CodePanel className="h-[640px] xl:sticky xl:top-0" title="Your code" code={code} onChange={setCode} language={language} highlightLine={hl} onRun={() => explain()} markers={res?.issues.filter((i) => i.line).map((i) => ({ line: i.line!, message: i.message, severity: i.severity }))} />
        <div className="min-w-0 space-y-4">
          {loading && !res && <Skeleton className="h-[640px] rounded-xl" />}
          {!res && !loading && (
            <Card className="h-full">
              <EmptyState icon={BookText} title="Explanation will appear here" description="Press “Explain code” (or Ctrl+Enter in the editor). Without Local AI, explanations come from syntax-aware analysis — they describe what each construct does, not the author's intent." />
            </Card>
          )}
          {res && (
            <>
              <Card className="p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <EngineBadge engine={res.engine} />
                  <Badge>{res.stats.codeLines} code lines</Badge>
                  <Badge>{res.stats.functions} functions</Badge>
                  {!res.parsed && <Badge tone="warning">Structure partially analysed</Badge>}
                </div>
                <EngineNotice engine={res.engine} />
                <p className="mt-2 text-[14px] font-medium">{res.summary}</p>
                <ul className="mt-2 space-y-1 text-[13px] text-fg/85">
                  {res.overview.map((o, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-primary">•</span>
                      {o}
                    </li>
                  ))}
                </ul>
                {!!res.syntaxErrors?.length && (
                  <p className="mt-2 text-xs text-danger">Syntax error on line {res.syntaxErrors[0].line}: {res.syntaxErrors[0].message}</p>
                )}
                {res.parseError && !res.syntaxErrors?.length && <p className="mt-2 text-xs text-subtle">Converter IR could not represent part of this code ({res.parseError}); structure comes from the full-language syntax tree.</p>}
                {res.analysisEngine && <p className="mt-1 text-[11px] text-subtle">Analysis: {res.analysisEngine}</p>}
                <div className="mt-3">
                  <ComplexityChips time={res.complexity.time} space={res.complexity.space} confidence={res.complexity.confidence} pattern={res.complexity.pattern} />
                  <ul className="mt-2 space-y-0.5 text-xs text-muted">
                    {res.complexity.reasons.map((r) => (
                      <li key={r}>– {r}</li>
                    ))}
                  </ul>
                </div>
              </Card>
              <Card>
                <Tabs
                  className="px-2"
                  value={tab}
                  onChange={setTab}
                  tabs={[
                    { value: 'lines', label: 'Line by line', icon: ListTree },
                    { value: 'structure', label: 'Structure', icon: Boxes },
                    { value: 'concepts', label: 'Concepts', icon: BookText },
                    { value: 'issues', label: 'Issues', icon: ShieldAlert, count: res.issues.length },
                  ]}
                  right={tab === 'lines' ? <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={showBraces} onChange={(e) => setShowBraces(e.target.checked)} /> braces & comments</label> : undefined}
                />
                <div className="max-h-[520px] overflow-y-auto p-3">
                  {tab === 'lines' && (
                    <ol className="space-y-1">
                      {lines.map((l) => (
                        <li key={l.line}>
                          <button onMouseEnter={() => setHl(l.line)} onMouseLeave={() => setHl(null)} onClick={() => setHl(l.line)} className={cn('grid w-full grid-cols-[38px_1fr] gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-elevated', hl === l.line && 'bg-primary-soft')}>
                            <span className="pt-0.5 text-right font-mono text-[11px] text-subtle">{l.line}</span>
                            <span className="min-w-0">
                              <code className={cn('block truncate font-mono text-[12px]', KIND_TONE[l.kind] ?? 'text-fg')}>{l.code.trim()}</code>
                              <span className="block text-[13px] text-fg/85">{l.text}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                  {tab === 'structure' && (
                    <div className="space-y-4 p-1 text-[13px]">
                      {!!res.classes?.length && (
                        <Group title="Classes" icon={Boxes} empty="">
                          {res.classes.map((c) => (
                            <Row key={c.name} line={c.line} onJump={setHl} title={<span className="font-mono text-primary">class {c.name}{c.base ? ` : ${c.base}` : ''}</span>} text={`${c.methods.length} method(s): ${c.methods.join(', ') || 'none'}${c.fields.length ? ` · fields: ${c.fields.slice(0, 6).join(', ')}` : ''}`} />
                          ))}
                        </Group>
                      )}
                      <Group title="Functions" icon={GitBranch} empty="No helper functions (only main / script code).">
                        {res.functions.map((f) => (
                          <Row
                            key={f.name}
                            line={f.line}
                            onJump={setHl}
                            title={<span className="font-mono text-primary">{f.name}({f.params}){f.returns && f.returns !== '—' ? ` → ${f.returns}` : ''}</span>}
                            text={`${f.description}${f.complexity ? ` Time ${f.complexity.time}, space ${f.complexity.space} (${f.complexity.confidence} confidence${f.complexity.pattern ? `, ${f.complexity.pattern}` : ''}).` : ''}`}
                            badge={f.recursive ? 'recursive' : f.kind && f.kind !== 'function' ? f.kind : undefined}
                          />
                        ))}
                      </Group>
                      <Group title="Loops" icon={Repeat} empty="No loops.">
                        {res.loops.map((l, i) => (
                          <Row key={i} line={l.line} onJump={setHl} title={<span className="capitalize">{l.kind}{l.depth ? ` (nested ×${l.depth})` : ''}</span>} text={l.description} />
                        ))}
                      </Group>
                      <Group title="Conditions" icon={Split} empty="No conditional statements.">
                        {res.conditions.map((c, i) => (
                          <Row key={i} line={c.line} onJump={setHl} title={<span className="font-mono text-warning">{c.condition}</span>} text={c.description} />
                        ))}
                      </Group>
                      <Group title="Variables" icon={Variable} empty="No variables detected.">
                        <div className="flex flex-wrap gap-1.5">
                          {res.variables.map((v) => (
                            <span key={v.scope + v.name} className="rounded-md border border-border bg-panel px-2 py-1 text-xs">
                              <span className="font-mono text-primary">{v.name}</span> <span className="text-muted">{v.type}</span> <span className="text-subtle">· {v.scope}</span>
                            </span>
                          ))}
                        </div>
                      </Group>
                      <Group title="Data structures" icon={Boxes} empty="Only scalar variables are used.">
                        {res.dataStructures.map((d) => (
                          <Row key={d.name + d.kind} title={<><span className="font-mono text-primary">{d.name}</span> · {d.kind}</>} text={d.description} />
                        ))}
                      </Group>
                    </div>
                  )}
                  {tab === 'concepts' && (
                    <div className="grid gap-2 p-1 sm:grid-cols-2">
                      {res.concepts.length ? res.concepts.map((c) => (
                        <div key={c.name} className="rounded-lg border border-border bg-panel p-3">
                          <p className="flex items-center gap-1.5 text-[13px] font-semibold"><Timer size={13} className="text-primary" />{c.name}</p>
                          <p className="mt-1 text-[13px] text-muted">{c.description}</p>
                        </div>
                      )) : <p className="text-muted">No notable concepts detected.</p>}
                    </div>
                  )}
                  {tab === 'issues' && (
                    <div className="p-1">
                      <IssueList issues={res.issues} onJump={setHl} />
                    </div>
                  )}
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ title, icon: Icon, empty, children }: { title: string; icon: typeof Repeat; empty: string; children: React.ReactNode }) {
  const kids = Children.toArray(children);
  const has = kids.length > 1 || (kids.length === 1 && !((kids[0] as any)?.props?.children?.length === 0));
  return (
    <div>
      <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        <Icon size={13} /> {title}
      </h4>
      {has ? <div className="space-y-1.5">{children}</div> : <p className="text-xs text-subtle">{empty}</p>}
    </div>
  );
}

function Row({ title, text, line, onJump, badge }: { title: React.ReactNode; text: string; line?: number | null; onJump?: (l: number) => void; badge?: string }) {
  return (
    <div className="rounded-lg border border-border bg-panel px-3 py-2">
      <p className="flex items-center gap-2 text-[13px]">
        {line ? (
          <button className="font-mono text-[11px] text-primary hover:underline" onClick={() => onJump?.(line)}>
            L{line}
          </button>
        ) : null}
        {title}
        {badge && <Badge tone="primary">{badge}</Badge>}
      </p>
      <p className="mt-0.5 text-[12.5px] text-muted">{text}</p>
    </div>
  );
}
