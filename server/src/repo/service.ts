/**
 * Repository Analyzer service: import (local folder or ZIP), analysis pipeline, persistence and
 * queries. Imported code is never executed.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { getDb, getDbPath, PROFILE_ID } from '../database/db.js';
import { config } from '../config.js';
import { AppError } from '../utils/http.js';
import { scanRepository, resolveInside, DEFAULT_IGNORES, SCAN_LIMITS, type ScannedFile } from './scan.js';
import { extractZip, ZipError, ZIP_LIMITS } from './zip.js';
import { analyzeFile, findDuplicates, findUnusedFunctions, fingerprint, type FileMetrics } from './analyze.js';
import { analyzeDependencies, type ManifestIssue } from './deps.js';
import { profileProject } from './detect.js';
import { RULE_BY_ID, RULES, type Finding } from './rules.js';
import { repoStats, technicalDebt, complexityReport, type FileRow, type FindingRow } from './summarize.js';
import { detectTools, runTools } from './tools.js';
import { startJob, activeJob, yieldNow, CancelledError, type Job } from './jobs.js';

const require = createRequire(import.meta.url);
const pj = <T>(s: string | null | undefined, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};

export function reposDir(): string {
  // storage lives next to the database that is actually open (tests use an in-memory DB → temp folder)
  const db = getDbPath();
  const base = !db || db === ':memory:' ? join(tmpdir(), 'codepilot-repos') : join(dirname(resolve(db)), 'repos');
  mkdirSync(base, { recursive: true });
  return base;
}

// ------------------------------------------------------------------ rows
interface RepoRow {
  id: number;
  name: string;
  source: 'folder' | 'zip';
  root_path: string;
  owned: number;
  status: string;
  profile: string;
  scan_info: string;
  analysis: string;
  file_count: number;
  source_files: number;
  loc: number;
  size_bytes: number;
  is_git: number;
  analyzed_at: string | null;
  created_at: string;
  updated_at: string;
}
function toRepo(r: RepoRow) {
  return {
    id: r.id,
    name: r.name,
    source: r.source,
    rootPath: r.root_path,
    managedCopy: !!r.owned,
    status: r.status,
    fileCount: r.file_count,
    sourceFiles: r.source_files,
    linesOfCode: r.loc,
    sizeBytes: r.size_bytes,
    isGit: !!r.is_git,
    analyzedAt: r.analyzed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    profile: pj(r.profile, {} as Record<string, unknown>),
    scanInfo: pj(r.scan_info, {} as Record<string, unknown>),
    analysis: pj(r.analysis, {} as Record<string, any>),
    job: activeJob(r.id, 'analysis'),
  };
}
const repoRow = (id: number) => getDb().prepare('SELECT * FROM repositories WHERE id = ? AND profile_id = ?').get(id, PROFILE_ID) as RepoRow | undefined;
export function getRepo(id: number) {
  const r = repoRow(id);
  if (!r) throw new AppError(404, 'not_found', 'Repository not found');
  return toRepo(r);
}
export function listRepos() {
  return (getDb().prepare('SELECT * FROM repositories WHERE profile_id = ? ORDER BY updated_at DESC, id DESC').all(PROFILE_ID) as unknown as RepoRow[]).map((r) => {
    const x = toRepo(r);
    return { ...x, analysis: { stats: x.analysis.stats ? { quality: x.analysis.stats.quality, findingsBySeverity: x.analysis.stats.findingsBySeverity, languages: x.analysis.stats.languages?.slice(0, 4) } : null } };
  });
}
function event(repoId: number, kind: string, message: string) {
  getDb().prepare('INSERT INTO repo_events (repo_id, kind, message) VALUES (?, ?, ?)').run(repoId, kind, message.slice(0, 500));
}
export function listEvents(repoId: number, limit = 20) {
  getRepo(repoId);
  return getDb().prepare('SELECT id, kind, message, created_at AS createdAt FROM repo_events WHERE repo_id = ? ORDER BY id DESC LIMIT ?').all(repoId, limit);
}

// ------------------------------------------------------------------ import
const SYSTEM_DIRS = /^[a-z]:\\(windows|program files|program files \(x86\)|programdata|\$recycle\.bin|system volume information)(\\|$)/i;

export function importFolder(input: { path: string; name?: string }) {
  const raw = input.path.trim().replace(/^"(.*)"$/, '$1');
  if (!raw || !isAbsolute(raw)) throw new AppError(400, 'invalid_path', 'Enter the absolute path of a folder, e.g. C:\\Users\\you\\projects\\my-app.');
  let real: string;
  try {
    real = realpathSync(raw);
  } catch {
    throw new AppError(404, 'folder_not_found', `Folder not found: ${raw}`);
  }
  let st;
  try {
    st = statSync(real);
  } catch (e) {
    throw new AppError(403, 'folder_unreadable', `Cannot read the folder (${(e as NodeJS.ErrnoException).code ?? 'error'}).`);
  }
  if (!st.isDirectory()) throw new AppError(400, 'not_a_folder', 'The path is not a folder.');
  if (/^[a-z]:\\?$/i.test(real) || real === '/' || SYSTEM_DIRS.test(real)) throw new AppError(400, 'folder_not_allowed', 'Choose a project folder, not a drive root or a system folder.');
  const dataDir = !getDbPath() || getDbPath() === ':memory:' ? null : dirname(resolve(getDbPath()));
  if (dataDir && (real.toLowerCase() === dataDir.toLowerCase() || real.toLowerCase().startsWith(dataDir.toLowerCase() + sep))) throw new AppError(400, 'folder_not_allowed', "CodePilot's own data folder cannot be imported.");
  const dup = getDb().prepare('SELECT id FROM repositories WHERE profile_id = ? AND source = ? AND lower(root_path) = lower(?)').get(PROFILE_ID, 'folder', real) as { id: number } | undefined;
  if (dup) throw new AppError(409, 'already_imported', 'This folder is already imported. Re-run its analysis instead.', { id: dup.id });
  const name = (input.name?.trim() || basename(real)).slice(0, 200);
  const id = Number(getDb().prepare(`INSERT INTO repositories (profile_id, name, source, root_path, owned, status, is_git) VALUES (?, ?, 'folder', ?, 0, 'ready', ?)`).run(PROFILE_ID, name, real, existsSync(join(real, '.git')) ? 1 : 0).lastInsertRowid);
  event(id, 'import', `Imported folder ${real} (read in place; files are never modified).`);
  const job = analyzeRepo(id);
  return { repo: getRepo(id), job };
}

export function importZip(buf: Buffer, fileName: string, name?: string) {
  if (!buf.length) throw new AppError(400, 'empty_upload', 'The uploaded file is empty.');
  const dest = join(reposDir(), randomUUID());
  const skip = new Set(DEFAULT_IGNORES.map((s) => s.toLowerCase()));
  let written: string[];
  try {
    written = extractZip(buf, dest, (entry, size) => size <= SCAN_LIMITS.maxFileBytes * 20 && !entry.split('/').slice(0, -1).some((seg) => skip.has(seg.toLowerCase())));
  } catch (e) {
    rmSync(dest, { recursive: true, force: true });
    if (e instanceof ZipError) throw new AppError(e.code === 'too_large' || e.code === 'bomb' ? 413 : 400, `zip_${e.code}`, e.message);
    throw e;
  }
  if (!written.length) {
    rmSync(dest, { recursive: true, force: true });
    throw new AppError(400, 'zip_empty', 'The archive contains no files that can be analysed.');
  }
  // a single top-level folder (GitHub "Download ZIP") becomes the repository root
  const tops = new Set(written.map((w) => w.split('/')[0]));
  const root = tops.size === 1 && written.every((w) => w.includes('/')) ? join(dest, [...tops][0]) : dest;
  const repoName = (name?.trim() || (tops.size === 1 ? [...tops][0] : basename(fileName).replace(/\.zip$/i, '')) || 'repository').slice(0, 200);
  const id = Number(getDb().prepare(`INSERT INTO repositories (profile_id, name, source, root_path, owned, status, is_git) VALUES (?, ?, 'zip', ?, 1, 'ready', 0)`).run(PROFILE_ID, repoName, root).lastInsertRowid);
  event(id, 'import', `Imported ${basename(fileName)} (${written.length} files extracted into CodePilot's storage; .git and dependency folders skipped).`);
  const job = analyzeRepo(id);
  return { repo: getRepo(id), job };
}

export function deleteRepo(id: number) {
  const r = repoRow(id);
  if (!r) throw new AppError(404, 'not_found', 'Repository not found');
  if (activeJob(id, 'analysis')) throw new AppError(409, 'busy', 'Wait for the running analysis to finish or cancel it first.');
  getDb().prepare('DELETE FROM repositories WHERE id = ?').run(id);
  let removedCopy = false;
  if (r.owned) {
    // only ever delete inside CodePilot's own repository storage
    const base = realpathSync(reposDir());
    const storageRoot = (() => {
      try {
        const real = realpathSync(r.root_path);
        const rel = real.slice(base.length + 1).split(sep)[0];
        return real.startsWith(base + sep) && rel ? join(base, rel) : null;
      } catch {
        return null;
      }
    })();
    if (storageRoot) {
      rmSync(storageRoot, { recursive: true, force: true, maxRetries: 3 });
      removedCopy = true;
    }
  }
  return { deleted: true, removedCopy, originalFolderUntouched: r.source === 'folder' };
}

// ------------------------------------------------------------------ analysis
export function analyzeRepo(id: number): Job {
  const r = repoRow(id);
  if (!r) throw new AppError(404, 'not_found', 'Repository not found');
  const running = activeJob(id, 'analysis');
  if (running) return running;
  getDb().prepare(`UPDATE repositories SET status = 'analyzing', updated_at = datetime('now') WHERE id = ?`).run(id);
  return startJob('analysis', id, async ({ signal, progress }) => {
    try {
      return await runAnalysis(id, r.root_path, r.name, signal, progress);
    } catch (e) {
      const cancelled = signal.aborted || e instanceof CancelledError;
      getDb().prepare(`UPDATE repositories SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(cancelled ? (r.analyzed_at ? 'analyzed' : 'ready') : 'error', id);
      event(id, cancelled ? 'cancelled' : 'error', cancelled ? 'Analysis cancelled; previous results (if any) were kept.' : `Analysis failed: ${(e as Error).message}`);
      throw e;
    }
  });
}

const DEP_RULE: Record<ManifestIssue['rule'], string> = { 'missing-lockfile': 'DEP-001', 'unpinned-version': 'DEP-002', 'duplicate-declaration': 'DEP-003', 'version-conflict': 'DEP-004', 'unused-dependency': 'DEP-005', 'invalid-manifest': 'DEP-006' };

async function runAnalysis(id: number, root: string, name: string, signal: AbortSignal, progress: (d: number, t: number, m: string) => void) {
  const started = Date.now();
  const check = () => {
    if (signal.aborted) throw new CancelledError();
  };
  progress(0, 1, 'Scanning files…');
  if (!existsSync(root)) throw new Error('The repository folder no longer exists.');
  const scan = scanRepository(root);
  check();
  const analysable = scan.files.filter((f) => f.content !== undefined && f.kind !== 'data');
  const findings: Finding[] = [];
  const metrics = new Map<string, FileMetrics>();
  for (let i = 0; i < analysable.length; i++) {
    const f = analysable[i];
    if (i % 20 === 0) {
      progress(i, analysable.length, `Analysing ${f.path}`);
      await yieldNow();
      check();
    }
    const res = analyzeFile({ path: f.path, language: f.language, kind: f.kind, content: f.content! });
    metrics.set(f.path, res.metrics);
    // documentation: only secret / private-key rules apply
    findings.push(...(f.kind === 'doc' ? res.findings.filter((x) => x.ruleId === 'SEC-001' || x.ruleId === 'SEC-002') : res.findings));
  }
  progress(analysable.length, analysable.length, 'Cross-file checks…');
  await yieldNow();
  const src = analysable.filter((f) => f.kind === 'source');
  findings.push(...findDuplicates(src.map((f) => ({ path: f.path, content: f.content! }))));
  findings.push(...findUnusedFunctions(src.filter((f) => metrics.get(f.path)?.functions.length).map((f) => ({ path: f.path, content: f.content!, metrics: metrics.get(f.path)!, language: f.language }))));
  for (const f of scan.files.filter((x) => x.sensitive)) {
    const r = RULE_BY_ID.get('SEC-003')!;
    findings.push({ path: f.path, line: null, col: null, endLine: null, severity: /\.env/i.test(f.path) ? 'medium' : 'high', category: 'security', ruleId: r.id, title: r.title, description: `${f.path} looks like a file that contains secrets and is not excluded by .gitignore. Its content was not read.`, why: r.why, fix: r.fix, confidence: 'medium', source: 'static', tool: 'codepilot', snippet: '' });
  }
  const deps = analyzeDependencies(scan.files);
  for (const issue of deps.issues) {
    const r = RULE_BY_ID.get(DEP_RULE[issue.rule])!;
    findings.push({ path: issue.manifest, line: issue.line, col: null, endLine: issue.line, severity: issue.severity, category: 'dependency', ruleId: r.id, title: r.title, description: issue.message, why: r.why, fix: r.fix, confidence: issue.confidence, source: 'static', tool: 'codepilot', snippet: '', anchor: `${issue.dependency ?? ''}|${issue.message}` });
  }
  check();
  progress(analysable.length, analysable.length, 'Optional tools…');
  const tools = await runTools(root, scan.files.filter((f) => f.language === 'python' && f.content !== undefined).map((f) => f.path), signal);
  findings.push(...tools.findings);
  check();
  const profile = profileProject(name, scan.files, deps.dependencies);

  // ---------------------------------------------------------------- persist (one transaction)
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM repo_files WHERE repo_id = ?').run(id);
    const insFile = db.prepare('INSERT INTO repo_files (repo_id, path, language, kind, size, lines, binary, sensitive, skipped, hash, metrics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const f of scan.files) insFile.run(id, f.path, f.language, f.kind, f.size, f.lines, f.binary ? 1 : 0, f.sensitive ? 1 : 0, f.skipped, f.content !== undefined ? createHash('sha1').update(f.content).digest('hex') : null, JSON.stringify(metrics.get(f.path) ?? {}));
    db.prepare('DELETE FROM repo_dependencies WHERE repo_id = ?').run(id);
    const insDep = db.prepare('INSERT INTO repo_dependencies (repo_id, ecosystem, name, spec, resolved, dev, direct, manifest) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const d of deps.dependencies.slice(0, 20_000)) insDep.run(id, d.ecosystem, d.name, d.spec, d.resolved, d.dev ? 1 : 0, d.direct ? 1 : 0, d.manifest);
    // findings: keep user status / notes for findings that are still detected (matched by fingerprint)
    db.prepare(`UPDATE repo_findings SET present = 0 WHERE repo_id = ? AND source IN ('static','tool')`).run(id);
    const upsert = db.prepare(`INSERT INTO repo_findings (repo_id, fingerprint, path, line, col, end_line, severity, category, rule_id, title, description, why, fix, confidence, source, tool, snippet, present)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(repo_id, fingerprint) DO UPDATE SET path = excluded.path, line = excluded.line, col = excluded.col, end_line = excluded.end_line, severity = excluded.severity, category = excluded.category,
        title = excluded.title, description = excluded.description, why = excluded.why, fix = excluded.fix, confidence = excluded.confidence, snippet = excluded.snippet, present = 1, updated_at = datetime('now')`);
    const occ = new Map<string, number>();
    for (const f of findings) {
      const key = `${f.ruleId}|${f.path}|${f.anchor ?? f.description}`;
      const n = occ.get(key) ?? 0;
      occ.set(key, n + 1);
      upsert.run(id, fingerprint(f, n), f.path, f.line, f.col, f.endLine, f.severity, f.category, f.ruleId, f.title.slice(0, 300), f.description.slice(0, 2000), f.why, f.fix, f.confidence, f.source, f.tool, f.snippet.slice(0, 1200));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const fileRows = fileRowsOf(id);
  const findingRows = findingRowsOf(id);
  const depRows = dependencyRows(id);
  const stats = repoStats(fileRows, findingRows, scan.dirs.length, depRows);
  const toolList = detectTools();
  const analysis = {
    stats,
    managers: deps.managers,
    manifests: deps.manifests,
    durationMs: Date.now() - started,
    complete: !scan.truncated,
    tools: {
      codepilotRules: RULES.length,
      treeSitter: `web-tree-sitter ${(require('web-tree-sitter/package.json') as { version: string }).version}`,
      external: toolList.map((t) => ({ id: t.id, name: t.name, available: t.available, version: t.version, ran: tools.ran.includes(t.id) })),
    },
    limitations: [
      'Static analysis finds known patterns; it cannot prove that code is correct or secure.',
      'Pattern-based security rules can produce false positives and miss vulnerabilities; confidence levels show how certain each finding is.',
      ...(scan.truncated ? [`Only the first ${SCAN_LIMITS.maxFiles} files were analysed.`] : []),
      ...(scan.files.some((f) => f.skipped?.startsWith('larger')) ? [`Files larger than ${SCAN_LIMITS.maxFileBytes / 1024} KB were not analysed.`] : []),
      'No dependency vulnerability database was consulted (offline mode).',
    ],
  };
  const isGit = existsSync(join(root, '.git')) ? 1 : 0;
  db.prepare(`UPDATE repositories SET status = 'analyzed', profile = ?, scan_info = ?, analysis = ?, file_count = ?, source_files = ?, loc = ?, size_bytes = ?, is_git = ?, analyzed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(
    JSON.stringify(profile),
    JSON.stringify({ ignored: scan.ignored.slice(0, 500), ignoredCount: scan.ignored.length, truncated: scan.truncated, directories: scan.dirs.length, limits: { ...SCAN_LIMITS, zip: ZIP_LIMITS } }),
    JSON.stringify(analysis),
    stats.totalFiles,
    stats.sourceFiles,
    stats.linesOfCode,
    stats.totalBytes,
    isGit,
    id,
  );
  const sev = stats.findingsBySeverity;
  event(id, 'analysis', `Analysed ${stats.totalFiles} files (${stats.linesOfCode} lines) in ${Math.round((Date.now() - started) / 100) / 10} s: ${sev.critical} critical, ${sev.high} high, ${sev.medium} medium, ${sev.low} low findings. Quality ${stats.quality.score}/100.`);
  progress(1, 1, 'Done');
  return { stats };
}

// ------------------------------------------------------------------ queries
function fileRowsOf(id: number): FileRow[] {
  return (getDb().prepare('SELECT path, language, kind, size, lines, binary, sensitive, skipped, metrics FROM repo_files WHERE repo_id = ? ORDER BY path').all(id) as any[]).map((r) => ({ path: r.path, language: r.language, kind: r.kind, size: r.size, lines: r.lines, binary: !!r.binary, sensitive: !!r.sensitive, skipped: r.skipped, metrics: pj(r.metrics, {}) }));
}
const FINDING_COLS = `id, path, line, col, end_line AS endLine, severity, category, rule_id AS ruleId, title, description, why, fix, confidence, source, tool, snippet, status, user_verified AS userVerified, note, present, created_at AS createdAt, updated_at AS updatedAt`;
const mapFinding = (r: any) => ({ ...r, present: !!r.present, userVerified: !!r.userVerified });
function findingRowsOf(id: number): FindingRow[] {
  return (getDb().prepare(`SELECT ${FINDING_COLS} FROM repo_findings WHERE repo_id = ?`).all(id) as any[]).map(mapFinding);
}
function dependencyRows(id: number) {
  return (getDb().prepare('SELECT ecosystem, name, spec, resolved, dev, direct, manifest FROM repo_dependencies WHERE repo_id = ? ORDER BY direct DESC, ecosystem, name').all(id) as any[]).map((d) => ({ ...d, dev: !!d.dev, direct: !!d.direct }));
}

/** Overview: stored analysis plus live finding counts (statuses may have changed since). */
export function overview(id: number) {
  const repo = getRepo(id);
  if (!repo.analyzedAt) return { repo, stats: null, events: listEvents(id, 10) };
  const files = fileRowsOf(id);
  const stats = repoStats(files, findingRowsOf(id), (repo.scanInfo as any).directories ?? 0, dependencyRows(id));
  return { repo, stats, events: listEvents(id, 10) };
}

