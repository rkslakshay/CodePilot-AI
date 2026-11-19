/**
 * Local AI code review (Ollama) on top of the static analysis.
 *
 * - Never sends a whole repository in one prompt: files are split into chunks (function boundaries
 *   where possible) that fit the model context (≈6 000 characters of code per prompt).
 * - Sensitive files are never read; every prompt passes through redactSecrets().
 * - Answers are JSON validated with Zod (REVIEW contracts) with the shared repair retry.
 * - Results are cached by content hash + model; unchanged code is not re-sent.
 * - Line numbers proposed by the model are only kept when they fall inside the chunk it saw.
 * - AI output never modifies files. AI-only issues are stored as source "ai" (low confidence);
 *   an AI issue on the same line as a static finding marks that finding "combined".
 * - When Ollama is unavailable the response is the static analysis, clearly labelled.
 */
import { createHash } from 'node:crypto';
import { getDb } from '../database/db.js';
import { aiJson, resolveAI } from '../providers/index.js';
import { contract, REVIEW } from '../providers/schemas.js';
import type { EngineInfo } from '../providers/types.js';
import { AppError } from '../utils/http.js';
import { redactSecrets, analyzeFile, fingerprint } from './analyze.js';
import { getRepo, readRepoFile, fileRowsOf, findingRowsOf, listFindings, getFinding } from './service.js';
import { gitOverview, gitDiff, addedLines } from './git.js';
import { startJob, activeJob, yieldNow, CancelledError, type Job } from './jobs.js';
import { SEVERITY_WEIGHT, type Severity } from './rules.js';

export const CHUNK_CHARS = 6000;
const OFFLINE_REVIEW: EngineInfo = { kind: 'offline', label: 'Static analysis only (offline, not AI)' };

const SYSTEM = `You are a careful senior code reviewer. You review ONE excerpt of a larger repository.
Rules: only report problems you can see in the excerpt; never invent APIs, files or line numbers;
use the line numbers printed at the start of each line ("12| ..."); use line 0 when unsure;
be concise and concrete; answer only with JSON matching the schema.`;

export interface Chunk {
  startLine: number;
  endLine: number;
  text: string;
  functions: string[];
}

/** Splits a file into prompt-sized chunks, preferring function boundaries. */
export function chunkFile(content: string, functions: { name: string; line: number; endLine: number }[] = [], maxChars = CHUNK_CHARS): Chunk[] {
  const lines = content.split(/\r?\n/);
  const slice = (a: number, b: number) => lines.slice(a - 1, b).join('\n');
  if (content.length <= maxChars) return [{ startLine: 1, endLine: lines.length, text: content, functions: functions.map((f) => f.name) }];
  // top-level functions only (not nested inside another listed function)
  const top = functions.filter((f) => !functions.some((g) => g !== f && g.line <= f.line && g.endLine >= f.endLine && (g.line !== f.line || g.endLine !== f.endLine))).sort((a, b) => a.line - b.line);
  const units: { start: number; end: number; names: string[] }[] = [];
  let cursor = 1;
  for (const f of top) {
    if (f.line > cursor) units.push({ start: cursor, end: f.line - 1, names: [] });
    units.push({ start: Math.max(f.line, cursor), end: f.endLine, names: [f.name] });
    cursor = f.endLine + 1;
  }
  if (cursor <= lines.length) units.push({ start: cursor, end: lines.length, names: [] });
  // break oversized units into fixed windows
  const pieces: typeof units = [];
  for (const u of units) {
    if (slice(u.start, u.end).length <= maxChars) pieces.push(u);
    else {
      let s = u.start;
      while (s <= u.end) {
        let e = s;
        let size = 0;
        while (e <= u.end && size + (lines[e - 1]?.length ?? 0) + 1 <= maxChars) size += (lines[e++ - 1]?.length ?? 0) + 1;
        e = Math.max(e - 1, s);
        pieces.push({ start: s, end: e, names: u.names.length ? [`${u.names[0]} (part)`] : [] });
        s = e + 1;
      }
    }
  }
  // greedily merge consecutive pieces up to the budget
  const chunks: Chunk[] = [];
  for (const p of pieces) {
    const last = chunks[chunks.length - 1];
    if (last && slice(last.startLine, p.end).length <= maxChars) {
      last.endLine = p.end;
      last.functions.push(...p.names);
      last.text = slice(last.startLine, last.endLine);
    } else chunks.push({ startLine: p.start, endLine: p.end, text: slice(p.start, p.end), functions: [...p.names] });
  }
  return chunks.filter((c) => c.text.trim());
}

