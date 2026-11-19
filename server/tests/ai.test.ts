/**
 * Local AI integration tests against an HTTP stub that implements the Ollama REST protocol
 * (streaming NDJSON /api/generate, /api/tags, /api/version, /api/show). Real-model checks live in
 * tests/ollama-live.test.ts and only run when a real Ollama server is available.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database/db.js';
import { clearStatusCache } from '../src/providers/index.js';
import { OllamaProvider, AIError } from '../src/providers/ollama.js';

openDatabase(':memory:');
const app = createApp();

/** Build the smallest object that satisfies a JSON schema (what a well-behaved model would emit). */
function fromSchema(s: any, key = ''): unknown {
  if (!s) return 'stub';
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case 'object':
      return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, fromSchema(v, k)]));
    case 'array':
      return Array.from({ length: Math.max(1, s.minItems ?? 1) }, () => fromSchema(s.items, key));
    case 'integer':
      return s.minimum ?? 0;
    default:
      return /code/i.test(key) ? 'print("from local model")' : `stub ${key}`;
  }
}

let server: Server;
let url = '';
const calls: { model: string; format: unknown; prompt: string }[] = [];
let malformedCount = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/version') return res.end(JSON.stringify({ version: '0.40.16-stub' }));
      if (req.url === '/api/tags')
        return res.end(JSON.stringify({ models: ['good', 'malformed', 'garbage', 'slow', 'huge'].map((n) => ({ name: `${n}:latest`, size: 986_000_000, details: { family: 'qwen2', parameter_size: '1.5B', quantization_level: 'Q4_K_M' } })) }));
      if (req.url === '/api/show')
        return res.end(JSON.stringify({ details: { family: 'qwen2', parameter_size: '1.5B', quantization_level: 'Q4_K_M', format: 'gguf' }, model_info: { 'qwen2.context_length': 32768 }, capabilities: ['completion', 'insert'] }));
      if (req.url !== '/api/generate') {
        res.statusCode = 404;
        return res.end('{}');
      }
      const p = JSON.parse(body);
      calls.push({ model: p.model, format: p.format, prompt: p.prompt });
      if (p.model === 'missing:latest') {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: `model "${p.model}" not found, try pulling it first` }));
      }
      res.setHeader('content-type', 'application/x-ndjson');
      const send = (text: string) => {
        // stream in small chunks like Ollama does
        for (let i = 0; i < text.length; i += 40) res.write(JSON.stringify({ response: text.slice(i, i + 40), done: false }) + '\n');
        res.end(JSON.stringify({ response: '', done: true, eval_count: 42 }));
      };
      if (p.model === 'slow:latest') {
        await new Promise((r) => setTimeout(r, 1500));
        return send('{}');
      }
      if (p.model === 'huge:latest') return send('x'.repeat(70_000));
      if (p.model === 'garbage:latest') return send('Sure! Here is your answer: (no JSON, sorry)');
      if (p.model === 'malformed:latest' && malformedCount++ % 2 === 0) return send('{"code": 42');
      if (typeof p.format === 'object') return send(JSON.stringify(fromSchema(p.format)));
      return send('ready');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

async function useModel(model: string) {
  await request(app).put('/api/settings').send({ aiProvider: 'ollama', ollamaUrl: url, ollamaModel: model });
  clearStatusCache();
}

describe('provider client', () => {
  it('reports status, models and capability information', async () => {
    const p = new OllamaProvider(url);
    const st = await p.status();
    expect(st.reachable).toBe(true);
    expect(st.models[0]).toMatchObject({ parameterSize: '1.5B', quantization: 'Q4_K_M' });
    const info = await p.show('good:latest');
    expect(info.contextLength).toBe(32768);
    expect(info.capabilities).toContain('completion');
    expect(info.fitsInMemory).toBe(true);
  });
  it('maps timeouts to a timeout error', async () => {
    await expect(new OllamaProvider(url).generate('slow:latest', 'x', { timeoutMs: 300 })).rejects.toMatchObject({ code: 'timeout' });
  });
  it('stops oversized responses', async () => {
    await expect(new OllamaProvider(url).generate('huge:latest', 'x')).rejects.toMatchObject({ code: 'too_large' });
  });
  it('reports a missing model', async () => {
    await expect(new OllamaProvider(url).generate('missing:latest', 'x')).rejects.toBeInstanceOf(AIError);
  });
  it('reports a stopped service', async () => {
    const st = await new OllamaProvider('http://127.0.0.1:9').status();
    expect(st.reachable).toBe(false);
    await expect(new OllamaProvider('http://127.0.0.1:9').generate('m', 'x')).rejects.toMatchObject({ code: 'not_running' });
  });
  it('refuses non-local addresses', () => {
    expect(() => new OllamaProvider('https://api.example.com')).toThrow();
  });
});

