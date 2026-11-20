/** UML Studio API (/api/uml). All generation, validation and rendering run locally. */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { h, ok, parse, toInt, AppError } from '../utils/http.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as S from '../uml/service.js';
import { generateFromText } from '../uml/generate.js';
import { classDiagramFromSource, sequenceFromSource, activityFromSource, listFunctions, type SourceFile } from '../uml/from-source.js';
import { generateFromRepository } from '../uml/from-repo.js';
import { getFile } from '../services/repo.js';
import { readRepoFile, fileRowsOf, getRepo } from '../repo/service.js';
import { renderPdf } from '../repo/report.js';
import { languageOf } from '../repo/scan.js';
import { DIAGRAM_TYPES, template, toSvg, validateDiagram, type DiagramType } from '../../../shared/uml/index.js';

export const uml = Router();
const heavy = rateLimit(30, 60_000);
const Type = z.enum(DIAGRAM_TYPES);
const LangEnum = z.enum(['c', 'cpp', 'java', 'python', 'javascript', 'typescript', 'tsx']);

function abortOnClose(res: Response): AbortSignal {
  const c = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) c.abort();
  });
  return c.signal;
}

/** Source selection: inline code, workspace files or repository files. */
const SourceSel = z.object({
  code: z.string().max(400_000).optional(),
  language: LangEnum.optional(),
  path: z.string().max(400).optional(),
  fileIds: z.array(z.number().int().positive()).max(200).optional(),
  repoId: z.number().int().positive().optional(),
  paths: z.array(z.string().max(1000)).max(400).optional(),
  folder: z.string().max(1000).optional(),
});
function resolveSources(sel: z.infer<typeof SourceSel>): SourceFile[] {
  if (sel.code !== undefined) {
    if (!sel.language) throw new AppError(400, 'bad_request', 'language is required with inline code');
    return [{ path: sel.path || `snippet.${sel.language === 'python' ? 'py' : sel.language === 'javascript' ? 'js' : sel.language === 'typescript' ? 'ts' : sel.language}`, content: sel.code, language: sel.language }];
  }
  if (sel.fileIds?.length) {
    return sel.fileIds.map((id) => {
      const f = getFile(id) as unknown as { name: string; language: string; content: string };
      return { path: f.name, content: f.content, language: f.language };
    });
  }
  if (sel.repoId) {
    getRepo(sel.repoId);
    const prefix = sel.folder ? sel.folder.replace(/\/+$/, '') + '/' : '';
    const rows = fileRowsOf(sel.repoId).filter((f) => f.kind === 'source' && !f.skipped && !f.sensitive && (!sel.paths || sel.paths.includes(f.path)) && (!prefix || f.path.startsWith(prefix)));
    return rows.slice(0, 400).map((f) => ({ path: f.path, content: readRepoFile(sel.repoId!, f.path).content, language: f.language ?? languageOf(f.path) }));
  }
  throw new AppError(400, 'bad_request', 'Provide code, workspace fileIds or a repository.');
}

uml.get('/templates', (req, res) => {
  const t = typeof req.query.type === 'string' ? parse(Type, req.query.type) : null;
  ok(res, t ? template(t) : DIAGRAM_TYPES.map((x) => ({ type: x, title: template(x).title })));
});
uml.get('/diagrams', (req, res) =>
  ok(res, S.listDiagrams({ type: typeof req.query.type === 'string' ? req.query.type : undefined, repoId: req.query.repoId ? toInt(req.query.repoId, 'repoId') : undefined, search: typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : undefined })),
);
const Create = z.object({ name: z.string().min(1).max(200), model: z.unknown(), repoId: z.number().int().positive().nullable().optional(), projectId: z.number().int().positive().nullable().optional(), sourcePath: z.string().max(400).nullable().optional() });
uml.post('/diagrams', (req, res) => {
  const b = parse(Create, req.body);
  ok(res, S.createDiagram({ ...b, model: b.model }), 201);
});
uml.get('/diagrams/:id', (req, res) => ok(res, S.getDiagram(toInt(req.params.id))));
const Update = z.object({ name: z.string().min(1).max(200).optional(), model: z.unknown().optional(), projectId: z.number().int().positive().nullable().optional() }).refine((v) => Object.keys(v).length > 0, 'Nothing to update');
uml.put('/diagrams/:id', (req, res) => ok(res, S.updateDiagram(toInt(req.params.id), parse(Update, req.body))));
uml.delete('/diagrams/:id', (req, res) => ok(res, S.deleteDiagram(toInt(req.params.id))));
uml.post('/diagrams/:id/duplicate', (req, res) => ok(res, S.duplicateDiagram(toInt(req.params.id)), 201));