const numbered = (c: Chunk) =>
  redactSecrets(c.text)
    .split('\n')
    .map((l, i) => `${c.startLine + i}| ${l}`)
    .join('\n');

function repoContext(repoId: number): string {
  const r = getRepo(repoId);
  const p = r.profile as { projectTypes?: string[]; frameworks?: { name: string }[]; languages?: { language: string }[] };
  return `Repository "${r.name}": ${[...(p.projectTypes ?? [])].slice(0, 6).join(', ') || 'unknown type'}; frameworks: ${(p.frameworks ?? []).map((f) => f.name).slice(0, 8).join(', ') || 'none detected'}.`;
}

type ReviewItem = { line: number; title: string; detail: string; severity: Severity };
export interface FileReview {
  summary: string;
  quality: string[];
  bugs: ReviewItem[];
  performance: ReviewItem[];
  security: ReviewItem[];
  maintainability: ReviewItem[];
  recommendations: string[];
  improvements: { title: string; detail: string }[];
}
const empty = (): FileReview => ({ summary: '', quality: [], bugs: [], performance: [], security: [], maintainability: [], recommendations: [], improvements: [] });

function cacheGet(repoId: number, scope: string, target: string, hash: string, model: string) {
  const r = getDb().prepare('SELECT result, created_at AS createdAt FROM repo_reviews WHERE repo_id = ? AND scope = ? AND target = ? AND content_hash = ? AND model = ? ORDER BY id DESC LIMIT 1').get(repoId, scope, target, hash, model) as { result: string; createdAt: string } | undefined;
  return r ? { data: JSON.parse(r.result), createdAt: r.createdAt } : null;
}
function cachePut(repoId: number, scope: string, target: string, hash: string, model: string, engine: 'ollama' | 'offline', data: unknown) {
  getDb().prepare('DELETE FROM repo_reviews WHERE repo_id = ? AND scope = ? AND target = ? AND model = ?').run(repoId, scope, target, model);
  getDb().prepare('INSERT INTO repo_reviews (repo_id, scope, target, content_hash, model, engine, result) VALUES (?, ?, ?, ?, ?, ?, ?)').run(repoId, scope, target, hash, model, engine, JSON.stringify(data));
}

const CATEGORY_OF = { bugs: 'bug', performance: 'performance', security: 'security', maintainability: 'maintainability' } as const;

/** Stores AI issues as findings; marks agreeing static findings as "combined". */
function persistAiFindings(repoId: number, path: string, review: FileReview, model: string, content: string) {
  const db = getDb();
  db.prepare(`UPDATE repo_findings SET present = 0 WHERE repo_id = ? AND path = ? AND source = 'ai'`).run(repoId, path);
  const statics = findingRowsOf(repoId).filter((f) => f.path === path && f.present && (f.source === 'static' || f.source === 'combined'));
  const lines = content.split(/\r?\n/);
  let created = 0;
  let combined = 0;
  for (const key of Object.keys(CATEGORY_OF) as (keyof typeof CATEGORY_OF)[]) {
    for (const it of review[key]) {
      const line = it.line > 0 && it.line <= lines.length ? it.line : null;
      const cat = CATEGORY_OF[key];
      const match = line ? statics.find((s) => s.line !== null && Math.abs(s.line - line) <= 1 && (s.category === cat || (cat === 'bug' && (s.category === 'maintainability' || s.category === 'security')) || (cat === 'security' && s.category === 'bug'))) : undefined;
      if (match) {
        db.prepare(`UPDATE repo_findings SET source = 'combined', description = CASE WHEN instr(description, 'Local AI review:') > 0 THEN description ELSE description || char(10) || char(10) || 'Local AI review: ' || ? END, updated_at = datetime('now') WHERE id = ?`).run(`${it.title} — ${it.detail}`.slice(0, 1000), match.id);
        combined++;
        continue;
      }
      const anchor = line ? (lines[line - 1] ?? '').trim() : it.title.toLowerCase();
      const f = { ruleId: `AI-${cat.toUpperCase()}`, path, snippet: '', description: it.title, line, anchor: redactSecrets(anchor) };
      db.prepare(`INSERT INTO repo_findings (repo_id, fingerprint, path, line, col, end_line, severity, category, rule_id, title, description, why, fix, confidence, source, tool, snippet, present)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'low', 'ai', ?, ?, 1)
        ON CONFLICT(repo_id, fingerprint) DO UPDATE SET line = excluded.line, severity = excluded.severity, description = excluded.description, present = 1, updated_at = datetime('now')`).run(
        repoId, fingerprint(f), path, line, line, it.severity, cat, f.ruleId, it.title.slice(0, 300), it.detail.slice(0, 2000),
        'Suggested by the local AI model. AI reviews can be wrong — verify before acting.', 'See the AI review for this file.', `ollama:${model}`,
        line ? redactSecrets(lines.slice(Math.max(0, line - 2), line + 1).join('\n')).slice(0, 600) : '',
      );
      created++;
    }
  }
  return { created, combined };
}

