import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bug, CheckCircle2, CircleSlash, Clock, Eraser, FlaskConical, Play, Plus, RefreshCw, ShieldAlert, ShieldCheck, Sparkles, Terminal, Trash2, Wand2, XCircle, Cpu, Check } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, PageHeader, Select, Skeleton, Tabs, Textarea, Tooltip } from '@/components/ui/primitives';
import { Dialog, toast } from '@/components/ui/overlay';
import { CodePanel, DiagnosisList, EngineBadge, EngineNotice, IssueList, LanguageSelect, Pre } from '@/components/common';
import { DiffView } from '@/components/code/CodeEditor';
import { useHandoff, useSettings } from '@/store';
import { langLabel, cn } from '@/lib/utils';
import type { Diagnosis, Engine, ExecResult, Issue, Lang, Runtime, SandboxInfo } from '@/lib/types';

const SAMPLES: Record<Lang, { name: string; code: string; stdin: string }[]> = {
  c: [
    { name: 'Sum of n numbers', stdin: '5\n10 20 30 40 50\n', code: '#include <stdio.h>\n\nint main() {\n    int n, x, sum = 0;\n    scanf("%d", &n);\n    for (int i = 0; i < n; i++) {\n        scanf("%d", &x);\n        sum += x;\n    }\n    printf("Sum = %d\\n", sum);\n    printf("Average = %.2f\\n", (double) sum / n);\n    return 0;\n}\n' },
    { name: 'Buggy: missing semicolon', stdin: '', code: '#include <stdio.h>\n\nint main() {\n    int a = 10\n    int b = 20;\n    printf("Sum = %d\\n", a + b);\n    return 0;\n}\n' },
  ],
  cpp: [
    { name: 'Vector statistics', stdin: '6\n4 8 15 16 23 42\n', code: '#include <iostream>\n#include <vector>\n#include <algorithm>\nusing namespace std;\n\nint main() {\n    int n;\n    cin >> n;\n    vector<int> v(n);\n    for (int i = 0; i < n; i++) cin >> v[i];\n    sort(v.begin(), v.end());\n    cout << "Min: " << v.front() << ", Max: " << v.back() << endl;\n    cout << "Median: " << v[n / 2] << endl;\n    return 0;\n}\n' },
    { name: 'Buggy: assignment in if', stdin: '', code: '#include <iostream>\nusing namespace std;\n\nint main() {\n    int score = 45;\n    if (score = 100) {\n        cout << "Perfect!" << endl;\n    }\n    return 0;\n}\n' },
  ],
  java: [
    { name: 'Palindrome check', stdin: 'racecar\n', code: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        String s = sc.next();\n        boolean ok = true;\n        for (int i = 0, j = s.length() - 1; i < j; i++, j--) {\n            if (s.charAt(i) != s.charAt(j)) { ok = false; break; }\n        }\n        System.out.println(s + (ok ? " is" : " is not") + " a palindrome");\n    }\n}\n' },
    { name: 'Buggy: index out of bounds', stdin: '', code: 'public class Main {\n    public static void main(String[] args) {\n        int[] marks = {78, 91, 66, 84};\n        int total = 0;\n        for (int i = 0; i <= marks.length; i++) {\n            total += marks[i];\n        }\n        System.out.println("Total: " + total);\n    }\n}\n' },
  ],
  python: [
    { name: 'Word frequency', stdin: 'the quick brown fox jumps over the lazy dog the end\n', code: 'text = input().split()\nfreq = {}\nfor w in text:\n    freq[w] = freq.get(w, 0) + 1\nfor word, count in sorted(freq.items(), key=lambda x: (-x[1], x[0]))[:3]:\n    print(word, count)\n' },
    { name: 'Buggy: missing colon', stdin: '', code: 'def average(values)\n    return sum(values) / len(values)\n\nprint(average([4, 8, 15, 16]))\n' },
  ],
  javascript: [
    { name: 'FizzBuzz', stdin: '15\n', code: "const n = Number(require('fs').readFileSync(0, 'utf8').trim());\nfor (let i = 1; i <= n; i++) {\n  let out = '';\n  if (i % 3 === 0) out += 'Fizz';\n  if (i % 5 === 0) out += 'Buzz';\n  console.log(out || i);\n}\n" },
    { name: 'Buggy: undefined variable', stdin: '', code: 'function area(r) {\n  return Math.PI * radius * radius;\n}\nconsole.log(area(2).toFixed(2));\n' },
  ],
};

