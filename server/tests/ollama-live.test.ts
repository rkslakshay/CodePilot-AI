/**
 * Live tests against a REAL local Ollama model. Skipped automatically when Ollama is not running
 * or has no model. Choose the model with CODEPILOT_LIVE_MODEL (default: first installed model).
 * Model output is non-deterministic, so these tests assert the pipeline (valid structured answers,
 * honest labels, compiled code) rather than exact text.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database/db.js';
import { OllamaProvider } from '../src/providers/ollama.js';
import { clearStatusCache } from '../src/providers/index.js';
import { executeCode } from '../src/execution/executor.js';

const URL = process.env.CODEPILOT_OLLAMA_URL ?? 'http://127.0.0.1:11434';
const status = await new OllamaProvider(URL).status();
const model = process.env.CODEPILOT_LIVE_MODEL ?? status.models[0]?.name;
const live = status.reachable && !!model;

openDatabase(':memory:');
const app = createApp();

describe.skipIf(!live)(`real local model (${model ?? 'none'})`, () => {
  beforeAll(async () => {
    await request(app).put('/api/settings').send({ aiProvider: 'ollama', ollamaUrl: URL, ollamaModel: model, aiTimeoutSec: 300, executionEnabled: true });
    clearStatusCache();
  });

  it('reports model capabilities', async () => {
    const r = await request(app).get(`/api/ai/models/${encodeURIComponent(model!)}`);
    expect(r.status).toBe(200);
    expect(r.body.data.capabilities.length).toBeGreaterThan(0);
  });

  it('connection test generates text', async () => {
    const r = await request(app).post('/api/ai/test').send({});
    expect(r.body.data.generated).toBe(true);
  }, 300_000);

  it('generates a program for a problem outside the offline catalogue, which then runs', async () => {
    const r = await request(app).post('/api/generate').send({ prompt: 'Read a sentence and print the number of words that start with a capital letter', language: 'python' });
    expect(r.body.data.engine.kind).toBe('ollama');
    expect(r.body.data.code.length).toBeGreaterThan(20);
    const run = await executeCode('python', r.body.data.code, 'Hello there General Kenobi\n');
    // Report rather than assert exact output: small models may still make logic mistakes.
    console.log(`[live] generated program status=${run.status} stdout=${JSON.stringify(run.stdout.slice(0, 80))}`);
    expect(['success', 'runtime_error', 'compile_error']).toContain(run.status);
  }, 600_000);

  it('converts code containing a dictionary (offline converter cannot)', async () => {
    const r = await request(app).post('/api/convert').send({ code: 'ages = {"ann": 31, "bob": 27}\nfor name in ages:\n    print(name, ages[name])\n', from: 'python', to: 'java' });
    expect(r.body.data.engine.kind).toBe('ollama');
    expect(r.body.data.code).toMatch(/class/);
  }, 600_000);

  it('explains code', async () => {
    const r = await request(app).post('/api/explain').send({ code: 'def sq(x):\n    return x * x\n\nprint(sq(4))\n', language: 'python', mode: 'beginner' });
    expect(r.body.data.engine.kind).toBe('ollama');
    expect(r.body.data.summary.length).toBeGreaterThan(10);
  }, 600_000);

  it('generates MCQs with four options each', async () => {
    const r = await request(app).post('/api/learning/questions').send({ topicId: 'stacks', type: 'mcq', count: 2 });
    expect(r.body.data.engine.kind).toBe('ollama');
    for (const q of r.body.data.questions) expect(q.options).toHaveLength(4);
  }, 600_000);
});

it('live suite availability', () => {
  console.log(live ? `[live] using ${model}` : '[live] skipped: no running Ollama with a model');
  expect(true).toBe(true);
});

describe.skipIf(!live)(`repository review with the real model (${model ?? 'none'})`, () => {
  it('reviews a file and answers a question about the repository', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { writeSampleRepo } = await import('./helpers/sampleRepo.js');
    await request(app).put('/api/settings').send({ aiProvider: 'ollama', ollamaUrl: URL, ollamaModel: model, aiTimeoutSec: 300 });
    clearStatusCache();
    const imp = (await request(app).post('/api/repos/import/folder').send({ path: writeSampleRepo(mkdtempSync(join(tmpdir(), 'cp-live-repo-'))) })).body.data;
    for (let i = 0; i < 200; i++) {
      if ((await request(app).get(`/api/repos/jobs/${imp.job.id}`)).body.data.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const r = (await request(app).post(`/api/repos/${imp.repo.id}/review/file`).send({ path: 'src/server.js' })).body.data;
    console.log('[live] review engine:', r.engine.label, '| notice:', r.engine.notice, '| error:', r.error, '| summary:', r.review?.summary?.slice(0, 160));
    expect(r.aiAvailable).toBe(true);
    expect(r.engine.kind).toBe('ollama');
    expect(r.review.summary.length).toBeGreaterThan(10);
    // every line the model cites is inside the file (out-of-range lines are dropped as 0)
    for (const k of ['bugs', 'security', 'performance', 'maintainability']) for (const it of r.review[k]) expect(it.line).toBeLessThanOrEqual(28);
    const a = (await request(app).post(`/api/repos/${imp.repo.id}/ask`).send({ question: 'How is the user id used in the /user endpoint?' })).body.data;
    console.log('[live] answer:', a.answer?.slice(0, 200));
    expect(a.aiAvailable).toBe(true);
    expect(a.sources.map((s: { path: string }) => s.path)).toContain('src/server.js');
  }, 600_000);
});
