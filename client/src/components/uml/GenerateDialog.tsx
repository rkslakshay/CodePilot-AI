/** Generate a UML diagram from a description (local AI or offline rules), from source code, or from an imported repository. */
import { useEffect, useMemo, useState } from 'react';
import { Bot, Code2, Cpu, FolderGit2, MessageSquareText, Sparkles } from 'lucide-react';
import { DIAGRAM_TYPES, DIAGRAM_LABEL, type DiagramType } from '@shared/uml/index';
import { Dialog } from '@/components/ui/overlay';
import { Alert, Button, Field, Input, Segmented, Select, Switch, Textarea } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { GEN_URL, type UmlGenRequest, type UmlGenResult } from '@/lib/uml';
import { useAi } from '@/store';
import type { CodeFile, Project } from '@/lib/types';
import type { RepoSummary, TreeFile } from '@/lib/repo';

export type GenMode = 'text' | 'source' | 'repository';
export interface GenPreset {
  mode?: GenMode;
  type?: DiagramType;
  fileId?: number;
  repoId?: number;
}

export const TEXT_EXAMPLES: Record<DiagramType, string> = {
  class: 'Create a class diagram for a library management system. Include Book, Member, Librarian, Loan, and Reservation. A member can borrow multiple books. A librarian manages loans.',
  usecase: 'An online banking application with Customer, Administrator and Banking System as actors. Customer can view balance, transfer funds and pay bills. Administrator can manage accounts. Transfer funds includes Authenticate.',
  sequence: 'The User enters credentials in the Frontend. The Frontend sends the credentials to the Auth API. The Auth API queries the Database for the user. The Database returns the user record to the Auth API. The Auth API returns a session token to the Frontend.',
  activity: 'Validate the cart. If the cart is valid, process the payment, otherwise show an error. In parallel reserve stock and send a confirmation email. Then confirm the order.',
  state: 'An order goes from Created to Confirmed when payment succeeds. From Confirmed to Shipped on dispatch. From Shipped to Delivered when received. From Created to Cancelled on cancel.',
  component: 'A full-stack web application with Frontend, Backend API, Database and Payment Gateway. The Frontend uses the Backend API via HTTPS. The Backend API uses the Database via SQL. The Backend API uses the Payment Gateway.',
  deployment: 'The web app runs on the Browser. The Browser runs on the Client Machine. The API runs on the Application Server. The Client Machine connects to the Application Server via HTTPS. The Application Server connects to the Database Server via TCP.',
  object: 'asha is a Student with rollNo = CS21-014 and gpa = 8.7. dsa is a Course with code = CS201. asha is enrolled in dsa.',
};
const SRC_LANGS = [
  ['python', 'Python'],
  ['java', 'Java'],
  ['typescript', 'TypeScript'],
  ['javascript', 'JavaScript'],
  ['cpp', 'C++'],
  ['c', 'C'],
] as const;

