import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { totalmem, freemem } from 'node:os';
import type { AIProvider, GenerateOptions, ModelInfo, ProviderStatus } from './types.js';

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i;
/** Hard cap on streamed model output so a runaway model cannot exhaust memory. */
export const MAX_RESPONSE_CHARS = 60_000;

export class AIError extends Error {
  constructor(
    public code: 'not_running' | 'timeout' | 'model_missing' | 'http' | 'too_large' | 'aborted' | 'malformed',
    message: string,
  ) {
    super(message);
  }
}

/** Find the Ollama executable without starting it. */
export function detectOllamaInstall(): { installed: boolean; path: string | null; version: string | null } {
  const candidates: string[] = [];
  try {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ollama'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    if (r.status === 0) candidates.push(...r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  } catch {
    /* ignore */
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe'));
  const path = candidates.find((p) => existsSync(p)) ?? null;
  if (!path) return { installed: false, path: null, version: null };
  let version: string | null = null;
  try {
    const r = spawnSync(path, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 6000 });
    version = (r.stdout + r.stderr).match(/\d+\.\d+\.\d+/)?.[0] ?? null;
  } catch {
    /* ignore */
  }
  return { installed: true, path, version };
}

/**
 * Ollama (https://ollama.com) local model server. All traffic stays on this machine:
 * the base URL is validated to be localhost / 127.0.0.1 / [::1].
 */
export class OllamaProvider implements AIProvider {
  readonly id = 'ollama';
  private baseUrl: string;

  constructor(baseUrl: string) {
    if (!LOCAL.test(baseUrl)) throw new Error('Ollama URL must point to this computer');
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async fetchWithTimeout(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, init.timeoutMs ?? 4000);
    const outer = init.signal;
    const onAbort = () => ctrl.abort();
    outer?.addEventListener('abort', onAbort);
    try {
      const res = await fetch(this.baseUrl + path, { ...init, signal: ctrl.signal });
      return { res, done: () => { clearTimeout(timer); outer?.removeEventListener('abort', onAbort); }, ctrl, timedOut: () => timedOut };
    } catch (e) {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
      throw this.mapError(e, timedOut, outer?.aborted);
    }
  }

  private mapError(e: unknown, timedOut: boolean, aborted?: boolean): AIError {
    if (e instanceof AIError) return e;
    const err = e as Error & { cause?: { code?: string } };
    if (aborted) return new AIError('aborted', 'The request was cancelled');
    if (timedOut || err.name === 'AbortError') return new AIError('timeout', 'The local model did not answer in time');
    if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/.test(err.message)) return new AIError('not_running', `Ollama is not running at ${this.baseUrl}`);
    return new AIError('http', err.message);
  }

  private async json(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<any> {
    const { res, done, timedOut } = await this.fetchWithTimeout(path, init);
    try {
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 404 && /not found/i.test(body)) throw new AIError('model_missing', body.slice(0, 200));
        throw new AIError('http', `Ollama responded ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`);
      }
      return await res.json();
    } catch (e) {
      throw this.mapError(e, timedOut());
    } finally {
      done();
    }
  }

  async status(): Promise<ProviderStatus> {
    try {
      const v = await this.json('/api/version', { timeoutMs: 2500 });
      const tags = await this.json('/api/tags', { timeoutMs: 4000 });
      const models: ModelInfo[] = (tags.models ?? []).map((m: any) => ({
        name: m.name,
        size: m.size,
        family: m.details?.family,
        parameterSize: m.details?.parameter_size,
        quantization: m.details?.quantization_level,
        modifiedAt: m.modified_at,
      }));
      return { provider: this.id, reachable: true, version: v.version, models };
    } catch (e) {
      return { provider: this.id, reachable: false, models: [], error: (e as Error).message };
    }
  }

  /** Detailed capability information for one installed model (context window, abilities, memory fit). */
  async show(model: string) {
    const r = await this.json('/api/show', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }), timeoutMs: 6000 });
    const info = r.model_info ?? {};
    const ctxKey = Object.keys(info).find((k) => k.endsWith('.context_length'));
    const tags = await this.json('/api/tags', { timeoutMs: 4000 }).catch(() => ({ models: [] }));
    const size: number | undefined = tags.models?.find((m: any) => m.name === model)?.size;
    const ramGb = totalmem() / 1024 ** 3;
    const needGb = size ? (size * 1.25) / 1024 ** 3 : null;
    return {
      name: model,
      family: r.details?.family ?? null,
      parameterSize: r.details?.parameter_size ?? null,
      quantization: r.details?.quantization_level ?? null,
      format: r.details?.format ?? null,
      contextLength: ctxKey ? Number(info[ctxKey]) : null,
      capabilities: (r.capabilities as string[] | undefined) ?? ['completion'],
      sizeBytes: size ?? null,
      estimatedRamGb: needGb ? +needGb.toFixed(1) : null,
      systemRamGb: +ramGb.toFixed(1),
      freeRamGb: +(freemem() / 1024 ** 3).toFixed(1),
      fitsInMemory: needGb === null ? null : needGb < ramGb * 0.7,
      advice:
        needGb === null
          ? 'Size unknown.'
          : needGb > ramGb * 0.7
            ? 'This model is large for this computer; answers may be very slow or fail.'
            : needGb > ramGb * 0.4
              ? 'Should run, but close other heavy applications for best speed.'
              : 'Comfortable fit for this computer.',
    };
  }

  /**
   * Generate with streaming so the response can be capped (MAX_RESPONSE_CHARS) and cancelled.
   * `opts.schema` enables Ollama structured outputs (JSON schema) for reliable JSON from small models.
   */
  async generate(model: string, prompt: string, opts: GenerateOptions = {}) {
    const started = Date.now();
    const body = {
      model,
      prompt,
      system: opts.system,
      stream: true,
      format: opts.schema ?? (opts.json ? 'json' : undefined),
      keep_alive: '10m',
      options: { temperature: opts.temperature ?? 0.2, num_predict: opts.maxTokens ?? 2048, num_ctx: opts.contextTokens ?? 4096 },
    };
    const { res, done, ctrl, timedOut } = await this.fetchWithTimeout('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: opts.timeoutMs ?? 180000,
      signal: opts.signal,
    });
    let text = '';
    let truncated = false;
    let evalCount = 0;
    try {
      if (!res.ok || !res.body) {
        const b = await res.text().catch(() => '');
        if (res.status === 404) throw new AIError('model_missing', `Model "${model}" is not installed in Ollama`);
        throw new AIError('http', `Ollama responded ${res.status}${b ? ': ' + b.slice(0, 200) : ''}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: end } = await reader.read();
        // a final chunk without a trailing newline is flushed by appending one
        buf += end ? '\n' : dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let chunk: any;
          try {
            chunk = JSON.parse(line);
          } catch {
            continue;
          }
          if (chunk.error) throw new AIError('http', String(chunk.error));
          text += chunk.response ?? '';
          if (chunk.done) evalCount = chunk.eval_count ?? 0;
          if (text.length > MAX_RESPONSE_CHARS) {
            truncated = true;
            ctrl.abort();
            break;
          }
        }
        if (truncated || end) break;
      }
    } catch (e) {
      if (!truncated) throw this.mapError(e, timedOut(), opts.signal?.aborted);
    } finally {
      done();
    }
    if (truncated) throw new AIError('too_large', `The model produced more than ${MAX_RESPONSE_CHARS.toLocaleString()} characters; the response was stopped.`);
    return { text, durationMs: Date.now() - started, tokens: evalCount };
  }
}
