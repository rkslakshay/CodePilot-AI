/** Provider abstraction: any local model backend implements this interface. */
export interface ModelInfo {
  name: string;
  size?: number;
  family?: string;
  parameterSize?: string;
  quantization?: string;
  modifiedAt?: string;
}
export interface GenerateOptions {
  system?: string;
  json?: boolean;
  /** JSON schema for structured outputs (preferred over plain json mode). */
  schema?: Record<string, unknown>;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
  contextTokens?: number;
  signal?: AbortSignal;
}
export interface ProviderStatus {
  provider: string;
  reachable: boolean;
  version?: string;
  models: ModelInfo[];
  error?: string;
}
export interface AIProvider {
  readonly id: string;
  status(): Promise<ProviderStatus>;
  generate(model: string, prompt: string, opts?: GenerateOptions): Promise<{ text: string; durationMs: number; tokens?: number }>;
}

/** Describes which engine produced a result. Shown to the user on every result. */
export interface EngineInfo {
  kind: 'ollama' | 'offline' | 'template';
  label: string;
  model?: string;
  notice?: string;
  durationMs?: number;
}
