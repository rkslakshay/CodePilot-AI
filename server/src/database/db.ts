import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { MIGRATIONS } from './migrations.js';
import { config } from '../config.js';

let db: DatabaseSync | null = null;
let dbPath = '';

export type Row = Record<string, unknown>;

export function openDatabase(path = config.dbPath): DatabaseSync {
  if (db) return db;
  dbPath = path === ':memory:' ? ':memory:' : resolve(path);
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  ensureProfile(db);
  return db;
}

export function getDb(): DatabaseSync {
  return db ?? openDatabase();
}

export function closeDatabase() {
  db?.close();
  db = null;
}

export function getDbPath() {
  return dbPath;
}

export function databaseSize(): number {
  if (!dbPath || dbPath === ':memory:' || !existsSync(dbPath)) return 0;
  let size = statSync(dbPath).size;
  if (existsSync(dbPath + '-wal')) size += statSync(dbPath + '-wal').size;
  return size;
}

function migrate(d: DatabaseSync) {
  d.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set((d.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    d.exec('BEGIN');
    try {
      d.exec(m.sql);
      d.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw e;
    }
  }
}

function ensureProfile(d: DatabaseSync) {
  const row = d.prepare('SELECT id FROM profiles WHERE id = 1').get();
  if (!row) d.prepare("INSERT INTO profiles (id, name) VALUES (1, 'Local Developer')").run();
}

/** Run a function inside a transaction. */
export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const r = fn();
    d.exec('COMMIT');
    return r;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export const PROFILE_ID = 1;
