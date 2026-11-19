/**
 * Windows execution sandbox (see sandbox/cpsandbox.cs). Built on first use with the .NET Framework
 * C# compiler that is part of Windows — nothing is downloaded. Provides OS-enforced limits:
 * Job Object (memory, CPU time, one active process, kill-on-close, UI restrictions) and a
 * Low-integrity token (no writes to user files; no reads of folders protected with "no read-up").
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { log } from '../utils/logger.js';

export type IsolationLevel = 'job+lowil' | 'job' | 'process';
export interface SandboxStatus {
  available: boolean;
  level: IsolationLevel;
  path: string | null;
  dataProtected: boolean;
  details: string[];
  limitations: string[];
}

const SRC = join(dirname(fileURLToPath(import.meta.url)), 'sandbox', 'cpsandbox.cs');
let status: SandboxStatus | null = null;

function cscPath(): string | null {
  const root = process.env.SYSTEMROOT || 'C:\\Windows';
  for (const p of [join(root, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), join(root, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')]) if (existsSync(p)) return p;
  return null;
}

const LIMITATIONS = [
  'Network access is not blocked at the operating-system level (that needs administrator firewall rules); the static guard and the Python/Node runtime restrictions block common network APIs.',
  'Low-integrity programs can still read ordinary files that you can read, except folders CodePilot protects (its database and backups).',
];

export function sandboxStatus(force = false): SandboxStatus {
  if (status && !force) return status;
  const base: SandboxStatus = { available: false, level: 'process', path: null, dataProtected: false, details: [], limitations: [] };
  if (process.platform !== 'win32') {
    status = { ...base, details: ['Windows sandbox not available on this platform; programs run in a separate guarded process.'], limitations: ['No OS-level isolation on this platform.'] };
    return status;
  }
  try {
    const binDir = join(dirname(config.dbPath === ':memory:' ? join(config.serverRoot, 'data', 'x') : config.dbPath), 'bin');
    mkdirSync(binDir, { recursive: true });
    const exe = join(binDir, 'cpsandbox.exe');
    const stamp = join(binDir, 'cpsandbox.sha256');
    const hash = createHash('sha256').update(readFileSync(SRC)).digest('hex');
    if (!existsSync(exe) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== hash) {
      const csc = cscPath();
      if (!csc) {
        status = { ...base, details: ['The .NET Framework C# compiler (csc.exe) was not found, so the sandbox could not be built.'], limitations: ['Programs run in a separate guarded process without OS-level isolation.'] };
        return status;
      }
      const r = spawnSync(csc, ['-nologo', '-optimize', `-out:${exe}`, SRC], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
      if (r.status !== 0) throw new Error(`csc failed: ${(r.stdout + r.stderr).slice(0, 300)}`);
      writeFileSync(stamp, hash);
    }
    const st = spawnSync(exe, ['selftest'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (st.status !== 0) throw new Error(`self-test failed: ${(st.stdout + st.stderr).trim()}`);
    // protect CodePilot's own data folder (database, backups) against reads/writes from sandboxed programs
    let dataProtected = false;
    if (config.dbPath !== ':memory:') {
      const dataDir = dirname(config.dbPath);
      const pr = spawnSync(exe, ['protect', dataDir], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      dataProtected = pr.status === 0;
      if (existsSync(config.backupDir) && !config.backupDir.startsWith(dataDir)) spawnSync(exe, ['protect', config.backupDir], { windowsHide: true, timeout: 10000 });
    }
    status = {
      available: true,
      level: 'job+lowil',
      path: exe,
      dataProtected,
      details: [
        'Windows Job Object: memory limit, CPU-time limit, at most one process (child processes cannot be started), all processes killed when the run ends, no clipboard / desktop / system-settings access.',
        'Low integrity level: the program cannot write to your files, settings or CodePilot data.',
        dataProtected ? 'CodePilot data folder is labelled no-read-up: sandboxed programs cannot read the database or backups.' : 'Could not protect the data folder against reads.',
        `Built locally from ${statSync(SRC).size} bytes of C# source with the Windows .NET Framework compiler.`,
      ],
      limitations: LIMITATIONS,
    };
  } catch (e) {
    log.warn('sandbox unavailable:', (e as Error).message);
    status = { ...base, details: [`Sandbox unavailable: ${(e as Error).message}`], limitations: ['Programs run in a separate guarded process without OS-level isolation.'] };
  }
  return status;
}
