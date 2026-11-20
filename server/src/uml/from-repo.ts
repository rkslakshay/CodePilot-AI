/**
 * Repository → UML, built only from evidence the Repository Analyzer already has (files, project
 * profile, dependency manifests) plus the import statements and configuration files themselves.
 * Nothing is executed and nothing is invented: when the evidence is insufficient the API says so.
 */
import { AppError } from '../utils/http.js';
import { getRepo, readRepoFile, fileRowsOf, dependencyRows } from '../repo/service.js';
import { DiagramBuilder, slug, type Diagram, type Evidence } from '../../../shared/uml/index.js';
import { classDiagramFromSource, type SourceFile } from './from-source.js';

export type RepoDiagramKind = 'class' | 'modules' | 'architecture' | 'deployment';
const CODE_LANGS = new Set(['java', 'typescript', 'tsx', 'javascript', 'python', 'cpp', 'c']);

function sourceFiles(repoId: number, folder?: string, limit = 400): { files: SourceFile[]; skipped: number } {
  const prefix = folder ? folder.replace(/\/+$/, '') + '/' : '';
  const rows = fileRowsOf(repoId).filter((f) => (f.kind === 'source' || f.kind === 'test') && f.language && CODE_LANGS.has(f.language) && !f.sensitive && !f.binary && !f.skipped && (!prefix || f.path.startsWith(prefix)) && f.kind !== 'test');
  const files: SourceFile[] = [];
  for (const f of rows.slice(0, limit)) {
    try {
      files.push({ path: f.path, content: readRepoFile(repoId, f.path).content, language: f.language });
    } catch {
      /* file vanished since the analysis */
    }
  }
  return { files, skipped: Math.max(0, rows.length - limit) };
}

export function generateFromRepository(repoId: number, kind: RepoDiagramKind, opts: { folder?: string } = {}): Diagram {
  const repo = getRepo(repoId);
  if (!repo.analyzedAt) throw new AppError(409, 'not_analysed', 'Analyse the repository first (Repository Analyzer).');
  let d: Diagram;
  if (kind === 'class') {
    const { files, skipped } = sourceFiles(repoId, opts.folder);
    if (!files.length) throw new AppError(422, 'no_source', `No supported source files${opts.folder ? ` under ${opts.folder}` : ''} (Java, TypeScript, JavaScript, Python, C, C++).`);
    d = classDiagramFromSource(files, { title: `${repo.name}${opts.folder ? ` · ${opts.folder}` : ''} — classes` }).diagram;
    if (skipped) d.meta.generation.warnings.push(`Only the first 400 source files were parsed (${skipped} more).`);
  } else if (kind === 'modules') d = moduleDiagram(repoId, repo.name, opts.folder);
  else if (kind === 'architecture') d = architectureDiagram(repoId, repo.name, repo.profile as Profile);
  else d = deploymentDiagram(repoId, repo.name, repo.profile as Profile);
  d.meta.generation = { ...d.meta.generation, method: 'repository', label: 'Generated from the repository (offline, not AI)', repoId, at: new Date().toISOString() };
  return d;
}

