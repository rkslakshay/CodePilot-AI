import { Router } from 'express';
import { h, ok, parse, toInt, notFound, badRequest, AppError } from '../utils/http.js';
import * as V from '../validators/schemas.js';
import * as F from '../services/features.js';
import * as R from '../services/repo.js';
import { getSettings, updateSettings, resetSettings, SettingsSchema, getProfile, renameProfile } from '../services/settings.js';
import { providerStatus, clearStatusCache, resolveAI } from '../providers/index.js';
import { OllamaProvider } from '../providers/ollama.js';
import { getLibrary, getAlgorithm } from '../services/library.js';
import { trace } from '../content/tracers.js';
import { TOPICS, findTopic } from '../content/learning.js';
import { TEMPLATES } from '../content/templates.js';
import { detectRuntimes } from '../execution/runtimes.js';
import { sandboxStatus } from '../execution/sandbox.js';
import { PATHS, CATEGORIES } from '../content/learning-paths.js';
import { dashboard } from '../services/dashboard.js';
import { loadDemoData, clearDemoData } from '../services/demo.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { config } from '../config.js';
import { LANGS, LANG_LABEL } from '../engine/ir.js';

export const api = Router();
const heavy = rateLimit(40, 60_000);
const exec = rateLimit(30, 60_000);

// ------------------------------------------------------------------ meta
api.get('/health', (_req, res) => ok(res, { status: 'ok', app: config.appName, version: config.version, time: new Date().toISOString() }));
api.get('/meta', (_req, res) =>
  ok(res, {
    app: config.appName,
    version: config.version,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    languages: LANGS.map((l) => ({ id: l, label: LANG_LABEL[l] })),
  }),
);

// ------------------------------------------------------------------ settings & profile
api.get('/settings', (_req, res) => ok(res, getSettings()));
api.put('/settings', (req, res) => {
  const patch = parse(SettingsSchema.partial(), req.body);
  const s = updateSettings(patch);
  if (patch.ollamaUrl || patch.aiProvider || patch.ollamaModel) clearStatusCache();
  ok(res, s);
});
api.post('/settings/reset', (_req, res) => ok(res, resetSettings()));
api.get('/profile', (_req, res) => ok(res, getProfile()));
api.put('/profile', (req, res) => ok(res, renameProfile(parse(V.ProfileSchema, req.body).name)));

