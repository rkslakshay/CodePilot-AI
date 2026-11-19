/**
 * Repository-level metrics, the quality score and the technical-debt report — all computed from
 * the stored analysis results. Nothing here is estimated or invented.
 */
import { SEVERITY_WEIGHT, type Severity } from './rules.js';

export interface FileRow {
  path: string;
  language: string | null;
  kind: string;
  size: number;
  lines: number;
  binary: boolean;
  sensitive: boolean;
  skipped: string | null;
  metrics: {
    parsed?: boolean;
    functions?: { name: string; line: number; endLine: number; length: number; params: number; complexity: number; nesting: number }[];
    classes?: number;
    maxComplexity?: number;
    maxNesting?: number;
    todos?: number;
  };
}
export interface FindingRow {
  id: number;
  path: string;
  line: number | null;
  severity: Severity;
  category: string;
  ruleId: string;
  title: string;
  description: string;
  confidence: string;
  source: string;
  status: string;
  present: boolean;
}

/**
 * Quality score (documented in ARCHITECTURE.md):
 *   weighted = Σ weight(severity) over open + reviewed findings that are still present
 *              (critical 10, high 5, medium 2, low 0.5, info 0; dismissed / fixed excluded)
 *   density  = weighted / max(1, KLOC)            KLOC = (source + test lines) / 1000
 *   score    = round(100 / (1 + density / 10))    → 100 with no findings, 50 at density 10
 */
export function qualityScore(findings: FindingRow[], loc: number) {
  const active = findings.filter((f) => f.present && (f.status === 'open' || f.status === 'reviewed'));
  const weighted = active.reduce((a, f) => a + SEVERITY_WEIGHT[f.severity], 0);
  const kloc = Math.max(1, loc / 1000);
  const density = weighted / kloc;
  const score = Math.round(100 / (1 + density / 10));
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'E';
  return { score, grade, weighted: Math.round(weighted * 10) / 10, kloc: Math.round(kloc * 100) / 100, density: Math.round(density * 100) / 100, formula: 'score = round(100 / (1 + (Σ severity weight per KLOC) / 10)); weights critical 10, high 5, medium 2, low 0.5, info 0' };
}

export const CC_BUCKETS = [
  { label: '1–5 (simple)', min: 1, max: 5 },
  { label: '6–10 (moderate)', min: 6, max: 10 },
  { label: '11–20 (complex)', min: 11, max: 20 },
  { label: '21–50 (very complex)', min: 21, max: 50 },
  { label: '> 50 (untestable)', min: 51, max: Infinity },
];

