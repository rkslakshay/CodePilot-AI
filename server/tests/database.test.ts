import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, closeDatabase, getDb } from '../src/database/db.js';
import * as R from '../src/services/repo.js';
import { updateSettings, getSettings } from '../src/services/settings.js';

const dir = mkdtempSync(join(tmpdir(), 'codepilot-db-'));
const file = join(dir, 'test.db');
afterAll(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe('SQLite persistence', () => {
  it('creates the schema through migrations', () => {
    openDatabase(file);
    const tables = (getDb().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ['profiles', 'settings', 'projects', 'code_files', 'history', 'saved_algorithms', 'learning_progress', 'saved_questions', 'practice_attempts', 'quiz_answers', 'repositories', 'repo_files', 'repo_findings', 'repo_dependencies', 'repo_reviews', 'repo_events', 'uml_diagrams', 'schema_migrations']) expect(tables).toContain(t);
    expect((getDb().prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys).toBe(1);
  });

  it('performs CRUD with relationships', () => {
    const p = R.createProject({ name: 'Persist me', language: 'c' }) as any;
    const f = R.createFile(p.id, { name: 'main.c', language: 'c', content: 'int main(){return 0;}' }) as any;
    expect(R.getProject(p.id).files).toHaveLength(1);
    R.updateFile(f.id, { content: '// edited' });
    expect((R.getFile(f.id) as any).content).toBe('// edited');
    R.addHistory({ kind: 'generation', title: 'Persisted generation', engine: 'template', input: {}, output: { code: 'x' } });
    R.saveAlgorithm({ title: 'Saved', steps: ['a'], complexity: { time: 'O(n)' } });
    updateSettings({ editorFontSize: 18 });
  });

  it('upgrades a 1.0 database to the 2.0 schema without touching existing records', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { MIGRATIONS } = await import('../src/database/migrations.js');
    const old = join(dir, 'v1.db');
    const d = new DatabaseSync(old);
    d.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    d.exec(MIGRATIONS[0].sql);
    d.prepare('INSERT INTO schema_migrations (version, name) VALUES (1, ?)').run(MIGRATIONS[0].name);
    d.exec(`INSERT INTO profiles (id, name) VALUES (1, 'Old user')`);
    d.exec(`INSERT INTO learning_progress (profile_id, topic_id, status, quiz_attempts, quiz_correct, quiz_total) VALUES (1, 'sorting', 'completed', 2, 7, 8)`);
    d.close();
    closeDatabase();
    openDatabase(old);
    const versions = (getDb().prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version);
    expect(versions).toEqual(MIGRATIONS.map((m) => m.version));
    expect(getDb().prepare(`SELECT status, quiz_correct AS c FROM learning_progress WHERE topic_id = 'sorting'`).get()).toEqual({ status: 'completed', c: 7 });
    expect((getDb().prepare(`SELECT name FROM profiles WHERE id = 1`).get() as { name: string }).name).toBe('Old user');
    closeDatabase();
    openDatabase(file);
  });

  it('enforces CHECK constraints', () => {
    expect(() => getDb().prepare("INSERT INTO code_files (project_id, name, language) VALUES (1, 'x', 'cobol')").run()).toThrow();
  });

  it('keeps all data after the application restarts', () => {
    closeDatabase();
    openDatabase(file);
    const projects = R.listProjects();
    expect(projects.map((p) => p.name)).toContain('Persist me');
    expect(projects[0].fileCount).toBe(1);
    expect((R.listHistory({}).items[0] as unknown as { title: string }).title).toBe('Persisted generation');
    expect(R.listSavedAlgorithms()).toHaveLength(1);
    expect(getSettings().editorFontSize).toBe(18);
  });

  it('keeps repositories, findings, dismissals and notes across a restart (and 2.0 data stays intact)', async () => {
    const { writeSampleRepo } = await import('./helpers/sampleRepo.js');
    const S = await import('../src/repo/service.js');
    const { getJob } = await import('../src/repo/jobs.js');
    const dir = writeSampleRepo(mkdtempSync(join(tmpdir(), 'cp-persist-')));
    const { repo, job } = S.importFolder({ path: dir, name: 'Persisted repo' });
    for (let i = 0; i < 400 && getJob(job.id)?.status === 'running'; i++) await new Promise((r) => setTimeout(r, 25));
    expect(getJob(job.id)?.status).toBe('done');
    const f = S.listFindings(repo.id, { search: 'eval' }).items[0];
    S.updateFinding(repo.id, f.id, { status: 'dismissed', note: 'test harness only' });
    const before = S.listFindings(repo.id, { limit: 500 }).total;
    closeDatabase();
    openDatabase(file);
    expect(S.listRepos().map((r) => r.name)).toContain('Persisted repo');
    expect(S.listFindings(repo.id, { limit: 500 }).total).toBe(before);
    const again = S.getFinding(repo.id, f.id);
    expect(again.status).toBe('dismissed');
    expect(again.note).toBe('test harness only');
    expect(S.fileTree(repo.id).length).toBeGreaterThan(10);
    expect(R.listProjects().map((p) => p.name)).toContain('Persist me');
    expect(getSettings().editorFontSize).toBe(18);
    S.deleteRepo(repo.id);
    rmSync(dir, { recursive: true, force: true });
  });

  it('cascades project deletion to files', () => {
    const p = R.listProjects()[0];
    R.deleteProject(p.id);
    expect((getDb().prepare('SELECT COUNT(*) AS c FROM code_files').get() as { c: number }).c).toBe(0);
  });

  it('creates restorable backups with VACUUM INTO', () => {
    const b = R.createBackup();
    expect(b.sizeBytes).toBeGreaterThan(0);
    expect(existsSync(R.backupPath(b.name))).toBe(true);
    expect(R.listBackups().map((x) => x.name)).toContain(b.name);
    expect(() => R.backupPath('../../etc/passwd')).toThrow();
    R.deleteBackup(b.name);
  });
});