// ------------------------------------------------------------------ module dependency diagram
const IMPORT_RES: Record<string, RegExp[]> = {
  js: [/^\s*import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g, /^\s*export\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/gm],
  python: [/^\s*from\s+([.\w]+)\s+import\b/gm, /^\s*import\s+([\w.]+)/gm],
  java: [/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm],
  c: [/^\s*#\s*include\s+"([^"]+)"/gm],
};
const famOf = (lang: string) => (/^(javascript|typescript|tsx)$/.test(lang) ? 'js' : lang === 'cpp' ? 'c' : lang);

function moduleDiagram(repoId: number, name: string, folder?: string): Diagram {
  const all = fileRowsOf(repoId).filter((f) => f.kind === 'source' && f.language && CODE_LANGS.has(f.language) && !f.skipped && !f.sensitive);
  const prefix = folder ? folder.replace(/\/+$/, '') + '/' : '';
  const files = all.filter((f) => !prefix || f.path.startsWith(prefix));
  if (files.length < 2) throw new AppError(422, 'too_small', 'At least two source files are needed for a module dependency diagram.');
  const paths = new Set(all.map((f) => f.path));
  // module = directory at the deepest level that still gives a readable number of modules
  const rel = (p: string) => p.slice(prefix.length);
  const moduleAt = (p: string, depth: number) => {
    const dirs = rel(p).split('/').slice(0, -1);
    return dirs.length ? dirs.slice(0, depth).join('/') : '(root)';
  };
  let depth = 1;
  for (let dd = 1; dd <= 5; dd++) {
    const n = new Set(files.map((f) => moduleAt(f.path, dd))).size;
    if (n <= 18) depth = dd;
    if (n > 18) break;
  }
  const moduleOf = new Map(files.map((f) => [f.path, moduleAt(f.path, depth)]));
  const deps = dependencyRows(repoId).filter((x) => x.direct);
  const depNames = new Set(deps.map((x) => x.name.toLowerCase()));
  const internal = new Map<string, { count: number; evidence: string }>();
  const external = new Map<string, { count: number; evidence: string; users: Map<string, number> }>();
  const resolve = (from: string, spec: string, lang: string): string | null => {
    if (lang === 'js' && spec.startsWith('.')) {
      const base = from.split('/').slice(0, -1);
      for (const part of spec.split('/')) {
        if (part === '..') base.pop();
        else if (part !== '.') base.push(part);
      }
      const p = base.join('/');
      for (const c of [p, `${p}.ts`, `${p}.tsx`, `${p}.js`, `${p}.jsx`, `${p}.mjs`, `${p}/index.ts`, `${p}/index.tsx`, `${p}/index.js`, p.replace(/\.js$/, '.ts'), p.replace(/\.js$/, '.tsx')]) if (paths.has(c)) return c;
      return null;
    }
    if (lang === 'js' && spec.startsWith('@/')) {
      for (const root of ['src/', 'client/src/', 'app/', '']) for (const ext of ['.ts', '.tsx', '.js', '/index.ts', '/index.tsx']) if (paths.has(`${root}${spec.slice(2)}${ext}`)) return `${root}${spec.slice(2)}${ext}`;
      return null;
    }
    if (lang === 'python') {
      const mod = spec.replace(/^\.+/, '').replace(/\./g, '/');
      const baseDir = spec.startsWith('.') ? from.split('/').slice(0, -(spec.match(/^\.+/)![0].length)).join('/') : '';
      for (const c of [`${baseDir ? baseDir + '/' : ''}${mod}.py`, `${baseDir ? baseDir + '/' : ''}${mod}/__init__.py`]) if (paths.has(c)) return c;
      for (const p of paths) if (p.endsWith(`/${mod}.py`)) return p;
      return null;
    }
    if (lang === 'java') {
      const p = spec.replace(/\./g, '/');
      for (const x of paths) if (x.endsWith(`${p}.java`)) return x;
      return null;
    }
    if (lang === 'c') {
      const dir = from.split('/').slice(0, -1).join('/');
      for (const c of [`${dir ? dir + '/' : ''}${spec}`, spec]) if (paths.has(c)) return c;
      for (const x of paths) if (x.endsWith(`/${spec}`)) return x;
      return null;
    }
    return null;
  };
  const pkgOf = (spec: string, lang: string) => (lang === 'js' ? (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]) : lang === 'python' ? spec.split('.')[0] : spec.split('.').slice(0, 2).join('.'));
  for (const f of files) {
    let content: string;
    try {
      content = readRepoFile(repoId, f.path).content;
    } catch {
      continue;
    }
    const lang = famOf(f.language!);
    for (const re of IMPORT_RES[lang] ?? []) {
      for (const m of content.matchAll(new RegExp(re.source, re.flags))) {
        const spec = m[1];
        const lineNo = content.slice(0, m.index).split('\n').length;
        const target = resolve(f.path, spec, lang);
        const from = moduleOf.get(f.path)!;
        if (target) {
          const to = moduleOf.get(target);
          if (!to || to === from) continue;
          const k = `${from}→${to}`;
          const cur = internal.get(k) ?? { count: 0, evidence: `${f.path}:${lineNo} imports ${spec}` };
          cur.count++;
          internal.set(k, cur);
        } else if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('node:') && lang !== 'c') {
          const pkg = pkgOf(spec, lang);
          if (!depNames.has(pkg.toLowerCase()) && lang !== 'java') continue; // stdlib / unknown: only declared dependencies count
          const cur = external.get(pkg) ?? { count: 0, evidence: `${f.path}:${lineNo}`, users: new Map() };
          cur.count++;
          cur.users.set(from, (cur.users.get(from) ?? 0) + 1);
          external.set(pkg, cur);
        }
      }
    }
  }
  const b = new DiagramBuilder('component', `${name}${folder ? ` · ${folder}` : ''} — module dependencies`);
  b.d.layout.direction = 'LR';
  const ev: Record<string, Evidence> = {};
  const modules = [...new Set(moduleOf.values())];
  const fileCount = (m: string) => files.filter((f) => moduleOf.get(f.path) === m).length;
  const mid = new Map<string, string>();
  for (const m of modules) {
    const id = b.el(`mod_${slug(m)}`, 'component', m, { stereotype: `module · ${fileCount(m)} file${fileCount(m) === 1 ? '' : 's'}` });
    mid.set(m, id);
    ev[id] = { basis: 'extracted', detail: `Folder ${prefix}${m === '(root)' ? '' : m}`, confidence: 'high' };
  }
  for (const [k, v] of internal) {
    const [a, c] = k.split('→');
    const id = b.rel('dependency', mid.get(a)!, mid.get(c)!, { label: `${v.count} import${v.count === 1 ? '' : 's'}` });
    ev[id] = { basis: 'extracted', detail: `e.g. ${v.evidence}`, confidence: 'high' };
  }
  const topExt = [...external.entries()].sort((x, y) => y[1].count - x[1].count).slice(0, 10);
  for (const [pkg, v] of topExt) {
    const id = b.el(`lib_${slug(pkg)}`, 'component', pkg, { stereotype: 'library' });
    ev[id] = { basis: 'extracted', detail: `Declared dependency, imported ${v.count} time(s), e.g. ${v.evidence}`, confidence: 'high' };
    for (const [m, c] of v.users) {
      const rid = b.rel('dependency', mid.get(m)!, id, { label: c > 1 ? `${c}` : '' });
      ev[rid] = { basis: 'extracted', detail: `${c} import(s) of ${pkg} from ${m}`, confidence: 'high' };
    }
  }
  const d = b.build('repository', 'Generated from the repository (offline, not AI)');
  d.meta.evidence = ev;
  d.meta.generation.warnings = [`Modules are folders at depth ${depth}; dependencies come from import / require / include statements resolved to files in the repository.`, ...(external.size > topExt.length ? [`Showing the 10 most used of ${external.size} external libraries.`] : [])];
  return d;
}