const STATUS: Record<ExecResult['status'], { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral'; icon: typeof Check }> = {
  success: { label: 'Success', tone: 'success', icon: CheckCircle2 },
  compile_error: { label: 'Compilation error', tone: 'danger', icon: XCircle },
  runtime_error: { label: 'Runtime error', tone: 'danger', icon: XCircle },
  timeout: { label: 'Time limit exceeded', tone: 'warning', icon: Clock },
  blocked: { label: 'Blocked by guard', tone: 'warning', icon: ShieldAlert },
  unavailable: { label: 'Runtime missing', tone: 'neutral', icon: CircleSlash },
  busy: { label: 'Busy', tone: 'warning', icon: Clock },
  internal_error: { label: 'Internal error', tone: 'danger', icon: XCircle },
};

interface DiagResult {
  engine: Engine;
  executed: boolean;
  executionSkipped?: string;
  exec: ExecResult | null;
  diagnostics: Diagnosis[];
  issues: Issue[];
  repair: { fixed: string; changes: { line: number; description: string }[]; source: string };
}
interface TestCase {
  input: string;
  expected: string;
  note?: string;
}
interface TestRun {
  passed: number;
  total: number;
  results: { input: string; expected: string; actual: string; status: string; passed: boolean; timeMs: number | null; error: string }[];
}

