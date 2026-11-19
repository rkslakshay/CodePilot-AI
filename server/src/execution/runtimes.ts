import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Lang } from '../engine/ir.js';

export interface RuntimeInfo {
  language: Lang;
  label: string;
  available: boolean;
  version: string | null;
  tool: string;
  compiler?: string;
  runtime?: string;
  runtimeArgs?: string[];
  path?: string;
  installHint: string;
}

const HINTS: Record<Lang, string> = {
  c: 'Install MinGW-w64 (free) — e.g. via MSYS2 (https://www.msys2.org) then `pacman -S mingw-w64-ucrt-x86_64-gcc` — and add its bin folder to PATH.',
  cpp: 'Install MinGW-w64 (free) — g++ ships together with gcc. Add its bin folder to PATH and restart CodePilot.',
  java: 'Install a free OpenJDK build (e.g. Eclipse Temurin from https://adoptium.net) and make sure `javac` is on PATH.',
  python: 'Install Python 3 from https://www.python.org (tick "Add python.exe to PATH" during setup).',
  javascript: 'Node.js is already required to run CodePilot, so JavaScript is always available.',
};

function probe(cmd: string, args: string[]): { ok: boolean; out: string; path?: string } {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000, windowsHide: true });
    if (r.error) return { ok: false, out: '' };
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    return { ok: r.status === 0, out };
  } catch {
    return { ok: false, out: '' };
  }
}

function where(cmd: string): string | undefined {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return undefined;
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
}

let cache: RuntimeInfo[] | null = null;

export function detectRuntimes(force = false): RuntimeInfo[] {
  if (cache && !force) return cache;
  const out: RuntimeInfo[] = [];

  const gcc = probe('gcc', ['--version']);
  const gccPath = gcc.ok ? where('gcc') : undefined;
  out.push({
    language: 'c', label: 'C', available: gcc.ok, version: gcc.ok ? gcc.out.split('\n')[0] : null, tool: 'gcc',
    compiler: gccPath ?? 'gcc', path: gccPath, installHint: HINTS.c,
  });
  const gpp = probe('g++', ['--version']);
  const gppPath = gpp.ok ? where('g++') : undefined;
  out.push({
    language: 'cpp', label: 'C++', available: gpp.ok, version: gpp.ok ? gpp.out.split('\n')[0] : null, tool: 'g++',
    compiler: gppPath ?? 'g++', path: gppPath, installHint: HINTS.cpp,
  });
  const javac = probe('javac', ['-version']);
  const java = probe('java', ['-version']);
  const javacPath = javac.ok ? where('javac') : undefined;
  let javaPath = java.ok ? where('java') : undefined;
  // Oracle's javapath\java.exe is a launcher stub that starts a second process; use the real JVM binary
  if (java.ok) {
    const props = spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    const home = `${props.stdout ?? ''}${props.stderr ?? ''}`.match(/java\.home = (.+)/)?.[1]?.trim();
    const real = home ? join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : null;
    if (real && existsSync(real)) javaPath = real;
  }
  out.push({
    language: 'java', label: 'Java', available: javac.ok && java.ok, version: javac.ok ? javac.out.split('\n')[0] : null, tool: 'javac + java',
    compiler: javacPath ?? 'javac', runtime: javaPath ?? 'java', path: javacPath, installHint: HINTS.java,
  });
  // On Windows `python` may be the Microsoft Store alias stub; verify it really runs.
  let py = probe('python', ['--version']);
  let pyCmd = 'python';
  let pyArgs: string[] = [];
  if (!py.ok || !/Python 3/.test(py.out)) {
    const alt = probe('py', ['-3', '--version']);
    if (alt.ok && /Python 3/.test(alt.out)) {
      py = alt;
      pyCmd = 'py';
      pyArgs = ['-3'];
    } else {
      const p3 = probe('python3', ['--version']);
      if (p3.ok && /Python 3/.test(p3.out)) {
        py = p3;
        pyCmd = 'python3';
      }
    }
  }
  const pyOk = py.ok && /Python 3/.test(py.out);
  let pyExe: string | undefined;
  if (pyOk) {
    const r = spawnSync(pyCmd, [...pyArgs, '-c', 'import sys;print(sys.executable)'], { encoding: 'utf8', windowsHide: true });
    pyExe = r.stdout?.trim() || undefined;
  }
  out.push({
    language: 'python', label: 'Python', available: pyOk, version: pyOk ? py.out.split('\n')[0] : null, tool: 'python',
    runtime: pyExe ?? pyCmd, runtimeArgs: pyExe ? [] : pyArgs, path: pyExe, installHint: HINTS.python,
  });
  out.push({
    language: 'javascript', label: 'JavaScript', available: true, version: `Node.js ${process.version}`, tool: 'node',
    runtime: process.execPath, path: process.execPath, installHint: HINTS.javascript,
  });
  cache = out;
  return out;
}

/** PATH used for child processes: only the directories of the detected toolchains + system dirs. */
export function runnerPath(): string {
  const dirs = new Set<string>();
  for (const r of detectRuntimes()) {
    for (const p of [r.compiler, r.runtime, r.path]) if (p && /[\\/]/.test(p)) dirs.add(dirname(p));
  }
  const sysRoot = process.env.SYSTEMROOT || 'C:\\Windows';
  if (process.platform === 'win32') {
    dirs.add(`${sysRoot}\\System32`);
    dirs.add(sysRoot);
  } else {
    ['/usr/bin', '/bin', '/usr/local/bin'].forEach((d) => dirs.add(d));
  }
  return [...dirs].join(process.platform === 'win32' ? ';' : ':');
}
