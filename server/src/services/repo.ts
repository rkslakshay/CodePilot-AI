/** Persistence services backed by SQLite. */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { getDb, getDbPath, databaseSize, PROFILE_ID, tx } from '../database/db.js';
import { config } from '../config.js';
import { notFound, badRequest } from '../utils/http.js';
import type { Lang } from '../engine/ir.js';

const j = (v: unknown) => JSON.stringify(v ?? {});
const pj = (s: unknown) => {
  try {
    return JSON.parse(String(s ?? '{}'));
  } catch {
    return {};
  }
};
const MAX_JSON = 200_000;
function clampJson(v: unknown) {
  const s = j(v);
  return s.length > MAX_JSON ? JSON.stringify({ truncated: true, preview: s.slice(0, 5000) }) : s;
}

// ---------------------------------------------------------------- history
export type HistoryKind = 'generation' | 'conversion' | 'explanation' | 'algorithm' | 'execution' | 'debug' | 'learning';
export interface HistoryInput {
  kind: HistoryKind;
  title: string;
  language?: string | null;
  targetLanguage?: string | null;
  engine: 'ollama' | 'offline' | 'template' | 'local';
  status?: string;
  input: unknown;
  output: unknown;
  isDemo?: boolean;
  createdAt?: string;
}

export function addHistory(h: HistoryInput): number {
  const r = getDb()
    .prepare(
      `INSERT INTO history (profile_id, kind, title, language, target_language, engine, status, input, output, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    )
    .run(PROFILE_ID, h.kind, h.title.slice(0, 200), h.language ?? null, h.targetLanguage ?? null, h.engine, h.status ?? 'success', clampJson(h.input), clampJson(h.output), h.isDemo ? 1 : 0, h.createdAt ?? null);
  return Number(r.lastInsertRowid);
}

const HISTORY_COLS = `id, kind, title, language, target_language AS targetLanguage, engine, status, is_demo AS isDemo, created_at AS createdAt`;

export function listHistory(q: { search?: string; kind?: string; language?: string; sort?: 'newest' | 'oldest'; limit?: number; offset?: number }) {
  const where = ['profile_id = ?'];
  const args: (string | number)[] = [PROFILE_ID];
  if (q.kind) {
    where.push('kind = ?');
    args.push(q.kind);
  }
  if (q.language) {
    where.push('(language = ? OR target_language = ?)');
    args.push(q.language, q.language);
  }
  if (q.search) {
    where.push('(title LIKE ? OR input LIKE ?)');
    args.push(`%${q.search}%`, `%${q.search}%`);
  }
  const w = where.join(' AND ');
  const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM history WHERE ${w}`).get(...args) as { c: number }).c;
  const items = getDb()
    .prepare(`SELECT ${HISTORY_COLS} FROM history WHERE ${w} ORDER BY created_at ${q.sort === 'oldest' ? 'ASC' : 'DESC'}, id ${q.sort === 'oldest' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`)
    .all(...args, q.limit ?? 50, q.offset ?? 0)
    .map((r) => ({ ...r, isDemo: !!(r as { isDemo: number }).isDemo }));
  return { items, total };
}

export function getHistory(id: number) {
  const r = getDb().prepare(`SELECT ${HISTORY_COLS}, input, output FROM history WHERE id = ? AND profile_id = ?`).get(id, PROFILE_ID) as Record<string, unknown> | undefined;
  if (!r) throw notFound('History record');
  return { ...r, isDemo: !!r.isDemo, input: pj(r.input), output: pj(r.output) };
}

export function deleteHistory(id: number) {
  const r = getDb().prepare('DELETE FROM history WHERE id = ? AND profile_id = ?').run(id, PROFILE_ID);
  if (!r.changes) throw notFound('History record');
}

export function clearHistory(kind?: string) {
  const r = kind ? getDb().prepare('DELETE FROM history WHERE profile_id = ? AND kind = ?').run(PROFILE_ID, kind) : getDb().prepare('DELETE FROM history WHERE profile_id = ?').run(PROFILE_ID);
  return Number(r.changes);
}

// ---------------------------------------------------------------- projects & files
export interface ProjectRow {
  id: number;
  name: string;
  description: string;
  language: string;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
}

