/** UML Studio persistence (SQLite) — diagrams are stored as validated structured models. */
import { getDb, PROFILE_ID } from '../database/db.js';
import { AppError } from '../utils/http.js';
import { safeParseDiagram, validateDiagram, autoLayout, DIAGRAM_TYPES, type Diagram, type DiagramType } from '../../../shared/uml/index.js';

interface Row {
  id: number;
  name: string;
  type: DiagramType;
  model: string;
  renderer: string;
  generation: string;
  repo_id: number | null;
  project_id: number | null;
  source_path: string | null;
  created_at: string;
  updated_at: string;
}
const toDto = (r: Row, withModel = true) => {
  const model = withModel ? (JSON.parse(r.model) as Diagram) : null;
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    renderer: r.renderer,
    generation: r.generation,
    repoId: r.repo_id,
    projectId: r.project_id,
    sourcePath: r.source_path,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(model ? { model, validation: summarise(model) } : {}),
  };
};
const summarise = (d: Diagram) => {
  const v = validateDiagram(d);
  return { valid: v.valid, errors: v.errors, warnings: v.warnings };
};

/** Parses and normalises a model from a request; structural errors are rejected (400). */
export function parseModel(input: unknown): Diagram {
  const r = safeParseDiagram(input);
  if (!r.ok) throw new AppError(400, 'invalid_diagram', `The diagram model is not valid: ${r.errors.slice(0, 3).join('; ')}`, r.errors);
  // elements without positions (e.g. added through the API) get placed without moving the others
  return autoLayout(r.diagram);
}

const row = (id: number) => getDb().prepare('SELECT * FROM uml_diagrams WHERE id = ? AND profile_id = ?').get(id, PROFILE_ID) as Row | undefined;
export function getDiagram(id: number) {
  const r = row(id);
  if (!r) throw new AppError(404, 'not_found', 'Diagram not found');
  return toDto(r);
}
export function listDiagrams(q: { type?: string; repoId?: number; search?: string } = {}) {
  const where = ['profile_id = ?'];
  const args: (string | number)[] = [PROFILE_ID];
  if (q.type) {
    if (!DIAGRAM_TYPES.includes(q.type as DiagramType)) throw new AppError(400, 'bad_request', 'Unknown diagram type');
    where.push('type = ?');
    args.push(q.type);
  }
  if (q.repoId) {
    where.push('repo_id = ?');
    args.push(q.repoId);
  }
  if (q.search) {
    where.push("name LIKE ? ESCAPE '\\'");
    args.push(`%${q.search.replace(/[\\%_]/g, '\\$&')}%`);
  }
  return (getDb().prepare(`SELECT * FROM uml_diagrams WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT 500`).all(...args) as unknown as Row[]).map((r) => {
    const m = JSON.parse(r.model) as Diagram;
    return { ...toDto(r, false), elementCount: m.elements.length, relationshipCount: m.relationships.length };
  });
}

export function createDiagram(input: { name: string; model: unknown; repoId?: number | null; projectId?: number | null; sourcePath?: string | null }) {
  const model = parseModel(input.model);
  const repoId = input.repoId ?? model.meta.generation.repoId ?? null;
  if (repoId && !getDb().prepare('SELECT 1 FROM repositories WHERE id = ? AND profile_id = ?').get(repoId, PROFILE_ID)) throw new AppError(404, 'not_found', 'Repository not found');
  if (input.projectId && !getDb().prepare('SELECT 1 FROM projects WHERE id = ? AND profile_id = ?').get(input.projectId, PROFILE_ID)) throw new AppError(404, 'not_found', 'Project not found');
  const id = Number(
    getDb()
      .prepare('INSERT INTO uml_diagrams (profile_id, name, type, model, generation, repo_id, project_id, source_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(PROFILE_ID, input.name.trim(), model.type, JSON.stringify(model), model.meta.generation.method, repoId, input.projectId ?? null, input.sourcePath ?? model.meta.generation.sourcePath ?? null).lastInsertRowid,
  );
  return getDiagram(id);
}

export function updateDiagram(id: number, patch: { name?: string; model?: unknown; projectId?: number | null }) {
  const cur = row(id);
  if (!cur) throw new AppError(404, 'not_found', 'Diagram not found');
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name.trim());
  }
  if (patch.model !== undefined) {
    const model = parseModel(patch.model);
    if (model.type !== cur.type) throw new AppError(400, 'type_change', 'A diagram cannot change its type; create a new diagram instead.');
    sets.push('model = ?', 'generation = ?');
    args.push(JSON.stringify(model), model.meta.generation.method);
  }
  if (patch.projectId !== undefined) {
    sets.push('project_id = ?');
    args.push(patch.projectId);
  }
  if (sets.length) getDb().prepare(`UPDATE uml_diagrams SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args, id);
  return getDiagram(id);
}

export function deleteDiagram(id: number) {
  if (!row(id)) throw new AppError(404, 'not_found', 'Diagram not found');
  getDb().prepare('DELETE FROM uml_diagrams WHERE id = ?').run(id);
  return { deleted: true };
}

export function duplicateDiagram(id: number) {
  const cur = row(id);
  if (!cur) throw new AppError(404, 'not_found', 'Diagram not found');
  const base = cur.name.replace(/ \(copy(?: \d+)?\)$/, '');
  let name = `${base} (copy)`;
  for (let n = 2; getDb().prepare('SELECT 1 FROM uml_diagrams WHERE profile_id = ? AND name = ?').get(PROFILE_ID, name); n++) name = `${base} (copy ${n})`;
  const newId = Number(
    getDb()
      .prepare('INSERT INTO uml_diagrams (profile_id, name, type, model, renderer, generation, repo_id, project_id, source_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(PROFILE_ID, name.slice(0, 200), cur.type, cur.model, cur.renderer, cur.generation, cur.repo_id, cur.project_id, cur.source_path).lastInsertRowid,
  );
  return getDiagram(newId);
}
