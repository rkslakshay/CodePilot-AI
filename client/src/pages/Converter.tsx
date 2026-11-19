import { useEffect, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, FlaskConical, Shuffle, XCircle, AlertTriangle, GitCompare, Info, Play } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, PageHeader, Tabs, Textarea } from '@/components/ui/primitives';
import { Dialog, toast } from '@/components/ui/overlay';
import { CodePanel, EngineBadge, EngineNotice, LanguageSelect, Pre } from '@/components/common';
import { useHandoff } from '@/store';
import { langLabel, cn } from '@/lib/utils';
import type { Engine, ExecResult, Lang } from '@/lib/types';

interface ConvResult {
  engine: Engine;
  ok: boolean;
  message?: string;
  code: string;
  explanation: string;
  warnings: string[];
  notes: string[];
  verification: string;
  comparison: {
    logic: { aspect: string; original: string; converted: string; same: boolean }[];
    syntaxChanges: string[];
    dataStructures: { name: string; from: string; to: string }[];
    behaviouralDifferences: string[];
  };
}

const SAMPLE = `def is_prime(n):
    if n < 2:
        return False
    i = 2
    while i * i <= n:
        if n % i == 0:
            return False
        i += 1
    return True


n = int(input())
count = 0
for k in range(2, n + 1):
    if is_prime(k):
        print(k, end=" ")
        count += 1
print()
print("Primes found:", count)
`;