export default function Compiler() {
  const { settings, update } = useSettings();
  const [runtimes, setRuntimes] = useState<Runtime[] | null>(null);
  const [sandbox, setSandbox] = useState<SandboxInfo | null>(null);
  const [lang, setLang] = useState<Lang>(settings.defaultLanguage);
  const [code, setCode] = useState(SAMPLES[settings.defaultLanguage][0].code);
  const [stdin, setStdin] = useState(SAMPLES[settings.defaultLanguage][0].stdin);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<'output' | 'debug' | 'tests'>('output');
  const [consent, setConsent] = useState(false);
  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [tests, setTests] = useState<TestCase[]>([{ input: '', expected: '' }]);
  const [testRun, setTestRun] = useState<TestRun | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testEngine, setTestEngine] = useState<Engine | null>(null);
  const take = useHandoff((s) => s.take);

  const loadRuntimes = async (refresh = false) => {
    try {
      const r = await api.get<{ runtimes: Runtime[]; sandbox?: SandboxInfo }>(`/runtimes${refresh ? '?refresh=1' : ''}`);
      setRuntimes(r.runtimes);
      setSandbox(r.sandbox ?? null);
    } catch {
      setRuntimes([]);
    }
  };
  useEffect(() => {
    void loadRuntimes();
    const h = take('compiler');
    if (h) {
      setLang(h.language);
      setCode(h.code);
      setStdin(h.stdin ?? '');
      const t = h.extra?.tests as TestCase[] | undefined;
      if (t?.length) setTests(t.map((x) => ({ input: x.input, expected: x.expected })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rt = runtimes?.find((r) => r.language === lang);
  const markers = useMemo(
    () => [
      ...(result?.diagnostics ?? []).filter((d) => d.line).map((d) => ({ line: d.line!, message: `${d.title}: ${d.explanation}`, severity: d.severity })),
      ...(diag?.issues ?? []).filter((i) => i.line).map((i) => ({ line: i.line!, message: i.message, severity: i.severity })),
    ],
    [result, diag],
  );

  const run = async () => {
    if (!settings.executionEnabled) return setConsent(true);
    setRunning(true);
    setTab('output');
    try {
      const r = await api.post<ExecResult>('/execute', { code, language: lang, stdin });
      setResult(r);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'execution_disabled') setConsent(true);
      else toast.error('Run failed', (e as Error).message);
    } finally {
      setRunning(false);
    }
  };
  const diagnose = async () => {
    setDiagLoading(true);
    setTab('debug');
    try {
      setDiag(await api.post<DiagResult>('/debug/diagnose', { code, language: lang, stdin, run: true }));
    } catch (e) {
      toast.error('Diagnosis failed', (e as Error).message);
    } finally {
      setDiagLoading(false);
    }
  };
  const runTests = async () => {
    if (!settings.executionEnabled) return setConsent(true);
    const valid = tests.filter((t) => t.input.trim() || t.expected.trim());
    if (!valid.length) return toast.warning('Add at least one test case');
    setTestLoading(true);
    try {
      setTestRun(await api.post<TestRun>('/debug/tests', { code, language: lang, tests: valid }));
    } catch (e) {
      toast.error('Test run failed', (e as Error).message);
    } finally {
      setTestLoading(false);
    }
  };
  const genTests = async () => {
    setTestLoading(true);
    try {
      const r = await api.post<{ engine: Engine; tests: TestCase[] }>('/debug/generate-tests', { code, language: lang });
      setTests(r.tests.length ? r.tests : [{ input: '', expected: '' }]);
      setTestEngine(r.engine);
      setTestRun(null);
    } catch (e) {
      toast.error('Could not generate tests', (e as Error).message);
    } finally {
      setTestLoading(false);
    }
  };

  const changeLang = (l: Lang) => {
    setLang(l);
    setCode(SAMPLES[l][0].code);
    setStdin(SAMPLES[l][0].stdin);
    setResult(null);
    setDiag(null);
    setTestRun(null);
  };

  return (
    <div>
      <PageHeader
        title="Compiler & Debugger"
        icon={Bug}
        description="Compile and run programs with your locally installed toolchains, interpret errors, generate tests and repair common mistakes."
        actions={
          <>
            <LanguageSelect value={lang} onChange={changeLang} />
            <Select aria-label="Sample programs" className="w-[200px]" value="" onChange={(e) => { const s = SAMPLES[lang][Number(e.target.value)]; if (s) { setCode(s.code); setStdin(s.stdin); setResult(null); setDiag(null); } }}>
              <option value="">Load a sample program…</option>
              {SAMPLES[lang].map((s, i) => (
                <option key={s.name} value={i}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Button icon={Wand2} onClick={diagnose} loading={diagLoading}>
              Debug
            </Button>
            <Button variant="primary" icon={Play} onClick={run} loading={running} disabled={rt && !rt.available}>
              Run
            </Button>
          </>
        }
      />

      {!settings.executionEnabled && (
        <Alert tone="warning" icon={ShieldAlert} className="mb-4" title="Code execution is turned off" action={<Button size="sm" variant="primary" onClick={() => setConsent(true)}>Review & enable</Button>}>
          Running programs executes code on your computer. Read the safety notice before enabling it. Static debugging works without execution.
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="min-w-0 space-y-4">
          <CodePanel className="h-[460px]" title={`main.${lang === 'python' ? 'py' : lang === 'javascript' ? 'js' : lang}`} code={code} onChange={setCode} language={lang} markers={markers} onRun={run} subtitle={<span className="hidden text-[11px] text-subtle md:inline">Ctrl+Enter to run</span>} />
          <Card>
            <Tabs
              className="px-2"
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'output', label: 'Output', icon: Terminal },
                { value: 'debug', label: 'Debugger', icon: Wand2, count: diag ? diag.diagnostics.length + diag.issues.length : undefined },
                { value: 'tests', label: 'Test cases', icon: FlaskConical, count: testRun ? testRun.total : undefined },
              ]}
              right={tab === 'output' && result ? <Button size="xs" variant="ghost" icon={Eraser} onClick={() => setResult(null)}>Clear</Button> : undefined}
            />
            <div className="p-4">
              {tab === 'output' && <OutputView result={result} running={running} />}
              {tab === 'debug' && (
                <DebugView
                  diag={diag}
                  loading={diagLoading}
                  lang={lang}
                  code={code}
                  onApply={(fixed) => {
                    setCode(fixed);
                    setDiag(null);
                    toast.success('Fix applied', 'Run the program again to check it.');
                  }}
                  onDiagnose={diagnose}
                />
              )}
              {tab === 'tests' && (
                <TestsView tests={tests} setTests={setTests} run={testRun} loading={testLoading} onRun={runTests} onGenerate={genTests} engine={testEngine} />
              )}
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Standard input (STDIN)" icon={Terminal} subtitle="Supplied to the program when it runs" />
            <div className="p-3">
              <Textarea value={stdin} onChange={(e) => setStdin(e.target.value)} rows={6} className="font-mono text-[12.5px]" placeholder="Input values, one per line or space separated" aria-label="Standard input" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Installed runtimes" icon={Cpu} actions={<Button size="xs" variant="ghost" icon={RefreshCw} onClick={() => loadRuntimes(true)}>Re-detect</Button>} />
            {!runtimes ? (
              <div className="space-y-2 p-4">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {runtimes.map((r) => (
                  <li key={r.language} className={cn('px-4 py-2.5', r.language === lang && 'bg-primary-soft/50')}>
                    <div className="flex items-center gap-2">
                      {r.available ? <CheckCircle2 size={15} className="text-success" /> : <XCircle size={15} className="text-danger" />}
                      <span className="text-[13px] font-medium">{r.label}</span>
                      <span className="ml-auto font-mono text-[11px] text-subtle">{r.tool}</span>
                    </div>
                    <p className="mt-0.5 truncate pl-6 text-[11.5px] text-muted" title={r.version ?? ''}>
                      {r.available ? r.version : r.installHint}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="p-4 text-xs leading-relaxed text-muted">
            <p className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-fg">
              <ShieldCheck size={15} className="text-secondary" /> Execution safeguards
            </p>
            <div className="mb-2">
              <Badge tone={sandbox?.available ? 'success' : 'warning'}>{sandbox?.available ? 'Windows sandbox active' : 'Guarded process only'}</Badge>
            </div>
            {sandbox?.available ? (
              <>
                Windows Job Object (memory and CPU limits, child processes blocked, killed when the run ends) · low integrity level (cannot write your files) · {sandbox.dataProtected ? 'CodePilot data folder unreadable · ' : ''}
              </>
            ) : null}
            Separate runner process · temporary folder deleted after each run · {Math.round(settings.executionTimeoutMs / 1000)} s time limit · 64 KB output cap · stripped environment (no app secrets or database path) · static guard · Python audit hook · Node.js permission model.
            {sandbox?.limitations.length ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-warning">
                {sandbox.limitations.map((l) => <li key={l}>{l}</li>)}
              </ul>
            ) : null}
          </Card>
        </div>
      </div>

      <Dialog
        open={consent}
        onClose={() => setConsent(false)}
        size="lg"
        title="Enable local code execution?"
        description="CodePilot runs your programs with the compilers installed on this computer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConsent(false)}>
              Keep disabled
            </Button>
            <Button
              variant="primary"
              icon={ShieldCheck}
              onClick={async () => {
                await update({ executionEnabled: true });
                setConsent(false);
                toast.success('Code execution enabled', 'You can turn it off any time in Settings.');
              }}
            >
              I understand — enable execution
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[13px] leading-relaxed">
          {sandbox?.available ? (
            <Alert tone="info" icon={ShieldCheck} title="Programs run in a restricted Windows sandbox">
              CodePilot uses a Windows Job Object and a low-integrity token. This blocks writing your files, starting other programs and reading CodePilot's data, but it is not a virtual machine: network access is not blocked by the OS and programs can still read ordinary files you can read. Only run code you wrote or trust.
            </Alert>
          ) : (
            <Alert tone="warning" icon={AlertTriangle} title="No operating-system sandbox is available">
              A time limit and process isolation cannot fully contain malicious code. Only run code you wrote or trust.
            </Alert>
          )}
          <p className="font-medium">What CodePilot does to reduce risk:</p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>Every run happens in a separate runner process — never inside the API server.</li>
            <li>Programs run in a fresh temporary folder that is deleted afterwards.</li>
            <li>The environment is stripped: no application settings, secrets or database location are passed on.</li>
            <li>Strict time limit ({settings.executionTimeoutMs / 1000} s) with process-tree termination, and a 64 KB output cap.</li>
            <li>A static guard blocks process creation, networking, native code and file-modifying APIs before running.</li>
            <li>Python runs with an audit hook blocking file writes, sockets and subprocesses; JavaScript runs with Node's permission model.</li>
            {sandbox?.available && <li>Each program runs inside a Windows Job Object (memory/CPU limits, one process only) with a low-integrity token; CodePilot's database folder is marked unreadable to it.</li>}
          </ul>
          <p className="text-muted">Unrestricted execution is never offered.</p>
        </div>
      </Dialog>
    </div>
  );
}

function OutputView({ result, running }: { result: ExecResult | null; running: boolean }) {
  if (running) return <div className="flex items-center gap-2 text-sm text-muted"><RefreshCw size={15} className="animate-spin text-primary" /> Compiling and running…</div>;
  if (!result) return <EmptyState icon={Terminal} title="No output yet" description="Press Run (or Ctrl+Enter in the editor) to execute the program." className="py-6" />;
  const s = STATUS[result.status];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={s.tone} icon={s.icon}>
          {s.label}
        </Badge>
        {result.compileTimeMs !== null && <Badge>compile {result.compileTimeMs} ms</Badge>}
        {result.timeMs !== null && <Badge>run {result.timeMs} ms</Badge>}
        {result.exitCode !== null && <Badge>exit code {result.exitCode}</Badge>}
        {result.isolation && <Badge tone={result.isolation === 'process' ? 'warning' : 'success'}>{result.isolation === 'process' ? 'guarded process' : 'sandboxed'}</Badge>}
        {result.truncated && <Badge tone="warning">output truncated</Badge>}
      </div>
      {result.message && <p className="text-[13px] text-muted">{result.message}</p>}
      {result.violations?.length ? (
        <ul className="space-y-1.5">
          {result.violations.map((v, i) => (
            <li key={i} className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-[13px]">
              <span className="font-mono text-xs text-warning">L{v.line}</span> {v.rule}
              <code className="mt-1 block truncate font-mono text-xs text-muted">{v.text}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {result.status !== 'compile_error' && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">stdout</p>
          <Pre className="max-h-72 min-h-[60px]">{result.stdout || <span className="text-subtle">(no output)</span>}</Pre>
        </div>
      )}
      {(result.stderr || result.compileOutput) && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{result.status === 'compile_error' ? 'Compiler output' : 'stderr / warnings'}</p>
          <Pre className="max-h-56 text-danger/90">{result.status === 'compile_error' ? result.compileOutput : [result.stderr, result.compileOutput].filter(Boolean).join('\n')}</Pre>
        </div>
      )}
      {!!result.diagnostics?.length && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">What went wrong</p>
          <DiagnosisList items={result.diagnostics} />
        </div>
      )}
    </div>
  );
}

function DebugView({ diag, loading, lang, code, onApply, onDiagnose }: { diag: DiagResult | null; loading: boolean; lang: Lang; code: string; onApply: (c: string) => void; onDiagnose: () => void }) {
  if (loading) return <div className="flex items-center gap-2 text-sm text-muted"><RefreshCw size={15} className="animate-spin text-primary" /> Analysing…</div>;
  if (!diag) return <EmptyState icon={Wand2} title="Find bugs and suggested fixes" description="The debugger runs the program (when execution is enabled), interprets compiler and runtime errors, checks for common mistakes and proposes repairs as a before/after diff." action={<Button variant="primary" icon={Sparkles} onClick={onDiagnose}>Debug this program</Button>} className="py-6" />;
  const changed = diag.repair.fixed.trim() !== code.trim();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <EngineBadge engine={diag.engine} />
        {diag.exec && <Badge tone={STATUS[diag.exec.status].tone}>Run: {STATUS[diag.exec.status].label}</Badge>}
        {diag.executionSkipped && <Badge tone="warning">{diag.executionSkipped}</Badge>}
      </div>
      <EngineNotice engine={diag.engine} />
      {!!diag.diagnostics.length && (
        <div>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Compiler / runtime errors explained</h4>
          <DiagnosisList items={diag.diagnostics} />
        </div>
      )}
      <div>
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Common mistake detection</h4>
        <IssueList issues={diag.issues} />
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold tracking-wide text-muted uppercase">Suggested repair ({diag.repair.source === 'ollama' ? 'local AI' : 'rule-based'})</h4>
          {changed && (
            <Button size="sm" variant="primary" icon={Check} onClick={() => onApply(diag.repair.fixed)}>
              Apply fix
            </Button>
          )}
        </div>
        {changed ? (
          <>
            <ul className="mb-2 space-y-1 text-[13px]">
              {diag.repair.changes.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <Wand2 size={13} className="mt-0.5 text-primary" />
                  {c.line ? <span className="font-mono text-xs text-muted">L{c.line}</span> : null}
                  {c.description}
                </li>
              ))}
            </ul>
            <div className="h-[320px] overflow-hidden rounded-lg border border-border">
              <DiffView original={code} modified={diag.repair.fixed} language={lang} />
            </div>
          </>
        ) : (
          <p className="text-[13px] text-muted">No automatic repair available. {diag.diagnostics.length || diag.issues.length ? 'Follow the suggestions above.' : ''}</p>
        )}
      </div>
    </div>
  );
}

function TestsView({ tests, setTests, run, loading, onRun, onGenerate, engine }: { tests: TestCase[]; setTests: (t: TestCase[]) => void; run: TestRun | null; loading: boolean; onRun: () => void; onGenerate: () => void; engine: Engine | null }) {
  const upd = (i: number, k: 'input' | 'expected', v: string) => setTests(tests.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Sparkles} onClick={onGenerate} loading={loading}>
          Generate test cases
        </Button>
        <Button size="sm" icon={Plus} onClick={() => setTests([...tests, { input: '', expected: '' }])}>
          Add test
        </Button>
        <Button size="sm" variant="primary" icon={FlaskConical} onClick={onRun} loading={loading}>
          Run all tests
        </Button>
        {engine && <EngineBadge engine={engine} />}
        {run && (
          <Badge tone={run.passed === run.total ? 'success' : 'danger'} className="ml-auto">
            {run.passed}/{run.total} passed
          </Badge>
        )}
      </div>
      <div className="space-y-2">
        {tests.map((t, i) => {
          const r = run?.results[i];
          return (
            <div key={i} className={cn('rounded-lg border p-2.5', r ? (r.passed ? 'border-success/30' : 'border-danger/30') : 'border-border')}>
              <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
                <span className="font-medium text-fg">Test {i + 1}</span>
                {t.note && <span className="truncate">{t.note}</span>}
                {r && (r.passed ? <Badge tone="success">passed</Badge> : <Badge tone="danger">{r.status === 'success' ? 'wrong output' : r.status}</Badge>)}
                <Tooltip label="Remove test" className="ml-auto">
                  <button aria-label={`Remove test ${i + 1}`} onClick={() => setTests(tests.filter((_, j) => j !== i))} className="text-subtle hover:text-danger">
                    <Trash2 size={14} />
                  </button>
                </Tooltip>
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                <Textarea value={t.input} onChange={(e) => upd(i, 'input', e.target.value)} rows={2} className="min-h-[56px] font-mono text-xs" placeholder="Input" aria-label={`Test ${i + 1} input`} />
                <Textarea value={t.expected} onChange={(e) => upd(i, 'expected', e.target.value)} rows={2} className="min-h-[56px] font-mono text-xs" placeholder="Expected output" aria-label={`Test ${i + 1} expected output`} />
                <Pre className={cn('min-h-[56px] text-xs', r && !r.passed && 'text-danger')}>{r ? r.actual || r.error || '(no output)' : <span className="text-subtle">Actual output</span>}</Pre>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-subtle">Outputs are compared after trimming trailing whitespace on each line.</p>
    </div>
  );
}