export function repoStats(files: FileRow[], findings: FindingRow[], dirs: number, deps: { direct: boolean; dev: boolean }[]) {
  const code = files.filter((f) => f.kind === 'source' || f.kind === 'test');
  const loc = code.reduce((a, f) => a + f.lines, 0);
  const fns = files.flatMap((f) => (f.metrics.functions ?? []).map((fn) => ({ ...fn, path: f.path })));
  const languages = new Map<string, { files: number; lines: number }>();
  for (const f of files) {
    if (!f.language || f.binary) continue;
    const l = languages.get(f.language) ?? { files: 0, lines: 0 };
    l.files++;
    l.lines += f.lines;
    languages.set(f.language, l);
  }
  const kinds = new Map<string, number>();
  for (const f of files) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
  const visible = findings.filter((f) => f.present && f.status !== 'dismissed' && f.status !== 'fixed');
  const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const byCategory: Record<string, number> = {};
  for (const f of visible) {
    bySeverity[f.severity]++;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
  }
  return {
    totalFiles: files.length,
    sourceFiles: files.filter((f) => f.kind === 'source').length,
    testFiles: files.filter((f) => f.kind === 'test').length,
    docFiles: files.filter((f) => f.kind === 'doc').length,
    configFiles: files.filter((f) => f.kind === 'config').length,
    binaryFiles: files.filter((f) => f.binary).length,
    sensitiveFiles: files.filter((f) => f.sensitive).length,
    skippedFiles: files.filter((f) => f.skipped && !f.binary && !f.sensitive).length,
    directories: dirs,
    linesOfCode: loc,
    totalBytes: files.reduce((a, f) => a + f.size, 0),
    functions: fns.length,
    classes: files.reduce((a, f) => a + (f.metrics.classes ?? 0), 0),
    dependencies: deps.filter((d) => d.direct).length,
    devDependencies: deps.filter((d) => d.direct && d.dev).length,
    todos: files.reduce((a, f) => a + (f.metrics.todos ?? 0), 0),
    languages: [...languages.entries()].map(([language, v]) => ({ language, ...v })).sort((a, b) => b.lines - a.lines),
    fileKinds: [...kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
    findingsBySeverity: bySeverity,
    findingsByCategory: byCategory,
    securityFindings: visible.filter((f) => f.category === 'security').length,
    complexityDistribution: CC_BUCKETS.map((b) => ({ label: b.label, count: fns.filter((f) => f.complexity >= b.min && f.complexity <= b.max).length })),
    quality: qualityScore(findings, loc),
  };
}

export function complexityReport(files: FileRow[], findings: FindingRow[]) {
  const fns = files.flatMap((f) => (f.metrics.functions ?? []).map((fn) => ({ ...fn, path: f.path })));
  const visible = findings.filter((f) => f.present && f.status !== 'dismissed' && f.status !== 'fixed');
  const perFile = new Map<string, number>();
  for (const f of visible) perFile.set(f.path, (perFile.get(f.path) ?? 0) + 1);
  const fileRows = files
    .filter((f) => f.metrics.functions?.length)
    .map((f) => {
      const cs = f.metrics.functions!.map((x) => x.complexity);
      return { path: f.path, lines: f.lines, functions: cs.length, totalComplexity: cs.reduce((a, b) => a + b, 0), maxComplexity: Math.max(...cs), maxNesting: f.metrics.maxNesting ?? 0, findings: perFile.get(f.path) ?? 0 };
    });
  const maintainability = fileRows
    .map((r) => {
      const reasons: string[] = [];
      if (r.lines > 800) reasons.push(`${r.lines} lines`);
      if (r.maxComplexity > 15) reasons.push(`a function with complexity ${r.maxComplexity}`);
      if (r.maxNesting > 4) reasons.push(`nesting depth ${r.maxNesting}`);
      if (r.functions > 40) reasons.push(`${r.functions} functions`);
      if (r.findings >= 10) reasons.push(`${r.findings} findings`);
      return { ...r, reasons };
    })
    .filter((r) => r.reasons.length)
    .sort((a, b) => b.reasons.length - a.reasons.length || b.totalComplexity - a.totalComplexity);
  const cc = fns.map((f) => f.complexity).sort((a, b) => a - b);
  return {
    functions: fns.length,
    averageComplexity: cc.length ? Math.round((cc.reduce((a, b) => a + b, 0) / cc.length) * 10) / 10 : 0,
    medianComplexity: cc.length ? cc[Math.floor(cc.length / 2)] : 0,
    distribution: CC_BUCKETS.map((b) => ({ label: b.label, count: fns.filter((f) => f.complexity >= b.min && f.complexity <= b.max).length })),
    mostComplexFunctions: [...fns].sort((a, b) => b.complexity - a.complexity || b.length - a.length).slice(0, 25),
    longestFunctions: [...fns].sort((a, b) => b.length - a.length).slice(0, 15),
    mostComplexFiles: [...fileRows].sort((a, b) => b.totalComplexity - a.totalComplexity).slice(0, 15),
    filesWithMostFindings: [...perFile.entries()].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    maintainabilityConcerns: maintainability.slice(0, 20),
    method: 'Cyclomatic complexity = 1 + number of decision points (if / elif / loops / case / catch / ternary / && / || / ??) per function, measured on the Tree-sitter syntax tree. Nested functions are measured separately.',
  };
}

export interface DebtItem {
  id: string;
  title: string;
  impact: 'high' | 'medium' | 'low';
  priority: number;
  summary: string;
  recommendation: string;
  evidence: { path: string; line: number | null; detail: string }[];
}

/** Technical-debt overview. Priority = impact weight (3 / 2 / 1) × log2(1 + number of occurrences). No time estimates. */
export function technicalDebt(files: FileRow[], findings: FindingRow[], deps: { direct: boolean; dev: boolean; name: string }[], profile: { docs: string[] }): DebtItem[] {
  const items: DebtItem[] = [];
  const visible = findings.filter((f) => f.present && f.status !== 'dismissed' && f.status !== 'fixed');
  const byRule = (...ids: string[]) => visible.filter((f) => ids.includes(f.ruleId));
  const ev = (fs: FindingRow[], n = 12) => fs.slice(0, n).map((f) => ({ path: f.path, line: f.line, detail: f.description }));
  const push = (it: Omit<DebtItem, 'priority'> & { count: number }) => {
    if (!it.count) return;
    const w = it.impact === 'high' ? 3 : it.impact === 'medium' ? 2 : 1;
    const { count: _c, ...rest } = it;
    items.push({ ...rest, priority: Math.round(w * Math.log2(1 + it.count) * 100) / 100 });
  };
  const complex = byRule('CP-CPX-001');
  push({ id: 'complex-functions', title: 'Complex functions', impact: complex.some((f) => f.severity === 'high') ? 'high' : 'medium', count: complex.length, summary: `${complex.length} function(s) have a cyclomatic complexity above 15.`, recommendation: 'Refactor the most complex functions first: extract helpers, replace nested conditionals with guard clauses or lookup tables, and add tests before changing them.', evidence: ev(complex) });
  const nest = byRule('CP-CPX-002');
  push({ id: 'deep-nesting', title: 'Excessive nesting', impact: 'medium', count: nest.length, summary: `${nest.length} function(s) nest blocks more than 4 levels deep.`, recommendation: 'Use early returns and extract inner loops / conditions into named functions.', evidence: ev(nest) });
  const dups = byRule('CP-DUP-001');
  push({ id: 'duplication', title: 'Repeated code', impact: dups.length > 5 ? 'high' : 'medium', count: dups.length, summary: `${dups.length} duplicated block(s) of 8+ identical lines.`, recommendation: 'Extract each duplicated block into one shared function or module so fixes only need to be made once.', evidence: ev(dups) });
  const large = files.filter((f) => f.kind === 'source' && f.lines > 800).sort((a, b) => b.lines - a.lines);
  push({ id: 'large-files', title: 'Large files', impact: large.some((f) => f.lines > 1500) ? 'medium' : 'low', count: large.length, summary: `${large.length} source file(s) exceed 800 lines.`, recommendation: 'Split large files by responsibility (e.g. data access, business rules, presentation).', evidence: large.slice(0, 12).map((f) => ({ path: f.path, line: null, detail: `${f.lines} lines, ${f.metrics.functions?.length ?? 0} functions` })) });
  const god = files.filter((f) => (f.metrics.functions?.length ?? 0) > 40 || ((f.metrics.functions?.length ?? 0) > 25 && f.lines > 600));
  push({ id: 'separation-of-concerns', title: 'Possible poor separation of concerns', impact: 'medium', count: god.length, summary: `${god.length} file(s) define very many functions, which often means several responsibilities are mixed.`, recommendation: 'Group related functions into separate modules with a clear purpose.', evidence: god.slice(0, 12).map((f) => ({ path: f.path, line: null, detail: `${f.metrics.functions!.length} functions in ${f.lines} lines` })) });
  const src = files.filter((f) => f.kind === 'source' && f.metrics.functions?.length);
  const tests = files.filter((f) => f.kind === 'test');
  if (src.length && !tests.length) push({ id: 'missing-tests', title: 'No automated tests', impact: 'high', count: src.length, summary: `${src.length} source file(s) with functions and no test files were found.`, recommendation: 'Add a test framework and start with tests for the most complex and most-changed functions.', evidence: src.sort((a, b) => (b.metrics.maxComplexity ?? 0) - (a.metrics.maxComplexity ?? 0)).slice(0, 8).map((f) => ({ path: f.path, line: null, detail: `max complexity ${f.metrics.maxComplexity}` })) });
  else if (src.length) {
    const testText = tests.map((t) => t.path.toLowerCase()).join(' ');
    const untested = src.filter((f) => (f.metrics.maxComplexity ?? 0) > 10 && !testText.includes((f.path.split('/').pop() ?? '').replace(/\.[^.]+$/, '').toLowerCase()));
    push({ id: 'missing-tests', title: 'Complex files without a matching test file', impact: 'medium', count: untested.length, summary: `${tests.length} test file(s) for ${src.length} source file(s); ${untested.length} complex file(s) have no test file with a matching name (a heuristic — tests may live elsewhere).`, recommendation: 'Add tests for complex modules before refactoring them.', evidence: untested.slice(0, 10).map((f) => ({ path: f.path, line: null, detail: `max complexity ${f.metrics.maxComplexity}` })) });
  }
  const readme = profile.docs.find((d) => /^readme(\.|$)/i.test(d.split('/').pop() ?? '') && !d.includes('/'));
  const readmeFile = readme ? files.find((f) => f.path === readme) : undefined;
  if (!readme) push({ id: 'missing-docs', title: 'Missing documentation', impact: 'medium', count: 1, summary: 'There is no README at the repository root.', recommendation: 'Add a README describing purpose, setup, how to run tests and the project structure.', evidence: [{ path: '.', line: null, detail: 'no README.* at the root' }] });
  else if (readmeFile && readmeFile.lines < 15) push({ id: 'missing-docs', title: 'Minimal documentation', impact: 'low', count: 1, summary: `The README has only ${readmeFile.lines} lines.`, recommendation: 'Document setup, usage, tests and architecture.', evidence: [{ path: readme, line: null, detail: `${readmeFile.lines} lines` }] });
  const prod = deps.filter((d) => d.direct && !d.dev);
  if (prod.length > 40) push({ id: 'dependencies', title: 'Many dependencies', impact: 'medium', count: prod.length - 40, summary: `${prod.length} direct production dependencies.`, recommendation: 'Review whether each dependency is still needed; every package adds maintenance and supply-chain risk.', evidence: prod.slice(0, 12).map((d) => ({ path: 'manifest', line: null, detail: d.name })) });
  const unusedDeps = byRule('DEP-005');
  push({ id: 'unused-dependencies', title: 'Possibly unused dependencies', impact: 'low', count: unusedDeps.length, summary: `${unusedDeps.length} declared package(s) were not found in any import (low confidence).`, recommendation: 'Confirm and remove unused packages.', evidence: ev(unusedDeps) });
  const todo = byRule('CP-DEBT-001');
  push({ id: 'todo-markers', title: 'TODO / FIXME markers', impact: 'low', count: todo.length, summary: `${todo.length} TODO / FIXME / HACK comment(s).`, recommendation: 'Resolve them or track them as issues.', evidence: ev(todo) });
  const smells = byRule('CP-CPX-003', 'CP-CPX-005', 'CP-BUG-009', 'CP-BUG-010');
  push({ id: 'maintainability', title: 'Maintainability problems', impact: 'low', count: smells.length, summary: `${smells.length} long functions, long parameter lists, unused variables or unused functions.`, recommendation: 'Clean these up opportunistically when touching the affected files.', evidence: ev(smells) });
  return items.sort((a, b) => b.priority - a.priority);
}