export function listProjects(search?: string): ProjectRow[] {
  const args: (string | number)[] = [PROFILE_ID];
  let filter = '';
  if (search) {
    filter = `AND (p.name LIKE ? OR p.description LIKE ? OR EXISTS (SELECT 1 FROM code_files f2 WHERE f2.project_id = p.id AND (f2.name LIKE ? OR f2.content LIKE ?)))`;
    args.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  return getDb()
    .prepare(
      `SELECT p.id, p.name, p.description, p.language, p.is_demo AS isDemo, p.created_at AS createdAt, p.updated_at AS updatedAt,
              (SELECT COUNT(*) FROM code_files f WHERE f.project_id = p.id) AS fileCount
       FROM projects p WHERE p.profile_id = ? ${filter} ORDER BY p.updated_at DESC, p.id DESC`,
    )
    .all(...args)
    .map((r) => ({ ...(r as unknown as ProjectRow), isDemo: !!(r as { isDemo: number }).isDemo }));
}

export function getProject(id: number) {
  const p = getDb()
    .prepare(`SELECT id, name, description, language, is_demo AS isDemo, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ? AND profile_id = ?`)
    .get(id, PROFILE_ID) as Record<string, unknown> | undefined;
  if (!p) throw notFound('Project');
  return { ...p, isDemo: !!p.isDemo, files: listFiles(id) };
}

export function createProject(d: { name: string; description?: string; language?: string; isDemo?: boolean }) {
  const r = getDb()
    .prepare('INSERT INTO projects (profile_id, name, description, language, is_demo) VALUES (?, ?, ?, ?, ?)')
    .run(PROFILE_ID, d.name.trim(), d.description ?? '', d.language ?? 'mixed', d.isDemo ? 1 : 0);
  return getProject(Number(r.lastInsertRowid));
}

export function updateProject(id: number, d: { name?: string; description?: string; language?: string }) {
  getProject(id);
  const cur = getDb().prepare('SELECT name, description, language FROM projects WHERE id = ?').get(id) as { name: string; description: string; language: string };
  getDb()
    .prepare(`UPDATE projects SET name = ?, description = ?, language = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(d.name?.trim() ?? cur.name, d.description ?? cur.description, d.language ?? cur.language, id);
  return getProject(id);
}

export function deleteProject(id: number) {
  const r = getDb().prepare('DELETE FROM projects WHERE id = ? AND profile_id = ?').run(id, PROFILE_ID);
  if (!r.changes) throw notFound('Project');
}

const FILE_COLS = `f.id, f.project_id AS projectId, f.name, f.language, f.is_demo AS isDemo, f.created_at AS createdAt, f.updated_at AS updatedAt, length(f.content) AS size`;

export function listFiles(projectId: number) {
  return getDb()
    .prepare(`SELECT ${FILE_COLS} FROM code_files f WHERE f.project_id = ? ORDER BY f.language, f.name`)
    .all(projectId)
    .map((r) => ({ ...r, isDemo: !!(r as { isDemo: number }).isDemo }));
}

export function recentFiles(limit = 6) {
  return getDb()
    .prepare(`SELECT ${FILE_COLS}, p.name AS projectName FROM code_files f JOIN projects p ON p.id = f.project_id WHERE p.profile_id = ? ORDER BY f.updated_at DESC, f.id DESC LIMIT ?`)
    .all(PROFILE_ID, limit)
    .map((r) => ({ ...r, isDemo: !!(r as { isDemo: number }).isDemo }));
}

export function getFile(id: number) {
  const r = getDb()
    .prepare(`SELECT ${FILE_COLS}, f.content, p.name AS projectName FROM code_files f JOIN projects p ON p.id = f.project_id WHERE f.id = ? AND p.profile_id = ?`)
    .get(id, PROFILE_ID) as Record<string, unknown> | undefined;
  if (!r) throw notFound('File');
  return { ...r, isDemo: !!r.isDemo };
}

function touchProject(projectId: number) {
  getDb().prepare(`UPDATE projects SET updated_at = datetime('now') WHERE id = ?`).run(projectId);
}

export function createFile(projectId: number, d: { name: string; language: Lang; content?: string; isDemo?: boolean }) {
  getProject(projectId);
  const r = getDb()
    .prepare('INSERT INTO code_files (project_id, name, language, content, is_demo) VALUES (?, ?, ?, ?, ?)')
    .run(projectId, d.name.trim(), d.language, d.content ?? '', d.isDemo ? 1 : 0);
  touchProject(projectId);
  return getFile(Number(r.lastInsertRowid));
}

export function updateFile(id: number, d: { name?: string; language?: Lang; content?: string }) {
  const cur = getFile(id) as Record<string, any>;
  getDb()
    .prepare(`UPDATE code_files SET name = ?, language = ?, content = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(d.name?.trim() ?? cur.name, d.language ?? cur.language, d.content ?? cur.content, id);
  touchProject(cur.projectId);
  return getFile(id);
}

export function deleteFile(id: number) {
  const cur = getFile(id) as Record<string, any>;
  getDb().prepare('DELETE FROM code_files WHERE id = ?').run(id);
  touchProject(cur.projectId);
}

export function duplicateFile(id: number) {
  const cur = getFile(id) as Record<string, any>;
  const dot = cur.name.lastIndexOf('.');
  const stem = dot > 0 ? cur.name.slice(0, dot) : cur.name;
  const ext = dot > 0 ? cur.name.slice(dot) : '';
  let n = 1;
  let name = `${stem}-copy${ext}`;
  while (getDb().prepare('SELECT 1 FROM code_files WHERE project_id = ? AND name = ?').get(cur.projectId, name)) name = `${stem}-copy${++n}${ext}`;
  return createFile(cur.projectId, { name, language: cur.language, content: cur.content });
}

/** Save a snippet into a project (creating "Scratchpad" when no project is given). */
export function saveSnippet(d: { projectId?: number; name: string; language: Lang; content: string }) {
  let projectId = d.projectId;
  if (!projectId) {
    const sp = getDb().prepare("SELECT id FROM projects WHERE profile_id = ? AND name = 'Scratchpad'").get(PROFILE_ID) as { id: number } | undefined;
    projectId = sp ? sp.id : (createProject({ name: "Scratchpad", description: "Snippets saved from CodePilot tools", language: "mixed" }) as unknown as { id: number }).id;
  }
  let name = d.name.trim();
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  while (getDb().prepare('SELECT 1 FROM code_files WHERE project_id = ? AND name = ?').get(projectId, name)) name = `${stem}-${++n}${ext}`;
  return createFile(projectId, { name, language: d.language, content: d.content });
}

// ---------------------------------------------------------------- saved algorithms
export function listSavedAlgorithms() {
  return getDb()
    .prepare(`SELECT id, title, algorithm_id AS algorithmId, language, is_demo AS isDemo, created_at AS createdAt, complexity FROM saved_algorithms WHERE profile_id = ? ORDER BY created_at DESC, id DESC`)
    .all(PROFILE_ID)
    .map((r) => ({ ...r, isDemo: !!(r as any).isDemo, complexity: pj((r as any).complexity) }));
}
export function getSavedAlgorithm(id: number) {
  const r = getDb().prepare(`SELECT * FROM saved_algorithms WHERE id = ? AND profile_id = ?`).get(id, PROFILE_ID) as Record<string, any> | undefined;
  if (!r) throw notFound('Saved algorithm');
  return {
    id: r.id, title: r.title, algorithmId: r.algorithm_id, language: r.language, code: r.code, pseudocode: r.pseudocode, flowchart: r.flowchart,
    steps: pj(r.steps), complexity: pj(r.complexity), notes: r.notes, isDemo: !!r.is_demo, createdAt: r.created_at,
  };
}
export function saveAlgorithm(d: { title: string; algorithmId?: string | null; language?: string | null; code?: string; pseudocode?: string; flowchart?: string; steps?: string[]; complexity?: unknown; notes?: string; isDemo?: boolean }) {
  const r = getDb()
    .prepare(`INSERT INTO saved_algorithms (profile_id, title, algorithm_id, language, code, pseudocode, flowchart, steps, complexity, notes, is_demo) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(PROFILE_ID, d.title, d.algorithmId ?? null, d.language ?? null, d.code ?? '', d.pseudocode ?? '', d.flowchart ?? '', j(d.steps ?? []), j(d.complexity ?? {}), d.notes ?? '', d.isDemo ? 1 : 0);
  return getSavedAlgorithm(Number(r.lastInsertRowid));
}
export function deleteSavedAlgorithm(id: number) {
  const r = getDb().prepare('DELETE FROM saved_algorithms WHERE id = ? AND profile_id = ?').run(id, PROFILE_ID);
  if (!r.changes) throw notFound('Saved algorithm');
}

// ---------------------------------------------------------------- learning
export function getProgress() {
  return getDb()
    .prepare(`SELECT topic_id AS topicId, status, quiz_attempts AS quizAttempts, quiz_correct AS quizCorrect, quiz_total AS quizTotal, updated_at AS updatedAt FROM learning_progress WHERE profile_id = ?`)
    .all(PROFILE_ID);
}
export function setTopicStatus(topicId: string, status: 'not_started' | 'in_progress' | 'completed') {
  getDb()
    .prepare(
      `INSERT INTO learning_progress (profile_id, topic_id, status, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(profile_id, topic_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
    )
    .run(PROFILE_ID, topicId, status);
}
export function recordQuiz(topicId: string, correct: number, total: number) {
  getDb()
    .prepare(
      `INSERT INTO learning_progress (profile_id, topic_id, status, quiz_attempts, quiz_correct, quiz_total, updated_at) VALUES (?, ?, 'in_progress', 1, ?, ?, datetime('now'))
       ON CONFLICT(profile_id, topic_id) DO UPDATE SET quiz_attempts = quiz_attempts + 1, quiz_correct = quiz_correct + excluded.quiz_correct,
         quiz_total = quiz_total + excluded.quiz_total, status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END, updated_at = excluded.updated_at`,
    )
    .run(PROFILE_ID, topicId, correct, total);
}
export interface AnswerRecord {
  question: string;
  options: string[];
  answer: number;
  chosen: number;
  explanation?: string;
  level?: string;
}
/** Stores every answered MCQ so wrong answers can be revised later. */
export function recordAnswers(topicId: string, answers: AnswerRecord[], mode: 'quiz' | 'revision' = 'quiz') {
  const st = getDb().prepare(`INSERT INTO quiz_answers (profile_id, topic_id, question, chosen, correct, mode, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const a of answers) {
    const payload = JSON.stringify({ q: a.question, options: a.options, answer: a.answer, explanation: a.explanation ?? '', level: a.level ?? '' });
    st.run(PROFILE_ID, topicId, a.question, a.chosen, a.chosen === a.answer ? 1 : 0, mode, payload);
  }
}
/** Questions whose most recent answer was wrong — the revision queue. */
export function revisionQueue(limit = 50) {
  const rows = getDb()
    .prepare(
      `SELECT qa.* FROM quiz_answers qa
       JOIN (SELECT question, MAX(id) AS last FROM quiz_answers WHERE profile_id = ? GROUP BY question) l ON l.last = qa.id
       WHERE qa.correct = 0 ORDER BY qa.id DESC LIMIT ?`,
    )
    .all(PROFILE_ID, limit) as any[];
  return rows.map((r) => {
    const wrongCount = (getDb().prepare(`SELECT COUNT(*) AS c FROM quiz_answers WHERE profile_id = ? AND question = ? AND correct = 0`).get(PROFILE_ID, r.question) as { c: number }).c;
    return { topicId: r.topic_id as string, question: r.question as string, lastChosen: r.chosen as number, wrongCount, lastAnsweredAt: r.created_at as string, mcq: pj(r.payload) };
  });
}
export function answerStats() {
  const r = getDb().prepare(`SELECT COUNT(*) AS total, SUM(correct) AS ok, SUM(CASE WHEN mode = 'revision' THEN 1 ELSE 0 END) AS revised FROM quiz_answers WHERE profile_id = ?`).get(PROFILE_ID) as { total: number; ok: number | null; revised: number | null };
  return { answered: r.total, correct: r.ok ?? 0, revisionAnswers: r.revised ?? 0 };
}
export function listSavedQuestions(topicId?: string) {
  const rows = topicId
    ? getDb().prepare(`SELECT * FROM saved_questions WHERE profile_id = ? AND topic_id = ? ORDER BY created_at DESC`).all(PROFILE_ID, topicId)
    : getDb().prepare(`SELECT * FROM saved_questions WHERE profile_id = ? ORDER BY created_at DESC`).all(PROFILE_ID);
  return rows.map((r: any) => ({ id: r.id, topicId: r.topic_id, type: r.type, question: r.question, payload: pj(r.payload), isDemo: !!r.is_demo, createdAt: r.created_at }));
}
export function saveQuestion(d: { topicId: string; type: "viva" | "mcq" | "practice"; question: string; payload?: unknown; isDemo?: boolean }) {
  const existing = getDb().prepare('SELECT id FROM saved_questions WHERE profile_id = ? AND type = ? AND question = ?').get(PROFILE_ID, d.type, d.question) as { id: number } | undefined;
  if (existing) return { id: existing.id, duplicate: true };
  const r = getDb().prepare('INSERT INTO saved_questions (profile_id, topic_id, type, question, payload, is_demo) VALUES (?,?,?,?,?,?)').run(PROFILE_ID, d.topicId, d.type, d.question, j(d.payload), d.isDemo ? 1 : 0);
  return { id: Number(r.lastInsertRowid), duplicate: false };
}
export function deleteSavedQuestion(id: number) {
  const r = getDb().prepare('DELETE FROM saved_questions WHERE id = ? AND profile_id = ?').run(id, PROFILE_ID);
  if (!r.changes) throw notFound('Saved question');
}
export function recordPractice(d: { topicId: string; problemId: string; status: 'attempted' | 'solved'; language?: string; isDemo?: boolean; createdAt?: string }) {
  getDb()
    .prepare(`INSERT INTO practice_attempts (profile_id, topic_id, problem_id, status, language, is_demo, created_at) VALUES (?,?,?,?,?,?, COALESCE(?, datetime('now')))`)
    .run(PROFILE_ID, d.topicId, d.problemId, d.status, d.language ?? null, d.isDemo ? 1 : 0, d.createdAt ?? null);
  if (getDb().prepare('SELECT status FROM learning_progress WHERE profile_id = ? AND topic_id = ?').get(PROFILE_ID, d.topicId) === undefined) setTopicStatus(d.topicId, 'in_progress');
}
export function practiceHistory(limit = 30) {
  return getDb()
    .prepare(`SELECT id, topic_id AS topicId, problem_id AS problemId, status, language, created_at AS createdAt FROM practice_attempts WHERE profile_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(PROFILE_ID, limit);
}

// ---------------------------------------------------------------- system / backups
export function databaseInfo() {
  const d = getDb();
  const count = (t: string) => (d.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
  const tables = ['projects', 'code_files', 'history', 'saved_algorithms', 'learning_progress', 'saved_questions', 'practice_attempts', 'settings'];
  const version = (d.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v;
  return {
    path: getDbPath(),
    sizeBytes: databaseSize(),
    schemaVersion: version,
    engine: `SQLite ${(d.prepare('SELECT sqlite_version() AS v').get() as { v: string }).v} (node:sqlite)`,
    tables: Object.fromEntries(tables.map((t) => [t, count(t)])),
    demoRecords: count("history WHERE is_demo = 1") + count('projects WHERE is_demo = 1'),
  };
}

export function createBackup() {
  if (getDbPath() === ':memory:') throw badRequest('In-memory database cannot be backed up');
  mkdirSync(config.backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = join(config.backupDir, `codepilot-${stamp}.db`);
  if (existsSync(file)) unlinkSync(file);
  // VACUUM INTO writes a consistent, compacted copy even while the app is running.
  getDb().prepare('VACUUM INTO ?').run(file);
  return backupInfo(file);
}

function backupInfo(file: string) {
  const st = statSync(file);
  return { name: basename(file), sizeBytes: st.size, createdAt: st.mtime.toISOString() };
}

export function listBackups() {
  if (!existsSync(config.backupDir)) return [];
  return readdirSync(config.backupDir)
    .filter((f) => /^codepilot-[\d-]+\.db$/.test(f))
    .map((f) => backupInfo(join(config.backupDir, f)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function backupPath(name: string) {
  if (!/^codepilot-[\d-]+\.db$/.test(name)) throw badRequest('Invalid backup name');
  const p = join(config.backupDir, name);
  if (!existsSync(p)) throw notFound('Backup');
  return p;
}

export function deleteBackup(name: string) {
  unlinkSync(backupPath(name));
}

export { tx };