// ------------------------------------------------------------------ architecture (high level)
interface Profile {
  frameworks?: { name: string; evidence: string }[];
  projectTypes?: string[];
  entryPoints?: { path: string; reason: string }[];
}
const DB_DRIVERS: Record<string, string> = { pg: 'PostgreSQL', postgres: 'PostgreSQL', 'pg-promise': 'PostgreSQL', psycopg2: 'PostgreSQL', 'psycopg2-binary': 'PostgreSQL', asyncpg: 'PostgreSQL', mysql: 'MySQL', mysql2: 'MySQL', pymysql: 'MySQL', mongodb: 'MongoDB', mongoose: 'MongoDB', pymongo: 'MongoDB', sqlite3: 'SQLite', 'better-sqlite3': 'SQLite', redis: 'Redis', ioredis: 'Redis', 'org.postgresql:postgresql': 'PostgreSQL', 'mysql:mysql-connector-java': 'MySQL', prisma: 'Database (Prisma)', '@prisma/client': 'Database (Prisma)', sequelize: 'SQL database (Sequelize)', typeorm: 'SQL database (TypeORM)', sqlalchemy: 'SQL database (SQLAlchemy)', 'spring-boot-starter-data-jpa': 'SQL database (JPA)' };
const SERVICES: Record<string, string> = { stripe: 'Stripe', '@stripe/stripe-js': 'Stripe', nodemailer: 'Email (SMTP)', '@sendgrid/mail': 'SendGrid', 'aws-sdk': 'AWS', '@aws-sdk/client-s3': 'AWS S3', boto3: 'AWS', firebase: 'Firebase', 'firebase-admin': 'Firebase', twilio: 'Twilio', openai: 'OpenAI API', axios: '', requests: '' };

