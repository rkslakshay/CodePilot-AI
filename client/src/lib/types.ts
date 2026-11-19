export type Lang = 'c' | 'cpp' | 'java' | 'python' | 'javascript';

export interface Engine {
  kind: 'ollama' | 'offline' | 'template';
  label: string;
  model?: string;
  notice?: string;
}

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  accent: 'violet' | 'teal' | 'blue' | 'amber';
  defaultLanguage: Lang;
  editorFontSize: number;
  editorTheme: 'codepilot-dark' | 'vs-dark' | 'vs' | 'hc-black';
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
  aiProvider: 'offline' | 'ollama';
  ollamaUrl: string;
  ollamaModel: string;
  aiTemperature: number;
  aiTimeoutSec: number;
  aiMaxTokens: number;
  executionEnabled: boolean;
  executionTimeoutMs: number;
  explanationMode: 'beginner' | 'advanced';
  sidebarCollapsed: boolean;
}

export interface AiStatus {
  provider: string;
  reachable: boolean;
  version?: string;
  models: { name: string; size?: number; family?: string; parameterSize?: string; quantization?: string }[];
  error?: string;
  configured: boolean;
  selectedModel: string;
  modelInstalled: boolean;
  mode: 'offline' | 'ollama';
  url: string;
  installed: boolean;
  installPath: string | null;
  installedVersion: string | null;
}

export interface ModelDetails {
  name: string;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
  contextLength: number | null;
  capabilities: string[];
  sizeBytes: number | null;
  estimatedRamGb: number | null;
  systemRamGb: number;
  freeRamGb: number;
  fitsInMemory: boolean | null;
  advice: string;
}

export interface Issue {
  line: number | null;
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  suggestion: string;
}

export interface Diagnosis {
  line: number | null;
  severity: 'error' | 'warning';
  title: string;
  explanation: string;
  suggestion: string;
  raw: string;
}

export interface ExecResult {
  status: 'success' | 'compile_error' | 'runtime_error' | 'timeout' | 'blocked' | 'unavailable' | 'busy' | 'internal_error';
  language: Lang;
  stdout: string;
  stderr: string;
  compileOutput: string;
  exitCode: number | null;
  timeMs: number | null;
  compileTimeMs: number | null;
  truncated: boolean;
  violations?: { line: number; rule: string; text: string }[];
  message?: string;
  diagnostics?: Diagnosis[];
  warnings?: Diagnosis[];
  isolation?: IsolationLevel;
}

export type IsolationLevel = 'job+lowil' | 'job' | 'process';
export interface SandboxInfo {
  available: boolean;
  level: IsolationLevel;
  dataProtected: boolean;
  details: string[];
  limitations: string[];
}

export interface Runtime {
  language: Lang;
  label: string;
  available: boolean;
  version: string | null;
  tool: string;
  path?: string;
  installHint: string;
}

export interface Complexity {
  time: string;
  space: string;
  reasons: string[];
  confidence?: 'high' | 'medium' | 'low';
  pattern?: string | null;
}

export interface HistoryItem {
  id: number;
  kind: 'generation' | 'conversion' | 'explanation' | 'algorithm' | 'execution' | 'debug' | 'learning';
  title: string;
  language: Lang | null;
  targetLanguage: Lang | null;
  engine: 'ollama' | 'offline' | 'template' | 'local';
  status: string;
  isDemo: boolean;
  createdAt: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  language: Lang | 'mixed';
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  fileCount?: number;
  files?: CodeFile[];
}

export interface CodeFile {
  id: number;
  projectId: number;
  name: string;
  language: Lang;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  size: number;
  content?: string;
  projectName?: string;
}

export interface AlgorithmSummary {
  id: string;
  name: string;
  category: string;
  summary: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  complexity: { best: string; average: string; worst: string; space: string; note?: string };
  visual: string;
}

export interface AlgorithmEntry extends AlgorithmSummary {
  description: string;
  input: string;
  output: string;
  steps: string[];
  example: { input: string; output: string; explanation: string };
  keywords: string[];
  defaultInput: string;
  focus: string;
  expectedOutput: string;
  source: 'python' | 'handwritten';
  code: Record<Lang, string>;
  pseudocode: string;
  flowchart: string;
  generated: Lang[];
}

export interface TraceStep {
  message: string;
  vars: Record<string, string | number | boolean>;
  array?: (number | string)[];
  hl?: { compare?: number[]; swap?: number[]; sorted?: number[]; active?: number[]; found?: number[]; dim?: number[]; range?: [number, number]; pivot?: number };
  graph?: {
    nodes: { id: number; x: number; y: number }[];
    edges: { from: number; to: number; w?: number }[];
    state: Record<number, 'current' | 'visited' | 'queued' | 'done'>;
    dist?: Record<number, string>;
    activeEdge?: [number, number];
    container?: { label: string; items: number[] };
  };
  list?: { kind: 'stack' | 'queue' | 'linked'; items: (number | string)[]; highlight?: number; op?: string };
  tree?: { nodes: { id: number; key: number; x: number; y: number; parent: number | null }[]; highlight?: number; path?: number[]; found?: number };
  buckets?: { slots: number[][]; highlight?: number; hashOf?: string };
  hanoi?: { rods: number[][]; move?: [number, number] };
  callStack?: string[];
  map?: Record<string, number>;
  counters: { comparisons: number; swaps: number; iterations: number };
}
