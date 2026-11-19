/**
 * Read-only repository scanner. Imported code is NEVER executed: files are only read as text.
 *
 * - symbolic links / junctions are never followed (lstat); they are listed as skipped
 * - default ignores: VCS folders, dependency folders, build output, virtualenvs and caches
 * - root and nested `.gitignore` files are honoured (common syntax: globs, `**`, `/anchored`, `dir/`, `!negation`)
 * - binary files (NUL byte in the first 8 KB or a known binary extension) are skipped
 * - files larger than MAX_FILE_BYTES are listed but not read
 * - secret-bearing files (.env, private keys, credential files) are flagged `sensitive`: their
 *   content is never stored, shown, sent to the AI model or copied into reports
 */
import { lstatSync, openSync, readSync, closeSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const SCAN_LIMITS = {
  maxFiles: 15_000,
  maxFileBytes: 1024 * 1024,
  maxDepth: 40,
};

export const DEFAULT_IGNORES = [
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'dist', 'build', 'out', 'target', '.next', '.nuxt', '.svelte-kit',
  '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.gradle', '.idea', '.vscode',
  'coverage', '.cache', '.parcel-cache', '.turbo', 'vendor', '.terraform', 'bin', 'obj',
];

const BINARY_EXT = new Set(
  'png jpg jpeg gif bmp ico webp avif tif tiff psd pdf zip gz tgz bz2 xz 7z rar jar war ear class exe dll so dylib o obj a lib pyc pyo whl woff woff2 ttf otf eot mp3 mp4 wav ogg webm mov avi mkv db sqlite sqlite3 bin dat iso dmg node wasm'.split(' '),
);

export type FileKind = 'source' | 'test' | 'config' | 'doc' | 'style' | 'markup' | 'data' | 'other';

export interface ScannedFile {
  path: string; // POSIX relative path
  size: number;
  language: string | null;
  kind: FileKind;
  lines: number;
  binary: boolean;
  sensitive: boolean;
  skipped: string | null; // reason when content was not read
  content?: string; // only for readable, non-sensitive text files
}
export interface ScanResult {
  files: ScannedFile[];
  dirs: string[];
  ignored: { path: string; reason: string }[];
  truncated: boolean;
  totalBytes: number;
}

const LANG_BY_EXT: Record<string, string> = {
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', java: 'java', py: 'python', pyw: 'python',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', sass: 'scss', less: 'less', json: 'json', md: 'markdown', mdx: 'markdown', rst: 'text', txt: 'text',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', xml: 'xml', gradle: 'groovy', kt: 'kotlin', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', cs: 'csharp',
  sh: 'shell', bash: 'shell', ps1: 'powershell', bat: 'batch', cmd: 'batch', sql: 'sql', vue: 'vue', svelte: 'svelte', ini: 'ini', cfg: 'ini', env: 'dotenv',
};
const SOURCE_LANGS = new Set(['c', 'cpp', 'java', 'python', 'javascript', 'typescript', 'tsx', 'kotlin', 'go', 'rust', 'ruby', 'php', 'csharp', 'shell', 'powershell', 'vue', 'svelte', 'sql']);
const CONFIG_NAMES = /^(package\.json|tsconfig.*\.json|jsconfig\.json|vite\.config\.[cm]?[jt]s|webpack\.config\.[cm]?js|rollup\.config\.[cm]?[jt]s|babel\.config\.[cm]?js|\.babelrc|\.eslintrc.*|eslint\.config\.[cm]?js|\.prettierrc.*|pyproject\.toml|setup\.py|setup\.cfg|requirements.*\.txt|Pipfile(\.lock)?|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|CMakeLists\.txt|Makefile|Dockerfile|docker-compose\.ya?ml|\.gitignore|\.editorconfig|tailwind\.config\.[cm]?[jt]s|postcss\.config\.[cm]?js|jest\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.npmrc|tox\.ini|pytest\.ini|\.nvmrc)$/i;
const SENSITIVE = /(^|\/)(\.env(\..+)?|\.envrc|id_rsa|id_dsa|id_ecdsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.jks|.*\.keystore|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|\.npmrc|\.pypirc|\.netrc|\.htpasswd|service-account.*\.json)$/i;
const NOT_SENSITIVE = /(^|\/)\.env\.(example|sample|template|dist)$/i;

export function languageOf(path: string): string | null {
  const base = path.split('/').pop() ?? '';
  if (/^dockerfile$/i.test(base)) return 'dockerfile';
  if (/^makefile$/i.test(base)) return 'make';
  if (/^cmakelists\.txt$/i.test(base)) return 'cmake';
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : '';
  return LANG_BY_EXT[ext] ?? null;
}
export function isSensitivePath(path: string): boolean {
  return SENSITIVE.test(path) && !NOT_SENSITIVE.test(path);
}
export function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec|specs|e2e|testing)\//i.test(path) || /(\.|_)(test|spec)\.[a-z]+$/i.test(path) || /(^|\/)test_[^/]+\.py$/i.test(path) || /Tests?\.java$/.test(path);
}
export function kindOf(path: string, language: string | null): FileKind {
  const base = path.split('/').pop() ?? '';
  if (CONFIG_NAMES.test(base)) return 'config';
  if (language === 'markdown' || /^(readme|changelog|contributing|license|licence|authors|notice)(\..*)?$/i.test(base) || /(^|\/)docs?\//i.test(path)) return language && SOURCE_LANGS.has(language) ? 'source' : 'doc';
  if (language && SOURCE_LANGS.has(language)) return isTestPath(path) ? 'test' : 'source';
  if (language === 'css' || language === 'scss' || language === 'less') return 'style';
  if (language === 'html' || language === 'xml') return 'markup';
  if (language === 'json' || language === 'yaml' || language === 'toml' || language === 'ini' || language === 'dockerfile' || language === 'make' || language === 'cmake' || language === 'groovy') return 'config';
  if (language === 'text' || language === 'csv') return 'data';
  return 'other';
}

// ------------------------------------------------------------------ .gitignore
interface IgnoreRule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
}
function globToRe(glob: string): string {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i);
      if (end < 0) re += '\\[';
      else {
        re += glob.slice(i, end + 1).replace(/^\[!/, '[^');
        i = end;
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return re;
}
/** Parses .gitignore text whose patterns are relative to `base` (POSIX, '' for the root). */
export function parseGitignore(text: string, base = ''): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (let line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    line = line.replace(/(?<!\\)\s+$/, '');
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    }
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const prefix = base ? `${base.replace(/[.+^${}()|\\[\]*?]/g, '\\$&')}/` : '';
    const body = globToRe(line);
    rules.push({ re: new RegExp(`^${prefix}${anchored ? '' : '(?:.*/)?'}${body}$`), negate, dirOnly });
  }
  return rules;
}
export function isIgnored(rules: IgnoreRule[], path: string, isDir: boolean): boolean {
  let ignored = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.re.test(path)) ignored = !r.negate;
  }
  return ignored;
}