describe('every AI feature uses the local model with a JSON schema', () => {
  beforeAll(() => useModel('good:latest'));
  const cases: [string, string, Record<string, unknown>][] = [
    ['generation', '/api/generate', { prompt: 'Simulate a bank queue with priority customers', language: 'python' }],
    ['conversion', '/api/convert', { code: 'x = {"a": 1}\nprint(x)\n', from: 'python', to: 'java' }],
    ['explanation', '/api/explain', { code: 'print(1)\n', language: 'python' }],
    ['algorithm', '/api/studio/problem', { problem: 'Schedule meetings in the fewest rooms', language: 'python' }],
    ['pseudocode', '/api/studio/code', { code: 'def f(n):\n    return n * 2\n\nprint(f(3))\n', language: 'python' }],
    ['debugging', '/api/debug/diagnose', { code: 'print(undefined_name)\n', language: 'python', run: false }],
    ['tests', '/api/debug/generate-tests', { code: 'print(input())\n', language: 'python' }],
    ['viva', '/api/learning/questions', { topicId: 'graphs', type: 'viva', count: 1 }],
    ['mcq', '/api/learning/questions', { topicId: 'graphs', type: 'mcq', count: 1 }],
  ];
  for (const [name, path, body] of cases) {
    it(name, async () => {
      const before = calls.length;
      const r = await request(app).post(path).send(body);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data.engine.kind).toBe('ollama');
      expect(r.body.data.engine.label).toContain('good:latest');
      const call = calls[calls.length - 1];
      expect(calls.length).toBeGreaterThan(before);
      expect(typeof call.format).toBe('object'); // structured output schema was sent
    });
  }
  it('generation returns the model code and keeps offline static checks', async () => {
    const r = await request(app).post('/api/generate').send({ prompt: 'anything', language: 'python' });
    expect(r.body.data.code).toBe('print("from local model")\n');
    expect(Array.isArray(r.body.data.issues)).toBe(true);
  });
  it('studio keeps the flowchart offline and labels sections separately', async () => {
    const r = await request(app).post('/api/studio/code').send({ code: 'def f(n):\n    return n * 2\n\nprint(f(3))\n', language: 'python' });
    expect(r.body.data.sections).toEqual({ steps: 'ollama', pseudocode: 'ollama', flowchart: 'offline', complexity: 'offline' });
    expect(r.body.data.flowchart).toContain('flowchart TD');
  });
});

describe('failure handling falls back honestly', () => {
  it('retries once when the model returns malformed JSON', async () => {
    await useModel('malformed:latest');
    malformedCount = 0;
    const before = calls.length;
    const r = await request(app).post('/api/explain').send({ code: 'print(1)\n', language: 'python' });
    expect(r.body.data.engine.kind).toBe('ollama');
    expect(calls.length - before).toBe(2);
    expect(calls[calls.length - 1].prompt).toContain('previous answer was invalid');
  });
  it('falls back to offline when the model never produces valid JSON', async () => {
    await useModel('garbage:latest');
    const r = await request(app).post('/api/generate').send({ prompt: 'check prime number', language: 'c' });
    expect(r.body.data.engine.kind).toBe('template');
    expect(r.body.data.engine.notice).toMatch(/unexpected format/);
  });
  it('falls back when the response is too large', async () => {
    await useModel('huge:latest');
    const r = await request(app).post('/api/explain').send({ code: 'print(1)\n', language: 'python' });
    expect(r.body.data.engine.kind).toBe('offline');
    expect(r.body.data.engine.notice).toMatch(/oversized/);
  });
  it('status endpoint reports install + model details', async () => {
    await useModel('good:latest');
    const s = await request(app).get('/api/ai/status?refresh=1');
    expect(s.body.data).toMatchObject({ reachable: true, installed: true, modelInstalled: true });
    const m = await request(app).get('/api/ai/models/good:latest');
    expect(m.body.data.parameterSize).toBe('1.5B');
    await request(app).put('/api/settings').send({ aiProvider: 'offline' });
  });
});
