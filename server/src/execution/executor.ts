import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Lang } from '../engine/ir.js';
import { detectRuntimes, runnerPath } from './runtimes.js';
import { scanCode, type GuardViolation } from './guard.js';
import { sandboxStatus, type IsolationLevel } from './sandbox.js';

const RUNNER = join(dirname(fileURLToPath(import.meta.url)), 'runner-process.mjs');
const MAX_CONCURRENT = 2;
let active = 0;

export interface StepResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  timeMs: number;
  spawnError?: boolean;
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
  violations?: GuardViolation[];
  message?: string;
  isolation?: IsolationLevel;
}

export interface ExecOptions {
  timeoutMs?: number;
  maxOutput?: number;
}

export function javaClassName(code: string): string {
  const m = code.match(/public\s+(?:final\s+)?class\s+([A-Za-z_]\w*)/) ?? code.match(/class\s+([A-Za-z_]\w*)[^{]*\{[\s\S]*?public\s+static\s+void\s+main/);
  return m?.[1] ?? 'Main';
}

export async function executeCode(language: Lang, code: string, stdin = '', opts: ExecOptions = {}): Promise<ExecResult> {
  const base: ExecResult = { status: 'internal_error', language, stdout: '', stderr: '', compileOutput: '', exitCode: null, timeMs: null, compileTimeMs: null, truncated: false };
  const rt = detectRuntimes().find((r) => r.language === language);
  if (!rt || !rt.available) return { ...base, status: 'unavailable', message: `${rt?.label ?? language} runtime is not installed. ${rt?.installHint ?? ''}` };
  const violations = scanCode(code, language);
  if (violations.length) return { ...base, status: 'blocked', violations, message: 'The execution guard blocked this program because it uses restricted operations.' };
  if (active >= MAX_CONCURRENT) return { ...base, status: 'busy', message: 'Too many programs are running. Please wait for them to finish.' };
  active++;
  try {
    const job = {
      language,
      code,
      stdin,
      timeoutMs: Math.min(Math.max(opts.timeoutMs ?? 5000, 500), 20000),
      compileTimeoutMs: 30000,
      maxOutput: Math.min(opts.maxOutput ?? 65536, 1 << 20),
      className: language === 'java' ? javaClassName(code) : undefined,
      path: runnerPath(),
      sandbox: sandboxStatus().available ? sandboxStatus().path : null,
      tools: { compiler: rt.compiler, runtime: rt.runtime, runtimeArgs: rt.runtimeArgs, linker: language === 'c' && process.platform === 'win32' ? detectRuntimes().find((r) => r.language === 'cpp' && r.available)?.compiler : undefined },
    };
    const raw = await spawnRunner(JSON.stringify(job), job.timeoutMs + job.compileTimeoutMs + 10000);
    let parsed: { phase: string; compile: StepResult | null; run: StepResult | null; error?: string; isolation?: IsolationLevel };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...base, message: 'The runner process returned an invalid response.' };
    }
    if (parsed.error) return { ...base, message: parsed.error };
    const compileOutput = parsed.compile ? `${parsed.compile.stdout}${parsed.compile.stderr}`.trim() : '';
    const compileTimeMs = parsed.compile?.timeMs ?? null;
    if (parsed.phase === 'compile' && parsed.compile) {
      return {
        ...base,
        status: parsed.compile.timedOut ? 'timeout' : 'compile_error',
        compileOutput,
        compileTimeMs,
        exitCode: parsed.compile.exitCode,
        message: parsed.compile.timedOut ? 'Compilation timed out.' : 'Compilation failed.',
      };
    }
    const r = parsed.run!;
    let status: ExecResult['status'] = 'success';
    if (r.timedOut) status = 'timeout';
    else if (r.spawnError) status = 'internal_error';
    else if (r.exitCode !== 0) status = 'runtime_error';
    return {
      ...base,
      isolation: parsed.isolation ?? 'process',
      status,
      stdout: r.stdout,
      stderr: r.stderr,
      compileOutput,
      exitCode: r.exitCode,
      timeMs: r.timeMs,
      compileTimeMs,
      truncated: r.truncated,
      message: r.timedOut
        ? `Execution exceeded the ${job.timeoutMs} ms time limit and was stopped.`
        : r.truncated
          ? 'Output limit reached; the program was stopped.'
          : r.spawnError
            ? 'Could not start the program.'
            : undefined,
    };
  } finally {
    active--;
  }
}

function spawnRunner(payload: string, hardTimeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    // The runner gets an empty-ish environment: no app configuration or secrets are inherited.
    const child = spawn(process.execPath, [RUNNER], {
      env: { SYSTEMROOT: process.env.SYSTEMROOT ?? '', PATH: runnerPath(), TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), hardTimeoutMs);
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.stdin.end(payload);
  });
}
