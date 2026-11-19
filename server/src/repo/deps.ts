/**
 * Offline dependency-manifest parsing. Nothing here contacts a registry or vulnerability database:
 * versions are reported exactly as declared / locked, and no package is ever called vulnerable or
 * outdated without a reliable local source of that information.
 */
export type Ecosystem = 'npm' | 'pypi' | 'maven' | 'gradle' | 'cmake';

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  spec: string; // declared version / range ('' when not declared)
  resolved: string | null; // version from a lockfile, when available
  dev: boolean;
  direct: boolean;
  manifest: string; // repository-relative path
}
export interface ManifestIssue {
  manifest: string;
  line: number | null;
  rule: 'invalid-manifest' | 'missing-lockfile' | 'unpinned-version' | 'duplicate-declaration' | 'version-conflict' | 'unused-dependency';
  severity: 'medium' | 'low' | 'info';
  message: string;
  confidence: 'high' | 'medium' | 'low';
  dependency?: string;
}
export interface DependencyReport {
  dependencies: Dependency[];
  issues: ManifestIssue[];
  managers: string[];
  manifests: string[];
}

const lineOf = (text: string, needle: string): number | null => {
  const i = text.indexOf(needle);
  return i < 0 ? null : text.slice(0, i).split('\n').length;
};

function isUnpinned(spec: string, eco: Ecosystem): boolean {
  const s = spec.trim();
  if (!s) return true;
  if (eco === 'npm') return s === '*' || s === 'latest' || s === '' || /^(>=?|x)/.test(s) || /^\d+(\.x)?$/.test(s) || /\|\|/.test(s);
  if (eco === 'pypi') return !/==/.test(s);
  return /^\[|,\)|LATEST|RELEASE|\+$/.test(s);
}

function parsePackageJson(path: string, text: string, out: DependencyReport) {
  let pkg: any;
  try {
    pkg = JSON.parse(text);
  } catch (e) {
    out.issues.push({ manifest: path, line: null, rule: 'invalid-manifest', severity: 'medium', message: `package.json is not valid JSON: ${(e as Error).message}`, confidence: 'high' });
    return;
  }
  const seen = new Map<string, string>();
  for (const [field, dev] of [['dependencies', false], ['devDependencies', true], ['optionalDependencies', false], ['peerDependencies', false]] as const) {
    const deps = pkg?.[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [name, spec] of Object.entries(deps)) {
      const s = String(spec);
      if (seen.has(name) && field !== 'peerDependencies')
        out.issues.push({ manifest: path, line: lineOf(text, `"${name}"`), rule: 'duplicate-declaration', severity: 'low', message: `"${name}" is declared in both ${seen.get(name)} and ${field}.`, confidence: 'high', dependency: name });
      seen.set(name, field);
      if (field === 'peerDependencies') continue;
      out.dependencies.push({ ecosystem: 'npm', name, spec: s, resolved: null, dev, direct: true, manifest: path });
      if (!/^(file:|link:|workspace:|git|https?:|npm:)/.test(s) && isUnpinned(s, 'npm'))
        out.issues.push({ manifest: path, line: lineOf(text, `"${name}"`), rule: 'unpinned-version', severity: 'low', message: `"${name}": "${s}" accepts a very broad range of versions; builds may not be reproducible without a lockfile.`, confidence: 'high', dependency: name });
    }
  }
}

function parsePackageLock(path: string, text: string, out: DependencyReport) {
  let lock: any;
  try {
    lock = JSON.parse(text);
  } catch (e) {
    out.issues.push({ manifest: path, line: null, rule: 'invalid-manifest', severity: 'medium', message: `package-lock.json is not valid JSON: ${(e as Error).message}`, confidence: 'high' });
    return;
  }
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const manifest = dir ? `${dir}/package.json` : 'package.json';
  const pkgs = lock?.packages;
  if (pkgs && typeof pkgs === 'object') {
    const versions = new Map<string, Set<string>>();
    for (const [key, v] of Object.entries<any>(pkgs)) {
      if (!key.startsWith('node_modules/') && !key.includes('/node_modules/')) continue;
      const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const version = String(v?.version ?? '');
      const direct = out.dependencies.find((d) => d.ecosystem === 'npm' && d.manifest === manifest && d.name === name && d.direct);
      if (direct && key === `node_modules/${name}`) direct.resolved = version;
      else if (!direct) out.dependencies.push({ ecosystem: 'npm', name, spec: '', resolved: version, dev: !!v?.dev, direct: false, manifest: path });
      if (!versions.has(name)) versions.set(name, new Set());
      versions.get(name)!.add(version);
    }
    for (const [name, vs] of versions)
      if (vs.size > 1)
        out.issues.push({ manifest: path, line: null, rule: 'version-conflict', severity: 'info', message: `${vs.size} versions of "${name}" are installed (${[...vs].slice(0, 4).join(', ')}). This is allowed by npm but increases bundle size and can cause subtle behaviour differences.`, confidence: 'high', dependency: name });
  }
}

