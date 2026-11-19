import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database/db.js';
import { clearStatusCache } from '../src/providers/index.js';

openDatabase(':memory:');
const app = createApp();

describe('API basics', () => {
  it('GET /api/health', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, data: { status: 'ok' } });
  });
  it('unknown API routes return a JSON 404', async () => {
    const r = await request(app).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.ok).toBe(false);
  });
  it('rejects cross-site origins', async () => {
    const r = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(r.status).toBe(403);
  });
  it('validates request bodies with clear messages', async () => {
    const r = await request(app).post('/api/generate').send({ prompt: 'x', language: 'cobol' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation_error');
    expect(r.body.error.details.length).toBeGreaterThan(0);
  });
  it('handles malformed JSON', async () => {
    const r = await request(app).post('/api/convert').set('content-type', 'application/json').send('{bad');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_json');
  });
});

describe('settings', () => {
  it('returns defaults with execution disabled and offline AI', async () => {
    const r = await request(app).get('/api/settings');
    expect(r.body.data.executionEnabled).toBe(false);
    expect(r.body.data.aiProvider).toBe('offline');
  });
  it('rejects non-local Ollama URLs (no data leaves the machine)', async () => {
    const r = await request(app).put('/api/settings').send({ ollamaUrl: 'https://api.example.com' });
    expect(r.status).toBe(400);
  });
  it('updates and persists values', async () => {
    const r = await request(app).put('/api/settings').send({ editorFontSize: 16, theme: 'light' });
    expect(r.body.data.editorFontSize).toBe(16);
    const g = await request(app).get('/api/settings');
    expect(g.body.data.theme).toBe('light');
  });
});