export function GenerateDialog({ open, onClose, preset, onResult }: { open: boolean; onClose: () => void; preset?: GenPreset; onResult: (r: UmlGenResult, req: UmlGenRequest) => void }) {
  const [mode, setMode] = useState<GenMode>(preset?.mode ?? 'text');
  const [type, setType] = useState<DiagramType>(preset?.type ?? 'class');
  const [text, setText] = useState('');
  const [useAiFlag, setUseAi] = useState(true);
  const ai = useAi((s) => s.status);
  // source
  const [srcFrom, setSrcFrom] = useState<'paste' | 'workspace' | 'repo'>(preset?.fileId ? 'workspace' : preset?.repoId && preset.mode === 'source' ? 'repo' : 'paste');
  const [code, setCode] = useState('');
  const [lang, setLang] = useState<string>('python');
  const [srcKind, setSrcKind] = useState<'class' | 'sequence' | 'activity'>('class');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [fileIds, setFileIds] = useState<number[]>(preset?.fileId ? [preset.fileId] : []);
  const [fn, setFn] = useState('');
  const [fns, setFns] = useState<{ path: string; functions: { qualified: string; line: number }[] }[] | null>(null);
  // repository
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [repoId, setRepoId] = useState<number | null>(preset?.repoId ?? null);
  const [repoKind, setRepoKind] = useState<'class' | 'modules' | 'architecture' | 'deployment'>('class');
  const [folder, setFolder] = useState('');
  const [repoFiles, setRepoFiles] = useState<TreeFile[]>([]);
  const [repoPath, setRepoPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setMode(preset?.mode ?? 'text');
    if (preset?.type) setType(preset.type);
    if (preset?.repoId) setRepoId(preset.repoId);
    if (preset?.fileId) {
      setSrcFrom('workspace');
      setFileIds([preset.fileId]);
      api
        .get<CodeFile>(`/files/${preset.fileId}`)
        .then((f) => setProjectId(f.projectId))
        .catch(() => undefined);
    }
  }, [open, preset]);
  useEffect(() => {
    if (!open) return;
    api.get<Project[]>('/projects').then(setProjects).catch(() => setProjects([]));
    api.get<RepoSummary[]>('/repos').then(setRepos).catch(() => setRepos([]));
  }, [open]);
  useEffect(() => {
    if (!projectId) return setFiles([]);
    api
      .get<Project>(`/projects/${projectId}`)
      .then((p) => setFiles(p.files ?? []))
      .catch(() => setFiles([]));
  }, [projectId]);
  useEffect(() => {
    if (!repoId) return setRepoFiles([]);
    api
      .get<TreeFile[]>(`/repos/${repoId}/files`)
      .then((t) => setRepoFiles(t.filter((f) => f.kind === 'source' && !f.skipped && !f.sensitive)))
      .catch(() => setRepoFiles([]));
  }, [repoId]);

  const sourceSel = useMemo((): Record<string, unknown> | null => {
    if (srcFrom === 'paste') return code.trim() ? { code, language: lang } : null;
    if (srcFrom === 'workspace') return fileIds.length ? { fileIds } : null;
    if (!repoId) return null;
    if (srcKind === 'class') return { repoId, ...(folder.trim() ? { folder: folder.trim() } : {}) };
    return repoPath ? { repoId, paths: [repoPath] } : null;
  }, [srcFrom, code, lang, fileIds, repoId, folder, srcKind, repoPath]);

  // function list for sequence / activity
  useEffect(() => {
    setFns(null);
    if (mode !== 'source' || srcKind === 'class' || !sourceSel) return;
    const t = setTimeout(() => {
      api
        .post<{ path: string; functions: { qualified: string; line: number }[] }[]>('/uml/source/functions', sourceSel)
        .then((r) => {
          setFns(r);
          const all = r.flatMap((x) => x.functions.map((f) => `${x.path}::${f.qualified}`));
          setFn((cur) => (all.includes(cur) ? cur : all[0] ?? ''));
        })
        .catch(() => setFns([]));
    }, 350);
    return () => clearTimeout(t);
  }, [mode, srcKind, sourceSel]);

  const build = (): UmlGenRequest | null => {
    if (mode === 'text') return text.trim().length >= 8 ? { mode, body: { type, text, useAi: useAiFlag } } : null;
    if (mode === 'source') {
      if (!sourceSel) return null;
      if (srcKind === 'class') return { mode, body: { ...sourceSel, kind: 'class' } };
      if (!fn) return null;
      const [path, qualified] = fn.split('::');
      return { mode, body: { ...sourceSel, kind: srcKind, function: qualified, targetPath: path } };
    }
    return repoId ? { mode, body: { repoId, kind: repoKind, ...(folder.trim() ? { folder: folder.trim() } : {}) } } : null;
  };
  const req = build();

  const run = async () => {
    if (!req) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<UmlGenResult>(GEN_URL[req.mode], req.body);
      onResult(r, req);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const aiReady = ai?.mode === 'ollama' && ai.reachable && ai.modelInstalled;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Generate a UML diagram"
      description="Everything runs on this computer. Source code and repositories are parsed locally and never uploaded."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Sparkles} loading={busy} disabled={!req || busy} onClick={run} data-testid="uml-generate-run">
            Generate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented<GenMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'text', label: 'Description', icon: MessageSquareText },
            { value: 'source', label: 'Source code', icon: Code2 },
            { value: 'repository', label: 'Repository', icon: FolderGit2 },
          ]}
        />

        {mode === 'text' && (
          <>
            <Field label="Diagram type" htmlFor="uml-gen-type">
              <Select id="uml-gen-type" value={type} onChange={(e) => setType(e.target.value as DiagramType)}>
                {DIAGRAM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DIAGRAM_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Describe the system"
              htmlFor="uml-gen-text"
              hint={
                <button type="button" className="text-primary hover:underline" onClick={() => setText(TEXT_EXAMPLES[type])}>
                  Use an example
                </button>
              }
            >
              <Textarea id="uml-gen-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={TEXT_EXAMPLES[type]} />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-elevated/50 px-3 py-2">
              <span className="flex items-center gap-2 text-[13px]">
                <Switch id="uml-use-ai" checked={useAiFlag} onChange={setUseAi} label="Use local AI when available" />
                Use local AI when available
              </span>
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                {useAiFlag && aiReady ? <Bot size={14} className="text-primary" /> : <Cpu size={14} />}
                {useAiFlag && aiReady ? `Local AI · Ollama · ${ai?.selectedModel ?? ''}` : 'Offline rule-based generator (not AI)'}
              </span>
            </div>
            <p className="text-[12px] text-muted [&_code]:[font-variant-ligatures:none]">
              The offline generator also understands a PlantUML-like notation, e.g. <code className="font-mono">Customer "1" --&gt; "0..*" Order : places</code>,{' '}
              <code className="font-mono">Car --|&gt; Vehicle</code>, <code className="font-mono">User -&gt; API : login()</code>, <code className="font-mono">[*] --&gt; Draft</code>.
            </p>
          </>
        )}

        {mode === 'source' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Diagram">
                <Select aria-label="Diagram from source" value={srcKind} onChange={(e) => setSrcKind(e.target.value as typeof srcKind)}>
                  <option value="class">Class diagram (classes, members, relationships)</option>
                  <option value="sequence">Sequence diagram (calls made by one method)</option>
                  <option value="activity">Activity diagram (control flow of one function)</option>
                </Select>
              </Field>
              <Field label="Source">
                <Select aria-label="Source location" value={srcFrom} onChange={(e) => setSrcFrom(e.target.value as typeof srcFrom)}>
                  <option value="paste">Paste code</option>
                  <option value="workspace">My Workspace files</option>
                  <option value="repo">Imported repository</option>
                </Select>
              </Field>
            </div>
            {srcFrom === 'paste' && (
              <>
                <Select aria-label="Source language" value={lang} onChange={(e) => setLang(e.target.value)} className="w-44">
                  {SRC_LANGS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
                <Textarea aria-label="Source code" rows={9} value={code} onChange={(e) => setCode(e.target.value)} className="font-mono text-[12.5px]" placeholder="class Order:\n    def __init__(self, customer: 'Customer'):\n        self.customer = customer" />
              </>
            )}
            {srcFrom === 'workspace' && (
              <div className="space-y-2">
                <Select aria-label="Project" value={projectId ?? ''} onChange={(e) => setProjectId(Number(e.target.value) || null)}>
                  <option value="">Choose a project…</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                {files.length > 0 && (
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                    {files.map((f) => (
                      <label key={f.id} className="flex items-center gap-2 text-[13px]">
                        <input type="checkbox" checked={fileIds.includes(f.id)} onChange={(e) => setFileIds((ids) => (e.target.checked ? [...ids, f.id] : ids.filter((x) => x !== f.id)))} />
                        <span className="font-mono">{f.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
            {srcFrom === 'repo' && (
              <div className="space-y-2">
                <RepoSelect repos={repos} value={repoId} onChange={setRepoId} />
                {srcKind === 'class' ? (
                  <Input aria-label="Folder (optional)" placeholder="Folder inside the repository (optional), e.g. src/models" value={folder} onChange={(e) => setFolder(e.target.value)} />
                ) : (
                  <Select aria-label="Source file" value={repoPath} onChange={(e) => setRepoPath(e.target.value)}>
                    <option value="">Choose a source file…</option>
                    {repoFiles.slice(0, 2000).map((f) => (
                      <option key={f.path} value={f.path}>
                        {f.path}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            )}
            {srcKind !== 'class' && (
              <Field label="Function or method">
                <Select aria-label="Function or method" value={fn} onChange={(e) => setFn(e.target.value)} disabled={!fns?.length}>
                  {!fns && <option value="">{sourceSel ? 'Reading functions…' : 'Choose the source first'}</option>}
                  {fns && !fns.some((x) => x.functions.length) && <option value="">No functions found</option>}
                  {fns?.map((x) =>
                    x.functions.map((f) => (
                      <option key={`${x.path}::${f.qualified}`} value={`${x.path}::${f.qualified}`}>
                        {fns.length > 1 ? `${x.path} — ` : ''}
                        {f.qualified} (line {f.line})
                      </option>
                    )),
                  )}
                </Select>
              </Field>
            )}
            <p className="text-[12px] text-muted">Parsed with Tree-sitter (offline). Imported code is never executed. Relationships are only drawn where the code establishes them; inferred ones are marked.</p>
          </>
        )}

        {mode === 'repository' && (
          <>
            <RepoSelect repos={repos} value={repoId} onChange={setRepoId} />
            {!repos.length && <Alert tone="info">Import a repository in the Repository Analyzer first.</Alert>}
            <Field label="Diagram">
              <Select aria-label="Repository diagram" value={repoKind} onChange={(e) => setRepoKind(e.target.value as typeof repoKind)}>
                <option value="class">Class diagram of the code</option>
                <option value="modules">Component diagram of modules and their imports</option>
                <option value="architecture">Component diagram of the architecture (frameworks, services)</option>
                <option value="deployment">Deployment diagram (Docker / compose / frameworks)</option>
              </Select>
            </Field>
            {(repoKind === 'class' || repoKind === 'modules') && <Input aria-label="Folder (optional)" placeholder="Folder (optional), e.g. src" value={folder} onChange={(e) => setFolder(e.target.value)} />}
            <p className="text-[12px] text-muted">Built from the files of the imported repository. When the repository holds no evidence for a diagram (for example no deployment configuration), nothing is invented and you are told why.</p>
          </>
        )}
        {error && (
          <Alert tone="warning" title="No diagram generated">
            {error}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

function RepoSelect({ repos, value, onChange }: { repos: RepoSummary[]; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <Select aria-label="Repository" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value) || null)}>
      <option value="">Choose a repository…</option>
      {repos.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </Select>
  );
}
