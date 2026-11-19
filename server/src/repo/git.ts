/**
 * Read-only local Git integration.
 *
 * Only these sub-commands are ever run: rev-parse, symbolic-ref, log, status, diff, show (numstat /
 * name-status / patch). Nothing commits, checks out, resets, fetches or pushes.
 *
 * A repository's own configuration can make Git execute programs (core.fsmonitor, filter.*.clean /
 * smudge / process, diff.external, diff.*.textconv, core.pager, core.sshCommand …). Imported
 * repositories are untrusted, so every call:
 *  - passes `-c` overrides that disable fsmonitor, the pager, external diff and every filter driver
 *    and diff driver named in the repository's config,
 *  - uses --no-ext-diff / --no-textconv for diffs,
 *  - ignores the system and global config (GIT_CONFIG_NOSYSTEM, GIT_CONFIG_GLOBAL),
 *  - runs with a stripped environment, no shell, a timeout and an output cap.
 */
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface GitInfo {
  available: boolean;
  version: string | null;
}
let gitInfo: GitInfo | null = null;
let gitCmd = 'git';
export function detectGit(force = false, cmd?: string): GitInfo {
  if (gitInfo && !force && (cmd === undefined || cmd === gitCmd)) return gitInfo;
  if (cmd !== undefined) gitCmd = cmd;
  cmd = gitCmd;
  try {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
    gitInfo = r.status === 0 ? { available: true, version: r.stdout.trim() } : { available: false, version: null };
  } catch {
    gitInfo = { available: false, version: null };
  }
  return gitInfo;
}

/** Collects `-c key=` overrides that neutralise every program-executing setting found in .git/config. */
export function safetyOverrides(root: string): string[] {
  const out = [
    'core.fsmonitor=false',
    'core.untrackedCache=false',
    'core.pager=cat',
    'core.sshCommand=',
    'core.hooksPath=' + join(tmpdir(), 'codepilot-no-hooks'),
    'diff.external=',
    'credential.helper=',
    'protocol.allow=never',
    'gc.auto=0',
    'maintenance.auto=false',
    'safe.directory=*',
  ];
  let config = '';
  try {
    const gitPath = join(root, '.git');
    // a `.git` file (worktree / submodule) points elsewhere; read the real config if it is a folder
    if (statSync(gitPath).isDirectory()) config = readFileSync(join(gitPath, 'config'), 'utf8');
  } catch {
    /* no readable config */
  }
  for (const m of config.matchAll(/^\s*\[\s*(filter|diff|merge)\s+"([^"]+)"\s*\]/gim)) {
    const kind = m[1].toLowerCase();
    const name = m[2];
    if (kind === 'filter') out.push(`filter.${name}.clean=`, `filter.${name}.smudge=`, `filter.${name}.process=`, `filter.${name}.required=false`);
    if (kind === 'diff') out.push(`diff.${name}.textconv=`, `diff.${name}.command=`);
    if (kind === 'merge') out.push(`merge.${name}.driver=`);
  }
  return out.flatMap((c) => ['-c', c]);
}

const ALLOWED = new Set(['rev-parse', 'symbolic-ref', 'log', 'status', 'diff', 'show', 'rev-list']);

export class GitError extends Error {
  constructor(message: string, public code: 'not_installed' | 'not_a_repo' | 'failed' | 'dubious_ownership' | 'empty') {
    super(message);
  }
}

export function git(root: string, args: string[], maxBuffer = 8 * 1024 * 1024): Promise<string> {
  if (!ALLOWED.has(args[0])) return Promise.reject(new GitError(`Git sub-command not allowed: ${args[0]}`, 'failed'));
  if (!detectGit().available) return Promise.reject(new GitError('Git is not installed or not on PATH.', 'not_installed'));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    HOME: tmpdir(),
    USERPROFILE: tmpdir(),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    GIT_OPTIONAL_LOCKS: '0',
    LC_ALL: 'C',
  };
  return new Promise((resolve, reject) => {
    execFile(gitCmd, [...safetyOverrides(root), '--no-pager', ...args], { cwd: root, env, timeout: 20_000, maxBuffer, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        const msg = String(stderr || err.message);
        if (/not a git repository/i.test(msg)) return reject(new GitError('This folder is not a Git repository.', 'not_a_repo'));
        if (/dubious ownership/i.test(msg)) return reject(new GitError('Git refused this repository because it is owned by another user.', 'dubious_ownership'));
        if (/does not have any commits|bad default revision|unknown revision|ambiguous argument 'HEAD'/i.test(msg)) return reject(new GitError('The repository has no commits yet.', 'empty'));
        return reject(new GitError(msg.trim().split('\n')[0].slice(0, 300), 'failed'));
      }
      resolve(stdout);
    });
  });
}

export interface ChangedFile {
  path: string;
  oldPath: string | null;
  staged: string | null; // M A D R C T or null
  unstaged: string | null;
  untracked: boolean;
  added: number | null;
  deleted: number | null;
  binary: boolean;
}

function parseNumstat(text: string): Map<string, { added: number | null; deleted: number | null; binary: boolean }> {
  const m = new Map<string, { added: number | null; deleted: number | null; binary: boolean }>();
  for (const line of text.split('\n')) {
    const p = line.split('\t');
    if (p.length < 3) continue;
    const path = p.slice(2).join('\t').replace(/^.*\{(.*) => (.*)\}.*$/, (_s, _a, b) => b).replace(/^.* => /, '');
    const bin = p[0] === '-';
    const prev = m.get(path);
    const a = bin ? null : Number(p[0]);
    const d = bin ? null : Number(p[1]);
    m.set(path, { added: prev && prev.added !== null && a !== null ? prev.added + a : a, deleted: prev && prev.deleted !== null && d !== null ? prev.deleted + d : d, binary: bin || !!prev?.binary });
  }
  return m;
}