export function fileTree(id: number) {
  getRepo(id);
  const counts = new Map<string, Record<string, number>>();
  for (const r of getDb().prepare(`SELECT path, severity, COUNT(*) AS c FROM repo_findings WHERE repo_id = ? AND present = 1 AND status NOT IN ('dismissed','fixed') GROUP BY path, severity`).all(id) as { path: string; severity: string; c: number }[]) {
    const m = counts.get(r.path) ?? {};
    m[r.severity] = r.c;
    counts.set(r.path, m);
  }
  return fileRowsOf(id).map((f) => ({ path: f.path, language: f.language, kind: f.kind, size: f.size, lines: f.lines, binary: f.binary, sensitive: f.sensitive, skipped: f.skipped, functions: f.metrics.functions?.length ?? 0, maxComplexity: f.metrics.maxComplexity ?? 0, findings: counts.get(f.path) ?? {} }));
}

/** Reads one file for the viewer. Sensitive, binary and oversized files are refused. */
export function readRepoFile(id: number, path: string) {
  const repo = getRepo(id);
  const row = getDb().prepare('SELECT path, language, kind, size, lines, binary, sensitive, skipped, hash, metrics FROM repo_files WHERE repo_id = ? AND path = ?').get(id, path) as any;
  if (!row) throw new AppError(404, 'not_found', 'File not found in this repository.');
  if (row.sensitive) throw new AppError(403, 'sensitive_file', 'This file probably contains secrets, so CodePilot does not display it.');
  if (row.binary) throw new AppError(415, 'binary_file', 'Binary files cannot be displayed.');
  if (row.skipped) throw new AppError(413, 'file_skipped', `Not displayed: ${row.skipped}.`);
  let abs: string;
  try {
    abs = resolveInside(repo.rootPath, path);
  } catch {
    throw new AppError(404, 'not_found', 'The file no longer exists on disk.');
  }
  const st = statSync(abs);
  if (st.size > SCAN_LIMITS.maxFileBytes) throw new AppError(413, 'file_skipped', 'The file has grown beyond the size limit.');
  const content = readFileSync(abs, 'utf8');
  const hash = createHash('sha1').update(content).digest('hex');
  const findings = (getDb().prepare(`SELECT ${FINDING_COLS} FROM repo_findings WHERE repo_id = ? AND path = ? AND present = 1 ORDER BY line`).all(id, path) as any[]).map(mapFinding);
  return { path: row.path, language: row.language, kind: row.kind, lines: row.lines, size: row.size, content, changedSinceAnalysis: hash !== row.hash, metrics: pj(row.metrics, {}), findings };
}