function architectureDiagram(repoId: number, name: string, profile: Profile): Diagram {
  const deps = dependencyRows(repoId).filter((x) => x.direct && !x.dev);
  const files = fileRowsOf(repoId);
  const fw = new Set((profile.frameworks ?? []).map((f) => f.name));
  const b = new DiagramBuilder('component', `${name} — architecture`);
  const ev: Record<string, Evidence> = {};
  const fe = ['React', 'Next.js', 'Vue', 'Angular', 'Svelte'].filter((x) => fw.has(x));
  const be = ['Express', 'NestJS', 'Fastify', 'Django', 'Flask', 'FastAPI', 'Spring Boot'].filter((x) => fw.has(x));
  const evidenceOf = (n: string) => (profile.frameworks ?? []).find((f) => f.name === n)?.evidence ?? '';
  let feId: string | null = null;
  let beId: string | null = null;
  if (fe.length) {
    feId = b.el('frontend', 'component', 'Frontend', { stereotype: fe.join(' + ') });
    ev[feId] = { basis: 'extracted', detail: fe.map(evidenceOf).join('; '), confidence: 'high' };
  }
  if (be.length) {
    beId = b.el('backend', 'component', 'Backend API', { stereotype: be.join(' + ') });
    ev[beId] = { basis: 'extracted', detail: be.map(evidenceOf).join('; '), confidence: 'high' };
    const api = b.el('api', 'interface', /Django|Flask|FastAPI|Express|NestJS|Fastify|Spring/.test(be.join()) ? 'HTTP API' : 'API');
    b.rel('provides', beId, api);
    if (feId) {
      const id = b.rel('requires', feId, api);
      ev[id] = { basis: 'inferred', detail: 'A front-end framework and a back-end framework are both present in this repository; the front end is assumed to call the back end over HTTP.', confidence: 'medium' };
    }
  }
  const host = beId ?? feId;
  const dbs = new Map<string, string>();
  for (const x of deps) {
    const db = DB_DRIVERS[x.name.toLowerCase()];
    if (db && !dbs.has(db)) dbs.set(db, `${x.name} in ${x.manifest}`);
  }
  for (const [db, why] of dbs) {
    const id = b.el(`db_${slug(db)}`, 'component', db, { stereotype: 'database' });
    ev[id] = { basis: 'extracted', detail: `Driver dependency: ${why}`, confidence: 'high' };
    if (host) {
      const r = b.rel('dependency', host, id, { label: 'queries' });
      ev[r] = { basis: 'inferred', detail: `The database driver is a dependency of the ${host === beId ? 'back end' : 'project'}.`, confidence: 'medium' };
    }
  }
  for (const x of deps) {
    const svc = SERVICES[x.name.toLowerCase()];
    if (!svc) continue;
    const id = `ext_${slug(svc)}`;
    if (!b.d.elements.some((e) => e.id === id)) {
      b.el(id, 'component', svc, { stereotype: 'external service' });
      ev[id] = { basis: 'extracted', detail: `SDK dependency: ${x.name} in ${x.manifest}`, confidence: 'high' };
      if (host) {
        const r = b.rel('dependency', host, id, { label: 'HTTPS' });
        ev[r] = { basis: 'inferred', detail: `${x.name} is a client SDK for ${svc}.`, confidence: 'medium' };
      }
    }
  }
  if (b.d.elements.length < 2) throw new AppError(422, 'not_enough_evidence', 'No recognised front-end / back-end frameworks, database drivers or external-service SDKs were found in the dependency manifests, so a reliable architecture diagram cannot be drawn. Try the module dependency diagram, which uses import statements instead.');
  const d = b.build('repository', 'Generated from the repository (offline, not AI)');
  d.meta.evidence = ev;
  d.meta.generation.warnings = ['Components come from detected frameworks and dependency manifests; connections marked "inferred" are typical for such a stack but not proven by the code.'];
  return d;
}

