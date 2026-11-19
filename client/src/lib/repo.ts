/** Types and helpers for the Repository Analyzer. */
import type { Engine } from './types';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Confidence = 'high' | 'medium' | 'low';
export type FindingSource = 'static' | 'tool' | 'ai' | 'combined';
export type FindingStatus = 'open' | 'reviewed' | 'dismissed' | 'fixed';

export interface Finding {
  id: number;
  path: string;
  line: number | null;
  col: number | null;
  endLine: number | null;
  severity: Severity;
  category: string;
  ruleId: string;
  title: string;
  description: string;
  why: string;
  fix: string;
  confidence: Confidence;
  source: FindingSource;
  tool: string;
  snippet: string;
  status: FindingStatus;
  userVerified: boolean;
  note: string;
  present: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Job {
  id: string;
  kind: 'analysis' | 'review';
  repoId: number;
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: { done: number; total: number; message: string };
  result: any;
  error: string | null;
}
export interface RepoSummary {
  id: number;
  name: string;
  source: 'folder' | 'zip';
  rootPath: string;
  managedCopy: boolean;
  status: 'ready' | 'analyzing' | 'analyzed' | 'error';
  fileCount: number;
  sourceFiles: number;
  linesOfCode: number;
  sizeBytes: number;
  isGit: boolean;
  analyzedAt: string | null;
  createdAt: string;
  updatedAt: string;
  profile: any;
  scanInfo: any;
  analysis: any;
  job: Job | null;
}
export interface RepoStats {
  totalFiles: number;
  sourceFiles: number;
  testFiles: number;
  docFiles: number;
  configFiles: number;
  binaryFiles: number;
  sensitiveFiles: number;
  skippedFiles: number;
  directories: number;
  linesOfCode: number;
  totalBytes: number;
  functions: number;
  classes: number;
  dependencies: number;
  devDependencies: number;
  todos: number;
  languages: { language: string; files: number; lines: number }[];
  fileKinds: { kind: string; count: number }[];
  findingsBySeverity: Record<Severity, number>;
  findingsByCategory: Record<string, number>;
  securityFindings: number;
  complexityDistribution: { label: string; count: number }[];
  quality: { score: number; grade: string; weighted: number; kloc: number; density: number; formula: string };
}
export interface TreeFile {
  path: string;
  language: string | null;
  kind: string;
  size: number;
  lines: number;
  binary: boolean;
  sensitive: boolean;
  skipped: string | null;
  functions: number;
  maxComplexity: number;
  findings: Partial<Record<Severity, number>>;
}
export interface FileReview {
  summary: string;
  quality: string[];
  bugs: ReviewItem[];
  performance: ReviewItem[];
  security: ReviewItem[];
  maintainability: ReviewItem[];
  recommendations: string[];
  improvements: { title: string; detail: string }[];
}
export interface ReviewItem {
  line: number;
  title: string;
  detail: string;
  severity: Severity;
}
export interface ReviewResult {
  engine: Engine;
  cached: boolean;
  aiAvailable: boolean;
  chunks: number;
  review: FileReview | null;
  staticFindings: Finding[];
  path: string;
  scope: string;
}

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
export const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
/** Colours are CSS variables so they work in dark and light themes. */
export const SEV_COLOR: Record<Severity, string> = { critical: 'var(--sev-critical)', high: 'var(--sev-high)', medium: 'var(--sev-medium)', low: 'var(--sev-low)', info: 'var(--sev-info)' };
export const SOURCE_LABEL: Record<FindingSource, string> = { static: 'Static analysis', tool: 'External tool', ai: 'Local AI review', combined: 'Static + AI' };
export const CATEGORY_LABEL: Record<string, string> = { bug: 'Bug', security: 'Security', complexity: 'Complexity', maintainability: 'Maintainability', performance: 'Performance', style: 'Style', dependency: 'Dependency', debt: 'Tech debt' };

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
export const fmtNum = (n: number) => n.toLocaleString();
/** Monaco language id for a repository file language. */
export const monacoId = (l: string | null) =>
  !l ? 'plaintext' : l === 'tsx' ? 'typescript' : l === 'dotenv' || l === 'text' || l === 'make' || l === 'cmake' ? 'plaintext' : l === 'scss' || l === 'less' ? l : l === 'batch' ? 'bat' : l === 'groovy' ? 'java' : l;