// ------------------------------------------------------------------ AI provider
api.get(
  '/ai/status',
  h(async (req, res) => ok(res, await providerStatus(req.query.refresh === '1'))),
);
api.post(
  '/ai/test',
  h(async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : getSettings().ollamaUrl;
    const model = typeof req.body?.model === 'string' ? req.body.model : getSettings().ollamaModel;
    let provider: OllamaProvider;
    try {
      provider = new OllamaProvider(url);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const st = await provider.status();
    if (!st.reachable) return ok(res, { reachable: false, message: st.error ?? 'Ollama is not reachable', models: [] });
    if (!model) return ok(res, { reachable: true, version: st.version, models: st.models, message: `Connected to Ollama ${st.version}. Choose a model to test generation.` });
    if (!st.models.some((m) => m.name === model)) return ok(res, { reachable: true, version: st.version, models: st.models, message: `Model "${model}" is not installed. CodePilot never downloads models automatically.` });
    try {
      const r = await provider.generate(model, 'Reply with the single word: ready', { timeoutMs: 90_000, temperature: 0 });
      ok(res, { reachable: true, version: st.version, models: st.models, generated: true, sample: r.text.trim().slice(0, 200), durationMs: r.durationMs, message: `Model "${model}" responded in ${(r.durationMs / 1000).toFixed(1)} s.` });
    } catch (e) {
      ok(res, { reachable: true, version: st.version, models: st.models, generated: false, message: `Model test failed: ${(e as Error).message}` });
    }
  }),
);
api.get(
  '/ai/models/:name',
  h(async (req, res) => {
    let provider: OllamaProvider;
    try {
      provider = new OllamaProvider(getSettings().ollamaUrl);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    try {
      ok(res, await provider.show(String(req.params.name)));
    } catch (e) {
      throw new AppError(502, 'ai_unavailable', (e as Error).message);
    }
  }),
);
api.get(
  '/ai/mode',
  h(async (_req, res) => {
    const r = await resolveAI();
    ok(res, r.engine);
  }),
);

// ------------------------------------------------------------------ generator
api.post('/generate', heavy, h(async (req, res) => ok(res, await F.generateCode({ ...parse(V.GenerateSchema, req.body), record: true }))));
api.get('/generate/catalog', (_req, res) =>
  ok(res, {
    templates: TEMPLATES.map((t) => ({ id: t.id, title: t.title, difficulty: t.difficulty, keywords: t.keywords.slice(0, 3) })),
    algorithms: getLibrary().map((a) => ({ id: a.id, title: a.name, difficulty: a.difficulty, category: a.category })),
  }),
);

// ------------------------------------------------------------------ converter
api.post('/convert', heavy, h(async (req, res) => ok(res, await F.convertCode({ ...parse(V.ConvertSchema, req.body), record: true }))));
api.post('/convert/verify', exec, h(async (req, res) => ok(res, await F.verifyConversion(parse(V.VerifySchema, req.body)))));

// ------------------------------------------------------------------ explainer
api.post('/explain', heavy, h(async (req, res) => ok(res, await F.explainCode({ ...parse(V.ExplainSchema, req.body), record: true }))));

// ------------------------------------------------------------------ algorithm studio
api.get('/algorithms', (_req, res) =>
  ok(
    res,
    getLibrary().map((a) => ({ id: a.id, name: a.name, category: a.category, summary: a.summary, difficulty: a.difficulty, complexity: a.complexity, visual: a.visual })),
  ),
);
api.get('/algorithms/:id', (req, res) => {
  const a = getAlgorithm(req.params.id);
  if (!a) throw notFound('Algorithm');
  ok(res, a);
});
api.post('/algorithms/:id/trace', (req, res) => {
  const a = getAlgorithm(req.params.id);
  if (!a) throw notFound('Algorithm');
  const { input } = parse(V.TraceSchema, req.body ?? {});
  ok(res, trace(a.id, input || a.defaultInput));
});
api.post('/studio/code', heavy, h(async (req, res) => ok(res, await F.studioFromCode({ ...parse(V.StudioCodeSchema, req.body), record: true }))));
api.post('/studio/problem', heavy, h(async (req, res) => ok(res, await F.studioFromProblem({ ...parse(V.StudioProblemSchema, req.body), record: true }))));
api.get('/saved-algorithms', (_req, res) => ok(res, R.listSavedAlgorithms()));
api.get('/saved-algorithms/:id', (req, res) => ok(res, R.getSavedAlgorithm(toInt(req.params.id))));
api.post('/saved-algorithms', (req, res) => ok(res, R.saveAlgorithm(parse(V.SavedAlgorithmSchema, req.body)), 201));
api.delete('/saved-algorithms/:id', (req, res) => {
  R.deleteSavedAlgorithm(toInt(req.params.id));
  ok(res, { deleted: true });
});

// ------------------------------------------------------------------ compiler & debugger
/** Sandbox status without the local executable path. */
function publicSandbox(force: boolean) {
  const { path: _p, ...rest } = sandboxStatus(force);
  return rest;
}
api.get('/runtimes', (req, res) => ok(res, { runtimes: detectRuntimes(req.query.refresh === '1'), sandbox: publicSandbox(req.query.refresh === '1'), executionEnabled: getSettings().executionEnabled, timeoutMs: getSettings().executionTimeoutMs }));
api.post('/execute', exec, h(async (req, res) => ok(res, await F.runCode({ ...parse(V.RunSchema, req.body), record: true }))));
api.post('/debug/tests', exec, h(async (req, res) => ok(res, await F.runTests(parse(V.TestsSchema, req.body)))));
api.post('/debug/diagnose', exec, h(async (req, res) => ok(res, await F.diagnose(parse(V.DiagnoseSchema, req.body)))));
api.post('/debug/generate-tests', heavy, h(async (req, res) => ok(res, await F.generateTests(parse(V.GenTestsSchema, req.body)))));

// ------------------------------------------------------------------ learning hub
api.get('/learning/topics', (_req, res) => ok(res, { topics: F.learningTopics(), progress: R.getProgress(), categories: CATEGORIES }));
api.get('/learning/paths', (_req, res) => {
  const progress = R.getProgress() as { topicId: string; status: string }[];
  const status = (id: string) => progress.find((p) => p.topicId === id)?.status ?? 'not_started';
  ok(
    res,
    PATHS.map((p) => {
      const topics = p.topics.map((id) => ({ id, name: findTopic(id)?.name ?? id, status: status(id) }));
      const done = topics.filter((t) => t.status === 'completed').length;
      return { ...p, topics, completed: done, total: topics.length, percent: Math.round((done / topics.length) * 100), next: topics.find((t) => t.status !== 'completed') ?? null };
    }),
  );
});
api.get('/learning/revision', (_req, res) => ok(res, { items: R.revisionQueue(), stats: R.answerStats() }));
api.post('/learning/revision', (req, res) => {
  const a = parse(V.RevisionAnswerSchema, req.body);
  if (!findTopic(a.topicId)) throw notFound('Topic');
  if (a.answer >= a.options.length || a.chosen >= a.options.length) throw badRequest('answer/chosen out of range');
  R.recordAnswers(a.topicId, [a], 'revision');
  ok(res, { correct: a.chosen === a.answer, remaining: R.revisionQueue().length });
});
api.get('/learning/topics/:id', (req, res) => {
  const t = findTopic(req.params.id);
  if (!t) throw notFound('Topic');
  ok(res, { ...t, progress: (R.getProgress() as { topicId: string }[]).find((p) => p.topicId === t.id) ?? null, saved: R.listSavedQuestions(t.id) });
});
api.post('/learning/questions', heavy, h(async (req, res) => ok(res, await F.generateQuestions({ ...parse(V.QuestionsSchema, req.body), record: true }))));
api.put('/learning/topics/:id/status', (req, res) => {
  if (!findTopic(req.params.id)) throw notFound('Topic');
  R.setTopicStatus(req.params.id, parse(V.TopicStatusSchema, req.body).status);
  ok(res, R.getProgress());
});
api.post('/learning/quiz', (req, res) => {
  const q = parse(V.QuizResultSchema, req.body);
  if (!findTopic(q.topicId)) throw notFound('Topic');
  if (q.correct > q.total) throw badRequest('correct cannot exceed total');
  if (q.answers) {
    if (q.answers.length !== q.total) throw badRequest('answers must contain one entry per question');
    if (q.answers.filter((a) => a.chosen === a.answer).length !== q.correct) throw badRequest('correct does not match the submitted answers');
  }
  R.recordQuiz(q.topicId, q.correct, q.total);
  if (q.answers) R.recordAnswers(q.topicId, q.answers, 'quiz');
  R.addHistory({ kind: 'learning', title: `Quiz result ${q.correct}/${q.total}: ${findTopic(q.topicId)!.name}`, engine: 'template', input: q, output: { score: q.correct / q.total } });
  ok(res, R.getProgress());
});
api.get('/learning/saved', (_req, res) => ok(res, R.listSavedQuestions()));
api.post('/learning/saved', (req, res) => ok(res, R.saveQuestion(parse(V.SaveQuestionSchema, req.body)), 201));
api.delete('/learning/saved/:id', (req, res) => {
  R.deleteSavedQuestion(toInt(req.params.id));
  ok(res, { deleted: true });
});
api.post('/learning/practice', (req, res) => {
  const p = parse(V.PracticeSchema, req.body);
  const topic = findTopic(p.topicId);
  if (!topic || !topic.practice.some((x) => x.id === p.problemId)) throw notFound('Practice problem');
  R.recordPractice(p);
  R.addHistory({ kind: 'learning', title: `Practice ${p.status}: ${topic.practice.find((x) => x.id === p.problemId)!.title}`, language: p.language ?? null, engine: 'local', input: p, output: {} });
  ok(res, { recorded: true });
});
api.get('/learning/stats', (_req, res) => {
  const progress = R.getProgress() as { topicId: string; status: string; quizAttempts: number; quizCorrect: number; quizTotal: number }[];
  const practice = R.practiceHistory(50) as { status: string; problemId: string }[];
  ok(res, {
    topics: TOPICS.length,
    completed: progress.filter((p) => p.status === 'completed').length,
    inProgress: progress.filter((p) => p.status === 'in_progress').length,
    quizAttempts: progress.reduce((a, p) => a + p.quizAttempts, 0),
    quizAccuracy: (() => {
      const t = progress.reduce((a, p) => a + p.quizTotal, 0);
      return t ? Math.round((progress.reduce((a, p) => a + p.quizCorrect, 0) / t) * 100) : null;
    })(),
    solved: new Set(practice.filter((p) => p.status === 'solved').map((p) => p.problemId)).size,
    practiceTotal: TOPICS.reduce((a, t) => a + t.practice.length, 0),
    savedQuestions: R.listSavedQuestions().length,
    toRevise: R.revisionQueue(500).length,
    answers: R.answerStats(),
    recentPractice: R.practiceHistory(10),
  });
});

// ------------------------------------------------------------------ workspace
api.get('/projects', (req, res) => ok(res, R.listProjects(typeof req.query.search === 'string' ? req.query.search.slice(0, 100) : undefined)));
api.post('/projects', (req, res) => ok(res, R.createProject(parse(V.ProjectCreateSchema, req.body)), 201));
api.get('/projects/:id', (req, res) => ok(res, R.getProject(toInt(req.params.id))));
api.put('/projects/:id', (req, res) => ok(res, R.updateProject(toInt(req.params.id), parse(V.ProjectUpdateSchema, req.body))));
api.delete('/projects/:id', (req, res) => {
  R.deleteProject(toInt(req.params.id));
  ok(res, { deleted: true });
});
api.post('/projects/:id/files', (req, res) => ok(res, R.createFile(toInt(req.params.id), parse(V.FileCreateSchema, req.body)), 201));
api.get('/files/recent', (_req, res) => ok(res, R.recentFiles(10)));
api.get('/files/:id', (req, res) => ok(res, R.getFile(toInt(req.params.id))));
api.put('/files/:id', (req, res) => ok(res, R.updateFile(toInt(req.params.id), parse(V.FileUpdateSchema, req.body))));
api.delete('/files/:id', (req, res) => {
  R.deleteFile(toInt(req.params.id));
  ok(res, { deleted: true });
});
api.post('/files/:id/duplicate', (req, res) => ok(res, R.duplicateFile(toInt(req.params.id)), 201));
api.get('/files/:id/download', (req, res) => {
  const f = R.getFile(toInt(req.params.id)) as unknown as { name: string; content: string };
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${f.name.replace(/[^\w.\- ()]/g, '_')}"`);
  res.send(f.content);
});
api.post('/snippets', (req, res) => ok(res, R.saveSnippet(parse(V.SnippetSchema, req.body)), 201));

// ------------------------------------------------------------------ history
api.get('/history', (req, res) => ok(res, R.listHistory(parse(V.HistoryQuerySchema, req.query))));
api.get('/history/:id', (req, res) => ok(res, R.getHistory(toInt(req.params.id))));
api.delete('/history/:id', (req, res) => {
  R.deleteHistory(toInt(req.params.id));
  ok(res, { deleted: true });
});
api.delete('/history', (req, res) => {
  if (req.query.confirm !== 'yes') throw badRequest('Add ?confirm=yes to clear history');
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  ok(res, { deleted: R.clearHistory(kind) });
});

// ------------------------------------------------------------------ dashboard, demo & system
api.get('/dashboard', (_req, res) => ok(res, dashboard()));
api.post('/demo/load', (_req, res) => ok(res, loadDemoData()));
api.post('/demo/clear', (_req, res) => ok(res, clearDemoData()));
api.get('/system/database', (_req, res) => ok(res, R.databaseInfo()));
api.get('/system/backups', (_req, res) => ok(res, R.listBackups()));
api.post('/system/backups', (_req, res) => ok(res, R.createBackup(), 201));
api.get('/system/backups/:name', (req, res) => res.download(R.backupPath(req.params.name)));
api.delete('/system/backups/:name', (req, res) => {
  R.deleteBackup(req.params.name);
  ok(res, { deleted: true });
});