// ------------------------------------------------------------------ deployment (configuration evidence only)
function deploymentDiagram(repoId: number, name: string, profile: Profile): Diagram {
  const files = fileRowsOf(repoId);
  const read = (p: string) => {
    try {
      return readRepoFile(repoId, p).content;
    } catch {
      return '';
    }
  };
  const b = new DiagramBuilder('deployment', `${name} — deployment`);
  const ev: Record<string, Evidence> = {};
  const compose = files.find((f) => /(^|\/)(docker-)?compose\.ya?ml$/.test(f.path));
  const dockerfiles = files.filter((f) => /(^|\/)Dockerfile(\.\w+)?$/.test(f.path));
  if (compose) {
    const text = read(compose.path);
    const services = parseComposeServices(text);
    if (services.length) {
      const host = b.el('docker_host', 'node', 'Docker host', { nodeType: 'device' });
      ev[host] = { basis: 'inferred', detail: `All services in ${compose.path} run on one Docker host unless deployed elsewhere.`, confidence: 'medium' };
      const ids = new Map<string, string>();
      for (const s of services) {
        const id = b.el(`svc_${slug(s.name)}`, 'node', s.name, { nodeType: 'executionEnvironment', stereotype: 'container', parent: host });
        ids.set(s.name, id);
        ev[id] = { basis: 'extracted', detail: `Service "${s.name}" in ${compose.path}${s.image ? ` (image ${s.image})` : s.build ? ' (built from this repository)' : ''}`, confidence: 'high', file: compose.path, line: s.line };
        const art = b.el(`art_${slug(s.name)}`, 'artifact', s.image || (s.build ? `${s.name} image (build: ${s.build})` : s.name), { parent: id });
        ev[art] = ev[id];
      }
      for (const s of services) for (const dep of s.dependsOn) if (ids.has(dep)) {
        const r = b.rel('communication', ids.get(s.name)!, ids.get(dep)!, { label: services.find((x) => x.name === dep)?.ports[0] ? `:${services.find((x) => x.name === dep)!.ports[0].split(':').pop()}` : '' });
        ev[r] = { basis: 'extracted', detail: `${s.name} depends_on ${dep} in ${compose.path}`, confidence: 'high', file: compose.path };
      }
      const published = services.filter((s) => s.ports.length);
      if (published.length) {
        const client = b.el('client', 'node', 'Client', { nodeType: 'device' });
        ev[client] = { basis: 'inferred', detail: 'Published ports are reached from outside the host.', confidence: 'medium' };
        for (const s of published.slice(0, 3)) {
          const r = b.rel('communication', client, ids.get(s.name)!, { label: `port ${s.ports[0].split(':')[0]}` });
          ev[r] = { basis: 'extracted', detail: `ports: ${s.ports.join(', ')} in ${compose.path}`, confidence: 'high' };
        }
      }
    }
  }
  if (!b.d.elements.length && dockerfiles.length) {
    for (const df of dockerfiles.slice(0, 4)) {
      const text = read(df.path);
      const from = /^\s*FROM\s+(\S+)/im.exec(text)?.[1] ?? 'base image';
      const expose = [...text.matchAll(/^\s*EXPOSE\s+(.+)$/gim)].map((m) => m[1].trim());
      const cmd = /^\s*(?:CMD|ENTRYPOINT)\s+(.+)$/im.exec(text)?.[1]?.replace(/[[\]"]/g, '').replace(/,\s*/g, ' ') ?? '';
      const host = b.el(`host_${slug(df.path)}`, 'node', 'Container host', { nodeType: 'device' });
      const env = b.el(`env_${slug(df.path)}`, 'node', from, { nodeType: 'executionEnvironment', stereotype: 'container', parent: host });
      const art = b.el(`art_${slug(df.path)}`, 'artifact', cmd ? cmd.slice(0, 50) : df.path, { parent: env });
      ev[env] = { basis: 'extracted', detail: `FROM ${from} in ${df.path}`, confidence: 'high', file: df.path };
      ev[art] = { basis: 'extracted', detail: cmd ? `CMD/ENTRYPOINT in ${df.path}` : df.path, confidence: 'high', file: df.path };
      ev[host] = { basis: 'inferred', detail: 'A container needs a host machine.', confidence: 'medium' };
      if (expose.length) {
        const client = b.d.elements.find((e) => e.id === 'client')?.id ?? b.el('client', 'node', 'Client', { nodeType: 'device' });
        const r = b.rel('communication', client, host, { label: `port ${expose[0]}` });
        ev[r] = { basis: 'extracted', detail: `EXPOSE ${expose.join(', ')} in ${df.path}`, confidence: 'high' };
      }
    }
  }
  if (!b.d.elements.length) {
    // no container configuration: derive from frameworks + database drivers, but only if a server framework exists
    const fw = new Set((profile.frameworks ?? []).map((f) => f.name));
    const be = ['Express', 'NestJS', 'Fastify', 'Django', 'Flask', 'FastAPI', 'Spring Boot'].filter((x) => fw.has(x));
    const fe = ['React', 'Next.js', 'Vue', 'Angular', 'Svelte'].filter((x) => fw.has(x));
    const deps = dependencyRows(repoId).filter((x) => x.direct && !x.dev);
    const dbs = [...new Set(deps.map((x) => DB_DRIVERS[x.name.toLowerCase()]).filter(Boolean))];
    if (!be.length && !fe.length)
      throw new AppError(422, 'not_enough_evidence', 'The repository has no Dockerfile, no docker-compose file and no recognised server or web framework, so there is no reliable evidence about where it runs. A deployment diagram would have to be invented, so none was generated. You can create one manually from the deployment template.');
    const runtime = be.some((x) => /Django|Flask|FastAPI/.test(x)) ? 'Python runtime' : be.includes('Spring Boot') ? 'JVM' : 'Node.js';
    let server: string | null = null;
    if (fe.length) {
      const client = b.el('client', 'node', 'Client device', { nodeType: 'device' });
      const browser = b.el('browser', 'node', 'Web browser', { nodeType: 'executionEnvironment', parent: client });
      const bundle = b.el('bundle', 'artifact', `${fe.join(' + ')} bundle`, { parent: browser });
      ev[bundle] = { basis: 'extracted', detail: `Front-end framework: ${fe.join(', ')}`, confidence: 'high' };
      ev[client] = { basis: 'inferred', detail: 'Single-page applications run in the user’s browser.', confidence: 'high' };
    }
    if (be.length) {
      server = b.el('server', 'node', 'Application server', { nodeType: 'device' });
      const env = b.el('runtime', 'node', runtime, { nodeType: 'executionEnvironment', parent: server });
      const entry = (profile.entryPoints ?? []).find((e) => !/package\.json$/.test(e.path));
      const art = b.el('api', 'artifact', entry?.path.split('/').pop() ?? 'server', { parent: env });
      ev[art] = { basis: 'extracted', detail: `Back-end framework: ${be.join(', ')}${entry ? `; entry point ${entry.path}` : ''}`, confidence: 'high' };
      ev[server] = { basis: 'inferred', detail: 'The deployment target is not stated in the repository; a generic server is shown.', confidence: 'low' };
      if (fe.length) {
        const r = b.rel('communication', 'client', server, { label: 'HTTP(S)' });
        ev[r] = { basis: 'inferred', detail: 'The front end calls the back end over HTTP.', confidence: 'medium' };
      }
    }
    for (const db of dbs) {
      const node = b.el(`db_${slug(db)}`, 'node', db, { nodeType: 'executionEnvironment', stereotype: 'database' });
      ev[node] = { basis: 'extracted', detail: `Database driver dependency for ${db}`, confidence: 'high' };
      if (server) {
        const r = b.rel('communication', server, node, { label: 'TCP' });
        ev[r] = { basis: 'inferred', detail: 'The server connects to the database through its driver.', confidence: 'medium' };
      }
    }
    b.d.meta.generation.warnings.push('No container configuration was found; nodes are derived from frameworks and database drivers and the hosting is shown generically (low confidence).');
  }
  const warnings = [...b.d.meta.generation.warnings];
  const d = b.build('repository', 'Generated from the repository (offline, not AI)');
  d.meta.evidence = ev;
  d.meta.generation.warnings = warnings;
  return d;
}

/** Minimal docker-compose reader: service names, image, build, ports and depends_on. */
export function parseComposeServices(text: string): { name: string; image: string; build: string; ports: string[]; dependsOn: string[]; line: number }[] {
  const lines = text.split(/\r?\n/);
  const out: { name: string; image: string; build: string; ports: string[]; dependsOn: string[]; line: number }[] = [];
  let inServices = false;
  let svcIndent = -1;
  let cur: (typeof out)[number] | null = null;
  let list: 'ports' | 'dependsOn' | null = null;
  lines.forEach((raw, i) => {
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    const indent = raw.length - raw.trimStart().length;
    const t = raw.trim();
    if (indent === 0) {
      inServices = /^services:\s*$/.test(t);
      cur = null;
      return;
    }
    if (!inServices) return;
    if (svcIndent < 0 || indent === svcIndent) {
      const m = /^([\w.-]+):\s*$/.exec(t);
      if (m && (svcIndent < 0 || indent === svcIndent)) {
        svcIndent = indent;
        cur = { name: m[1], image: '', build: '', ports: [], dependsOn: [], line: i + 1 };
        out.push(cur);
        list = null;
        return;
      }
    }
    if (!cur) return;
    const kv = /^([\w_-]+):\s*(.*)$/.exec(t);
    if (kv) {
      list = null;
      const v = kv[2].replace(/^["']|["']$/g, '');
      if (kv[1] === 'image') cur.image = v;
      else if (kv[1] === 'build') cur.build = v || '.';
      else if (kv[1] === 'ports') {
        list = 'ports';
        if (v.startsWith('[')) cur.ports.push(...v.replace(/[[\]"']/g, '').split(',').map((x) => x.trim()).filter(Boolean));
      } else if (kv[1] === 'depends_on') {
        list = 'dependsOn';
        if (v.startsWith('[')) cur.dependsOn.push(...v.replace(/[[\]"']/g, '').split(',').map((x) => x.trim()).filter(Boolean));
      }
      return;
    }
    const item = /^-\s*["']?([^"']+?)["']?\s*$/.exec(t);
    if (item && list) cur[list].push(item[1]);
    else if (list === 'dependsOn' && /^([\w.-]+):\s*$/.test(t)) cur.dependsOn.push(t.replace(/:\s*$/, ''));
  });
  return out;
}