function parseYarnOrPnpmLock(path: string, text: string, out: DependencyReport) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const manifest = dir ? `${dir}/package.json` : 'package.json';
  for (const d of out.dependencies.filter((x) => x.manifest === manifest && x.direct && !x.resolved)) {
    const esc = d.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const yarn = new RegExp(`^"?${esc}@[^\\n]*:\\n\\s+version:?\\s+"?([^"\\n]+)"?`, 'm').exec(text);
    const pnpm = new RegExp(`^\\s+'?/?${esc}@([0-9][^:'(\\s]*)`, 'm').exec(text);
    d.resolved = yarn?.[1] ?? pnpm?.[1] ?? null;
  }
}

function parseRequirements(path: string, text: string, out: DependencyReport) {
  const dev = /dev|test/i.test(path);
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) return;
    const m = /^([A-Za-z0-9_.\-]+)(\[[^\]]*\])?\s*(.*)$/.exec(line);
    if (!m) {
      out.issues.push({ manifest: path, line: i + 1, rule: 'invalid-manifest', severity: 'low', message: `Could not parse requirement "${line}".`, confidence: 'medium' });
      return;
    }
    const name = m[1].toLowerCase();
    const spec = m[3].split(';')[0].trim();
    if (seen.has(name)) out.issues.push({ manifest: path, line: i + 1, rule: 'duplicate-declaration', severity: 'low', message: `"${name}" is listed more than once.`, confidence: 'high', dependency: name });
    seen.add(name);
    out.dependencies.push({ ecosystem: 'pypi', name, spec, resolved: /^==\s*[\w.]+$/.test(spec) ? spec.replace(/^==\s*/, '') : null, dev, direct: true, manifest: path });
    if (isUnpinned(spec, 'pypi')) out.issues.push({ manifest: path, line: i + 1, rule: 'unpinned-version', severity: 'low', message: `"${name}${spec ? ' ' + spec : ''}" is not pinned with ==; installs can change over time.`, confidence: 'high', dependency: name });
  });
}

function parsePyproject(path: string, text: string, out: DependencyReport) {
  // PEP 621 `dependencies = [...]` and Poetry `[tool.poetry.dependencies]` tables (simple TOML subset)
  const arr = /^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m.exec(text);
  if (arr) {
    for (const m of arr[1].matchAll(/["']([^"']+)["']/g)) {
      const r = /^([A-Za-z0-9_.\-]+)(\[[^\]]*\])?\s*(.*)$/.exec(m[1].trim());
      if (r) out.dependencies.push({ ecosystem: 'pypi', name: r[1].toLowerCase(), spec: r[3].split(';')[0].trim(), resolved: null, dev: false, direct: true, manifest: path });
    }
  }
  const tables = text.matchAll(/^\[tool\.poetry\.((?:group\.\w+\.)?(?:dev-)?dependencies)\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm);
  for (const t of tables) {
    const dev = /dev|group/.test(t[1]);
    for (const line of t[2].split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_.\-]+)\s*=\s*(?:"([^"]*)"|\{[^}]*version\s*=\s*"([^"]*)")/.exec(line);
      if (m && m[1].toLowerCase() !== 'python') out.dependencies.push({ ecosystem: 'pypi', name: m[1].toLowerCase(), spec: m[2] ?? m[3] ?? '', resolved: null, dev, direct: true, manifest: path });
    }
  }
}

