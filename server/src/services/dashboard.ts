import { getDb, PROFILE_ID } from '../database/db.js';
import { listProjects, recentFiles, listSavedAlgorithms, getProgress } from './repo.js';
import { TOPICS } from '../content/learning.js';
import { detectRuntimes } from '../execution/runtimes.js';
import { sandboxStatus } from '../execution/sandbox.js';
import { getSettings } from './settings.js';

const KIND_ROUTE: Record<string, string> = {
  generation: '/generator',
  conversion: '/converter',
  explanation: '/explainer',
  algorithm: '/studio',
  execution: '/compiler',
  debug: '/compiler',
  learning: '/learning',
};

/** Dashboard statistics — computed entirely from local database records. */
export function dashboard() {
  const d = getDb();
  const kinds = d.prepare(`SELECT kind, COUNT(*) AS c FROM history WHERE profile_id = ? GROUP BY kind`).all(PROFILE_ID) as { kind: string; c: number }[];
  const byKind = Object.fromEntries(kinds.map((k) => [k.kind, k.c]));
  const exec = d.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS ok FROM history WHERE profile_id = ? AND kind = 'execution'`).get(PROFILE_ID) as { total: number; ok: number | null };
  const langRows = d
    .prepare(
      `SELECT language, SUM(c) AS c FROM (
         SELECT language, COUNT(*) AS c FROM history WHERE profile_id = ? AND language IS NOT NULL GROUP BY language
         UNION ALL
         SELECT target_language AS language, COUNT(*) AS c FROM history WHERE profile_id = ? AND target_language IS NOT NULL GROUP BY target_language
         UNION ALL
         SELECT f.language, COUNT(*) AS c FROM code_files f JOIN projects p ON p.id = f.project_id WHERE p.profile_id = ? GROUP BY f.language
       ) GROUP BY language ORDER BY c DESC`,
    )
    .all(PROFILE_ID, PROFILE_ID, PROFILE_ID) as { language: string; c: number }[];
  const activity = d
    .prepare(`SELECT date(created_at) AS day, COUNT(*) AS c FROM history WHERE profile_id = ? AND created_at >= date('now', '-13 days') GROUP BY day`)
    .all(PROFILE_ID) as { day: string; c: number }[];
  const days: { day: string; count: number }[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = dt.toISOString().slice(0, 10);
    days.push({ day: key, count: activity.find((a) => a.day === key)?.c ?? 0 });
  }
  const recent = (kind: string, n = 5) =>
    d
      .prepare(`SELECT id, title, language, target_language AS targetLanguage, engine, status, is_demo AS isDemo, created_at AS createdAt FROM history WHERE profile_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(PROFILE_ID, kind, n)
      .map((r: any) => ({ ...r, isDemo: !!r.isDemo }));
  const projects = listProjects();
  const fileCount = (d.prepare(`SELECT COUNT(*) AS c FROM code_files f JOIN projects p ON p.id = f.project_id WHERE p.profile_id = ?`).get(PROFILE_ID) as { c: number }).c;
  const progress = getProgress() as { topicId: string; status: string; quizCorrect: number; quizTotal: number }[];
  const completed = progress.filter((p) => p.status === 'completed').length;
  const quizCorrect = progress.reduce((a, p) => a + p.quizCorrect, 0);
  const quizTotal = progress.reduce((a, p) => a + p.quizTotal, 0);
  const total = kinds.reduce((a, k) => a + k.c, 0);
  const streak = (() => {
    let s = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].count > 0) s++;
      else if (i === days.length - 1) continue;
      else break;
    }
    return s;
  })();
  // How results were produced (local AI vs offline engine vs built-in templates) — from history records.
  const engines = (d.prepare(`SELECT engine, COUNT(*) AS c FROM history WHERE profile_id = ? GROUP BY engine`).all(PROFILE_ID) as { engine: string; c: number }[]).map((r) => ({
    engine: r.engine === 'local' ? 'offline' : r.engine,
    count: r.c,
  }));
  // "Continue where you left off": the most recent real records of each kind.
  const lastFile = (recentFiles(1)[0] as unknown as { id: number; name: string; language: string; projectName: string; updatedAt: string } | undefined) ?? null;
  const lastWork = d
    .prepare(`SELECT id, kind, title, language, created_at AS createdAt FROM history WHERE profile_id = ? AND kind IN ('generation','conversion','explanation','algorithm','execution','debug') ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(PROFILE_ID) as { id: number; kind: string; title: string; language: string | null; createdAt: string } | undefined;
  const titles = new Map(TOPICS.map((tp) => [tp.id, tp.name]));
  const inProgress = (progress as { topicId: string; status: string; updatedAt?: string; quizCorrect: number; quizTotal: number }[])
    .filter((p) => p.status === 'in_progress' && titles.has(p.topicId))
    .sort((x, y) => String(y.updatedAt ?? '').localeCompare(String(x.updatedAt ?? '')))
    .map((p) => ({ topicId: p.topicId, title: titles.get(p.topicId)!, quizCorrect: p.quizCorrect, quizTotal: p.quizTotal }));
  const sb = sandboxStatus();
  const settings = getSettings();
  return {
    continue: {
      file: lastFile ? { id: lastFile.id, name: lastFile.name, language: lastFile.language, projectName: lastFile.projectName, updatedAt: lastFile.updatedAt } : null,
      work: lastWork ? { ...lastWork, route: KIND_ROUTE[lastWork.kind] ?? '/history' } : null,
      topics: inProgress.slice(0, 3),
    },
    engines,
    toolchain: {
      runtimes: detectRuntimes().map((r) => ({ language: r.language, label: r.label, available: r.available, version: r.version })),
      executionEnabled: settings.executionEnabled,
      isolation: sb.level,
      sandbox: sb.available,
    },
    totals: {
      activities: total,
      generations: byKind.generation ?? 0,
      conversions: byKind.conversion ?? 0,
      explanations: byKind.explanation ?? 0,
      algorithms: byKind.algorithm ?? 0,
      executions: exec.total,
      executionSuccessRate: exec.total ? Math.round(((exec.ok ?? 0) / exec.total) * 100) : null,
      debugSessions: byKind.debug ?? 0,
      learning: byKind.learning ?? 0,
      projects: projects.length,
      files: fileCount,
      savedAlgorithms: listSavedAlgorithms().length,
      topicsCompleted: completed,
      topicsInProgress: inProgress.length,
      topicsTotal: TOPICS.length,
      quizAccuracy: quizTotal ? Math.round((quizCorrect / quizTotal) * 100) : null,
      streakDays: streak,
    },
    languages: langRows.map((r) => ({ language: r.language, count: r.c })),
    activity: days,
    recentProjects: projects.slice(0, 5),
    recentFiles: recentFiles(6),
    recentGenerations: recent('generation'),
    recentConversions: recent('conversion'),
    recentActivity: d
      .prepare(`SELECT id, kind, title, language, target_language AS targetLanguage, engine, status, is_demo AS isDemo, created_at AS createdAt FROM history WHERE profile_id = ? ORDER BY created_at DESC, id DESC LIMIT 8`)
      .all(PROFILE_ID)
      .map((r: any) => ({ ...r, isDemo: !!r.isDemo })),
    savedAlgorithms: listSavedAlgorithms().slice(0, 5),
    hasDemoData: !!d.prepare('SELECT 1 FROM history WHERE profile_id = ? AND is_demo = 1 UNION SELECT 1 FROM projects WHERE profile_id = ? AND is_demo = 1 LIMIT 1').get(PROFILE_ID, PROFILE_ID),
  };
}