export interface FindingQuery {
  search?: string;
  severity?: string;
  category?: string;
  path?: string;
  status?: string;
  source?: string;
  confidence?: string;
  sort?: 'severity' | 'confidence' | 'path' | 'newest';
  includeResolved?: boolean;
  limit?: number;
  offset?: number;
}
export function listFindings(id: number, q: FindingQuery) {
  getRepo(id);
  const where = ['repo_id = ?'];
  const args: (string | number)[] = [id];
  if (!q.includeResolved) where.push('present = 1');
  if (q.severity) {
    const s = q.severity.split(',').filter(Boolean);
    where.push(`severity IN (${s.map(() => '?').join(',')})`);
    args.push(...s);
  }
  if (q.category) {
    const c = q.category.split(',').filter(Boolean);
    where.push(`category IN (${c.map(() => '?').join(',')})`);
    args.push(...c);
  }
  if (q.status) {
    const s = q.status.split(',').filter(Boolean);
    where.push(`status IN (${s.map(() => '?').join(',')})`);
    args.push(...s);
  }
  if (q.source) {
    where.push('source = ?');
    args.push(q.source);
  }
  if (q.confidence) {
    where.push('confidence = ?');
    args.push(q.confidence);
  }
  if (q.path) {
    where.push('(path = ? OR path LIKE ? ESCAPE \'\\\')');
    args.push(q.path, `${q.path.replace(/[\\%_]/g, '\\$&')}/%`);
  }
  if (q.search) {
    where.push(`(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\' OR rule_id LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')`);
    const like = `%${q.search.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(like, like, like, like, like);
  }
  const sev = `CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;
  const conf = `CASE confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END`;
  const order = q.sort === 'confidence' ? `${conf}, ${sev}` : q.sort === 'path' ? 'path, line' : q.sort === 'newest' ? 'created_at DESC, id DESC' : `${sev}, ${conf}, path, line`;
  const total = (getDb().prepare(`SELECT COUNT(*) AS c FROM repo_findings WHERE ${where.join(' AND ')}`).get(...args) as { c: number }).c;
  const items = (getDb().prepare(`SELECT ${FINDING_COLS} FROM repo_findings WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, Math.min(q.limit ?? 100, 500), q.offset ?? 0) as any[]).map(mapFinding);
  return { total, items };
}
export function getFinding(id: number, findingId: number) {
  const r = getDb().prepare(`SELECT ${FINDING_COLS} FROM repo_findings WHERE repo_id = ? AND id = ?`).get(id, findingId);
  if (!r) throw new AppError(404, 'not_found', 'Finding not found');
  return { ...mapFinding(r), rule: RULE_BY_ID.get((r as any).ruleId) ?? null };
}
export function updateFinding(id: number, findingId: number, patch: { status?: string; note?: string; userVerified?: boolean }) {
  getFinding(id, findingId);
  const sets: string[] = [];
  const args: (string | number)[] = [];
  if (patch.status) {
    sets.push('status = ?');
    args.push(patch.status);
  }
  if (patch.note !== undefined) {
    sets.push('note = ?');
    args.push(patch.note);
  }
  if (patch.userVerified !== undefined) {
    sets.push('user_verified = ?');
    args.push(patch.userVerified ? 1 : 0);
  }
  if (sets.length) getDb().prepare(`UPDATE repo_findings SET ${sets.join(', ')}, updated_at = datetime('now') WHERE repo_id = ? AND id = ?`).run(...args, id, findingId);
  if (patch.status) event(id, 'finding', `Finding #${findingId} marked ${patch.status}.`);
  return getFinding(id, findingId);
}

export function dependencies(id: number) {
  const repo = getRepo(id);
  const deps = dependencyRows(id);
  const issues = listFindings(id, { category: 'dependency', limit: 500 }).items;
  const ecosystems = [...new Set(deps.map((d) => d.ecosystem))].map((e) => ({ ecosystem: e, direct: deps.filter((d) => d.ecosystem === e && d.direct).length, transitive: deps.filter((d) => d.ecosystem === e && !d.direct).length }));
  return { dependencies: deps, issues, ecosystems, managers: repo.analysis.managers ?? [], manifests: repo.analysis.manifests ?? [], vulnerabilityData: 'not checked (offline)' };
}
export function complexity(id: number) {
  getRepo(id);
  return complexityReport(fileRowsOf(id), findingRowsOf(id));
}
export function debt(id: number) {
  const repo = getRepo(id);
  return { items: technicalDebt(fileRowsOf(id), findingRowsOf(id), dependencyRows(id), { docs: ((repo.profile as any).docs as string[]) ?? [] }), method: 'Priority = impact weight (high 3, medium 2, low 1) × log2(1 + occurrences). Evidence comes from stored findings and metrics. No effort or time estimates are given.' };
}
export const rulesCatalogue = () => RULES;
export { fileRowsOf, findingRowsOf, dependencyRows };