/** Reviews one file (or one function in it). Uses the cache when the content is unchanged. */
export async function reviewFile(repoId: number, path: string, opts: { functionName?: string; signal?: AbortSignal; force?: boolean } = {}) {
  const file = readRepoFile(repoId, path); // refuses sensitive / binary / oversized files
  const fns = ((file.metrics as { functions?: { name: string; line: number; endLine: number }[] }).functions ?? []);
  let chunks = chunkFile(file.content, fns);
  let scope: 'file' | 'function' = 'file';
  let target = path;
  if (opts.functionName) {
    const fn = fns.find((f) => f.name === opts.functionName);
    if (!fn) throw new AppError(404, 'not_found', `Function ${opts.functionName} was not found in ${path}.`);
    const lines = file.content.split(/\r?\n/);
    chunks = chunkFile(lines.slice(fn.line - 1, fn.endLine).join('\n')).map((c) => ({ ...c, startLine: c.startLine + fn.line - 1, endLine: c.endLine + fn.line - 1, functions: [fn.name] }));
    scope = 'function';
    target = `${path}#${fn.name}@${fn.line}`;
  }
  const staticFindings = file.findings.filter((f: { source: string }) => f.source !== 'ai');
  const hash = createHash('sha1').update(chunks.map((c) => c.text).join('\n\0')).digest('hex');
  const ai = await resolveAI();
  if (!ai.provider) {
    return { engine: { ...OFFLINE_REVIEW, notice: ai.engine.notice ?? 'Local AI is turned off (Settings → AI provider). This is the static analysis of the file.' }, cached: false, aiAvailable: false, chunks: chunks.length, review: null, staticFindings, metrics: file.metrics, path, scope };
  }
  const model = ai.model;
  if (!opts.force) {
    const hit = cacheGet(repoId, scope, target, hash, model);
    if (hit) return { engine: { kind: 'ollama' as const, label: `Local AI (Ollama · ${model}) — cached ${hit.createdAt}`, model }, cached: true, aiAvailable: true, chunks: chunks.length, review: hit.data as FileReview, staticFindings: readRepoFile(repoId, path).findings, metrics: file.metrics, path, scope };
  }
  const merged = empty();
  const summaries: string[] = [];
  let engine: EngineInfo | null = null;
  const ctx = repoContext(repoId);
  for (let i = 0; i < chunks.length; i++) {
    if (opts.signal?.aborted) throw new CancelledError();
    const c = chunks[i];
    const known = staticFindings.filter((f: { line: number | null }) => f.line && f.line >= c.startLine && f.line <= c.endLine).slice(0, 8).map((f: { line: number; title: string }) => `- line ${f.line}: ${f.title}`).join('\n');
    const prompt = `${ctx}\nFile: ${path} (${file.language ?? 'text'}), lines ${c.startLine}-${c.endLine}${chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : ''}${c.functions.length ? `; functions: ${c.functions.slice(0, 10).join(', ')}` : ''}.\n${known ? `Static analysis already reported:\n${known}\nDo not repeat these; only add problems they missed. Keep each list short (at most 5 items).\n` : ''}\nCode:\n${numbered(c)}\n\nReview this code: summary, quality observations, bugs, performance, security, maintainability, best-practice recommendations and suggested improvements.`;
    const r = await aiJson(prompt, SYSTEM, { ...contract(REVIEW.file, 2000), contextTokens: 8192, signal: opts.signal });
    if (!r.data) {
      if (opts.signal?.aborted) throw new CancelledError();
      return { engine: { ...OFFLINE_REVIEW, notice: r.engine.notice ?? 'Local AI review was unavailable.' }, cached: false, aiAvailable: false, chunks: chunks.length, review: null, staticFindings, metrics: file.metrics, path, scope, error: (r as { error?: string }).error };
    }
    engine = r.engine;
    const inRange = (it: { line: number; title: string; detail: string; severity: string }): ReviewItem => ({ ...it, severity: it.severity as Severity, line: it.line >= c.startLine && it.line <= c.endLine ? it.line : 0 });
    summaries.push(r.data.summary);
    merged.quality.push(...r.data.quality);
    merged.bugs.push(...r.data.bugs.map(inRange));
    merged.performance.push(...r.data.performance.map(inRange));
    merged.security.push(...r.data.security.map(inRange));
    merged.maintainability.push(...r.data.maintainability.map(inRange));
    merged.recommendations.push(...r.data.recommendations);
    merged.improvements.push(...r.data.improvements);
  }
  merged.summary = summaries.filter(Boolean).join(' ');
  for (const k of ['quality', 'recommendations'] as const) merged[k] = [...new Set(merged[k])];
  cachePut(repoId, scope, target, hash, model, 'ollama', merged);
  const persisted = persistAiFindings(repoId, path, merged, model, file.content);
  return { engine: engine ?? { kind: 'ollama' as const, label: `Local AI (Ollama · ${model})`, model }, cached: false, aiAvailable: true, chunks: chunks.length, review: merged, persisted, staticFindings: readRepoFile(repoId, path).findings, metrics: file.metrics, path, scope };
}

