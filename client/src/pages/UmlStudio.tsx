/** UML Studio: create, generate, edit, validate, save and export the 8 main UML diagram types — fully offline. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  AlertTriangle, ArrowLeft, Boxes, CheckCircle2, ChevronDown, Copy, Download, FilePlus2, FileText, Grid3x3, LayoutTemplate, ListTree, Maximize, Minus, MousePointer2, Pencil, Plus, Redo2, RefreshCw, Save, Search, ShieldCheck,
  Shapes, Sparkles, Spline, Trash2, Undo2, Wand2, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  DIAGRAM_TYPES, DIAGRAM_LABEL, ELEMENT_KINDS, RELATIONSHIP_KINDS, ELEMENT_LABEL, RELATIONSHIP_LABEL, MERMAID_TYPES, History, addElement, addRelationship, autoLayout, deleteElement, deleteRelationship, emptyDiagram, template, toPlantUml, toMermaid,
  validateDiagram, type Diagram, type DiagramType, type ElementKind, type RelationshipKind,
} from '@shared/uml/index';
import { api, ApiError } from '@/lib/api';
import { Alert, Badge, Button, EmptyState, IconButton, Input, PageHeader, Select, Skeleton, Tabs, Tooltip } from '@/components/ui/primitives';
import { Dialog, Menu, MenuItem, confirmAction, toast } from '@/components/ui/overlay';
import { EngineBadge } from '@/components/common';
import { UmlCanvas, type CanvasHandle, type Selection } from '@/components/uml/Canvas';
import { Inspector } from '@/components/uml/Inspector';
import { GenerateDialog, type GenPreset } from '@/components/uml/GenerateDialog';
import { exportMermaid, exportPdf, exportPlantUml, exportPng, exportSvg, GEN_URL, setDraft, getDraft, draftSeq, type UmlDiagramDto, type UmlDiagramSummary, type UmlGenRequest, type UmlGenResult } from '@/lib/uml';
import { copyText, timeAgo, cn } from '@/lib/utils';
import type { Engine } from '@/lib/types';

const TYPE_HINT: Record<DiagramType, string> = {
  class: 'Classes, interfaces, attributes, operations, associations, inheritance',
  usecase: 'Actors, use cases, system boundary, include / extend',
  sequence: 'Lifelines, ordered messages, activations, alt / opt / loop',
  activity: 'Actions, decisions with guards, fork / join, swimlanes',
  state: 'States, transitions with event [guard] / effect, composite states',
  component: 'Components, provided / required interfaces, dependencies',
  deployment: 'Nodes, devices, execution environments, artifacts',
  object: 'Objects with attribute values and links at one moment',
};

// keeps the editor mounted (and its undo history) when an unsaved draft is first saved
const keyAlias = new Map<string, string>();

export default function UmlStudio() {
  const { id } = useParams();
  if (!id) return <Home />;
  const key = keyAlias.get(id) ?? (id === 'new' ? `new-${draftSeq()}` : id);
  return <Editor key={key} routeId={id} draftNo={draftSeq()} />;
}

// ====================================================================== home / gallery
function Home() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<UmlDiagramSummary[] | null>(null);
  const [q, setQ] = useState('');
  const [type, setType] = useState<'' | DiagramType>('');
  const [gen, setGen] = useState<GenPreset | null>(null);
  const [renaming, setRenaming] = useState<UmlDiagramSummary | null>(null);
  const repoFilter = Number(params.get('repoId')) || null;

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (type) qs.set('type', type);
    if (q.trim()) qs.set('search', q.trim());
    if (repoFilter) qs.set('repoId', String(repoFilter));
    api
      .get<UmlDiagramSummary[]>(`/uml/diagrams?${qs}`)
      .then(setList)
      .catch(() => setList([]));
  }, [type, q, repoFilter]);
  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  // entry points: /uml?generate=text|source|repository&fileId=…&repoId=…&type=…
  useEffect(() => {
    const g = params.get('generate');
    if (!g) return;
    setGen({ mode: g as GenPreset['mode'], fileId: Number(params.get('fileId')) || undefined, repoId: Number(params.get('repoId')) || undefined, type: (params.get('type') as DiagramType) || undefined });
    const next = new URLSearchParams(params);
    next.delete('generate');
    next.delete('fileId');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const open = (d: Diagram, name?: string, request?: UmlGenRequest, result?: Omit<UmlGenResult, 'diagram'>) => {
    setDraft({ diagram: d, name, request, result });
    nav('/uml/new');
  };
  const remove = async (d: UmlDiagramSummary) => {
    if (!(await confirmAction({ title: `Delete “${d.name}”?`, description: 'The diagram is removed from this computer. This cannot be undone.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    await api.del(`/uml/diagrams/${d.id}`);
    toast.success('Diagram deleted');
    load();
  };
  const duplicate = async (d: UmlDiagramSummary) => {
    const c = await api.post<UmlDiagramSummary>(`/uml/diagrams/${d.id}/duplicate`);
    toast.success('Diagram duplicated', c.name);
    load();
  };

  return (
    <div>
      <PageHeader
        title="UML Studio"
        icon={Shapes}
        description="Create, generate, edit and export professional UML diagrams. Everything runs on this computer — local AI is optional, and offline generation is never labelled as AI."
        actions={
          <>
            <Button variant="primary" icon={Sparkles} onClick={() => setGen({ mode: 'text' })} data-testid="uml-open-generate">
              Generate
            </Button>
          </>
        }
      />
      <h2 className="mb-2 text-sm font-semibold text-muted">New diagram</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="uml-type-cards">
        {DIAGRAM_TYPES.map((t) => (
          <div key={t} className="flex flex-col rounded-xl border border-border bg-card p-3.5">
            <div className="font-semibold">{DIAGRAM_LABEL[t]}</div>
            <p className="mt-1 flex-1 text-[12.5px] text-muted">{TYPE_HINT[t]}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="xs" variant="outline" icon={FilePlus2} onClick={() => open(emptyDiagram(t), `Untitled ${DIAGRAM_LABEL[t].toLowerCase()}`)} aria-label={`Blank ${DIAGRAM_LABEL[t]}`}>
                Blank
              </Button>
              <Button size="xs" variant="outline" icon={LayoutTemplate} onClick={() => open(template(t), template(t).title)} aria-label={`Example ${DIAGRAM_LABEL[t]}`}>
                Example
              </Button>
              <Button size="xs" variant="ghost" icon={Wand2} onClick={() => setGen({ mode: 'text', type: t })} aria-label={`Generate ${DIAGRAM_LABEL[t]}`}>
                Generate
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold text-muted">
          Saved diagrams{repoFilter ? ' for this repository' : ''}
          {repoFilter && (
            <button className="ml-2 text-primary hover:underline" onClick={() => setParams({})}>
              show all
            </button>
          )}
        </h2>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-subtle" />
          <Input aria-label="Search diagrams" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-48 pl-8 text-[13px]" />
        </div>
        <Select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value as DiagramType | '')} className="h-8 w-48 text-[13px]">
          <option value="">All types</option>
          {DIAGRAM_TYPES.map((t) => (
            <option key={t} value={t}>
              {DIAGRAM_LABEL[t]}
            </option>
          ))}
        </Select>
      </div>
      {!list ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : !list.length ? (
        <EmptyState icon={Shapes} title="No saved diagrams yet" description="Start from a blank diagram or an example above, or generate one from a description, your code or an imported repository." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card" data-testid="uml-saved-list">
          {list.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-elevated/40">
              <Link to={`/uml/${d.id}`} className="min-w-0 flex-1">
                <div className="truncate font-medium hover:text-primary">{d.name}</div>
                <div className="text-[12px] text-muted">
                  {DIAGRAM_LABEL[d.type]} · {d.elementCount ?? 0} elements · {d.relationshipCount ?? 0} relationships · updated {timeAgo(d.updatedAt)}
                </div>
              </Link>
              <Badge tone={d.generation === 'ai' ? 'primary' : 'neutral'}>{GEN_LABEL[d.generation] ?? d.generation}</Badge>
              <div className="flex gap-0.5">
                <IconButton icon={Pencil} label={`Rename ${d.name}`} size="icon-sm" onClick={() => setRenaming(d)} />
                <IconButton icon={Copy} label={`Duplicate ${d.name}`} size="icon-sm" onClick={() => void duplicate(d)} />
                <IconButton icon={Trash2} label={`Delete ${d.name}`} size="icon-sm" onClick={() => void remove(d)} />
              </div>
            </div>
          ))}
        </div>
      )}
      <GenerateDialog
        open={!!gen}
        preset={gen ?? undefined}
        onClose={() => setGen(null)}
        onResult={(r, req) => {
          setGen(null);
          const { diagram, ...rest } = r;
          open(diagram, diagram.title || DIAGRAM_LABEL[diagram.type], req, rest);
        }}
      />
      <RenameDialog
        item={renaming}
        onClose={() => setRenaming(null)}
        onDone={() => {
          setRenaming(null);
          load();
        }}
      />
    </div>
  );
}
const GEN_LABEL: Record<string, string> = { ai: 'Local AI', rules: 'Offline rules', source: 'From source', repository: 'From repository', manual: 'Manual', template: 'Example' };

function RenameDialog({ item, onClose, onDone }: { item: UmlDiagramSummary | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  useEffect(() => setName(item?.name ?? ''), [item]);
  const save = async () => {
    if (!item || !name.trim()) return;
    await api.put(`/uml/diagrams/${item.id}`, { name: name.trim() });
    toast.success('Diagram renamed');
    onDone();
  };
  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      title="Rename diagram"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!name.trim()}>
            Rename
          </Button>
        </>
      }
    >
      <Input aria-label="Diagram name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} autoFocus />
    </Dialog>
  );
}

// ====================================================================== editor
interface Doc {
  id: number | null;
  name: string;
  repoId: number | null;
  projectId: number | null;
  sourcePath: string | null;
}
const isDark = () => document.documentElement.classList.contains('dark');

function Editor({ routeId, draftNo }: { routeId: string; draftNo: number }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [d, setD] = useState<Diagram | null>(null);
  const hist = useRef<History<Diagram> | null>(null);
  const [, setTick] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [connecting, setConnecting] = useState<{ kind: RelationshipKind; source: string | null } | null>(null);
  const [grid, setGrid] = useState(true);
  const [dark, setDark] = useState(isDark);
  const [scale, setScale] = useState(1);
  const [left, setLeft] = useState<'add' | 'outline'>('add');
  const [showIssues, setShowIssues] = useState(false);
  const [gen, setGen] = useState<GenPreset | null>(null);
  const [lastReq, setLastReq] = useState<UmlGenRequest | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canvas = useRef<CanvasHandle>(null);

  // theme follows the app
  useEffect(() => {
    const o = new MutationObserver(() => setDark(isDark()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => o.disconnect();
  }, []);

  // load once
  useEffect(() => {
    const init = (model: Diagram, dc: Doc) => {
      hist.current = new History(model);
      setD(model);
      setDoc(dc);
    };
    if (routeId === 'new') {
      const p = getDraft(draftNo);
      const t = (params.get('type') as DiagramType) || 'class';
      const model = p?.diagram ?? emptyDiagram(DIAGRAM_TYPES.includes(t) ? t : 'class');
      init(model, { id: null, name: p?.name || model.title || `Untitled ${DIAGRAM_LABEL[model.type].toLowerCase()}`, repoId: model.meta.generation.repoId ?? null, projectId: null, sourcePath: model.meta.generation.sourcePath ?? null });
      if (p?.request) setLastReq(p.request);
      if (p?.result) setEngine(p.result.engine);
      setDirty(true);
      return;
    }
    api
      .get<UmlDiagramDto>(`/uml/diagrams/${routeId}`)
      .then((r) => init(r.model, { id: r.id, name: r.name, repoId: r.repoId, projectId: r.projectId, sourcePath: r.sourcePath }))
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // warn before closing with unsaved changes
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const commit = useCallback((next: Diagram) => {
    hist.current?.push(next);
    setD(next);
    setDirty(true);
    setTick((x) => x + 1);
  }, []);
  const onCanvasChange = useCallback(
    (next: Diagram, transient: boolean) => {
      if (transient) setD(next);
      else commit(next);
    },
    [commit],
  );
  const undo = () => {
    if (!hist.current?.canUndo) return;
    setD(hist.current.undo());
    setDirty(true);
    setTick((x) => x + 1);
  };
  const redo = () => {
    if (!hist.current?.canRedo) return;
    setD(hist.current.redo());
    setDirty(true);
    setTick((x) => x + 1);
  };

  const validation = useMemo(() => (d ? validateDiagram(d) : null), [d]);
  const issues = useMemo(() => (validation ? [...validation.errors, ...validation.warnings] : []), [validation]);
  const errorIds = useMemo(() => (validation?.errors ?? []).flatMap((i) => [i.elementId, i.relationshipId].filter(Boolean) as string[]), [validation]);

  const save = useCallback(async () => {
    if (!d || !doc) return;
    setBusy('save');
    try {
      if (doc.id === null) {
        const r = await api.post<UmlDiagramDto>('/uml/diagrams', { name: doc.name.trim() || 'Untitled diagram', model: d, repoId: doc.repoId, projectId: doc.projectId, sourcePath: doc.sourcePath });
        keyAlias.set(String(r.id), `new-${draftNo}`);
        setDoc({ ...doc, id: r.id });
        nav(`/uml/${r.id}`, { replace: true });
      } else {
        await api.put(`/uml/diagrams/${doc.id}`, { name: doc.name.trim() || 'Untitled diagram', model: d });
      }
      setDirty(false);
      toast.success('Diagram saved', validation && !validation.valid ? `Saved with ${validation.errors.length} notation error(s) — see Validate.` : undefined);
    } catch (e) {
      toast.error('Could not save', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [d, doc, nav, validation]);

  const runGeneration = async (req: UmlGenRequest) => {
    setBusy('regen');
    try {
      const r = await api.post<UmlGenResult>(GEN_URL[req.mode], req.body);
      applyResult(r, req);
    } catch (e) {
      toast.error('Regeneration failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const applyResult = (r: UmlGenResult, req: UmlGenRequest) => {
    if (!d) return;
    if (r.diagram.type === d.type && (d.elements.length === 0 || req === lastReq || JSON.stringify(req) === JSON.stringify(lastReq))) {
      commit(r.diagram);
      setLastReq(req);
      setEngine(r.engine);
      setSelection(null);
      requestAnimationFrame(() => canvas.current?.fit());
      if (r.warnings.length) toast.warning('Generated with notes', r.warnings[0]);
      return;
    }
    const { diagram, ...rest } = r;
    setDraft({ diagram, name: diagram.title || DIAGRAM_LABEL[diagram.type], request: req, result: rest });
    nav('/uml/new');
  };
  const regenRequest: UmlGenRequest | null = useMemo(() => {
    if (lastReq) return lastReq;
    const g = d?.meta.generation;
    if (d && g?.prompt && (g.method === 'ai' || g.method === 'rules')) return { mode: 'text', body: { type: d.type, text: g.prompt } };
    return null;
  }, [lastReq, d]);
  const regenerate = async () => {
    if (!regenRequest) return;
    if (d && hist.current && hist.current.canUndo && !(await confirmAction({ title: 'Regenerate the diagram?', description: 'The diagram is generated again from the same input. Your manual edits are replaced, but you can undo this.', confirmLabel: 'Regenerate' })))
      return;
    setLastReq(regenRequest);
    await runGeneration(regenRequest);
  };

  // element / relationship creation
  const addKind = (kind: ElementKind) => {
    if (!d) return;
    const sel = selection?.kind === 'element' ? d.elements.find((e) => e.id === selection.id) : undefined;
    const parent = sel && ['boundary', 'lane', 'node', 'component', 'state'].includes(sel.kind) && sel.kind !== kind ? sel.id : null;
    try {
      const r = addElement(d, kind, parent ? { parent } : {});
      const laid = autoLayout(r.diagram);
      commit(laid);
      setSelection({ kind: 'element', id: r.id });
    } catch (e) {
      toast.error('Cannot add element', (e as Error).message);
    }
  };
  const onConnectPick = (id: string) => {
    if (!d || !connecting) return;
    if (!connecting.source) return setConnecting({ ...connecting, source: id });
    try {
      const r = addRelationship(d, connecting.kind, connecting.source, id);
      commit(r.diagram);
      setSelection({ kind: 'relationship', id: r.id });
      const v = validateDiagram(r.diagram).errors.find((x) => x.relationshipId === r.id);
      if (v) toast.warning('Check this relationship', v.message);
    } catch (e) {
      toast.error('Cannot connect', (e as Error).message);
    }
    setConnecting(null);
  };
  const deleteSelection = useCallback(() => {
    if (!d || !selection) return;
    if (selection.kind === 'element') {
      const r = deleteElement(d, selection.id);
      commit(r.diagram);
      if (r.removedElements.length > 1 || r.removedRelationships.length) toast.info('Deleted', `${r.removedElements.length} element(s) and ${r.removedRelationships.length} relationship(s) removed. Undo with Ctrl+Z.`);
    } else commit(deleteRelationship(d, selection.id));
    setSelection(null);
  }, [d, selection, commit]);

  // keyboard shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) (e.preventDefault(), undo());
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) (e.preventDefault(), redo());
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) (e.preventDefault(), deleteSelection());
      else if (e.key === 'Escape') (setConnecting(null), setSelection(null));
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  const back = async () => {
    if (dirty && !(await confirmAction({ title: 'Leave without saving?', description: 'Your unsaved changes to this diagram will be lost.', confirmLabel: 'Leave', tone: 'danger' }))) return;
    nav('/uml');
  };
  const doExport = async (kind: 'svg' | 'png' | 'pdf' | 'puml' | 'mmd' | 'copy-puml' | 'copy-mmd') => {
    if (!d || !doc) return;
    try {
      if (validation && !validation.valid && !['copy-puml', 'copy-mmd'].includes(kind)) toast.warning('Exporting a diagram with notation errors', `${validation.errors.length} error(s) — see Validate.`);
      if (kind === 'svg') exportSvg(d, doc.name);
      else if (kind === 'png') await exportPng(d, doc.name);
      else if (kind === 'pdf') {
        setBusy('pdf');
        await exportPdf(d, doc.name);
      } else if (kind === 'puml') exportPlantUml(d, doc.name);
      else if (kind === 'mmd') exportMermaid(d, doc.name);
      else if (kind === 'copy-puml') (await copyText(toPlantUml(d)), toast.success('PlantUML copied'));
      else if (kind === 'copy-mmd') (await copyText(toMermaid(d) ?? ''), toast.success('Mermaid copied'));
    } catch (e) {
      toast.error('Export failed', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (loadError) return <EmptyState icon={AlertTriangle} title="Diagram not available" description={loadError} action={<Button onClick={() => nav('/uml')}>Back to UML Studio</Button>} />;
  if (!d || !doc) return <Skeleton className="h-[70vh] rounded-xl" />;

  const mermaidOk = (MERMAID_TYPES as readonly string[]).includes(d.type);
  const connectName = (id: string | null) => (id ? d.elements.find((e) => e.id === id)?.name || id : '');
  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-7.5rem)] lg:min-h-[600px]" data-testid="uml-editor">
      {/* ------------------------------------------------ toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-2 py-1.5" role="toolbar" aria-label="Diagram toolbar">
        <IconButton icon={ArrowLeft} label="Back to diagrams" onClick={() => void back()} />
        <Input aria-label="Diagram name" value={doc.name} onChange={(e) => (setDoc({ ...doc, name: e.target.value }), setDirty(true))} className="h-8 w-40 font-medium sm:w-52" maxLength={200} />
        <Badge tone="neutral" className="hidden 2xl:inline-flex">{DIAGRAM_LABEL[d.type]}</Badge>
        {dirty ? <span className="text-[12px] text-warning">Unsaved</span> : <span className="text-[12px] text-success">Saved</span>}
        <div className="mx-1 hidden h-6 w-px bg-border sm:block" />
        <Menu
          align="left"
          trigger={(_o, toggle) => (
            <Button size="sm" variant="ghost" icon={FilePlus2} iconRight={ChevronDown} onClick={toggle}>
              New
            </Button>
          )}
        >
          {(close) =>
            DIAGRAM_TYPES.map((t) => (
              <MenuItem
                key={t}
                onClick={() => {
                  close();
                  setDraft({ diagram: emptyDiagram(t), name: `Untitled ${DIAGRAM_LABEL[t].toLowerCase()}` });
                                nav('/uml/new');
                }}
              >
                {DIAGRAM_LABEL[t]}
              </MenuItem>
            ))
          }
        </Menu>
        <Button size="sm" variant="ghost" icon={Sparkles} onClick={() => setGen({ mode: 'text', type: d.type })}>
          Generate
        </Button>
        <Tooltip label={regenRequest ? 'Run the same generation again' : 'Only generated diagrams can be regenerated'}>
          <Button size="sm" variant="ghost" aria-label="Regenerate" icon={RefreshCw} disabled={!regenRequest || !!busy} loading={busy === 'regen'} onClick={() => void regenerate()}>
            <span className="hidden 2xl:inline">Regenerate</span>
          </Button>
        </Tooltip>
        <IconButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!hist.current?.canUndo} onClick={undo} />
        <IconButton icon={Redo2} label="Redo (Ctrl+Y)" disabled={!hist.current?.canRedo} onClick={redo} />
        <Tooltip label="Re-arrange every element automatically (undoable)">
          <Button size="sm" variant="ghost" aria-label="Auto layout" icon={Spline} onClick={() => (commit(autoLayout(d, { force: true })), requestAnimationFrame(() => canvas.current?.fit()))} disabled={d.type === 'sequence'}>
            <span className="hidden 2xl:inline">Auto layout</span>
          </Button>
        </Tooltip>
        <Button size="sm" variant={validation?.valid ? 'ghost' : 'danger'} icon={validation?.valid ? ShieldCheck : AlertTriangle} onClick={() => setShowIssues((v) => !v)} data-testid="uml-validate">
          Validate{issues.length ? ` (${issues.length})` : ''}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Menu
            trigger={(_o, toggle) => (
              <Button size="sm" variant="outline" icon={Download} iconRight={ChevronDown} onClick={toggle} loading={busy === 'pdf'} data-testid="uml-export">
                Export
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem icon={Download} onClick={() => (close(), void doExport('svg'))}>
                  SVG (vector)
                </MenuItem>
                <MenuItem icon={Download} onClick={() => (close(), void doExport('png'))}>
                  PNG (2× resolution)
                </MenuItem>
                <MenuItem icon={FileText} onClick={() => (close(), void doExport('pdf'))}>
                  PDF (vector)
                </MenuItem>
                <MenuItem icon={Download} onClick={() => (close(), void doExport('puml'))}>
                  PlantUML source (.puml)
                </MenuItem>
                <MenuItem icon={Copy} onClick={() => (close(), void doExport('copy-puml'))}>
                  Copy PlantUML
                </MenuItem>
                {mermaidOk && (
                  <>
                    <MenuItem icon={Download} onClick={() => (close(), void doExport('mmd'))}>
                      Mermaid source (.mmd)
                    </MenuItem>
                    <MenuItem icon={Copy} onClick={() => (close(), void doExport('copy-mmd'))}>
                      Copy Mermaid
                    </MenuItem>
                  </>
                )}
              </>
            )}
          </Menu>
          <Button size="sm" variant="primary" icon={Save} loading={busy === 'save'} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
      {engine && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="uml-engine">
          <EngineBadge engine={engine} />
          {engine.notice && <span className="text-warning">{engine.notice}</span>}
          <button className="ml-auto text-muted hover:text-fg" aria-label="Dismiss" onClick={() => setEngine(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ------------------------------------------------ body */}
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
        {/* left: palette + outline */}
        <aside className="order-2 flex max-h-[420px] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card lg:order-1 lg:max-h-none" aria-label="Elements">
          <Tabs
            className="px-2 pt-1"
            value={left}
            onChange={setLeft}
            tabs={[
              { value: 'add', label: 'Add', icon: Plus },
              { value: 'outline', label: 'Outline', icon: ListTree, count: d.elements.length },
            ]}
          />
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {left === 'add' ? (
              <div className="space-y-3">
                <div>
                  <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Elements</h3>
                  <div className="grid grid-cols-2 gap-1">
                    {ELEMENT_KINDS[d.type].map((k) => (
                      <button key={k} onClick={() => addKind(k)} className="truncate rounded-md border border-border px-2 py-1.5 text-left text-[12px] hover:border-primary/50 hover:bg-primary-soft" aria-label={`Add ${ELEMENT_LABEL[k]}`}>
                        {ELEMENT_LABEL[k]}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 px-1 text-[11px] text-subtle">Select a container first to add inside it.</p>
                </div>
                <div>
                  <h3 className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Relationships</h3>
                  <div className="grid grid-cols-1 gap-1">
                    {RELATIONSHIP_KINDS[d.type].map((k) => (
                      <button
                        key={k}
                        onClick={() => setConnecting(connecting?.kind === k ? null : { kind: k, source: null })}
                        className={cn('truncate rounded-md border px-2 py-1.5 text-left text-[12px]', connecting?.kind === k ? 'border-primary bg-primary-soft text-primary' : 'border-border hover:border-primary/50 hover:bg-primary-soft')}
                        aria-pressed={connecting?.kind === k}
                        aria-label={`Connect with ${RELATIONSHIP_LABEL[k]}`}
                      >
                        {RELATIONSHIP_LABEL[k]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <Outline d={d} selection={selection} onSelect={setSelection} />
            )}
          </div>
        </aside>

        {/* center: canvas */}
        <section className="relative order-1 h-[62vh] min-h-[380px] overflow-hidden rounded-xl border border-border bg-bg lg:order-2 lg:h-auto">
          {d.elements.length === 0 && !connecting && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6 text-center text-sm text-muted">
              <div>
                <Boxes className="mx-auto mb-2 opacity-60" />
                Empty diagram. Add elements from the left panel, or use <b>Generate</b>.
              </div>
            </div>
          )}
          {connecting && (
            <div className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-primary/40 bg-card px-3 py-1 text-[12.5px] shadow" role="status">
              <MousePointer2 size={13} className="text-primary" />
              {connecting.source ? `${RELATIONSHIP_LABEL[connecting.kind]} from “${connectName(connecting.source)}” — click the target` : `${RELATIONSHIP_LABEL[connecting.kind]} — click the source element`}
              <button className="text-muted hover:text-fg" onClick={() => setConnecting(null)} aria-label="Cancel connecting">
                <X size={13} />
              </button>
            </div>
          )}
          <UmlCanvas ref={canvas} diagram={d} selected={selection} errorIds={errorIds} grid={grid} dark={dark} connecting={connecting} onSelect={setSelection} onConnectPick={onConnectPick} onChange={onCanvasChange} onScale={setScale} />
          <div className="absolute bottom-2 right-2 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-card/95 p-0.5 shadow-sm" aria-label="Zoom controls">
            <IconButton icon={ZoomOut} label="Zoom out" size="icon-sm" onClick={() => canvas.current?.zoom(1 / 1.2)} />
            <span className="w-11 text-center font-mono text-[11.5px] text-muted" data-testid="uml-zoom">
              {Math.round(scale * 100)}%
            </span>
            <IconButton icon={ZoomIn} label="Zoom in" size="icon-sm" onClick={() => canvas.current?.zoom(1.2)} />
            <IconButton icon={Maximize} label="Fit to screen" size="icon-sm" onClick={() => canvas.current?.fit()} />
            <IconButton icon={Minus} label="Reset zoom to 100%" size="icon-sm" onClick={() => canvas.current?.reset()} />
            <IconButton icon={Grid3x3} label={grid ? 'Hide grid' : 'Show grid'} size="icon-sm" variant={grid ? 'secondary' : 'ghost'} onClick={() => setGrid((g) => !g)} />
          </div>
          {showIssues && (
            <div className="absolute bottom-12 left-2 z-10 max-h-[45%] w-[min(460px,calc(100%-1rem))] overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-lg" data-testid="uml-issues">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  {validation?.valid ? <CheckCircle2 size={15} className="text-success" /> : <AlertTriangle size={15} className="text-danger" />}
                  {validation?.valid ? 'Valid UML' : `${validation?.errors.length} error(s)`}
                  {validation && validation.warnings.length > 0 && <span className="font-normal text-muted">· {validation.warnings.length} warning(s)</span>}
                </span>
                <IconButton icon={X} label="Close validation" size="icon-sm" onClick={() => setShowIssues(false)} />
              </div>
              {!issues.length && <p className="text-[12.5px] text-muted">No notation problems found.</p>}
              <ul className="space-y-1">
                {issues.map((i, n) => (
                  <li key={n}>
                    <button
                      className={cn('w-full rounded-md px-2 py-1 text-left text-[12.5px]', i.level === 'error' ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning')}
                      onClick={() => i.elementId ? setSelection({ kind: 'element', id: i.elementId }) : i.relationshipId ? setSelection({ kind: 'relationship', id: i.relationshipId }) : undefined}
                    >
                      {i.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* right: inspector */}
        <aside className="order-3 min-h-0 overflow-hidden rounded-xl border border-border bg-card" aria-label="Properties">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h2 className="text-[13px] font-semibold">Properties</h2>
            {selection && (
              <button className="text-[12px] text-muted hover:text-fg" onClick={() => setSelection(null)}>
                Diagram
              </button>
            )}
          </div>
          <Inspector d={d} selection={selection} onChange={commit} onSelect={setSelection} issues={issues} />
        </aside>
      </div>

      <GenerateDialog open={!!gen} preset={gen ?? undefined} onClose={() => setGen(null)} onResult={(r, req) => (setGen(null), applyResult(r, req))} />
      {d.meta.generation.method === 'ai' && <Alert tone="info" className="text-[12.5px]">This diagram was suggested by a local AI model. Check it against your requirements — AI output can be incomplete or wrong.</Alert>}
    </div>
  );
}

function Outline({ d, selection, onSelect }: { d: Diagram; selection: Selection | null; onSelect: (s: Selection) => void }) {
  const tree = (parent: string | null, depth: number): React.ReactNode[] =>
    d.elements
      .filter((e) => (e.parent ?? null) === parent)
      .flatMap((e) => [
        <button
          key={e.id}
          onClick={() => onSelect({ kind: 'element', id: e.id })}
          className={cn('flex w-full items-center gap-1.5 truncate rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-elevated', selection?.id === e.id && 'bg-primary-soft text-primary')}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <span className="truncate">{e.name || `(${ELEMENT_LABEL[e.kind]})`}</span>
          <span className="ml-auto shrink-0 text-[10.5px] text-subtle">{ELEMENT_LABEL[e.kind]}</span>
        </button>,
        ...tree(e.id, depth + 1),
      ]);
  const name = (id: string) => d.elements.find((e) => e.id === id)?.name || id;
  return (
    <div className="space-y-3" data-testid="uml-outline">
      <div>{d.elements.length ? tree(null, 0) : <p className="px-2 text-[12px] text-muted">No elements.</p>}</div>
      {d.relationships.length > 0 && (
        <div>
          <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">Relationships</h3>
          {d.relationships.map((r) => (
            <button key={r.id} onClick={() => onSelect({ kind: 'relationship', id: r.id })} className={cn('block w-full truncate rounded-md px-2 py-1 text-left text-[12px] hover:bg-elevated', selection?.id === r.id && 'bg-primary-soft text-primary')}>
              {name(r.source)} → {name(r.target)} <span className="text-subtle">· {r.label || RELATIONSHIP_LABEL[r.kind]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