export async function gitOverview(root: string) {
  const info = detectGit();
  if (!info.available) return { available: false as const, reason: 'Git is not installed or not on PATH. Install Git for Windows (free) to use this section.', git: info };
  if (!existsSync(join(root, '.git'))) return { available: false as const, reason: 'This repository is not a Git repository (no .git folder). ZIP imports never include Git history.', git: info };
  let branch = '';
  try {
    branch = (await git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])).trim();
  } catch {
    branch = '';
  }
  let head: string | null = null;
  let commits: { hash: string; short: string; author: string; date: string; subject: string; files: number; added: number; deleted: number }[] = [];
  let empty = false;
  try {
    head = (await git(root, ['rev-parse', 'HEAD'])).trim();
    const log = await git(root, ['log', '-n', '25', '--no-color', '--date=iso-strict', '--numstat', '--format=%x1e%H%x1f%h%x1f%an%x1f%ad%x1f%s']);
    commits = log
      .split('\x1e')
      .filter((c) => c.trim())
      .map((c) => {
        const [header, ...rest] = c.split('\n');
        const [hash, short, author, date, subject] = header.split('\x1f');
        const ns = parseNumstat(rest.join('\n'));
        let added = 0;
        let deleted = 0;
        for (const v of ns.values()) {
          added += v.added ?? 0;
          deleted += v.deleted ?? 0;
        }
        return { hash, short, author, date, subject, files: ns.size, added, deleted };
      });
  } catch (e) {
    if (e instanceof GitError && e.code === 'empty') empty = true;
    else throw e;
  }
  const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--no-renames']);
  const changes = new Map<string, ChangedFile>();
  const entries = status.split('\0').filter(Boolean);
  for (const e of entries) {
    const x = e[0];
    const y = e[1];
    const path = e.slice(3);
    changes.set(path, { path, oldPath: null, staged: x === '?' || x === ' ' ? null : x, unstaged: y === '?' || y === ' ' ? null : y, untracked: x === '?', added: null, deleted: null, binary: false });
  }
  if (!empty) {
    const staged = parseNumstat(await git(root, ['diff', '--cached', '--numstat', '--no-ext-diff', '--no-textconv', '--no-renames']));
    const unstaged = parseNumstat(await git(root, ['diff', '--numstat', '--no-ext-diff', '--no-textconv', '--no-renames']));
    for (const c of changes.values()) {
      const s = staged.get(c.path);
      const u = unstaged.get(c.path);
      c.added = s || u ? (s?.added ?? 0) + (u?.added ?? 0) : null;
      c.deleted = s || u ? (s?.deleted ?? 0) + (u?.deleted ?? 0) : null;
      c.binary = !!(s?.binary || u?.binary);
    }
  }
  const list = [...changes.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    available: true as const,
    git: info,
    branch: branch || (head ? `(detached at ${head.slice(0, 7)})` : '(no commits)'),
    head,
    empty,
    commits,
    changes: list,
    summary: {
      staged: list.filter((c) => c.staged).length,
      unstaged: list.filter((c) => c.unstaged && !c.untracked).length,
      untracked: list.filter((c) => c.untracked).length,
      added: list.reduce((a, c) => a + (c.added ?? 0), 0),
      deleted: list.reduce((a, c) => a + (c.deleted ?? 0), 0),
    },
  };
}

const SAFE_REV = /^[0-9a-f]{7,40}$/i;
const SAFE_PATH = (p: string) => !p.startsWith('-') && !p.includes('\0') && !p.split(/[\\/]/).includes('..');

/** Diff of one file (working tree vs HEAD, or staged only) or of one commit. */
export async function gitDiff(root: string, opts: { path?: string; staged?: boolean; commit?: string }) {
  if (opts.commit) {
    if (!SAFE_REV.test(opts.commit)) throw new GitError('Invalid commit id.', 'failed');
    return git(root, ['show', '--no-color', '--no-ext-diff', '--no-textconv', '--format=%H%n%an <%ae>%n%ad%n%n%B', '--stat', '--patch', opts.commit, ...(opts.path && SAFE_PATH(opts.path) ? ['--', opts.path] : [])], 4 * 1024 * 1024);
  }
  if (opts.path && !SAFE_PATH(opts.path)) throw new GitError('Invalid path.', 'failed');
  const args = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', ...(opts.staged ? ['--cached'] : ['HEAD'])];
  return git(root, [...args, ...(opts.path ? ['--', opts.path] : [])], 4 * 1024 * 1024);
}

/** Lines added in the working tree compared with HEAD, per file (from unified=0 hunks). */
export function addedLines(diff: string): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  let file: string | null = null;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      file = null;
      continue;
    }
    const f = /^\+\+\+ b\/(.*)$/.exec(line);
    if (f && !inHunk) {
      file = f[1];
      if (!out.has(file)) out.set(file, new Set());
      continue;
    }
    if (/^\+\+\+ \/dev\/null/.test(line) && !inHunk) {
      file = null;
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h) {
      newLine = Number(h[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || !file) continue;
    // only real additions count — context lines (' ') just advance the new-side counter
    if (line.startsWith('+')) out.get(file)!.add(newLine++);
    else if (line.startsWith(' ')) newLine++;
    else if (line.startsWith('\\')) continue; // "\ No newline at end of file"
  }
  return out;
}