describe('offline features', () => {
  it('generates code from a recognised problem and labels it as a template', async () => {
    const r = await request(app).post('/api/generate').send({ prompt: 'Write a program to check whether a number is prime', language: 'cpp' });
    expect(r.status).toBe(200);
    expect(r.body.data.engine.kind).toBe('template');
    expect(r.body.data.engine.label).toMatch(/not AI/);
    expect(r.body.data.code).toContain('#include <iostream>');
    expect(r.body.data.testCases.length).toBeGreaterThan(0);
  });
  it('is honest when it cannot solve an arbitrary problem offline', async () => {
    const r = await request(app).post('/api/generate').send({ prompt: 'Build a REST API for a pet hospital with authentication', language: 'python' });
    expect(r.body.data.matched).toBe(false);
    expect(r.body.data.codeIsSkeleton).toBe(true);
    expect(r.body.data.message).toMatch(/cannot/);
  });
  it('converts code with semantic comparison', async () => {
    const r = await request(app).post('/api/convert').send({ code: 'n = 5\ntotal = 0\nfor i in range(1, n + 1):\n    total += i\nprint("Sum:", total)\n', from: 'python', to: 'java' });
    expect(r.body.data.ok).toBe(true);
    expect(r.body.data.code).toContain('public class Main');
    expect(r.body.data.comparison.logic.find((x: any) => x.aspect === 'Loops').same).toBe(true);
    expect(r.body.data.verified).toBe(false);
  });
  it('rejects same-language conversion', async () => {
    const r = await request(app).post('/api/convert').send({ code: 'x = 1', from: 'python', to: 'python' });
    expect(r.status).toBe(400);
  });
  it('explains code', async () => {
    const r = await request(app).post('/api/explain').send({ code: 'for i in range(3):\n    print(i)\n', language: 'python', mode: 'beginner' });
    expect(r.body.data.lines.length).toBe(2);
    expect(r.body.data.engine.kind).toBe('offline');
  });
  it('builds algorithm, pseudocode and flowchart from code', async () => {
    const r = await request(app).post('/api/studio/code').send({ code: 'def f(n):\n    if n <= 1:\n        return 1\n    return n * f(n - 1)\n\n\nprint(f(5))\n', language: 'python' });
    expect(r.body.data.flowchart).toContain('flowchart TD');
    expect(r.body.data.pseudocode).toContain('FUNCTION f(n)');
    expect(Object.keys(r.body.data.conversions)).toHaveLength(4);
  });
  it('matches a problem statement to the algorithm library', async () => {
    const r = await request(app).post('/api/studio/problem').send({ problem: 'find shortest path in a weighted graph', language: 'java' });
    expect(r.body.data.matched).toBe(true);
    expect(r.body.data.algorithmId).toBe('dijkstra');
  });
  it('lists algorithms and returns traces', async () => {
    const list = await request(app).get('/api/algorithms');
    expect(list.body.data.length).toBe(26);
    const t = await request(app).post('/api/algorithms/quick-sort/trace').send({ input: '3, 1, 2' });
    expect(t.body.data.steps.at(-1).array).toEqual([1, 2, 3]);
  });
  it('serves learning content and records quiz results', async () => {
    const q = await request(app).post('/api/learning/questions').send({ topicId: 'graphs', type: 'mcq', count: 3 });
    expect(q.body.data.questions).toHaveLength(3);
    expect(q.body.data.engine.label).toMatch(/question bank/);
    const r = await request(app).post('/api/learning/quiz').send({ topicId: 'graphs', correct: 2, total: 3 });
    expect(r.body.data.find((p: any) => p.topicId === 'graphs').quizCorrect).toBe(2);
    const bad = await request(app).post('/api/learning/quiz').send({ topicId: 'graphs', correct: 5, total: 3 });
    expect(bad.status).toBe(400);
  });
  it('stores per-question answers and builds a revision queue from wrong answers', async () => {
    const q = (await request(app).post('/api/learning/questions').send({ topicId: 'sorting', type: 'mcq', count: 3, seed: 7 })).body.data.questions;
    // answer the first question wrong, the others right
    const answers = q.map((x: any, i: number) => ({ question: x.q, options: x.options, answer: x.answer, explanation: x.explanation, chosen: i === 0 ? (x.answer + 1) % x.options.length : x.answer }));
    // the reported score must match the answers
    await request(app).post('/api/learning/quiz').send({ topicId: 'sorting', correct: 3, total: 3, answers }).expect(400);
    await request(app).post('/api/learning/quiz').send({ topicId: 'sorting', correct: 2, total: 3, answers }).expect(200);
    let rev = (await request(app).get('/api/learning/revision')).body.data;
    expect(rev.items.map((i: any) => i.question)).toContain(q[0].q);
    expect(rev.items.map((i: any) => i.question)).not.toContain(q[1].q);
    const item = rev.items.find((i: any) => i.question === q[0].q);
    expect(item.mcq.explanation).toBe(q[0].explanation);
    expect(item.wrongCount).toBe(1);
    // a wrong revision attempt keeps it in the queue, a correct one removes it
    const again = { topicId: 'sorting', question: q[0].q, options: q[0].options, answer: q[0].answer, explanation: q[0].explanation };
    expect((await request(app).post('/api/learning/revision').send({ ...again, chosen: answers[0].chosen })).body.data.correct).toBe(false);
    const ok = (await request(app).post('/api/learning/revision').send({ ...again, chosen: q[0].answer })).body.data;
    expect(ok.correct).toBe(true);
    rev = (await request(app).get('/api/learning/revision')).body.data;
    expect(rev.items.map((i: any) => i.question)).not.toContain(q[0].q);
    expect(rev.stats.revisionAnswers).toBe(2);
    await request(app).post('/api/learning/revision').send({ ...again, topicId: 'nope', chosen: 0 }).expect(404);
  });
  it('serves learning paths with progress computed from topic status', async () => {
    await request(app).put('/api/learning/topics/arrays/status').send({ status: 'completed' }).expect(200);
    const paths = (await request(app).get('/api/learning/paths')).body.data;
    const f = paths.find((p: any) => p.id === 'dsa-foundations');
    expect(f.total).toBe(4);
    expect(f.completed).toBeGreaterThanOrEqual(1);
    expect(f.next.id).not.toBe('arrays');
    const topics = (await request(app).get('/api/learning/topics')).body.data;
    expect(topics.categories).toHaveLength(4);
    expect(topics.topics.every((t: any) => topics.categories.includes(t.category))).toBe(true);
  });
});