/** Background review of a folder or the whole repository (prioritised, capped, cancellable). */
export function startScopeReview(repoId: number, opts: { folder?: string; maxFiles?: number }): Job {
  getRepo(repoId);
  const running = activeJob(repoId, 'review');
  if (running) return running;
  const max = Math.min(Math.max(opts.maxFiles ?? 15, 1), 40);
  const prefix = opts.folder ? opts.folder.replace(/\/+$/, '') + '/' : '';
  const findings = findingRowsOf(repoId);
  const weight = new Map<string, number>();
  for (const f of findings) if (f.present && f.status !== 'dismissed') weight.set(f.path, (weight.get(f.path) ?? 0) + SEVERITY_WEIGHT[f.severity] + 0.1);
  const candidates = fileRowsOf(repoId)
    .filter((f) => (f.kind === 'source' || f.kind === 'test') && !f.sensitive && !f.binary && !f.skipped && f.lines > 0 && f.metrics.parsed && (!prefix || f.path.startsWith(prefix)))
    .sort((a, b) => (weight.get(b.path) ?? 0) + (b.metrics.maxComplexity ?? 0) - ((weight.get(a.path) ?? 0) + (a.metrics.maxComplexity ?? 0)));
  const chosen = candidates.slice(0, max);
  return startJob('review', repoId, async ({ signal, progress }) => {
    const results: { path: string; summary: string; issues: number; cached: boolean; engine: string; error?: string }[] = [];
    let aiAvailable = true;
    let notice: string | undefined;
    for (let i = 0; i < chosen.length; i++) {
      if (signal.aborted) throw new CancelledError();
      progress(i, chosen.length, `Reviewing ${chosen[i].path}`);
      await yieldNow();
      const r = await reviewFile(repoId, chosen[i].path, { signal });
      if (!r.aiAvailable) {
        aiAvailable = false;
        notice = (r.engine as EngineInfo).notice;
        break;
      }
      const rv = r.review!;
      results.push({ path: chosen[i].path, summary: rv.summary, issues: rv.bugs.length + rv.security.length + rv.performance.length + rv.maintainability.length, cached: r.cached, engine: r.engine.label });
    }
    progress(chosen.length, chosen.length, 'Done');
    const out = { scope: prefix ? 'folder' : 'repo', folder: prefix || null, considered: candidates.length, reviewed: results.length, skipped: Math.max(0, candidates.length - chosen.length), aiAvailable, notice, files: results };
    getDb().prepare('INSERT INTO repo_reviews (repo_id, scope, target, content_hash, model, engine, result) VALUES (?, ?, ?, ?, ?, ?, ?)').run(repoId, prefix ? 'folder' : 'repo', prefix || '.', `${Date.now()}`, 'job', aiAvailable ? 'ollama' : 'offline', JSON.stringify(out));
    return out;
  });
}
export function lastScopeReview(repoId: number) {
  const r = getDb().prepare(`SELECT result, created_at AS createdAt FROM repo_reviews WHERE repo_id = ? AND scope IN ('folder','repo') ORDER BY id DESC LIMIT 1`).get(repoId) as { result: string; createdAt: string } | undefined;
  return r ? { ...JSON.parse(r.result), createdAt: r.createdAt } : null;
}
export function cachedFileReview(repoId: number, path: string) {
  const r = getDb().prepare(`SELECT result, model, created_at AS createdAt FROM repo_reviews WHERE repo_id = ? AND scope = 'file' AND target = ? ORDER BY id DESC LIMIT 1`).get(repoId, path) as { result: string; model: string; createdAt: string } | undefined;
  return r ? { review: JSON.parse(r.result) as FileReview, model: r.model, createdAt: r.createdAt } : null;
}