function parsePipfile(path: string, text: string, out: DependencyReport) {
  for (const t of text.matchAll(/^\[(packages|dev-packages)\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)) {
    for (const line of t[2].split(/\r?\n/)) {
      const m = /^\s*"?([A-Za-z0-9_.\-]+)"?\s*=\s*(?:"([^"]*)"|\{[^}]*version\s*=\s*"([^"]*)")/.exec(line);
      if (m) out.dependencies.push({ ecosystem: 'pypi', name: m[1].toLowerCase(), spec: m[2] ?? m[3] ?? '', resolved: null, dev: t[1] === 'dev-packages', direct: true, manifest: path });
    }
  }
}

function parsePom(path: string, text: string, out: DependencyReport) {
  if (!/<project[\s>]/.test(text)) {
    out.issues.push({ manifest: path, line: null, rule: 'invalid-manifest', severity: 'medium', message: 'pom.xml has no <project> element.', confidence: 'high' });
    return;
  }
  const props = new Map<string, string>();
  const propBlock = /<properties>([\s\S]*?)<\/properties>/.exec(text)?.[1] ?? '';
  for (const m of propBlock.matchAll(/<([\w.\-]+)>([^<]*)<\/\1>/g)) props.set(m[1], m[2].trim());
  const body = text.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '').replace(/<plugins>[\s\S]*?<\/plugins>/g, '');
  const seen = new Set<string>();
  for (const m of body.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const tag = (t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(m[1])?.[1]?.trim() ?? '';
    const name = `${tag('groupId')}:${tag('artifactId')}`;
    let spec = tag('version');
    const ref = /^\$\{(.+)\}$/.exec(spec);
    if (ref && props.has(ref[1])) spec = props.get(ref[1])!;
    if (seen.has(name)) out.issues.push({ manifest: path, line: lineOf(text, `<artifactId>${tag('artifactId')}</artifactId>`), rule: 'duplicate-declaration', severity: 'low', message: `${name} is declared more than once.`, confidence: 'high', dependency: name });
    seen.add(name);
    out.dependencies.push({ ecosystem: 'maven', name, spec, resolved: spec && !/[\[\(,]/.test(spec) ? spec : null, dev: tag('scope') === 'test', direct: true, manifest: path });
  }
}

function parseGradle(path: string, text: string, out: DependencyReport) {
  const re = /^\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|androidTestImplementation|kapt|annotationProcessor)\s*\(?\s*['"]([^'":]+):([^'":]+)(?::([^'"]+))?['"]/gm;
  for (const m of text.matchAll(re)) {
    const spec = m[4] ?? '';
    out.dependencies.push({ ecosystem: 'gradle', name: `${m[2]}:${m[3]}`, spec, resolved: spec && !/[+\[\(]/.test(spec) ? spec : null, dev: /^test|androidTest/.test(m[1]), direct: true, manifest: path });
    if (!spec || /\+|latest/i.test(spec)) out.issues.push({ manifest: path, line: text.slice(0, m.index).split('\n').length, rule: 'unpinned-version', severity: 'low', message: `${m[2]}:${m[3]} uses a dynamic version ("${spec || 'none'}").`, confidence: 'high', dependency: `${m[2]}:${m[3]}` });
  }
}

function parseCmake(path: string, text: string, out: DependencyReport) {
  for (const m of text.matchAll(/find_package\s*\(\s*([A-Za-z0-9_]+)(?:\s+([0-9][\w.]*))?/gi)) out.dependencies.push({ ecosystem: 'cmake', name: m[1], spec: m[2] ?? '', resolved: null, dev: false, direct: true, manifest: path });
  for (const m of text.matchAll(/FetchContent_Declare\s*\(\s*([A-Za-z0-9_]+)[\s\S]*?GIT_TAG\s+([^\s)]+)/gi)) out.dependencies.push({ ecosystem: 'cmake', name: m[1], spec: m[2], resolved: m[2], dev: false, direct: true, manifest: path });
}

const IMPORT_ALIASES: Record<string, string> = { 'beautifulsoup4': 'bs4', 'pillow': 'PIL', 'scikit-learn': 'sklearn', 'pyyaml': 'yaml', 'python-dotenv': 'dotenv', 'opencv-python': 'cv2', 'psycopg2-binary': 'psycopg2' };

/** Parses every manifest in the repository. `files` must contain text content for manifest files. */
export function analyzeDependencies(files: { path: string; content?: string; language: string | null }[]): DependencyReport {
  const out: DependencyReport = { dependencies: [], issues: [], managers: [], manifests: [] };
  const byName = (re: RegExp) => files.filter((f) => re.test(f.path.split('/').pop() ?? '') && f.content !== undefined);
  const has = (dir: string, name: string) => files.some((f) => f.path === (dir ? `${dir}/${name}` : name));
  const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  // order matters: manifests first, then lockfiles that resolve their versions
  for (const f of byName(/^package\.json$/)) {
    out.manifests.push(f.path);
    parsePackageJson(f.path, f.content!, out);
    const d = dirOf(f.path);
    const pkgHasDeps = out.dependencies.some((x) => x.manifest === f.path);
    if (pkgHasDeps && !has(d, 'package-lock.json') && !has(d, 'yarn.lock') && !has(d, 'pnpm-lock.yaml') && !has(d, 'npm-shrinkwrap.json') && !f.path.includes('/node_modules/')) {
      // workspaces share the root lockfile
      const rootLock = has('', 'package-lock.json') || has('', 'yarn.lock') || has('', 'pnpm-lock.yaml');
      if (!(d && rootLock)) out.issues.push({ manifest: f.path, line: null, rule: 'missing-lockfile', severity: 'medium', message: 'No lockfile (package-lock.json, yarn.lock or pnpm-lock.yaml) next to this package.json: installs are not reproducible.', confidence: 'high' });
    }
  }
  for (const f of byName(/^(package-lock|npm-shrinkwrap)\.json$/)) {
    out.manifests.push(f.path);
    parsePackageLock(f.path, f.content!, out);
  }
  for (const f of byName(/^(yarn\.lock|pnpm-lock\.yaml)$/)) {
    out.manifests.push(f.path);
    parseYarnOrPnpmLock(f.path, f.content!, out);
  }
  for (const f of byName(/^requirements[\w.\-]*\.txt$/)) {
    out.manifests.push(f.path);
    parseRequirements(f.path, f.content!, out);
  }
  for (const f of byName(/^pyproject\.toml$/)) {
    out.manifests.push(f.path);
    parsePyproject(f.path, f.content!, out);
  }
  for (const f of byName(/^Pipfile$/)) {
    out.manifests.push(f.path);
    parsePipfile(f.path, f.content!, out);
    if (!has(dirOf(f.path), 'Pipfile.lock')) out.issues.push({ manifest: f.path, line: null, rule: 'missing-lockfile', severity: 'low', message: 'Pipfile without Pipfile.lock.', confidence: 'high' });
  }
  for (const f of byName(/^pom\.xml$/)) {
    out.manifests.push(f.path);
    parsePom(f.path, f.content!, out);
  }
  for (const f of byName(/^build\.gradle(\.kts)?$/)) {
    out.manifests.push(f.path);
    parseGradle(f.path, f.content!, out);
  }
  for (const f of byName(/^CMakeLists\.txt$/)) {
    out.manifests.push(f.path);
    parseCmake(f.path, f.content!, out);
  }

  // unused direct dependencies (heuristic: the package name never appears in any import / require of the same ecosystem)
  const jsSrc = files.filter((f) => f.content !== undefined && /^(javascript|typescript|tsx|vue|svelte)$/.test(f.language ?? '')).map((f) => f.content!).join('\n');
  const pySrc = files.filter((f) => f.content !== undefined && f.language === 'python').map((f) => f.content!).join('\n');
  const configText = files.filter((f) => f.content !== undefined && /(config|rc)\b|package\.json$/i.test(f.path)).map((f) => f.content!).join('\n');
  const checked = new Set<string>();
  for (const d of out.dependencies.filter((x) => x.direct)) {
    const key = `${d.ecosystem}:${d.manifest}:${d.name}`;
    if (checked.has(key)) continue;
    checked.add(key);
    if (d.ecosystem === 'npm' && jsSrc) {
      if (d.name.startsWith('@types/') || d.dev) continue; // dev tools are used by scripts / configs, not imports
      const esc = d.name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      const used = new RegExp(`(from\\s+|require\\(\\s*|import\\(\\s*|import\\s+)['"]${esc}(/[^'"]*)?['"]`).test(jsSrc) || new RegExp(`['"]${esc}['"]`).test(configText.replace(/"dependencies"[\s\S]*?\}/, ''));
      if (!used) out.issues.push({ manifest: d.manifest, line: null, rule: 'unused-dependency', severity: 'info', message: `"${d.name}" is a production dependency but no import or require of it was found. It may be unused, or loaded dynamically / by a tool.`, confidence: 'low', dependency: d.name });
    }
    if (d.ecosystem === 'pypi' && pySrc && !d.dev) {
      const mod = (IMPORT_ALIASES[d.name] ?? d.name).replace(/-/g, '_');
      const used = new RegExp(`^\\s*(import|from)\\s+${mod.replace(/\./g, '\\.')}\\b`, 'mi').test(pySrc);
      if (!used) out.issues.push({ manifest: d.manifest, line: null, rule: 'unused-dependency', severity: 'info', message: `"${d.name}" is declared but no "import ${mod}" was found. The import name may differ from the package name.`, confidence: 'low', dependency: d.name });
    }
  }
  const m = new Set<string>();
  for (const f of files) {
    const b = f.path.split('/').pop() ?? '';
    if (b === 'package-lock.json') m.add('npm');
    if (b === 'yarn.lock') m.add('yarn');
    if (b === 'pnpm-lock.yaml') m.add('pnpm');
    if (/^requirements.*\.txt$/.test(b)) m.add('pip');
    if (b === 'Pipfile') m.add('pipenv');
    if (b === 'pyproject.toml') m.add(/\[tool\.poetry/.test(f.content ?? '') ? 'poetry' : 'pip (pyproject)');
    if (b === 'pom.xml') m.add('maven');
    if (/^build\.gradle/.test(b)) m.add('gradle');
    if (b === 'CMakeLists.txt') m.add('cmake');
  }
  if (!m.has('npm') && !m.has('yarn') && !m.has('pnpm') && files.some((f) => /(^|\/)package\.json$/.test(f.path))) m.add('npm (no lockfile)');
  out.managers = [...m];
  return out;
}
