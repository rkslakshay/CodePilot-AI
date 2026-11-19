import type { ZodTypeAny, z } from 'zod';
import { getSettings } from '../services/settings.js';
import { OllamaProvider, AIError, detectOllamaInstall } from './ollama.js';
import type { AIProvider, EngineInfo, ProviderStatus } from './types.js';

export type { EngineInfo } from './types.js';
export { AIError, detectOllamaInstall };

export const OFFLINE_ENGINE: EngineInfo = { kind: 'offline', label: 'Offline engine (rule-based, not AI)' };

let statusCache: { at: number; url: string; status: ProviderStatus } | null = null;
let installCache: { at: number; value: ReturnType<typeof detectOllamaInstall> } | null = null;

export function getProvider(): OllamaProvider | null {
  const s = getSettings();
  if (s.aiProvider !== 'ollama') return null;
  return new OllamaProvider(s.ollamaUrl);
}

export interface FullStatus extends ProviderStatus {
  configured: boolean;
  selectedModel: string;
  modelInstalled: boolean;
  mode: 'offline' | 'ollama';
  url: string;
  installed: boolean;
  installPath: string | null;
  installedVersion: string | null;
}

export async function providerStatus(force = false): Promise<FullStatus> {
  const s = getSettings();
  const base = { configured: s.aiProvider === 'ollama', selectedModel: s.ollamaModel, mode: s.aiProvider, url: s.ollamaUrl };
  let st: ProviderStatus;
  if (!force && statusCache && statusCache.url === s.ollamaUrl && Date.now() - statusCache.at < 10000) st = statusCache.status;
  else {
    st = await new OllamaProvider(s.ollamaUrl).status();
    statusCache = { at: Date.now(), url: s.ollamaUrl, status: st };
  }
  if (force || !installCache || Date.now() - installCache.at > 60000) installCache = { at: Date.now(), value: detectOllamaInstall() };
  const inst = installCache.value;
  return {
    ...st,
    ...base,
    modelInstalled: !!s.ollamaModel && st.models.some((m) => m.name === s.ollamaModel),
    // a reachable server means it is installed even if the binary is somewhere unusual
    installed: inst.installed || st.reachable,
    installPath: inst.path,
    installedVersion: inst.version ?? st.version ?? null,
  };
}

export function clearStatusCache() {
  statusCache = null;
}

/**
 * Decide whether a request should use local AI. Returns the provider + model when Ollama is
 * selected, running and has the configured model; otherwise the reason for the offline fallback.
 */
export async function resolveAI(): Promise<{ provider: AIProvider; model: string; engine: EngineInfo } | { provider: null; engine: EngineInfo }> {
  const s = getSettings();
  if (s.aiProvider !== 'ollama') return { provider: null, engine: OFFLINE_ENGINE };
  const st = await providerStatus();
  if (!st.reachable)
    return {
      provider: null,
      engine: { ...OFFLINE_ENGINE, notice: st.installed ? `Local AI is selected but the Ollama service is not running (${st.error ?? 'no response'}). Start Ollama, or results stay offline.` : 'Local AI is selected but Ollama is not installed. Showing offline results instead.' },
    };
  if (!s.ollamaModel) return { provider: null, engine: { ...OFFLINE_ENGINE, notice: 'Local AI is selected but no model is chosen. Pick an installed model in Settings.' } };
  if (!st.modelInstalled) return { provider: null, engine: { ...OFFLINE_ENGINE, notice: `The model "${s.ollamaModel}" is not installed in Ollama. Showing offline results instead.` } };
  return { provider: getProvider()!, model: s.ollamaModel, engine: { kind: 'ollama', label: `Local AI · ${s.ollamaModel}`, model: s.ollamaModel } };
}

/** Extract a JSON object from model output (handles code fences and surrounding prose). */
export function parseJsonLoose<T = any>(text: string): T | null {
  const t = text.trim().replace(/^`{3}(?:json)?\s*/i, '').replace(/`{3}\s*$/i, '');
  try {
    return JSON.parse(t);
  } catch {
    const s = t.indexOf('{');
    const e = t.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Pull the first fenced code block (or the whole text) out of model output. */
export function extractCode(text: string): string {
  const m = text.match(/`{3}[\w+#-]*\n([\s\S]*?)`{3}/);
  return (m ? m[1] : text).trim() + '\n';
}

/** Remove markdown fences a model may wrap around code inside JSON strings. */
export function cleanCode(code: string): string {
  const m = code.match(/^\s*`{3}[\w+#-]*\s*\n([\s\S]*?)\n?`{3}\s*$/);
  return (m ? m[1] : code).replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
}

export type AiJsonResult<T> = { data: T; engine: EngineInfo; durationMs: number } | { data: null; engine: EngineInfo; error?: string };

const NOTICE: Record<AIError['code'], string> = {
  not_running: 'Ollama stopped responding.',
  timeout: 'The local model did not answer within the time limit (Settings → AI → timeout).',
  model_missing: 'The selected model is no longer installed.',
  http: 'Ollama returned an error.',
  too_large: 'The local model produced an oversized response.',
  aborted: 'The request was cancelled.',
  malformed: 'The local model returned an answer in an unexpected format twice.',
};

export interface AiJsonOptions<S extends ZodTypeAny> {
  /** JSON schema passed to Ollama structured outputs. */
  schema: Record<string, unknown>;
  /** Runtime validation of the parsed object. */
  validate: S;
  maxTokens?: number;
  /** Model context window (num_ctx) for prompts that need more than the default 4096 tokens. */
  contextTokens?: number;
  signal?: AbortSignal;
}

/**
 * Ask the local model for a JSON object constrained by a JSON schema, validate it with Zod and,
 * if the answer is malformed, retry once with a repair prompt. Any failure returns data = null
 * plus an engine notice explaining the offline fallback — results are never mislabelled.
 */
export async function aiJson<S extends ZodTypeAny>(prompt: string, system: string, opts: AiJsonOptions<S>): Promise<AiJsonResult<z.output<S>>> {
  const ai = await resolveAI();
  if (!ai.provider) return { data: null, engine: ai.engine };
  const s = getSettings();
  const gen = (p: string) =>
    ai.provider.generate(ai.model, p, { system, schema: opts.schema, temperature: s.aiTemperature, timeoutMs: s.aiTimeoutSec * 1000, maxTokens: opts.maxTokens ?? s.aiMaxTokens, contextTokens: opts.contextTokens, signal: opts.signal });
  let total = 0;
  try {
    let r = await gen(prompt);
    total += r.durationMs;
    let parsed = opts.validate.safeParse(parseJsonLoose(r.text));
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || 'root'}: ${i.message}`).join('; ');
      r = await gen(`${prompt}\n\nYour previous answer was invalid (${issues}). Answer again with ONLY a JSON object that matches the required schema exactly.`);
      total += r.durationMs;
      parsed = opts.validate.safeParse(parseJsonLoose(r.text));
      if (!parsed.success) throw new AIError('malformed', 'invalid JSON');
    }
    clearStatusCache();
    return { data: parsed.data, engine: { ...ai.engine, durationMs: total }, durationMs: total };
  } catch (e) {
    const err = e instanceof AIError ? e : new AIError('http', (e as Error).message);
    if (err.code === 'not_running' || err.code === 'model_missing') clearStatusCache();
    return { data: null, engine: { ...OFFLINE_ENGINE, notice: `Local AI could not complete this request: ${NOTICE[err.code]} Showing offline results instead.` }, error: err.code };
  }
}