// ------------------------------------------------------------------ questions
const STOP = new Set('the and for with that this what where which how does do why are is was can from into not you your have has code file files function functions repository repo about there their when then than use used using'.split(' '));

/** Keyword retrieval: returns the most relevant excerpts (never the whole repository). */
export function retrieve(repoId: number, question: string, maxExcerpts = 3) {
  const stem = (t: string) => (t.length >= 6 ? t.replace(/(ing|ed|es|s)$/, '') : t);
  const terms = [...new Set((question.toLowerCase().match(/[a-z_][a-z0-9_.-]{2,}/g) ?? []).filter((t) => !STOP.has(t)).map(stem))].slice(0, 12);
  const files = fileRowsOf(repoId).filter((f) => !f.sensitive && !f.binary && !f.skipped && (f.kind === 'source' || f.kind === 'test' || f.kind === 'config' || f.kind === 'doc'));
  const scored: { path: string; score: number; content: string; firstLine: number }[] = [];
  for (const f of files.slice(0, 3000)) {
    let content: string;
    try {
      content = readRepoFile(repoId, f.path).content;
    } catch {
      continue;
    }
    const lower = content.toLowerCase();
    let score = 0;
    let first = Infinity;
    let matched = 0;
    for (const t of terms) {
      const before = score;
      if (f.path.toLowerCase().includes(t)) score += 3;
      const fnHit = (f.metrics.functions ?? []).find((fn) => fn.name.toLowerCase() === t);
      if (fnHit) {
        score += 8;
        first = Math.min(first, fnHit.line);
      }
      let idx = lower.indexOf(t);
      let n = 0;
      while (idx >= 0 && n < 20) {
        n++;
        if (n === 1) first = Math.min(first, lower.slice(0, idx).split('\n').length);
        idx = lower.indexOf(t, idx + t.length);
      }
      score += Math.min(n, 10);
      if (score > before) matched++;
    }
    score *= matched;
    if (score > 0) scored.push({ path: f.path, score, content, firstLine: Number.isFinite(first) ? first : 1 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxExcerpts).map((s) => {
    const lines = s.content.split(/\r?\n/);
    const start = Math.max(1, s.firstLine - 20);
    const end = Math.min(lines.length, start + 70);
    return { path: s.path, startLine: start, endLine: end, text: lines.slice(start - 1, end).join('\n').slice(0, 2600) };
  });
}

export async function askRepository(repoId: number, question: string, opts: { findingId?: number; path?: string; signal?: AbortSignal } = {}) {
  const repo = getRepo(repoId);
  let excerpts: { path: string; startLine: number; endLine: number; text: string }[] = [];
  let findingContext = '';
  if (opts.findingId) {
    const f = getFinding(repoId, opts.findingId);
    findingContext = `The question is about this finding: [${f.severity}] ${f.title} at ${f.path}${f.line ? `:${f.line}` : ''} — ${f.description}\n`;
    try {
      const file = readRepoFile(repoId, f.path);
      const lines = file.content.split(/\r?\n/);
      const at = f.line ?? 1;
      const s = Math.max(1, at - 25);
      const e = Math.min(lines.length, at + 25);
      excerpts.push({ path: f.path, startLine: s, endLine: e, text: lines.slice(s - 1, e).join('\n') });
    } catch {
      /* file not readable (e.g. sensitive): answer from the finding text only */
    }
  } else if (opts.path) {
    const file = readRepoFile(repoId, opts.path);
    const c = chunkFile(file.content, (file.metrics as { functions?: { name: string; line: number; endLine: number }[] }).functions)[0];
    excerpts.push({ path: opts.path, startLine: c.startLine, endLine: c.endLine, text: c.text });
  }
  excerpts.push(...retrieve(repoId, question, opts.findingId || opts.path ? 2 : 3).filter((x) => !excerpts.some((e) => e.path === x.path)));
  excerpts = excerpts.slice(0, 3);
  const ai = await resolveAI();
  const sources = excerpts.map((e) => ({ path: e.path, startLine: e.startLine, endLine: e.endLine }));
  if (!ai.provider) {
    return { engine: { ...OFFLINE_REVIEW, notice: ai.engine.notice ?? 'Local AI is turned off, so questions cannot be answered in natural language.' }, answer: null, sources, aiAvailable: false };
  }
  let budget = CHUNK_CHARS + 1500;
  const ctx = excerpts
    .map((e) => {
      const text = numbered({ startLine: e.startLine, endLine: e.endLine, text: e.text.slice(0, Math.max(0, budget)), functions: [] });
      budget -= text.length;
      return `--- ${e.path} (lines ${e.startLine}-${e.endLine})\n${text}`;
    })
    .join('\n\n');
  const prompt = `${repoContext(repoId)}\n${findingContext}Relevant excerpts (the only code you can see):\n${ctx || '(no matching code found)'}\n\nQuestion: ${redactSecrets(question.slice(0, 1500))}\nAnswer using only these excerpts; say clearly when the excerpts are not enough. List the files you relied on.`;
  const r = await aiJson(prompt, SYSTEM.replace('You review ONE excerpt', `You answer questions about the repository "${repo.name}" from excerpts`), { ...contract(REVIEW.answer, 900), contextTokens: 8192, signal: opts.signal });
  if (!r.data) return { engine: { ...OFFLINE_REVIEW, notice: r.engine.notice }, answer: null, sources, aiAvailable: false };
  return { engine: r.engine, answer: r.data.answer, cited: r.data.files.filter((f) => sources.some((s) => s.path === f)), sources, aiAvailable: true };
}

// ------------------------------------------------------------------ Git change review
const RISKY_PATH = /(auth|login|password|passw|secur|crypt|token|session|permission|acl|payment|billing|\.env|config|settings|docker|migration|schema|\.github\/workflows)/i;

export async function reviewGitChanges(repoId: number, opts: { useAi?: boolean; signal?: AbortSignal } = {}) {
  const repo = getRepo(repoId);
  const ov = await gitOverview(repo.rootPath);
  if (!ov.available) return { available: false, reason: ov.reason };
  if (!ov.changes.length) return { available: true, branch: ov.branch, changes: [], introduced: [], risks: [], ai: null, engine: OFFLINE_REVIEW, note: 'No uncommitted changes compared with HEAD.' };
  const diff = ov.empty ? '' : await gitDiff(repo.rootPath, {});
  const added = addedLines(diff);
  const files = fileRowsOf(repoId);
  const introduced: { path: string; line: number | null; severity: string; ruleId: string; title: string; description: string; confidence: string }[] = [];
  const risks: { title: string; detail: string; severity: Severity; paths: string[] }[] = [];
  for (const c of ov.changes) {
    if (c.staged === 'D' || c.unstaged === 'D' || c.binary) continue;
    const row = files.find((f) => f.path === c.path);
    if (row?.sensitive) continue;
    let content: string;
    try {
      content = readRepoFile(repoId, c.path).content;
    } catch {
      continue; // new files appear after the next analysis
    }
    const res = analyzeFile({ path: c.path, language: row?.language ?? null, kind: row?.kind ?? 'source', content });
    const newLines = c.untracked || ov.empty ? null : added.get(c.path) ?? new Set<number>();
    for (const f of res.findings) {
      if (newLines && (f.line === null || !newLines.has(f.line))) continue;
      introduced.push({ path: f.path, line: f.line, severity: f.severity, ruleId: f.ruleId, title: f.title, description: f.description, confidence: f.confidence });
    }
  }
  const changedSrc = ov.changes.filter((c) => /\.(c|cc|cpp|h|hpp|java|py|js|jsx|ts|tsx|mjs|cjs)$/.test(c.path) && !/(test|spec)/i.test(c.path));
  const changedTests = ov.changes.filter((c) => /(^|\/)(tests?|__tests__|spec|e2e)\/|\.(test|spec)\.|(^|\/)test_[^/]+\.py$|Test\.java$/.test(c.path));
  if (changedSrc.length && !changedTests.length) risks.push({ title: 'Source changed without test changes', detail: `${changedSrc.length} source file(s) changed but no test file was added or modified.`, severity: 'medium', paths: changedSrc.map((c) => c.path).slice(0, 20) });
  const deletedTests = ov.changes.filter((c) => (c.staged === 'D' || c.unstaged === 'D') && changedTests.includes(c));
  if (deletedTests.length) risks.push({ title: 'Tests deleted', detail: `${deletedTests.length} test file(s) are deleted in this change.`, severity: 'high', paths: deletedTests.map((c) => c.path) });
  const big = ov.changes.filter((c) => (c.added ?? 0) + (c.deleted ?? 0) > 300);
  if (big.length) risks.push({ title: 'Large changes', detail: 'Files with more than 300 changed lines are hard to review thoroughly.', severity: 'low', paths: big.map((c) => `${c.path} (+${c.added} −${c.deleted})`) });
  const sensitive = ov.changes.filter((c) => RISKY_PATH.test(c.path));
  if (sensitive.length) risks.push({ title: 'Security- or configuration-sensitive files changed', detail: 'Changes to authentication, configuration, build or schema files deserve extra review.', severity: 'medium', paths: sensitive.map((c) => c.path).slice(0, 20) });
  const manifests = ov.changes.filter((c) => /(^|\/)(package\.json|requirements[^/]*\.txt|pyproject\.toml|pom\.xml|build\.gradle(\.kts)?|Pipfile)$/.test(c.path));
  if (manifests.length) {
    const addedDeps = diff.split('\n').filter((l) => /^\+\s*("[^"]+"\s*:\s*"[^"]+"|[A-Za-z0-9_.\-]+\s*([=<>~!]=|>|<)|<artifactId>)/.test(l) && !l.startsWith('+++')).map((l) => l.slice(1).trim()).slice(0, 20);
    risks.push({ title: 'Dependency manifest changed', detail: addedDeps.length ? `New or changed entries: ${addedDeps.join('; ')}` : 'Dependencies may have changed; review new packages before installing.', severity: 'low', paths: manifests.map((c) => c.path) });
  }
  const highIntroduced = introduced.filter((i) => i.severity === 'critical' || i.severity === 'high');
  if (highIntroduced.length) risks.unshift({ title: 'High-severity findings on changed lines', detail: `${highIntroduced.length} critical / high static finding(s) are on lines added by this change.`, severity: 'high', paths: [...new Set(highIntroduced.map((i) => i.path))] });
  let ai: unknown = null;
  let engine: EngineInfo = OFFLINE_REVIEW;
  if (opts.useAi !== false && diff) {
    const safeDiff = diff
      .split(/(?=^diff --git )/m)
      .filter((part) => !files.some((f) => f.sensitive && part.includes(` b/${f.path}`)))
      .join('');
    const r = await aiJson(`${repoContext(repoId)}\nUnified diff of uncommitted changes (may be truncated):\n${redactSecrets(safeDiff).slice(0, CHUNK_CHARS)}\n\nExplain the purpose and potential impact of this change, the risks it introduces (bugs, security, behaviour changes) and which tests should be added.`, SYSTEM.replace('You review ONE excerpt of a larger repository', 'You review a code change (diff)'), { ...contract(REVIEW.diff, 900), contextTokens: 8192, signal: opts.signal });
    if (r.data) {
      ai = r.data;
      engine = r.engine;
    } else engine = { ...OFFLINE_REVIEW, notice: r.engine.notice };
  }
  return { available: true, branch: ov.branch, changes: ov.changes, summary: ov.summary, introduced, risks, ai, engine, diffTruncated: diff.length > CHUNK_CHARS };
}

export function reviewFindings(repoId: number) {
  return listFindings(repoId, { source: 'ai', limit: 500 });
}
