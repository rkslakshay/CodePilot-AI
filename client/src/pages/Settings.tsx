import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Bot, Code, Cpu, Database, Download, HardDrive, Info, Palette, PlugZap, RefreshCw, RotateCcw, ShieldCheck, Trash2, User, CheckCircle2, XCircle, Archive } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert, Badge, Button, Card, CardHeader, Field, Input, PageHeader, Segmented, Select, Switch } from '@/components/ui/primitives';
import { confirmAction, toast } from '@/components/ui/overlay';
import { LanguageSelect } from '@/components/common';
import { useAi, useSettings } from '@/store';
import { formatBytes, formatDateTime, cn } from '@/lib/utils';
import type { ModelDetails, Settings } from '@/lib/types';

interface DbInfo {
  path: string;
  sizeBytes: number;
  schemaVersion: number;
  engine: string;
  tables: Record<string, number>;
  demoRecords: number;
}
interface Backup {
  name: string;
  sizeBytes: number;
  createdAt: string;
}
interface TestResult {
  reachable: boolean;
  version?: string;
  models: { name: string; parameterSize?: string }[];
  generated?: boolean;
  message: string;
  sample?: string;
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">{label}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, update } = useSettings();
  const loc = useLocation();
  const set = async (patch: Partial<Settings>) => {
    try {
      await update(patch);
    } catch (e) {
      toast.error('Setting not saved', (e as Error).message);
    }
  };
  useEffect(() => {
    if (loc.hash) setTimeout(() => document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }, [loc.hash]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Settings"
        icon={Code}
        description="Preferences are stored in the local database."
        actions={
          <Button
            variant="ghost"
            icon={RotateCcw}
            onClick={async () => {
              if (!(await confirmAction({ title: 'Reset all settings?', description: 'Appearance, editor, AI and execution settings return to their defaults (execution will be disabled). Your projects and history are not affected.', confirmLabel: 'Reset settings' }))) return;
              await api.post('/settings/reset');
              await useSettings.getState().load();
              toast.success('Settings reset');
            }}
          >
            Reset to defaults
          </Button>
        }
      />
      <div className="space-y-4">
        <ProfileCard />
        <Card id="appearance">
          <CardHeader title="Appearance" icon={Palette} />
          <div className="divide-y divide-border px-4">
            <Row label="Theme" hint="Dark is the default; System follows your OS.">
              <Segmented value={settings.theme} onChange={(v) => set({ theme: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} />
            </Row>
            <Row label="Accent colour">
              <div className="flex gap-2">
                {(['violet', 'teal', 'blue', 'amber'] as const).map((a) => (
                  <button key={a} aria-label={`${a} accent`} onClick={() => set({ accent: a })} className={cn('h-7 w-7 rounded-full border-2', settings.accent === a ? 'border-fg' : 'border-transparent')} style={{ background: { violet: '#8b7cff', teal: '#35c9a5', blue: '#5b9dff', amber: '#f3b65d' }[a] }} />
                ))}
              </div>
            </Row>
          </div>
        </Card>
        <Card id="editor">
          <CardHeader title="Editor" icon={Code} />
          <div className="divide-y divide-border px-4">
            <Row label="Default programming language">
              <LanguageSelect value={settings.defaultLanguage} onChange={(l) => set({ defaultLanguage: l })} />
            </Row>
            <Row label="Font size" hint={`${settings.editorFontSize}px`}>
              <input type="range" min={10} max={24} value={settings.editorFontSize} onChange={(e) => set({ editorFontSize: Number(e.target.value) })} aria-label="Editor font size" className="w-40 accent-[var(--primary)]" />
            </Row>
            <Row label="Editor theme">
              <Select aria-label="Editor theme" className="w-48" value={settings.editorTheme} onChange={(e) => set({ editorTheme: e.target.value as Settings['editorTheme'] })}>
                <option value="codepilot-dark">CodePilot Dark</option>
                <option value="vs-dark">Visual Studio Dark</option>
                <option value="vs">Light</option>
                <option value="hc-black">High contrast</option>
              </Select>
            </Row>
            <Row label="Tab size">
              <Segmented value={String(settings.tabSize)} onChange={(v) => set({ tabSize: Number(v) })} options={[{ value: '2', label: '2' }, { value: '4', label: '4' }, { value: '8', label: '8' }]} />
            </Row>
            <Row label="Word wrap">
              <Switch checked={settings.wordWrap} onChange={(v) => set({ wordWrap: v })} label="Word wrap" />
            </Row>
            <Row label="Minimap">
              <Switch checked={settings.minimap} onChange={(v) => set({ minimap: v })} label="Minimap" />
            </Row>
            <Row label="Default explanation level" hint="Used by the Code Explainer and generated explanations.">
              <Segmented value={settings.explanationMode} onChange={(v) => set({ explanationMode: v })} options={[{ value: 'beginner', label: 'Beginner' }, { value: 'advanced', label: 'Advanced' }]} />
            </Row>
          </div>
        </Card>
        <AiCard set={set} />
        <Card id="execution">
          <CardHeader title="Code execution" icon={ShieldCheck} actions={<Badge tone={settings.executionEnabled ? 'success' : 'neutral'}>{settings.executionEnabled ? 'Enabled' : 'Disabled'}</Badge>} />
          <div className="divide-y divide-border px-4">
            <Row label="Allow running programs locally" hint="Runs in a separate process; on Windows also inside a Job Object with a low-integrity token. Not a virtual machine.">
              <Switch
                checked={settings.executionEnabled}
                label="Allow code execution"
                onChange={async (v) => {
                  if (v && !(await confirmAction({ title: 'Enable local code execution?', description: 'Programs will run on this computer with time limits, output caps, a stripped environment and a static API guard. On Windows they also run in a Job Object with a low-integrity token. This is not a virtual machine — only run code you trust.', confirmLabel: 'Enable execution', tone: 'primary' }))) return;
                  await set({ executionEnabled: v });
                }}
              />
            </Row>
            <Row label="Time limit per run" hint={`${settings.executionTimeoutMs / 1000} seconds (compile time is limited separately)`}>
              <input type="range" min={1000} max={15000} step={1000} value={settings.executionTimeoutMs} onChange={(e) => set({ executionTimeoutMs: Number(e.target.value) })} aria-label="Execution time limit" className="w-40 accent-[var(--primary)]" />
            </Row>
          </div>
        </Card>
        <DataCard />
        <AboutCard />
      </div>
    </div>
  );
}

function ProfileCard() {
  const [name, setName] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => {
    api.get<{ name: string }>('/profile').then((p) => {
      setName(p.name);
      setSaved(p.name);
    });
  }, []);
  return (
    <Card id="profile">
      <CardHeader title="Local profile" icon={User} subtitle="No account or sign-in — everything stays on this computer." />
      <div className="flex flex-wrap items-end gap-2 p-4">
        <Field label="Display name" className="min-w-[220px] flex-1">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Display name" />
        </Field>
        <Button
          disabled={!name.trim() || name === saved}
          onClick={async () => {
            try {
              const p = await api.put<{ name: string }>('/profile', { name });
              setSaved(p.name);
              toast.success('Profile updated');
            } catch (e) {
              toast.error('Could not update profile', (e as Error).message);
            }
          }}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

function AiCard({ set }: { set: (p: Partial<Settings>) => Promise<void> }) {
  const settings = useSettings((s) => s.settings);
  const { status, refresh, checking } = useAi();
  const [url, setUrl] = useState(settings.ollamaUrl);
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  useEffect(() => setUrl(settings.ollamaUrl), [settings.ollamaUrl]);
  useEffect(() => {
    void refresh(true);
  }, [refresh]);
  const models = status?.models ?? [];
  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.post<TestResult>('/ai/test', { url, model: settings.ollamaModel }));
    } catch (e) {
      setTest({ reachable: false, models: [], message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };
  return (
    <Card id="ai">
      <CardHeader title="AI provider" icon={Bot} subtitle="Optional local AI through Ollama. No API keys, no paid services, no cloud." />
      <div className="divide-y divide-border px-4">
        <Row label="Provider" hint={settings.aiProvider === 'offline' ? 'Rule-based engine, templates and static analysis. Results are never labelled as AI.' : 'Uses a model running in Ollama on this computer, with automatic offline fallback.'}>
          <Segmented value={settings.aiProvider} onChange={(v) => set({ aiProvider: v })} options={[{ value: 'offline', label: 'Offline', icon: Cpu }, { value: 'ollama', label: 'Local AI (Ollama)', icon: Bot }]} />
        </Row>
        <div className="py-3">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Ollama address" hint="Only localhost addresses are accepted, so your code never leaves this machine." className="min-w-[240px] flex-1">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-[13px]" aria-label="Ollama address" />
            </Field>
            <Button disabled={url === settings.ollamaUrl} onClick={() => set({ ollamaUrl: url }).then(() => refresh(true))}>
              Save address
            </Button>
          </div>
        </div>
        <Row label="Ollama installation" hint={status?.installed ? `Version ${status.installedVersion ?? 'unknown'}${status.installPath ? ` · ${status.installPath}` : ''}` : 'Not found on this computer'}>
          <Badge tone={status?.installed ? 'success' : 'neutral'} icon={status?.installed ? CheckCircle2 : XCircle}>
            {status?.installed ? 'Installed' : 'Not installed'}
          </Badge>
        </Row>
        <Row label="Service status" hint={status?.reachable ? `Ollama ${status.version} · ${models.length} model(s) installed` : status?.installed ? 'Installed but not running — start the Ollama app (it runs in the system tray).' : status?.error ?? 'Not checked yet'}>
          <div className="flex items-center gap-2">
            <Badge tone={status?.reachable ? 'success' : 'warning'} icon={status?.reachable ? CheckCircle2 : XCircle}>
              {status?.reachable ? 'Running' : 'Not running'}
            </Badge>
            <Button size="sm" variant="ghost" icon={RefreshCw} loading={checking} onClick={() => refresh(true)}>
              Re-check
            </Button>
          </div>
        </Row>
        <Row label="Model" hint="Only models already installed in Ollama are listed. CodePilot never downloads models.">
          <Select aria-label="Model" className="w-60" value={settings.ollamaModel} onChange={(e) => set({ ollamaModel: e.target.value })} disabled={!models.length && !settings.ollamaModel}>
            <option value="">{models.length ? 'Select a model…' : 'No installed models found'}</option>
            {settings.ollamaModel && !models.some((m) => m.name === settings.ollamaModel) && <option value={settings.ollamaModel}>{settings.ollamaModel} (not installed)</option>}
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
                {m.parameterSize ? ` · ${m.parameterSize}` : ''}
              </option>
            ))}
          </Select>
        </Row>
        {settings.ollamaModel && status?.reachable && <ModelDetailsCard name={settings.ollamaModel} />}
        <Row label="Response time limit" hint={`${settings.aiTimeoutSec} s — small models on a CPU can need 30–120 s for long answers`}>
          <input type="range" min={30} max={600} step={30} value={settings.aiTimeoutSec} onChange={(e) => set({ aiTimeoutSec: Number(e.target.value) })} aria-label="AI time limit" className="w-40 accent-[var(--primary)]" />
        </Row>
        <Row label="Maximum answer length" hint={`${settings.aiMaxTokens} tokens — longer allows bigger programs but takes more time`}>
          <input type="range" min={512} max={8192} step={512} value={settings.aiMaxTokens} onChange={(e) => set({ aiMaxTokens: Number(e.target.value) })} aria-label="AI maximum tokens" className="w-40 accent-[var(--primary)]" />
        </Row>
        <Row label="Creativity (temperature)" hint={`${settings.aiTemperature.toFixed(1)} — lower is more deterministic`}>
          <input type="range" min={0} max={1} step={0.1} value={settings.aiTemperature} onChange={(e) => set({ aiTemperature: Number(e.target.value) })} aria-label="Temperature" className="w-40 accent-[var(--primary)]" />
        </Row>
        <div className="space-y-3 py-3">
          <Button icon={PlugZap} loading={testing} onClick={runTest}>
            Test AI connection
          </Button>
          {test && (
            <Alert tone={test.generated ? 'success' : test.reachable ? 'warning' : 'danger'} title={test.message}>
              {test.sample && <p className="font-mono text-xs">Model replied: “{test.sample}”</p>}
            </Alert>
          )}
          {(!status?.reachable || !models.length) && (
            <Alert tone="info" icon={Info} title="How to enable local AI (free, optional)">
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>{status?.installed ? 'Ollama is installed — start it from the Start menu (it runs in the system tray).' : 'Install Ollama from ollama.com, or run: winget install Ollama.Ollama'}</li>
                <li>
                  Download a model yourself in a terminal. CodePilot never downloads models. Suggested sizes:
                  <ul className="mt-1 list-disc pl-4">
                    <li><code className="inline">ollama pull qwen2.5-coder:1.5b</code> ≈ 1 GB — runs on most laptops (8 GB RAM)</li>
                    <li><code className="inline">ollama pull qwen2.5-coder:3b</code> ≈ 1.9 GB — better quality, 8–16 GB RAM</li>
                    <li><code className="inline">ollama pull qwen2.5-coder:7b</code> ≈ 4.7 GB — best quality, 16 GB+ RAM or a GPU</li>
                  </ul>
                </li>
                <li>Select “Local AI”, pick the model above and press “Test AI connection”.</li>
              </ol>
            </Alert>
          )}
        </div>
      </div>
    </Card>
  );
}

function DataCard() {
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [busy, setBusy] = useState(false);
  const load = () => {
    api.get<DbInfo>('/system/database').then(setInfo).catch(() => undefined);
    api.get<Backup[]>('/system/backups').then(setBackups).catch(() => undefined);
  };
  useEffect(load, []);
  return (
    <Card id="data">
      <CardHeader title="Database & backups" icon={Database} subtitle={info?.engine} />
      <div className="space-y-4 p-4">
        {info && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-panel px-3 py-2">
                <p className="text-[11px] text-muted">Size</p>
                <p className="font-mono text-[15px] font-semibold">{formatBytes(info.sizeBytes)}</p>
              </div>
              <div className="rounded-lg border border-border bg-panel px-3 py-2">
                <p className="text-[11px] text-muted">Schema version</p>
                <p className="font-mono text-[15px] font-semibold">v{info.schemaVersion}</p>
              </div>
              <div className="rounded-lg border border-border bg-panel px-3 py-2">
                <p className="text-[11px] text-muted">Demo records</p>
                <p className="font-mono text-[15px] font-semibold">{info.demoRecords}</p>
              </div>
            </div>
            <p className="flex items-center gap-2 font-mono text-[11.5px] break-all text-muted">
              <HardDrive size={13} className="shrink-0" /> {info.path}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(info.tables).map(([t, c]) => (
                <Badge key={t}>
                  {t}: {c}
                </Badge>
              ))}
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            icon={Archive}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const b = await api.post<Backup>('/system/backups');
                toast.success('Backup created', b.name);
                load();
              } catch (e) {
                toast.error('Backup failed', (e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Create backup
          </Button>
          <Button
            onClick={async () => {
              const r = await api.post<Record<string, number>>('/demo/load');
              toast.success('Demo data loaded', `${r.projects} projects and ${r.history} history records marked as demo.`);
              load();
            }}
          >
            Load demo data
          </Button>
          <Button
            variant="outline"
            icon={Trash2}
            onClick={async () => {
              if (!(await confirmAction({ title: 'Remove demonstration data?', description: 'Only records marked as demo are deleted.', confirmLabel: 'Remove demo data' }))) return;
              await api.post('/demo/clear');
              toast.success('Demo data removed');
              load();
            }}
          >
            Remove demo data
          </Button>
        </div>
        {backups.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {backups.map((b) => (
              <li key={b.name} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                <Archive size={14} className="text-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{b.name}</span>
                <span className="text-xs text-subtle">{formatBytes(b.sizeBytes)} · {formatDateTime(b.createdAt)}</span>
                <a href={`/api/system/backups/${b.name}`} aria-label={`Download ${b.name}`} className="text-muted hover:text-fg">
                  <Download size={15} />
                </a>
                <button
                  aria-label={`Delete ${b.name}`}
                  className="text-muted hover:text-danger"
                  onClick={async () => {
                    if (!(await confirmAction({ title: 'Delete this backup?', description: b.name }))) return;
                    await api.del(`/system/backups/${b.name}`);
                    load();
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-subtle">To restore a backup, stop CodePilot and replace server/data/codepilot.db with the backup file.</p>
      </div>
    </Card>
  );
}

function AboutCard() {
  const [meta, setMeta] = useState<{ app: string; version: string; node: string; platform: string } | null>(null);
  useEffect(() => {
    api.get<typeof meta>('/meta').then(setMeta).catch(() => undefined);
  }, []);
  return (
    <Card id="about">
      <CardHeader title="About" icon={Info} />
      <div className="grid gap-2 p-4 text-[13px] sm:grid-cols-2">
        <p><span className="text-muted">Application:</span> {meta?.app} {meta?.version}</p>
        <p><span className="text-muted">Runtime:</span> Node.js {meta?.node}</p>
        <p><span className="text-muted">Platform:</span> {meta?.platform}</p>
        <p><span className="text-muted">Cost:</span> free & open-source stack, no paid services</p>
        <p className="sm:col-span-2 text-xs text-subtle">React · TypeScript · Vite · Tailwind CSS · Monaco Editor · Mermaid · Express · Zod · SQLite (node:sqlite) · optional Ollama.</p>
      </div>
    </Card>
  );
}

function ModelDetailsCard({ name }: { name: string }) {
  const [d, setD] = useState<ModelDetails | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setD(null);
    setErr('');
    api.get<ModelDetails>(`/ai/models/${encodeURIComponent(name)}`).then(setD).catch((e) => setErr(e.message));
  }, [name]);
  if (err) return <p className="py-2 text-xs text-warning">Model details unavailable: {err}</p>;
  if (!d) return null;
  return (
    <div className="py-3">
      <p className="mb-2 text-[13.5px] font-medium">Model capabilities</p>
      <div className="grid gap-2 sm:grid-cols-4">
        {[
          ['Parameters', d.parameterSize ?? '—'],
          ['Quantization', d.quantization ?? '—'],
          ['Context window', d.contextLength ? `${d.contextLength.toLocaleString()} tokens` : '—'],
          ['Est. memory', d.estimatedRamGb ? `${d.estimatedRamGb} GB of ${d.systemRamGb} GB` : '—'],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-border bg-panel px-3 py-2">
            <p className="text-[11px] text-muted">{k}</p>
            <p className="font-mono text-[13px] font-semibold">{v}</p>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {d.capabilities.map((c) => (
          <Badge key={c} tone="info">{c}</Badge>
        ))}
        <span className={cn('text-xs', d.fitsInMemory === false ? 'text-warning' : 'text-muted')}>{d.advice}</span>
      </div>
    </div>
  );
}