export default function Converter() {
  const [from, setFrom] = useState<Lang>('python');
  const [to, setTo] = useState<Lang>('java');
  const [source, setSource] = useState(SAMPLE);
  const [res, setRes] = useState<ConvResult | null>(null);
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'explanation' | 'comparison' | 'warnings'>('comparison');
  const [verifyOpen, setVerifyOpen] = useState(false);
  const take = useHandoff((s) => s.take);
  const send = useHandoff((s) => s.send);
  const nav = useNavigate();

  useEffect(() => {
    const h = take('converter');
    if (h) {
      setSource(h.code);
      setFrom(h.language);
      if (h.language === to) setTo(h.language === 'python' ? 'java' : 'python');
      if (h.extra?.output) setOutput(String(h.extra.output));
      if (h.extra?.to) setTo(h.extra.to as Lang);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take]);

  const convert = async () => {
    if (!source.trim()) return setError('Paste some code to convert.');
    if (from === to) return setError('Choose two different languages.');
    setLoading(true);
    setError('');
    try {
      const r = await api.post<ConvResult>('/convert', { code: source, from, to });
      setRes(r);
      if (r.ok) setOutput(r.code);
      else setError(r.message ?? 'Conversion failed');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const swap = () => {
    setFrom(to);
    setTo(from);
    if (output) {
      setSource(output);
      setOutput('');
      setRes(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Code Converter"
        icon={Shuffle}
        description="Translate programs between C, C++, Java, Python and JavaScript through a structured, language-neutral pipeline."
        actions={
          <Button variant="primary" icon={Shuffle} loading={loading} onClick={convert}>
            Convert
          </Button>
        }
      />
      <Card className="mb-4 flex flex-wrap items-center gap-3 p-3">
        <Field label="From" className="w-[150px]">
          <LanguageSelect value={from} onChange={(l) => { setFrom(l); if (l === to) setTo(from); }} className="w-full" ariaLabel="Source language" />
        </Field>
        <Button variant="ghost" size="icon" icon={ArrowLeftRight} aria-label="Swap languages" onClick={swap} className="mt-5" />
        <Field label="To" className="w-[150px]">
          <LanguageSelect value={to} onChange={(l) => { setTo(l); if (l === from) setFrom(to); }} className="w-full" ariaLabel="Target language" />
        </Field>
        <p className="mt-5 hidden flex-1 text-xs text-subtle md:block">20 language pairs supported. Conversions are not guaranteed to be semantically identical — use “Verify by running” to compare outputs.</p>
      </Card>
      {error && <Alert tone="danger" className="mb-4" icon={XCircle}>{error}</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <CodePanel className="h-[480px]" title={`${langLabel(from)} source`} code={source} onChange={setSource} language={from} saveable={false} onRun={convert} />
        <CodePanel
          className="h-[480px]"
          title={`${langLabel(to)} output`}
          code={output}
          onChange={setOutput}
          language={to}
          fileBase="converted"
          subtitle={res?.ok ? <EngineBadge engine={res.engine} className="ml-1 hidden md:inline-flex" /> : undefined}
          actions={
            output ? (
              <>
                <Button size="xs" variant="ghost" icon={FlaskConical} onClick={() => setVerifyOpen(true)}>
                  Verify by running
                </Button>
                <Button size="xs" variant="ghost" icon={Play} onClick={() => { send({ target: 'compiler', code: output, language: to }); nav('/compiler'); }}>
                  Open in compiler
                </Button>
              </>
            ) : undefined
          }
        />
      </div>
      {!res && !loading && (
        <Card className="mt-4">
          <EmptyState icon={GitCompare} title="Semantic comparison appears after conversion" description="CodePilot compares the logic, syntax, data structures and potential behavioural differences between the original and converted code." />
        </Card>
      )}
      {res?.ok && (
        <Card className="mt-4">
          <div className="px-4 pt-3">
            <EngineNotice engine={res.engine} />
          </div>
          <Tabs
            className="px-2"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'comparison', label: 'Semantic comparison', icon: GitCompare },
              { value: 'explanation', label: 'Explanation', icon: Info },
              { value: 'warnings', label: 'Warnings', icon: AlertTriangle, count: res.warnings.length },
            ]}
          />
          <div className="p-4 text-[13.5px]">
            {tab === 'explanation' && (
              <div className="space-y-3 leading-relaxed">
                <p>{res.explanation}</p>
                <Alert tone="warning" icon={AlertTriangle}>
                  {res.verification}
                </Alert>
              </div>
            )}
            {tab === 'warnings' &&
              (res.warnings.length ? (
                <ul className="space-y-1.5">
                  {res.warnings.map((w, i) => (
                    <li key={i} className="flex gap-2 rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-[13px]">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                      {w}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-2 text-success">
                  <CheckCircle2 size={15} /> Every construct was converted. Still review the behavioural differences.
                </p>
              ))}
            {tab === 'comparison' && (
              <div className="grid gap-4 xl:grid-cols-2">
                <div>
                  <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Original logic vs converted logic</h4>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-[13px]">
                      <thead className="bg-panel text-xs text-muted">
                        <tr>
                          <th className="px-3 py-2 font-medium">Aspect</th>
                          <th className="px-3 py-2 font-medium">{langLabel(from)}</th>
                          <th className="px-3 py-2 font-medium">{langLabel(to)}</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {res.comparison.logic.map((r) => (
                          <tr key={r.aspect} className="border-t border-border">
                            <td className="px-3 py-2 text-muted">{r.aspect}</td>
                            <td className="px-3 py-2 font-mono text-xs">{r.original}</td>
                            <td className="px-3 py-2 font-mono text-xs">{r.converted}</td>
                            <td className="px-3 py-2">{r.same ? <CheckCircle2 size={15} className="text-success" /> : <AlertTriangle size={15} className="text-warning" />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!!res.comparison.dataStructures.length && (
                    <>
                      <h4 className="mt-4 mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Changed data structures</h4>
                      <ul className="space-y-1.5">
                        {res.comparison.dataStructures.map((d) => (
                          <li key={d.name} className="flex flex-wrap items-center gap-2 text-[13px]">
                            <span className="font-mono text-primary">{d.name}</span>
                            <Badge>{d.from}</Badge>→<Badge tone="secondary">{d.to}</Badge>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
                <div className="space-y-4">
                  <div>
                    <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Changed syntax ({langLabel(to)})</h4>
                    <ul className="list-disc space-y-1 pl-5 text-fg/90">
                      {res.comparison.syntaxChanges.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Potential behavioural differences</h4>
                    <ul className="space-y-1.5">
                      {res.comparison.behaviouralDifferences.map((s) => (
                        <li key={s} className="flex gap-2 text-[13px] text-fg/90">
                          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
      <VerifyDialog open={verifyOpen} onClose={() => setVerifyOpen(false)} source={source} from={from} converted={output} to={to} />
    </div>
  );
}

function VerifyDialog({ open, onClose, source, from, converted, to }: { open: boolean; onClose: () => void; source: string; from: Lang; converted: string; to: Lang }) {
  const [stdin, setStdin] = useState('20\n');
  const [loading, setLoading] = useState(false);
  const [r, setR] = useState<{ same: boolean; original: ExecResult; converted: ExecResult; note: string } | null>(null);
  const nav = useNavigate();
  const run = async () => {
    setLoading(true);
    setR(null);
    try {
      setR(await api.post('/convert/verify', { source, from, converted, to, stdin }));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'execution_disabled') {
        toast.warning('Code execution is disabled', 'Enable it in the Compiler & Debugger first.');
        onClose();
        nav('/compiler');
      } else toast.error('Verification failed', (e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const out = (x: ExecResult) => (x.status === 'success' ? x.stdout : `[${x.status}] ${x.message ?? ''}\n${x.compileOutput || x.stderr}`);
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Verify conversion by running both programs" description="Both programs run locally with the same standard input; their outputs are compared. Matching output is evidence for this input only, not a proof of equivalence." footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" icon={FlaskConical} loading={loading} onClick={run}>Run both</Button></>}>
      <Field label="Standard input (STDIN)">
        <Textarea value={stdin} onChange={(e) => setStdin(e.target.value)} rows={3} className="font-mono text-xs" />
      </Field>
      {r && (
        <div className="mt-4 space-y-3">
          <Alert tone={r.same ? 'success' : 'warning'} icon={r.same ? CheckCircle2 : AlertTriangle} title={r.same ? 'Outputs match' : 'Outputs differ'}>
            {r.note}
          </Alert>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs text-muted">{langLabel(from)} output</p>
              <Pre className={cn('max-h-56', r.original.status !== 'success' && 'text-danger')}>{out(r.original)}</Pre>
            </div>
            <div>
              <p className="mb-1 text-xs text-muted">{langLabel(to)} output</p>
              <Pre className={cn('max-h-56', r.converted.status !== 'success' && 'text-danger')}>{out(r.converted)}</Pre>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
