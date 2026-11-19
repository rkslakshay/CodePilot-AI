/**
 * Optional third-party analysers. CodePilot never installs them; it only detects them and, when
 * present, runs those that are safe for untrusted code:
 *  - Ruff (`--isolated`: ignores project configuration) and Bandit only READ Python files.
 *  - Semgrep is detected but not run: its registry rule packs are downloaded from the internet,
 *    which this application must not do without consent.
 *  - ESLint is detected but not run: a project's eslint.config.js is JavaScript that would be
 *    executed, i.e. it would run code from the imported repository.
 */
import { execFile, spawnSync } from 'node:child_process';
import { RULE_BY_ID, type Finding, type Severity } from './rules.js';

export interface ToolInfo {
  id: 'ruff' | 'bandit' | 'semgrep' | 'eslint';
  name: string;
  available: boolean;
  version: string | null;
  runs: boolean;
  note: string;
  install: string;
}

const probe = (cmd: string, args: string[]) => {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (r.error || r.status !== 0) return null;
    return `${r.stdout}${r.stderr}`.trim().split('\n')[0].slice(0, 80);
  } catch {
    return null;
  }
};

let cache: ToolInfo[] | null = null;
export function detectTools(force = false): ToolInfo[] {
  if (cache && !force) return cache;
  const ruff = probe('ruff', ['--version']);
  const bandit = probe('bandit', ['--version']) ?? probe('python', ['-m', 'bandit', '--version']);
  const semgrep = probe('semgrep', ['--version']);
  const eslint = probe('eslint', ['--version']);
  cache = [
    { id: 'ruff', name: 'Ruff (Python linter)', available: !!ruff, version: ruff, runs: !!ruff, note: 'Runs with --isolated (project configuration ignored); reads files only.', install: 'pip install ruff' },
    { id: 'bandit', name: 'Bandit (Python security)', available: !!bandit, version: bandit, runs: !!bandit, note: 'Reads Python files only; never imports or runs them.', install: 'pip install bandit' },
    { id: 'semgrep', name: 'Semgrep Community Edition', available: !!semgrep, version: semgrep, runs: false, note: 'Detected only: its rule packs are downloaded from the internet, so CodePilot does not run it automatically.', install: 'pip install semgrep (check the current licence terms first)' },
    { id: 'eslint', name: 'ESLint', available: !!eslint, version: eslint, runs: false, note: 'Not run: a project ESLint config is JavaScript that would execute code from the imported repository.', install: 'npm install -g eslint' },
  ];
  return cache;
}

const run = (cmd: string, args: string[], cwd: string, signal?: AbortSignal) =>
  new Promise<string>((resolve) => {
    execFile(cmd, args, { cwd, timeout: 120_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, signal, env: { PATH: process.env.PATH ?? '', SYSTEMROOT: process.env.SYSTEMROOT ?? '' } }, (_e, stdout) => resolve(String(stdout ?? '')));
  });

const SEV: Record<string, Severity> = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

/** Converts Bandit JSON output into findings (exported for tests). */
export function parseBandit(json: string, root: string): Finding[] {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const r = RULE_BY_ID.get('SEC-001')!;
  return (data?.results ?? []).map((x: any) => ({
    path: relPath(String(x.filename ?? ''), root),
    line: Number(x.line_number) || null,
    col: Number(x.col_offset ?? -1) + 1 || null,
    endLine: Number(x.line_number) || null,
    severity: SEV[String(x.issue_severity).toUpperCase()] ?? 'low',
    category: 'security' as const,
    ruleId: `bandit:${x.test_id}`,
    title: `Bandit ${x.test_id}: ${x.test_name}`,
    description: String(x.issue_text ?? ''),
    why: String(x.more_info ? `See ${x.more_info}` : r.why),
    fix: 'Review the flagged code; see the Bandit documentation for this test.',
    confidence: (SEV[String(x.issue_confidence).toUpperCase()] ?? 'low') as 'high' | 'medium' | 'low',
    source: 'tool' as const,
    tool: 'bandit',
    snippet: '',
  }));
}

/** Converts Ruff JSON output into findings (exported for tests). */
export function parseRuff(json: string, root: string): Finding[] {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  return (Array.isArray(data) ? data : []).map((x: any) => {
    const code = String(x.code ?? 'ruff');
    const sec = code.startsWith('S');
    const bug = /^(F|E9|B|PLE)/.test(code);
    return {
      path: relPath(String(x.filename ?? ''), root),
      line: Number(x.location?.row) || null,
      col: Number(x.location?.column) || null,
      endLine: Number(x.end_location?.row) || null,
      severity: (sec ? 'medium' : bug ? 'medium' : 'low') as Severity,
      category: (sec ? 'security' : bug ? 'bug' : 'style') as Finding['category'],
      ruleId: `ruff:${code}`,
      title: `Ruff ${code}`,
      description: String(x.message ?? ''),
      why: x.url ? `See ${x.url}` : 'Reported by Ruff.',
      fix: x.fix?.message ? String(x.fix.message) : 'See the Ruff rule documentation.',
      confidence: 'high' as const,
      source: 'tool' as const,
      tool: 'ruff',
      snippet: '',
    };
  });
}
function relPath(p: string, root: string): string {
  const a = p.replace(/\\/g, '/');
  const r = root.replace(/\\/g, '/').replace(/\/$/, '');
  return (a.toLowerCase().startsWith(r.toLowerCase() + '/') ? a.slice(r.length + 1) : a).replace(/^\.\//, '');
}

/** Runs the installed, safe tools on Python files. Returns their findings (empty when none are installed). */
export async function runTools(root: string, pythonFiles: string[], signal?: AbortSignal): Promise<{ findings: Finding[]; ran: string[] }> {
  const tools = detectTools();
  const out: Finding[] = [];
  const ran: string[] = [];
  if (!pythonFiles.length) return { findings: out, ran };
  const files = pythonFiles.slice(0, 2000);
  if (tools.find((t) => t.id === 'ruff')?.runs) {
    out.push(...parseRuff(await run('ruff', ['check', '--isolated', '--output-format', 'json', '--exit-zero', '--select', 'E9,F,B,S', ...files], root, signal), root));
    ran.push('ruff');
  }
  if (tools.find((t) => t.id === 'bandit')?.runs) {
    out.push(...parseBandit(await run('bandit', ['-f', 'json', '-q', ...files], root, signal), root));
    ran.push('bandit');
  }
  return { findings: out, ran };
}