function countLines(text: string): number {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return text.endsWith('\n') ? n - 1 : n;
}
function looksBinary(abs: string): boolean {
  const fd = openSync(abs, 'r');
  try {
    const b = Buffer.alloc(8192);
    const n = readSync(fd, b, 0, 8192, 0);
    return b.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}

/** Scans `root` read-only. `useGitignore` defaults to true. */
export function scanRepository(root: string, opts: { useGitignore?: boolean; extraIgnores?: string[] } = {}): ScanResult {
  const realRoot = realpathSync(root);
  const files: ScannedFile[] = [];
  const dirs: string[] = [];
  const ignored: { path: string; reason: string }[] = [];
  const defaults = new Set([...DEFAULT_IGNORES, ...(opts.extraIgnores ?? [])].map((s) => s.toLowerCase()));
  let truncated = false;
  let totalBytes = 0;

  const walk = (absDir: string, relDir: string, rules: IgnoreRule[], depth: number) => {
    if (depth > SCAN_LIMITS.maxDepth) {
      ignored.push({ path: relDir, reason: 'too deep' });
      return;
    }
    let local = rules;
    if (opts.useGitignore !== false) {
      try {
        const gi = readFileSync(join(absDir, '.gitignore'), 'utf8');
        local = [...rules, ...parseGitignore(gi, relDir)];
      } catch {
        /* no .gitignore here */
      }
    }
    let entries: string[];
    try {
      entries = readdirSync(absDir).sort((a, b) => a.localeCompare(b));
    } catch (e) {
      ignored.push({ path: relDir || '.', reason: `unreadable: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
      return;
    }
    for (const name of entries) {
      const abs = join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      let st;
      try {
        st = lstatSync(abs);
      } catch (e) {
        ignored.push({ path: rel, reason: `unreadable: ${(e as NodeJS.ErrnoException).code ?? 'error'}` });
        continue;
      }
      if (st.isSymbolicLink()) {
        ignored.push({ path: rel, reason: 'symbolic link (not followed)' });
        continue;
      }
      if (st.isDirectory()) {
        if (defaults.has(name.toLowerCase())) {
          ignored.push({ path: rel, reason: 'ignored by default' });
          continue;
        }
        if (isIgnored(local, rel, true)) {
          ignored.push({ path: rel, reason: '.gitignore' });
          continue;
        }
        dirs.push(rel);
        walk(abs, rel, local, depth + 1);
        continue;
      }
      if (!st.isFile()) {
        ignored.push({ path: rel, reason: 'not a regular file' });
        continue;
      }
      if (isIgnored(local, rel, false)) {
        ignored.push({ path: rel, reason: '.gitignore' });
        continue;
      }
      if (files.length >= SCAN_LIMITS.maxFiles) {
        truncated = true;
        continue;
      }
      totalBytes += st.size;
      const language = languageOf(rel);
      const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
      const sensitive = isSensitivePath(rel);
      const f: ScannedFile = { path: rel, size: st.size, language, kind: kindOf(rel, language), lines: 0, binary: false, sensitive, skipped: null };
      if (BINARY_EXT.has(ext)) {
        f.binary = true;
        f.skipped = 'binary file';
      } else if (sensitive) {
        f.skipped = 'sensitive file (content never read into reports or AI prompts)';
      } else if (st.size > SCAN_LIMITS.maxFileBytes) {
        f.skipped = `larger than ${SCAN_LIMITS.maxFileBytes / 1024} KB`;
      } else {
        try {
          if (looksBinary(abs)) {
            f.binary = true;
            f.skipped = 'binary content';
          } else {
            f.content = readFileSync(abs, 'utf8');
            f.lines = countLines(f.content);
          }
        } catch (e) {
          f.skipped = `unreadable: ${(e as NodeJS.ErrnoException).code ?? 'error'}`;
        }
      }
      files.push(f);
    }
  };
  walk(realRoot, '', [], 0);
  return { files, dirs, ignored, truncated, totalBytes };
}

/** Resolves a repository-relative path to an absolute path, refusing anything outside the root. */
export function resolveInside(root: string, relPath: string): string {
  const realRoot = realpathSync(root);
  const clean = relPath.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
  if (clean.some((p) => p === '..')) throw new Error('Path escapes the repository');
  const abs = join(realRoot, ...clean);
  const real = realpathSync(abs);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error('Path escapes the repository');
  if (relative(realRoot, real).split(sep).includes('..')) throw new Error('Path escapes the repository');
  return real;
}