describe('code execution', () => {
  it('is disabled until the user enables it', async () => {
    const r = await request(app).post('/api/execute').send({ code: 'print(1)', language: 'python' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('execution_disabled');
  });
  it('runs programs after opt-in and records history', async () => {
    await request(app).put('/api/settings').send({ executionEnabled: true });
    const r = await request(app).post('/api/execute').send({ code: 'n = int(input())\nprint(n * 2)\n', language: 'python', stdin: '21\n' });
    expect(r.body.data.status).toBe('success');
    expect(r.body.data.stdout.replace(/\r/g, '')).toBe('42\n');
    const h = await request(app).get('/api/history?kind=execution');
    expect(h.body.data.total).toBeGreaterThan(0);
  });
  it('explains compile errors', async () => {
    const r = await request(app).post('/api/execute').send({ code: 'public class Main { public static void main(String[] a) { int x = 1 System.out.println(x); } }', language: 'java' });
    expect(r.body.data.status).toBe('compile_error');
    expect(r.body.data.diagnostics[0].title).toMatch(/semicolon/i);
  });
  it('runs test cases and compares output', async () => {
    const r = await request(app).post('/api/debug/tests').send({ code: 'a, b = map(int, input().split())\nprint(a + b)\n', language: 'python', tests: [{ input: '2 3\n', expected: '5' }, { input: '1 1\n', expected: '3' }] });
    expect(r.body.data.passed).toBe(1);
    expect(r.body.data.total).toBe(2);
  });
  it('diagnoses and proposes a repair', async () => {
    const r = await request(app).post('/api/debug/diagnose').send({ code: 'def f(x)\n    return x\nprint(f(2))\n', language: 'python', stdin: '' });
    expect(r.body.data.repair.fixed).toContain('def f(x):');
  });
});

describe('workspace CRUD and persistence', () => {
  let projectId = 0;
  let fileId = 0;
  it('creates a project', async () => {
    const r = await request(app).post('/api/projects').send({ name: 'Algorithms', description: 'test', language: 'python' });
    expect(r.status).toBe(201);
    projectId = r.body.data.id;
  });
  it('rejects duplicate project names', async () => {
    const r = await request(app).post('/api/projects').send({ name: 'Algorithms' });
    expect(r.status).toBe(409);
  });
  it('creates, edits, duplicates and downloads files', async () => {
    const c = await request(app).post(`/api/projects/${projectId}/files`).send({ name: 'main.py', language: 'python', content: 'print(1)\n' });
    fileId = c.body.data.id;
    const u = await request(app).put(`/api/files/${fileId}`).send({ content: 'print(2)\n' });
    expect(u.body.data.content).toBe('print(2)\n');
    const d = await request(app).post(`/api/files/${fileId}/duplicate`);
    expect(d.body.data.name).toBe('main-copy.py');
    const dl = await request(app).get(`/api/files/${fileId}/download`);
    expect(dl.headers['content-disposition']).toContain('main.py');
    expect(dl.text).toBe('print(2)\n');
  });
  it('validates file names', async () => {
    const r = await request(app).post(`/api/projects/${projectId}/files`).send({ name: '../evil.py', language: 'python' });
    expect(r.status).toBe(400);
  });
  it('searches projects by file content', async () => {
    const r = await request(app).get('/api/projects?search=print(2)');
    expect(r.body.data.map((p: any) => p.id)).toContain(projectId);
  });
  it('renames and deletes with cascading file removal', async () => {
    const r = await request(app).put(`/api/projects/${projectId}`).send({ name: 'Renamed' });
    expect(r.body.data.name).toBe('Renamed');
    await request(app).delete(`/api/projects/${projectId}`).expect(200);
    await request(app).get(`/api/files/${fileId}`).expect(404);
  });
});

describe('request origin protection', () => {
  it('rejects DNS-rebinding requests with a foreign Host header', async () => {
    const r = await request(app).get('/api/settings').set('Host', 'attacker.example:4317');
    expect(r.status).toBe(421);
    expect(r.body.error.code).toBe('forbidden_host');
    await request(app).get('/api/settings').set('Host', 'localhost:4317').expect(200);
  });
  it('rejects cross-site requests and sends a strict CSP', async () => {
    const r = await request(app).post('/api/projects').set('Origin', 'https://attacker.example').send({ name: 'x' });
    expect(r.status).toBe(403);
    const ok = await request(app).get('/api/health');
    expect(ok.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(ok.headers['x-frame-options']).toBe('DENY');
  });
});

describe('history, demo data and dashboard', () => {
  it('loads demo data flagged as demo and computes dashboard statistics from it', async () => {
    const r = await request(app).post('/api/demo/load');
    expect(r.body.data.projects).toBe(4);
    const d = await request(app).get('/api/dashboard');
    expect(d.body.data.totals.projects).toBeGreaterThanOrEqual(4);
    expect(d.body.data.hasDemoData).toBe(true);
    expect(d.body.data.activity).toHaveLength(14);
    const h = await request(app).get('/api/history?limit=5');
    expect(h.body.data.items.length).toBe(5);
  });
  it('dashboard command-center data comes from real records', async () => {
    await request(app).put('/api/learning/topics/sorting/status').send({ status: 'in_progress' }).expect(200);
    const d = (await request(app).get('/api/dashboard')).body.data;
    // engine breakdown sums to the number of history records
    const engineTotal = d.engines.reduce((a: number, e: any) => a + e.count, 0);
    expect(engineTotal).toBe(d.totals.activities);
    expect(d.engines.every((e: any) => ['ollama', 'offline', 'template'].includes(e.engine))).toBe(true);
    // continue-where-you-left-off points at existing records
    expect(d.continue.file?.id).toBeTruthy();
    await request(app).get(`/api/files/${d.continue.file.id}`).expect(200);
    expect(d.continue.work?.route).toMatch(/^\//);
    const prog = (await request(app).get('/api/learning/topics')).body.data.progress;
    expect(d.continue.topics.length).toBeGreaterThan(0);
    for (const t of d.continue.topics) expect(prog.find((p: any) => p.topicId === t.topicId).status).toBe('in_progress');
    expect(d.totals.topicsInProgress).toBeGreaterThanOrEqual(1);
    // toolchain reflects the runtime detector, JavaScript is always available
    expect(d.toolchain.runtimes.find((r: any) => r.language === 'javascript').available).toBe(true);
    expect(['job+lowil', 'job', 'process']).toContain(d.toolchain.isolation);
  });
  it('filters and searches history, deletes single records', async () => {
    const r = await request(app).get('/api/history?kind=conversion&search=Python');
    expect(r.body.data.items.every((i: any) => i.kind === 'conversion')).toBe(true);
    const id = r.body.data.items[0].id;
    const one = await request(app).get(`/api/history/${id}`);
    expect(one.body.data.output.code).toBeTruthy();
    await request(app).delete(`/api/history/${id}`).expect(200);
    await request(app).get(`/api/history/${id}`).expect(404);
  });
  it('requires confirmation to clear history', async () => {
    await request(app).delete('/api/history').expect(400);
    const r = await request(app).delete('/api/history?confirm=yes&kind=learning');
    expect(r.body.data.deleted).toBeGreaterThan(0);
  });
  it('removes demo content without touching user data', async () => {
    await request(app).post('/api/projects').send({ name: 'Mine' });
    await request(app).post('/api/demo/clear').expect(200);
    const p = await request(app).get('/api/projects');
    expect(p.body.data.map((x: any) => x.name)).toEqual(['Mine']);
  });
});

describe('local AI provider (Ollama protocol stub)', () => {
  // Ollama is optional and not installed here, so we exercise the real HTTP client against a
  // minimal server that speaks the Ollama REST protocol. No model is downloaded.
  let server: Server;
  let url = '';
  const calls: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.0-stub' }));
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'stub-coder:latest', size: 1, details: { family: 'stub', parameter_size: '1B' } }] }));
        if (req.url === '/api/generate') {
          const p = JSON.parse(body);
          const response = p.format ? JSON.stringify({ understanding: 'Stub understanding', code: 'print("from stub")\n', explanation: 'stub', timeComplexity: 'O(1)', spaceComplexity: 'O(1)', testCases: [] }) : 'ready';
          return res.end(JSON.stringify({ response }));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  it('reports Ollama as unreachable when nothing is running', async () => {
    await request(app).put('/api/settings').send({ aiProvider: 'ollama', ollamaUrl: 'http://127.0.0.1:9', ollamaModel: 'x' });
    clearStatusCache();
    const s = await request(app).get('/api/ai/status?refresh=1');
    expect(s.body.data.reachable).toBe(false);
    const g = await request(app).post('/api/generate').send({ prompt: 'check prime number', language: 'python' });
    expect(g.body.data.engine.kind).toBe('template');
    expect(g.body.data.engine.notice).toMatch(/not installed|not running/);
  });
  it('detects models and uses local AI when configured', async () => {
    await request(app).put('/api/settings').send({ ollamaUrl: url, ollamaModel: 'stub-coder:latest' });
    const s = await request(app).get('/api/ai/status?refresh=1');
    expect(s.body.data.reachable).toBe(true);
    expect(s.body.data.modelInstalled).toBe(true);
    const t = await request(app).post('/api/ai/test').send({});
    expect(t.body.data.generated).toBe(true);
    const g = await request(app).post('/api/generate').send({ prompt: 'anything at all', language: 'python' });
    expect(g.body.data.engine.kind).toBe('ollama');
    expect(g.body.data.code).toBe('print("from stub")\n');
    expect(calls.some((c) => c === 'POST /api/generate')).toBe(true);
  });
  it('does not claim AI output when the selected model is missing', async () => {
    await request(app).put('/api/settings').send({ ollamaModel: 'not-installed' });
    clearStatusCache();
    const g = await request(app).post('/api/explain').send({ code: 'print(1)', language: 'python' });
    expect(g.body.data.engine.kind).toBe('offline');
    expect(g.body.data.engine.notice).toMatch(/not installed/);
    await request(app).put('/api/settings').send({ aiProvider: 'offline' });
  });
});