uml.post('/validate', (req, res) => {
  const v = validateDiagram(req.body?.model);
  ok(res, { valid: v.valid, errors: v.errors, warnings: v.warnings });
});

const GenText = z.object({ type: Type, text: z.string().min(1).max(6000), useAi: z.boolean().optional() });
uml.post('/generate/text', heavy, h(async (req, res) => {
  const b = parse(GenText, req.body);
  ok(res, await generateFromText(b.type as DiagramType, b.text, { useAi: b.useAi, signal: abortOnClose(res) }));
}));

const GenSource = SourceSel.extend({ kind: z.enum(['class', 'sequence', 'activity']).default('class'), function: z.string().max(200).optional(), targetPath: z.string().max(1000).optional() });
uml.post('/generate/source', heavy, (req, res) => {
  const b = parse(GenSource, req.body);
  const files = resolveSources(b);
  if (!files.length) throw new AppError(422, 'no_source', 'No readable source files were selected.');
  let diagram;
  if (b.kind === 'class') diagram = classDiagramFromSource(files).diagram;
  else {
    if (!b.function) throw new AppError(400, 'bad_request', 'Choose a function or method.');
    const path = b.targetPath ?? files[0].path;
    const file = files.find((f) => f.path === path);
    if (!file) throw new AppError(404, 'not_found', 'Source file not found');
    diagram = b.kind === 'sequence' ? sequenceFromSource(files, { path, function: b.function }) : activityFromSource(file, b.function);
  }
  if (b.repoId) diagram.meta.generation.repoId = b.repoId;
  const v = validateDiagram(diagram);
  ok(res, { diagram, engine: { kind: 'offline', label: 'Extracted from source code (Tree-sitter, offline, not AI)' }, warnings: diagram.meta.generation.warnings, validation: { valid: v.valid, errors: v.errors, warnings: v.warnings } });
});
uml.post('/source/functions', (req, res) => {
  const files = resolveSources(parse(SourceSel, req.body));
  ok(res, files.slice(0, 50).map((f) => ({ path: f.path, language: f.language, functions: listFunctions(f) })));
});

const GenRepo = z.object({ repoId: z.number().int().positive(), kind: z.enum(['class', 'modules', 'architecture', 'deployment']), folder: z.string().max(1000).optional() });
uml.post('/generate/repository', heavy, (req, res) => {
  const b = parse(GenRepo, req.body);
  const diagram = generateFromRepository(b.repoId, b.kind, { folder: b.folder });
  const v = validateDiagram(diagram);
  ok(res, { diagram, engine: { kind: 'offline', label: 'Generated from the repository (offline, not AI)' }, warnings: diagram.meta.generation.warnings, validation: { valid: v.valid, errors: v.errors, warnings: v.warnings } });
});

const Pdf = z.object({ model: z.unknown(), name: z.string().max(200).optional() });
uml.post('/export/pdf', heavy, h(async (req, res) => {
  const b = parse(Pdf, req.body);
  const model = S.parseModel(b.model);
  const { svg, width, height } = toSvg(model);
  // one page sized to the diagram (vector output), with a small margin
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:${width + 48}px ${height + 48}px;margin:24px}html,body{margin:0;background:#fff}svg{display:block}</style></head><body>${svg.replace(/^<\?xml[^>]*>/, '')}</body></html>`;
  try {
    const pdf = await renderPdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(b.name || model.title || model.type).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'diagram'}.pdf"`);
    res.send(pdf);
  } catch (e) {
    const err = e as Error & { status?: number };
    throw new AppError(err.status ?? 500, 'pdf_failed', err.message);
  }
}));
