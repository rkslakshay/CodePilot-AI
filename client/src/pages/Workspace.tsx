import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Copy, Download, FilePlus2, FileCode2, FolderKanban, FolderPlus, MessageSquareCode, MoreHorizontal, Pencil, Play, Save, Search, Shuffle, Trash2, GitBranch } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, PageHeader, Select, Skeleton, Textarea } from '@/components/ui/primitives';
import { Dialog, Menu, MenuItem, confirmAction, toast } from '@/components/ui/overlay';
import { LangDot, LanguageSelect } from '@/components/common';
import { CodeEditor } from '@/components/code/CodeEditor';
import { useHandoff } from '@/store';
import { LANGS, downloadText, langFromFile, langLabel, timeAgo, cn, formatBytes } from '@/lib/utils';
import type { CodeFile, Lang, Project } from '@/lib/types';

export default function Workspace() {
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [search, setSearch] = useState('');
  const [project, setProject] = useState<Project | null>(null);
  const [file, setFile] = useState<(CodeFile & { content: string }) | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [projDialog, setProjDialog] = useState<{ mode: 'new' | 'edit'; p?: Project } | null>(params.get('new') ? { mode: 'new' } : null);
  const [fileDialog, setFileDialog] = useState<{ mode: 'new' | 'rename'; f?: CodeFile } | null>(null);
  const send = useHandoff((s) => s.send);
  const nav = useNavigate();
  const dirty = !!file && draft !== file.content;

  const loadProjects = useCallback(async (q = search) => {
    try {
      setProjects(await api.get<Project[]>(`/projects${q ? `?search=${encodeURIComponent(q)}` : ''}`));
    } catch (e) {
      toast.error('Could not load projects', (e as Error).message);
      setProjects([]);
    }
  }, [search]);
  const openProject = useCallback(async (id: number) => {
    try {
      const p = await api.get<Project>(`/projects/${id}`);
      setProject(p);
      return p;
    } catch {
      setProject(null);
      return null;
    }
  }, []);
  const openFile = useCallback(async (id: number) => {
    try {
      const f = await api.get<CodeFile & { content: string }>(`/files/${id}`);
      setFile(f);
      setDraft(f.content);
      if (!project || project.id !== f.projectId) await openProject(f.projectId);
    } catch {
      toast.error('File not found');
    }
  }, [openProject, project]);

  useEffect(() => {
    void loadProjects('');
    const fid = Number(params.get('file'));
    const pid = Number(params.get('project'));
    if (fid) void openFile(fid);
    else if (pid) void openProject(pid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void loadProjects(search), 250);
    return () => clearTimeout(t);
  }, [search, loadProjects]);

  const save = useCallback(async () => {
    if (!file || !dirty) return;
    setSaving(true);
    try {
      const f = await api.put<CodeFile & { content: string }>(`/files/${file.id}`, { content: draft });
      setFile(f);
      toast.success('Saved', f.name);
      void loadProjects();
    } catch (e) {
      toast.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [file, dirty, draft, loadProjects]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [save]);

  const guardDirty = async () => !dirty || (await confirmAction({ title: 'Discard unsaved changes?', description: `${file?.name} has changes that have not been saved.`, confirmLabel: 'Discard' }));

  const selectProject = async (p: Project) => {
    if (!(await guardDirty())) return;
    setFile(null);
    setParams({ project: String(p.id) });
    await openProject(p.id);
  };
  const selectFile = async (f: CodeFile) => {
    if (file?.id === f.id || !(await guardDirty())) return;
    setParams({ file: String(f.id) });
    await openFile(f.id);
  };
  const deleteProject = async (p: Project) => {
    if (!(await confirmAction({ title: `Delete project “${p.name}”?`, description: `This permanently deletes the project and its ${p.fileCount ?? project?.files?.length ?? 0} file(s).` }))) return;
    await api.del(`/projects/${p.id}`);
    toast.success('Project deleted');
    if (project?.id === p.id) {
      setProject(null);
      setFile(null);
      setParams({});
    }
    void loadProjects();
  };
  const deleteFile = async (f: CodeFile) => {
    if (!(await confirmAction({ title: `Delete “${f.name}”?`, description: 'The file will be permanently removed from this project.' }))) return;
    await api.del(`/files/${f.id}`);
    toast.success('File deleted');
    if (file?.id === f.id) setFile(null);
    if (project) await openProject(project.id);
    void loadProjects();
  };
  const duplicate = async (f: CodeFile) => {
    const c = await api.post<CodeFile>(`/files/${f.id}/duplicate`);
    toast.success('File duplicated', c.name);
    if (project) await openProject(project.id);
  };

  const grouped = useMemo(() => {
    const g = new Map<Lang, CodeFile[]>();
    for (const f of project?.files ?? []) g.set(f.language, [...(g.get(f.language) ?? []), f]);
    return LANGS.filter((l) => g.has(l.id)).map((l) => ({ lang: l.id, files: g.get(l.id)! }));
  }, [project]);

  const handoff = (target: 'compiler' | 'explainer' | 'converter' | 'studio') => {
    if (!file) return;
    send({ target, code: draft, language: file.language });
    nav(`/${target}${target === 'studio' ? '?tab=analyze' : ''}`);
  };

  return (
    <div>
      <PageHeader
        title="My Workspace"
        icon={FolderKanban}
        description="Projects and code files stored in your local SQLite database. Changes persist across restarts."
        actions={<Button variant="primary" icon={FolderPlus} onClick={() => setProjDialog({ mode: 'new' })}>New project</Button>}
      />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="flex max-h-[calc(100vh-190px)] min-h-[400px] flex-col overflow-hidden">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search projects & code…" className="h-8 pl-8 text-[13px]" aria-label="Search projects" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!projects && [1, 2, 3].map((i) => <Skeleton key={i} className="mb-2 h-12" />)}
            {projects?.length === 0 && <EmptyState icon={FolderKanban} title={search ? 'No matches' : 'No projects yet'} description={search ? undefined : 'Create a project to start organising your code.'} />}
            {projects?.map((p) => (
              <div key={p.id} className={cn('group mb-0.5 flex items-center rounded-lg', project?.id === p.id ? 'bg-primary-soft' : 'hover:bg-elevated')}>
                <button className="min-w-0 flex-1 px-2.5 py-2 text-left" onClick={() => selectProject(p)}>
                  <p className="flex items-center gap-2 truncate text-[13px] font-medium">
                    <FolderKanban size={14} className={project?.id === p.id ? 'text-primary' : 'text-muted'} />
                    <span className="truncate">{p.name}</span>
                  </p>
                  <p className="pl-[22px] text-[11px] text-subtle">
                    {p.fileCount} {p.fileCount === 1 ? 'file' : 'files'} · {timeAgo(p.updatedAt)} {p.isDemo && '· demo'}
                  </p>
                </button>
                <Menu trigger={(_o, t) => <IconButton icon={MoreHorizontal} label="Project actions" size="icon-sm" onClick={t} className="opacity-60 group-hover:opacity-100" />}>
                  {(close) => (
                    <>
                      <MenuItem icon={Pencil} onClick={() => { close(); setProjDialog({ mode: 'edit', p }); }}>Rename / edit</MenuItem>
                      <MenuItem icon={Trash2} danger onClick={() => { close(); void deleteProject(p); }}>Delete project</MenuItem>
                    </>
                  )}
                </Menu>
              </div>
            ))}
          </div>
        </Card>

        {!project ? (
          <Card>
            <EmptyState icon={FolderKanban} title="Select or create a project" description="Code you save from the generator, converter and other tools lands in the “Scratchpad” project." action={<Button icon={FolderPlus} onClick={() => setProjDialog({ mode: 'new' })}>New project</Button>} className="py-20" />
          </Card>
        ) : (
          <div className="grid min-w-0 gap-4 xl:grid-cols-[240px_1fr]">
            <Card className="flex max-h-[calc(100vh-190px)] flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{project.name}</p>
                  {project.description && <p className="truncate text-[11px] text-subtle">{project.description}</p>}
                </div>
                <IconButton icon={FilePlus2} label="New file" size="icon-sm" onClick={() => setFileDialog({ mode: 'new' })} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {grouped.length === 0 && <EmptyState icon={FileCode2} title="No files" action={<Button size="sm" icon={FilePlus2} onClick={() => setFileDialog({ mode: 'new' })}>New file</Button>} />}
                {grouped.map((g) => (
                  <div key={g.lang} className="mb-2">
                    <p className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">
                      <LangDot lang={g.lang} /> {langLabel(g.lang)} <span className="font-normal">({g.files.length})</span>
                    </p>
                    {g.files.map((f) => (
                      <div key={f.id} className={cn('group flex items-center rounded-md', file?.id === f.id ? 'bg-primary-soft' : 'hover:bg-elevated')}>
                        <button onClick={() => selectFile(f)} className="min-w-0 flex-1 truncate px-2 py-1.5 text-left font-mono text-[12.5px]">
                          {f.name}
                          {file?.id === f.id && dirty && <span className="ml-1 text-warning">●</span>}
                        </button>
                        <Menu trigger={(_o, t) => <IconButton icon={MoreHorizontal} label="File actions" size="icon-sm" onClick={t} className="opacity-50 group-hover:opacity-100" />}>
                          {(close) => (
                            <>
                              <MenuItem icon={Pencil} onClick={() => { close(); setFileDialog({ mode: 'rename', f }); }}>Rename</MenuItem>
                              <MenuItem icon={Copy} onClick={() => { close(); void duplicate(f); }}>Duplicate</MenuItem>
                              <MenuItem icon={Download} onClick={() => { close(); window.location.href = `/api/files/${f.id}/download`; }}>Download</MenuItem>
                              <MenuItem icon={Trash2} danger onClick={() => { close(); void deleteFile(f); }}>Delete</MenuItem>
                            </>
                          )}
                        </Menu>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
            {file ? (
              <Card className="flex h-[calc(100vh-190px)] min-h-[460px] min-w-0 flex-col overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <LangDot lang={file.language} />
                    <span className="truncate font-mono text-[13px]">{file.name}</span>
                    {dirty ? <Badge tone="warning">unsaved</Badge> : <span className="text-[11px] text-subtle">saved {timeAgo(file.updatedAt)} · {formatBytes(file.size)}</span>}
                    {file.isDemo && <Badge>demo</Badge>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="xs" variant="ghost" icon={Play} onClick={() => handoff('compiler')}>Run</Button>
                    <Button size="xs" variant="ghost" icon={MessageSquareCode} onClick={() => handoff('explainer')}>Explain</Button>
                    <Button size="xs" variant="ghost" icon={Shuffle} onClick={() => handoff('converter')}>Convert</Button>
                    <Button size="xs" variant="ghost" icon={GitBranch} onClick={() => handoff('studio')}>Flowchart</Button>
                    <IconButton icon={Download} label="Download" size="icon-sm" onClick={() => downloadText(file.name, draft)} />
                    <Button size="sm" variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={save}>
                      Save
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <CodeEditor value={draft} onChange={setDraft} language={file.language} />
                </div>
              </Card>
            ) : (
              <Card>
                <EmptyState icon={FileCode2} title="Select a file to edit" description="Ctrl+S saves the open file." className="py-20" />
              </Card>
            )}
          </div>
        )}
      </div>

      <ProjectDialog
        state={projDialog}
        onClose={() => {
          setProjDialog(null);
          if (params.get('new')) setParams({});
        }}
        onDone={async (p) => {
          setProjDialog(null);
          await loadProjects();
          await openProject(p.id);
          setParams({ project: String(p.id) });
        }}
      />
      {project && (
        <FileDialog
          state={fileDialog}
          projectId={project.id}
          onClose={() => setFileDialog(null)}
          onDone={async (f) => {
            setFileDialog(null);
            await openProject(project.id);
            await openFile(f.id);
            setParams({ file: String(f.id) });
            void loadProjects();
          }}
        />
      )}
    </div>
  );
}

function ProjectDialog({ state, onClose, onDone }: { state: { mode: 'new' | 'edit'; p?: Project } | null; onClose: () => void; onDone: (p: Project) => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [lang, setLang] = useState<string>('mixed');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(state?.p?.name ?? '');
    setDesc(state?.p?.description ?? '');
    setLang(state?.p?.language ?? 'mixed');
    setError('');
  }, [state]);
  const submit = async () => {
    if (!name.trim()) return setError('Project name is required');
    setBusy(true);
    try {
      const body = { name, description: desc, language: lang };
      const p = state?.mode === 'edit' ? await api.put<Project>(`/projects/${state.p!.id}`, body) : await api.post<Project>('/projects', body);
      toast.success(state?.mode === 'edit' ? 'Project updated' : 'Project created');
      onDone(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!state} onClose={onClose} title={state?.mode === 'edit' ? 'Edit project' : 'New project'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{state?.mode === 'edit' ? 'Save changes' : 'Create project'}</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Name" error={error}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sorting assignments" aria-label="Project name" />
        </Field>
        <Field label="Description (optional)">
          <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
        </Field>
        <Field label="Primary language">
          <Select value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Primary language">
            <option value="mixed">Mixed</option>
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
}

const TEMPLATES: Record<Lang, string> = {
  c: '#include <stdio.h>\n\nint main() {\n    printf("Hello, CodePilot!\\n");\n    return 0;\n}\n',
  cpp: '#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello, CodePilot!" << endl;\n    return 0;\n}\n',
  java: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, CodePilot!");\n    }\n}\n',
  python: 'def main():\n    print("Hello, CodePilot!")\n\n\nif __name__ == "__main__":\n    main()\n',
  javascript: 'function main() {\n  console.log("Hello, CodePilot!");\n}\n\nmain();\n',
};

function FileDialog({ state, projectId, onClose, onDone }: { state: { mode: 'new' | 'rename'; f?: CodeFile } | null; projectId: number; onClose: () => void; onDone: (f: CodeFile) => void }) {
  const [name, setName] = useState('');
  const [lang, setLang] = useState<Lang>('python');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(state?.f?.name ?? 'main.py');
    setLang(state?.f?.language ?? 'python');
    setError('');
  }, [state]);
  const submit = async () => {
    if (!name.trim()) return setError('File name is required');
    setBusy(true);
    try {
      const f = state?.mode === 'rename' ? await api.put<CodeFile>(`/files/${state.f!.id}`, { name, language: lang }) : await api.post<CodeFile>(`/projects/${projectId}/files`, { name, language: lang, content: TEMPLATES[lang] });
      toast.success(state?.mode === 'rename' ? 'File renamed' : 'File created');
      onDone(f);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!state} onClose={onClose} title={state?.mode === 'rename' ? 'Rename file' : 'New file'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{state?.mode === 'rename' ? 'Rename' : 'Create file'}</Button></>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="File name" error={error}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              const l = langFromFile(e.target.value);
              if (l) setLang(l);
            }}
            aria-label="File name"
            className="font-mono"
          />
        </Field>
        <Field label="Language">
          <LanguageSelect value={lang} onChange={setLang} className="w-full" />
        </Field>
      </form>
    </Dialog>
  );
}
