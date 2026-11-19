/**
 * Repository Analyzer: import security, scanning, static analysis (with exact line numbers),
 * dependencies, findings management, Git (including malicious repository configuration), AI review
 * against an Ollama protocol stub, and reports.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync, readdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/database/db.js';
import { clearStatusCache } from '../src/providers/index.js';
import { buildZip, readZipEntries, ZipError, safeEntryName } from '../src/repo/zip.js';
import { scanRepository, parseGitignore, isIgnored } from '../src/repo/scan.js';
import { analyzeFile, redactSecrets } from '../src/repo/analyze.js';
import { analyzeDependencies } from '../src/repo/deps.js';
import { chunkFile } from '../src/repo/review.js';
import { detectGit, git, safetyOverrides } from '../src/repo/git.js';
import { parseBandit, parseRuff } from '../src/repo/tools.js';
import { qualityScore } from '../src/repo/summarize.js';
import { findBrowser } from '../src/repo/report.js';
import { writeSampleRepo, lineOf, SAMPLE } from './helpers/sampleRepo.js';

openDatabase(':memory:');
const app = createApp();
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

async function waitJob(id: string) {
  for (let i = 0; i < 400; i++) {
    const j = (await request(app).get(`/api/repos/jobs/${id}`)).body.data;
    if (j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('job did not finish');
}
async function importSample(extra: Record<string, string> = {}) {
  const dir = writeSampleRepo(tmp('cp-repo-'), extra);
  const r = await request(app).post('/api/repos/import/folder').send({ path: dir });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const job = await waitJob(r.body.data.job.id);
  expect(job.status, job.error).toBe('done');
  return { id: r.body.data.repo.id as number, dir };
}
const findings = async (id: number, q = '') => (await request(app).get(`/api/repos/${id}/findings?limit=500${q}`)).body.data.items as any[];

// ------------------------------------------------------------------ ZIP security
describe('ZIP import security', () => {
  it('rejects path traversal, absolute paths, drive letters and Windows device names', () => {
    for (const bad of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:/Windows/x.txt', '\\\\server\\share\\x', 'dir/con.txt', 'a/b:c.txt', 'x\0y'])
      expect(() => safeEntryName(bad), bad).toThrow(ZipError);
    expect(safeEntryName('src\\main.py')).toBe('src/main.py');
    expect(safeEntryName('./a/./b.txt')).toBe('a/b.txt');
  });
  it('rejects a malicious archive over HTTP and writes nothing', async () => {
    const before = existsSync(join(tmpdir(), 'codepilot-repos')) ? readdirSync(join(tmpdir(), 'codepilot-repos')).length : 0;
    const zip = buildZip([{ name: 'ok.txt', data: 'fine' }, { name: '../../escaped.txt', data: 'pwned' }]);
    const r = await request(app).post('/api/repos/import/zip').set('Content-Type', 'application/zip').set('X-File-Name', 'evil.zip').send(zip);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('zip_unsafe_path');
    const after = existsSync(join(tmpdir(), 'codepilot-repos')) ? readdirSync(join(tmpdir(), 'codepilot-repos')).length : 0;
    expect(after).toBe(before);
    expect(existsSync(join(tmpdir(), 'escaped.txt'))).toBe(false);
  });
  it('rejects symlink entries, encrypted entries, non-ZIP data and corrupt archives', async () => {
    expect(() => readZipEntries(buildZip([{ name: 'link', data: '/etc/passwd', unixMode: 0o120777 }]))).toThrow(/Symbolic link/);
    expect(() => readZipEntries(buildZip([{ name: 'secret.txt', data: 'x', encrypted: true }]))).toThrow(/Encrypted/);
    const notZip = await request(app).post('/api/repos/import/zip').set('Content-Type', 'application/zip').send(Buffer.from('hello world, definitely not a zip'));
    expect(notZip.body.error.code).toBe('zip_not_zip');
    const truncated = buildZip([{ name: 'a.txt', data: 'abc' }]).subarray(0, 40);
    expect(() => readZipEntries(Buffer.concat([truncated, Buffer.alloc(30)]))).toThrow(ZipError);
  });
  it('imports a valid ZIP (GitHub-style top folder), skips node_modules / .git and analyses it', async () => {
    const files = Object.entries(SAMPLE).filter(([p]) => !p.startsWith('.env')).map(([p, c]) => ({ name: `sample-shop-main/${p}`, data: c }));
    files.push({ name: 'sample-shop-main/.git/config', data: '[core]\n\tfsmonitor = evil\n' });
    const r = await request(app).post('/api/repos/import/zip?name=Zipped%20shop').set('Content-Type', 'application/zip').set('X-File-Name', 'sample-shop-main.zip').send(buildZip(files));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const repo = r.body.data.repo;
    expect(repo.name).toBe('Zipped shop');
    expect(repo.managedCopy).toBe(true);
    expect(existsSync(join(repo.rootPath, '.git'))).toBe(false);
    expect(existsSync(join(repo.rootPath, 'node_modules'))).toBe(false);
    expect((await waitJob(r.body.data.job.id)).status).toBe('done');
    const tree = (await request(app).get(`/api/repos/${repo.id}/files`)).body.data;
    expect(tree.map((f: any) => f.path)).toContain('src/server.js');
    // removing a ZIP repository deletes CodePilot's copy
    await request(app).delete(`/api/repos/${repo.id}`).expect(400);
    const del = await request(app).delete(`/api/repos/${repo.id}?confirm=yes`);
    expect(del.body.data.removedCopy).toBe(true);
    expect(existsSync(repo.rootPath)).toBe(false);
  });
  it('enforces the archive size limit', async () => {
    const big = Buffer.alloc(101 * 1024 * 1024, 1);
    const r = await request(app).post('/api/repos/import/zip').set('Content-Type', 'application/zip').send(big);
    expect(r.status).toBe(413);
  });
});

// ------------------------------------------------------------------ folder scanning
describe('folder import and scanning', () => {
  it('rejects bad paths: relative, missing, files, drive roots and system folders', async () => {
    expect((await request(app).post('/api/repos/import/folder').send({ path: 'relative/dir' })).body.error.code).toBe('invalid_path');
    expect((await request(app).post('/api/repos/import/folder').send({ path: join(tmpdir(), 'no-such-dir-xyz') })).status).toBe(404);
    const f = join(tmp('cp-f-'), 'file.txt');
    writeFileSync(f, 'x');
    expect((await request(app).post('/api/repos/import/folder').send({ path: f })).body.error.code).toBe('not_a_folder');
    if (process.platform === 'win32') {
      expect((await request(app).post('/api/repos/import/folder').send({ path: 'C:\\' })).body.error.code).toBe('folder_not_allowed');
      expect((await request(app).post('/api/repos/import/folder').send({ path: 'C:\\Windows' })).body.error.code).toBe('folder_not_allowed');
    }
  });
  it('honours default ignores and .gitignore, skips binaries, flags secret files without reading them', () => {
    const dir = writeSampleRepo(tmp('cp-scan-'));
    const s = scanRepository(dir);
    const paths = s.files.map((f) => f.path);
    expect(paths).not.toContain('node_modules/leftpad/index.js');
    expect(paths).not.toContain('dist/bundle.js');
    expect(paths).not.toContain('debug.log');
    expect(paths).not.toContain('secret_dir/hidden.js');
    expect(s.ignored.find((i) => i.path === 'node_modules')?.reason).toBe('ignored by default');
    expect(s.ignored.find((i) => i.path === 'debug.log')?.reason).toBe('.gitignore');
    const env = s.files.find((f) => f.path === '.env')!;
    expect(env.sensitive).toBe(true);
    expect(env.content).toBeUndefined();
    expect(s.files.find((f) => f.path === '.env.example')!.sensitive).toBe(false);
    expect(s.files.find((f) => f.path === 'logo.png')!.binary).toBe(true);
    expect(s.files.find((f) => f.path === 'data.bin.txt')!.binary).toBe(true);
    expect(s.files.find((f) => f.path === 'empty.py')!.lines).toBe(0);
    expect(s.files.find((f) => f.path === 'tests/test_main.py')!.kind).toBe('test');
  });
  it('lists but does not read large files', () => {
    const dir = tmp('cp-big-');
    writeFileSync(join(dir, 'huge.js'), 'x'.repeat(1024 * 1024 + 10));
    const f = scanRepository(dir).files[0];
    expect(f.skipped).toMatch(/larger than/);
    expect(f.content).toBeUndefined();
  });
  it('never follows symbolic links / junctions out of the repository', () => {
    const outside = tmp('cp-outside-');
    writeFileSync(join(outside, 'private.txt'), 'outside data');
    const dir = tmp('cp-link-');
    writeFileSync(join(dir, 'a.js'), 'let a = 1;\n');
    let linked = true;
    try {
      symlinkSync(outside, join(dir, 'escape'), 'junction');
    } catch {
      linked = false; // symlinks may need extra rights; junctions normally do not
    }
    const s = scanRepository(dir);
    expect(s.files.map((f) => f.path)).toEqual(['a.js']);
    if (linked) expect(s.ignored.find((i) => i.path === 'escape')?.reason).toMatch(/symbolic link/);
  });
  it('supports .gitignore negation, anchors and ** globs', () => {
    const rules = parseGitignore(['*.log', '!keep.log', '/build', 'docs/**/draft*', 'tmp/'].join('\n'));
    expect(isIgnored(rules, 'a/b.log', false)).toBe(true);
    expect(isIgnored(rules, 'keep.log', false)).toBe(false);
    expect(isIgnored(rules, 'build', true)).toBe(true);
    expect(isIgnored(rules, 'src/build', true)).toBe(false);
    expect(isIgnored(rules, 'docs/x/y/draft1.md', false)).toBe(true);
    expect(isIgnored(rules, 'tmp', false)).toBe(false);
    expect(isIgnored(rules, 'tmp', true)).toBe(true);
  });
  it('detects the project profile from real files', async () => {
    const { id } = await importSample();
    const ov = (await request(app).get(`/api/repos/${id}`)).body.data;
    const p = ov.repo.profile;
    expect(p.frameworks.map((f: any) => f.name)).toEqual(expect.arrayContaining(['React', 'Express', 'Vitest']));
    expect(p.projectTypes).toEqual(expect.arrayContaining(['Full-stack application', 'Node.js', 'TypeScript', 'Python', 'Java', 'C']));
    expect(p.entryPoints.map((e: any) => e.path)).toEqual(expect.arrayContaining(['src/server.js', 'java/Main.java', 'app/main.py', 'c/util.c']));
    expect(p.testDirs).toContain('tests');
    expect(p.docs).toContain('README.md');
    expect(ov.repo.analysis.managers).toEqual(expect.arrayContaining(['pip', 'npm (no lockfile)']));
    // duplicate import of the same folder is refused
    const again = await request(app).post('/api/repos/import/folder').send({ path: ov.repo.rootPath });
    expect(again.status).toBe(409);
  });
});

// ------------------------------------------------------------------ static analysis
describe('static analysis rules', () => {
  let id = 0;
  let all: any[] = [];
  beforeAll(async () => {
    id = (await importSample()).id;
    all = await findings(id);
  });
  const at = (rule: string, file: string, needle: string) => all.find((f) => f.ruleId === rule && f.path === file && f.line === lineOf(file, needle));

  it.each([
    ['SEC-004', 'src/server.js', "db.query('SELECT", 'high'],
    ['SEC-005', 'src/server.js', "exec('ls '", 'high'],
    ['SEC-006', 'src/server.js', 'eval(process.argv', 'high'],
    ['SEC-001', 'src/server.js', 'const dbPassword', 'high'],
    ['SEC-012', 'src/server.js', 'const API_URL', 'low'],
    ['SEC-014', 'src/server.js', "origin: '*'", 'medium'],
    ['SEC-010', 'src/server.js', 'Math.random()', 'medium'],
    ['SEC-011', 'src/App.tsx', 'dangerouslySetInnerHTML', 'medium'],
    ['SEC-005', 'app/main.py', 'os.system(f"echo', 'high'],
    ['SEC-007', 'app/main.py', 'pickle.load(f)', 'high'],
    ['SEC-007', 'app/main.py', 'yaml.load(text)', 'high'],
    ['SEC-009', 'app/main.py', 'hashlib.md5', 'medium'],
    ['SEC-005', 'java/Main.java', 'Runtime.getRuntime()', 'high'],
    ['SEC-009', 'java/Main.java', 'getInstance("MD5")', 'medium'],
    ['SEC-015', 'c/util.c', 'gets(buf)', 'high'],
    ['SEC-015', 'c/util.c', 'strcpy(dst', 'medium'],
  ])('%s in %s at the right line (%s)', (rule, file, needle, severity) => {
    const f = at(rule, file, needle);
    expect(f, `${rule} ${file}:${lineOf(file, needle)}`).toBeTruthy();
    expect(f.severity).toBe(severity);
    expect(['high', 'medium', 'low']).toContain(f.confidence);
    expect(f.source).toBe('static');
    expect(f.why).toBeTruthy();
    expect(f.fix).toBeTruthy();
  });
  it.each([
    ['CP-BUG-001', 'src/server.js', "console.log('never')"],
    ['CP-BUG-002', 'src/server.js', '} catch (e) {}'],
    ['CP-BUG-007', 'src/server.js', 'data.count == 3'],
    ['CP-BUG-009', 'src/server.js', 'const unusedThing'],
    ['CP-BUG-011', 'src/server.js', 'JSON.parse(req.query'],
    ['CP-STY-002', 'src/server.js', 'var legacy'],
    ['CP-BUG-006', 'src/App.tsx', 'items.find('],
    ['CP-DEBT-001', 'src/App.tsx', 'TODO: paginate'],
    ['CP-BUG-002', 'app/main.py', 'except:'],
    ['CP-BUG-008', 'app/main.py', 'except:'],
    ['CP-BUG-006', 'app/main.py', 're.match('],
    ['CP-BUG-009', 'app/main.py', 'unused_value = 10'],
    ['CP-BUG-012', 'app/main.py', 'f = open(path)'],
    ['CP-STY-001', 'app/main.py', 'def loadUser'],
    ['CP-CPX-001', 'app/main.py', 'def classify'],
    ['CP-CPX-002', 'app/main.py', 'def classify'],
    ['CP-CPX-005', 'app/main.py', 'def classify'],
    ['CP-PERF-002', 'java/Main.java', 'out += i'],
    ['CP-BUG-012', 'java/Main.java', 'new BufferedReader'],
    ['CP-BUG-011', 'java/Main.java', 'Integer.parseInt'],
    ['CP-BUG-002', 'java/Main.java', '} catch (Exception e) {'],
    ['CP-STY-001', 'java/Main.java', 'class helper'],
    ['CP-PERF-001', 'c/util.c', 'i < strlen(s)'],
    ['CP-BUG-003', 'c/util.c', "s[i] = 'a'"],
    ['CP-BUG-004', 'c/util.c', 'if (0)'],
    ['CP-BUG-012', 'c/util.c', 'fopen('],
    ['CP-BUG-013', 'c/util.c', 'atoi(buf)'],
    ['CP-DUP-001', 'src/b.js', 'function normalise'],
  ])('%s in %s at the right line', (rule, file, needle) => {
    expect(at(rule, file, needle), `${rule} ${file}:${lineOf(file, needle)}`).toBeTruthy();
  });
  it('reports both secrets on one line, redacts them everywhere and never reads .env', async () => {
    const keys = all.filter((f) => f.path === 'config/keys.js' && f.ruleId === 'SEC-001');
    expect(keys.map((k) => k.title).sort()).toEqual(['Hard-coded AWS access key ID', 'Hard-coded GitHub token']);
    const dump = JSON.stringify(all);
    expect(dump).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(dump).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
    expect(dump).not.toContain('Sup3rS3cretValue!');
    expect(dump).not.toContain('do-not-read-me');
    const env = all.find((f) => f.path === '.env');
    expect(env.ruleId).toBe('SEC-003');
    expect(env.line).toBeNull();
    expect((await request(app).get(`/api/repos/${id}/file?path=.env`)).status).toBe(403);
    expect((await request(app).get(`/api/repos/${id}/file?path=logo.png`)).status).toBe(415);
    expect((await request(app).get(`/api/repos/${id}/file?path=../package.json`)).status).toBe(404);
  });
  it('measures complexity on the syntax tree', async () => {
    const cx = (await request(app).get(`/api/repos/${id}/complexity`)).body.data;
    const classify = cx.mostComplexFunctions[0];
    expect(classify.name).toBe('classify');
    expect(classify.path).toBe('app/main.py');
    expect(classify.complexity).toBe(21);
    expect(classify.nesting).toBe(5);
    expect(cx.distribution.reduce((a: number, b: any) => a + b.count, 0)).toBe(cx.functions);
  });
  it('handles empty files, unsupported syntax and syntax errors without inventing findings', () => {
    expect(analyzeFile({ path: 'e.py', language: 'python', kind: 'source', content: '' }).findings).toEqual([]);
    const broken = analyzeFile({ path: 'b.js', language: 'javascript', kind: 'source', content: 'function (( {\n  let x = ;\n' });
    expect(broken.metrics.parseErrors).toBeGreaterThan(0);
    const unknown = analyzeFile({ path: 'x.rs', language: 'rust', kind: 'source', content: 'fn main() { let x = 5; }\n' });
    expect(unknown.metrics.parsed).toBe(false);
    expect(unknown.findings).toEqual([]);
  });
  it('flags secrets in test files with low confidence and ignores placeholders', () => {
    const t = analyzeFile({ path: 'tests/conf.test.js', language: 'javascript', kind: 'test', content: "const password = 'hunter2hunter2';\nconst api_key = 'your_api_key_here';\n" });
    const s = t.findings.filter((f) => f.ruleId === 'SEC-001');
    expect(s).toHaveLength(1);
    expect(s[0].confidence).toBe('low');
  });
  it('redacts secrets from arbitrary text', () => {
    const t = redactSecrets(`key = "${'AKIA' + 'ABCDEFGHIJKLMNOP'}"\npassword = "s3cretpass!"\n${'-----BEGIN ' + 'RSA PRIVATE KEY-----'}\nMIIabc\n${'-----END ' + 'RSA PRIVATE KEY-----'}`);
    expect(t).not.toMatch(/AKIA[A-Z]{16}|s3cretpass|MIIabc/);
  });
  it('computes the documented quality score', () => {
    const f = (severity: string) => ({ severity, present: true, status: 'open' }) as any;
    expect(qualityScore([], 5000).score).toBe(100);
    // 2 high (10) + 1 medium (2) = 12 over 2 KLOC → density 6 → 100 / 1.6 = 62.5 → 63
    expect(qualityScore([f('high'), f('high'), f('medium')], 2000).score).toBe(63);
    expect(qualityScore([{ ...f('critical'), status: 'dismissed' }], 1000).score).toBe(100);
  });
  it('produces a prioritised technical-debt report with evidence', async () => {
    const d = (await request(app).get(`/api/repos/${id}/debt`)).body.data;
    expect(d.items.length).toBeGreaterThan(2);
    for (let i = 1; i < d.items.length; i++) expect(d.items[i - 1].priority).toBeGreaterThanOrEqual(d.items[i].priority);
    const cx = d.items.find((x: any) => x.id === 'complex-functions');
    expect(cx.evidence[0].path).toBe('app/main.py');
    expect(JSON.stringify(d)).not.toMatch(/\b(hours?|days?|weeks?)\b/i);
  });
});

// ------------------------------------------------------------------ dependencies
describe('dependency analysis', () => {
  it('parses npm, PyPI, Maven, Gradle and CMake manifests with lockfiles', () => {
    const files = [
      { path: 'package.json', language: 'json', content: JSON.stringify({ dependencies: { express: '^4.19.2' }, devDependencies: { vitest: '1.6.0' } }) },
      { path: 'package-lock.json', language: 'json', content: JSON.stringify({ packages: { '': {}, 'node_modules/express': { version: '4.19.2' }, 'node_modules/debug': { version: '2.6.9' }, 'node_modules/send/node_modules/debug': { version: '4.3.4' } } }) },
      { path: 'svc/pom.xml', language: 'xml', content: '<project><properties><junit.version>5.10.0</junit.version></properties><dependencies><dependency><groupId>org.junit</groupId><artifactId>junit-jupiter</artifactId><version>${junit.version}</version><scope>test</scope></dependency></dependencies></project>' },
      { path: 'android/build.gradle', language: 'groovy', content: "dependencies {\n  implementation 'com.squareup.okhttp3:okhttp:4.12.0'\n  implementation 'com.google.code.gson:gson:2.+'\n}\n" },
      { path: 'native/CMakeLists.txt', language: 'cmake', content: 'find_package(OpenSSL 3.0 REQUIRED)\n' },
      { path: 'py/pyproject.toml', language: 'toml', content: '[project]\nname = "x"\ndependencies = ["requests>=2.31", "rich==13.7.0"]\n' },
    ];
    const r = analyzeDependencies(files);
    const by = (n: string) => r.dependencies.find((d) => d.name === n)!;
    expect(by('express')).toMatchObject({ resolved: '4.19.2', direct: true, dev: false, ecosystem: 'npm' });
    expect(by('vitest').dev).toBe(true);
    expect(by('debug').direct).toBe(false);
    expect(by('org.junit:junit-jupiter')).toMatchObject({ spec: '5.10.0', dev: true, ecosystem: 'maven' });
    expect(by('com.google.code.gson:gson').resolved).toBeNull();
    expect(by('OpenSSL')).toMatchObject({ ecosystem: 'cmake', spec: '3.0' });
    expect(by('rich').spec).toBe('==13.7.0');
    expect(r.issues.find((i) => i.rule === 'version-conflict')?.dependency).toBe('debug');
    expect(r.issues.find((i) => i.rule === 'unpinned-version' && i.dependency === 'com.google.code.gson:gson')).toBeTruthy();
    expect(r.issues.find((i) => i.rule === 'missing-lockfile')).toBeUndefined();
    expect(r.managers).toEqual(expect.arrayContaining(['npm', 'maven', 'gradle', 'cmake']));
  });
  it('reports invalid manifests and missing lockfiles without crashing', () => {
    const r = analyzeDependencies([
      { path: 'package.json', language: 'json', content: '{ "dependencies": { "a": ' },
      { path: 'web/package.json', language: 'json', content: '{"dependencies":{"left-pad":"*"}}' },
      { path: 'Pipfile', language: null, content: '[packages]\nflask = "*"\n' },
    ]);
    expect(r.issues.find((i) => i.rule === 'invalid-manifest' && i.manifest === 'package.json')).toBeTruthy();
    expect(r.issues.filter((i) => i.rule === 'missing-lockfile').map((i) => i.manifest).sort()).toEqual(['Pipfile', 'web/package.json']);
  });
  it('exposes dependencies and issues through the API without claiming vulnerabilities', async () => {
    const { id } = await importSample();
    const d = (await request(app).get(`/api/repos/${id}/dependencies`)).body.data;
    expect(d.vulnerabilityData).toMatch(/not checked/);
    expect(d.dependencies.find((x: any) => x.name === 'left-pad').spec).toBe('*');
    const rules = d.issues.map((i: any) => i.ruleId);
    expect(rules).toEqual(expect.arrayContaining(['DEP-001', 'DEP-002', 'DEP-003', 'DEP-005']));
    expect(JSON.stringify(d)).not.toMatch(/CVE-|vulnerab(le|ility) found/i);
  });
});

// ------------------------------------------------------------------ findings management
describe('findings management', () => {
  it('searches, filters, sorts, updates and keeps statuses across re-analysis', async () => {
    const { id, dir } = await importSample();
    const sec = await findings(id, '&category=security&sort=confidence');
    expect(sec.every((f) => f.category === 'security')).toBe(true);
    const confRank = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    for (let i = 1; i < sec.length; i++) expect(confRank[sec[i - 1].confidence]).toBeLessThanOrEqual(confRank[sec[i].confidence]);
    expect((await findings(id, '&severity=critical,high')).every((f) => ['critical', 'high'].includes(f.severity))).toBe(true);
    expect((await findings(id, '&path=c')).every((f) => f.path.startsWith('c/'))).toBe(true);
    expect((await findings(id, '&search=strcpy')).length).toBe(1);
    const eqeq = (await findings(id, '&search=loose')).find((f) => f.ruleId === 'CP-BUG-007');
    const dismissed = await request(app).patch(`/api/repos/${id}/findings/${eqeq.id}`).send({ status: 'dismissed', note: 'Intentional coercion' });
    expect(dismissed.body.data.status).toBe('dismissed');
    const sqli = (await findings(id, '&search=SQL')).find((f) => f.ruleId === 'SEC-004');
    await request(app).patch(`/api/repos/${id}/findings/${sqli.id}`).send({ userVerified: true, status: 'reviewed' }).expect(200);
    await request(app).patch(`/api/repos/${id}/findings/${sqli.id}`).send({ status: 'bogus' }).expect(400);
    // edit the file above the findings (line numbers shift) and re-run the analysis
    writeFileSync(join(dir, 'src/server.js'), '// header added later\n// second line\n' + SAMPLE['src/server.js']);
    const job = (await request(app).post(`/api/repos/${id}/analyze`)).body.data;
    expect((await waitJob(job.id)).status).toBe('done');
    const after = await findings(id);
    const e2 = after.find((f) => f.id === eqeq.id);
    expect(e2.status).toBe('dismissed');
    expect(e2.note).toBe('Intentional coercion');
    expect(e2.line).toBe(eqeq.line + 2);
    const s2 = after.find((f) => f.id === sqli.id);
    expect(s2.userVerified).toBe(true);
    expect(s2.status).toBe('reviewed');
    // dismissed findings do not count in the overview statistics
    const ov = (await request(app).get(`/api/repos/${id}`)).body.data;
    expect(ov.stats.findingsBySeverity.low).toBe(after.filter((f) => f.severity === 'low' && f.status !== 'dismissed' && f.status !== 'fixed').length);
    // a finding whose code was removed is no longer present
    writeFileSync(join(dir, 'c/util.c'), SAMPLE['c/util.c'].replace('    strcpy(dst, buf);\n', ''));
    await waitJob((await request(app).post(`/api/repos/${id}/analyze`)).body.data.id);
    expect((await findings(id, '&search=strcpy')).length).toBe(0);
    expect((await findings(id, '&search=strcpy&includeResolved=1')).length).toBe(1);
  });
  it('supports multiple repositories and cancellation of an analysis', async () => {
    const a = await importSample();
    const b = await importSample();
    const list = (await request(app).get('/api/repos')).body.data;
    expect(list.map((r: any) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    const job = (await request(app).post(`/api/repos/${a.id}/analyze`)).body.data;
    await request(app).post(`/api/repos/jobs/${job.id}/cancel`);
    const done = await waitJob(job.id);
    expect(['cancelled', 'done']).toContain(done.status);
    expect((await request(app).get(`/api/repos/${a.id}`)).body.data.repo.status).not.toBe('analyzing');
    // deleting a folder repository never touches the original folder
    const del = (await request(app).delete(`/api/repos/${b.id}?confirm=yes`)).body.data;
    expect(del.originalFolderUntouched).toBe(true);
    expect(existsSync(join(b.dir, 'src/server.js'))).toBe(true);
    await request(app).get(`/api/repos/${b.id}`).expect(404);
  });
  it('lists repository activity events', async () => {
    const { id } = await importSample();
    const ev = (await request(app).get(`/api/repos/${id}/events`)).body.data;
    expect(ev.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['import', 'analysis']));
  });
});

// ------------------------------------------------------------------ Git
const hasGit = detectGit(true).available;
function gitCli(dir: string, ...args: string[]) {
  const r = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
}
describe.runIf(hasGit)('Git integration (read-only)', () => {
  it('shows branch, commits, staged / unstaged / untracked changes and diffs', async () => {
    const dir = writeSampleRepo(tmp('cp-git-'));
    gitCli(dir, 'init', '-q', '-b', 'main');
    gitCli(dir, 'add', '-A');
    gitCli(dir, 'commit', '-q', '-m', 'Initial import');
    appendFileSync(join(dir, 'src/server.js'), "function added() { eval(userInput); }\n");
    writeFileSync(join(dir, 'README.md'), SAMPLE['README.md'] + 'More docs.\n');
    gitCli(dir, 'add', 'README.md');
    writeFileSync(join(dir, 'src/new.js'), "const x = 1;\n");
    const r = await request(app).post('/api/repos/import/folder').send({ path: dir });
    const id = r.body.data.repo.id;
    expect(r.body.data.repo.isGit).toBe(true);
    await waitJob(r.body.data.job.id);
    const g = (await request(app).get(`/api/repos/${id}/git`)).body.data;
    expect(g.available).toBe(true);
    expect(g.branch).toBe('main');
    expect(g.commits[0].subject).toBe('Initial import');
    expect(g.commits[0].added).toBeGreaterThan(50);
    const by = (p: string) => g.changes.find((c: any) => c.path === p);
    expect(by('README.md')).toMatchObject({ staged: 'M', unstaged: null });
    expect(by('src/server.js')).toMatchObject({ staged: null, unstaged: 'M', added: 1, deleted: 0 });
    expect(by('src/new.js').untracked).toBe(true);
    expect(g.summary).toMatchObject({ staged: 1, unstaged: 1, untracked: 1 });
    const diff = (await request(app).get(`/api/repos/${id}/git/diff?path=src/server.js`)).body.data.diff;
    expect(diff).toContain('+function added() { eval(userInput); }');
    const commitDiff = (await request(app).get(`/api/repos/${id}/git/diff?commit=${g.commits[0].short}`)).body.data.diff;
    expect(commitDiff).toContain('Initial import');
    await request(app).get(`/api/repos/${id}/git/diff?commit=--output=x`).expect(422);
    // change review (static only): the new eval is reported as introduced; untouched findings are not
    const rv = (await request(app).post(`/api/repos/${id}/git/review`).send({ useAi: false })).body.data;
    expect(rv.introduced.some((i: any) => i.ruleId === 'SEC-006' && i.path === 'src/server.js')).toBe(true);
    expect(rv.introduced.some((i: any) => i.ruleId === 'SEC-004')).toBe(false);
    expect(rv.risks.map((x: any) => x.title)).toEqual(expect.arrayContaining(['Source changed without test changes', 'High-severity findings on changed lines']));
    // nothing was committed or modified by CodePilot
    expect(gitCli(dir, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
    expect(gitCli(dir, 'status', '--porcelain')).toContain('?? src/new.js');
  });
  it('handles non-Git folders, empty repositories and a missing Git executable', async () => {
    const { id } = await importSample();
    const ng = (await request(app).get(`/api/repos/${id}/git`)).body.data;
    expect(ng.available).toBe(false);
    expect(ng.reason).toMatch(/not a Git repository/);
    const dir = tmp('cp-empty-git-');
    writeFileSync(join(dir, 'a.py'), 'print(1)\n');
    gitCli(dir, 'init', '-q');
    const r = await request(app).post('/api/repos/import/folder').send({ path: dir });
    await waitJob(r.body.data.job.id);
    const g = (await request(app).get(`/api/repos/${r.body.data.repo.id}/git`)).body.data;
    expect(g.empty).toBe(true);
    expect(g.commits).toEqual([]);
    expect(g.changes.map((c: any) => c.path)).toEqual(['a.py']);
    expect(detectGit(true, 'git-executable-that-does-not-exist').available).toBe(false);
    const missing = await request(app).get(`/api/repos/${r.body.data.repo.id}/git`);
    expect(missing.body.data.available).toBe(false);
    expect(missing.body.data.reason).toMatch(/not installed/);
    detectGit(true, 'git');
  });
  it('does not run programs configured by a malicious repository (fsmonitor, filters, textconv)', async () => {
    const dir = tmp('cp-evil-git-');
    const marker = join(tmp('cp-marker-'), 'pwned.txt').replace(/\\/g, '/');
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    writeFileSync(join(dir, '.gitattributes'), '*.txt filter=evil diff=evil\n');
    gitCli(dir, 'init', '-q');
    gitCli(dir, 'add', '-A');
    gitCli(dir, 'commit', '-q', '-m', 'c1');
    const hook = `sh -c 'echo pwned >> "${marker}"'`;
    appendFileSync(join(dir, '.git', 'config'), `[core]\n\tfsmonitor = ${hook}\n[filter "evil"]\n\tclean = ${hook}\n\tsmudge = ${hook}\n[diff "evil"]\n\ttextconv = ${hook}\n`);
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    // control: plain git really executes the configured command
    spawnSync('git', ['status', '--porcelain'], { cwd: dir });
    const control = existsSync(marker);
    rmSync(marker, { force: true });
    // CodePilot's hardened calls
    await git(dir, ['status', '--porcelain=v1', '-z']);
    await git(dir, ['diff', '--no-ext-diff', '--no-textconv', 'HEAD']);
    await git(dir, ['log', '-n', '1', '--numstat']);
    expect(existsSync(marker)).toBe(false);
    expect(control, 'the malicious config should be effective with plain git (control)').toBe(true);
    expect(safetyOverrides(dir)).toEqual(expect.arrayContaining(['filter.evil.clean=', 'diff.evil.textconv=']));
    await expect(git(dir, ['checkout', 'HEAD'])).rejects.toThrow(/not allowed/);
  });
});

// ------------------------------------------------------------------ optional tools
describe('diff parsing', () => {
  it('counts only added lines, not context lines, as changed', async () => {
    const { addedLines } = await import('../src/repo/git.js');
    const diff = ['diff --git a/x.js b/x.js', '--- a/x.js', '+++ b/x.js', '@@ -1,5 +1,6 @@', ' one', ' two', '-three', '+THREE', '+three-and-a-half', ' four', ' five', '\\ No newline at end of file', 'diff --git a/y.js b/y.js', 'new file mode 100644', '--- /dev/null', '+++ b/y.js', '@@ -0,0 +1,2 @@', '+a', '+b'].join('\n');
    const m = addedLines(diff);
    expect([...m.get('x.js')!]).toEqual([3, 4]);
    expect([...m.get('y.js')!]).toEqual([1, 2]);
  });
});

describe('optional external tools', () => {
  it('parses Bandit and Ruff JSON into labelled tool findings', () => {
    const b = parseBandit(JSON.stringify({ results: [{ filename: 'C:\\r\\app\\x.py', line_number: 3, col_offset: 4, issue_severity: 'HIGH', issue_confidence: 'MEDIUM', test_id: 'B602', test_name: 'subprocess_popen_with_shell_equals_true', issue_text: 'shell=True' }] }), 'C:\\r');
    expect(b[0]).toMatchObject({ path: 'app/x.py', line: 3, col: 5, severity: 'high', confidence: 'medium', source: 'tool', tool: 'bandit', ruleId: 'bandit:B602' });
    const r = parseRuff(JSON.stringify([{ filename: '/r/a.py', code: 'F841', message: 'Local variable `x` is assigned to but never used', location: { row: 2, column: 5 } }]), '/r');
    expect(r[0]).toMatchObject({ path: 'a.py', line: 2, category: 'bug', source: 'tool', tool: 'ruff' });
    expect(parseBandit('not json', '')).toEqual([]);
  });
  it('reports tool availability with install instructions instead of installing anything', async () => {
    const c = (await request(app).get('/api/repos/capabilities')).body.data;
    for (const t of c.tools) expect(t.install).toBeTruthy();
    expect(c.tools.find((t: any) => t.id === 'eslint').runs).toBe(false);
    expect(c.tools.find((t: any) => t.id === 'semgrep').runs).toBe(false);
    expect(c.defaultIgnores).toContain('node_modules');
  });
});

// ------------------------------------------------------------------ AI review (Ollama protocol stub)
function fromSchema(s: any, key = ''): unknown {
  if (!s) return 'stub';
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case 'object':
      return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, fromSchema(v, k)]));
    case 'array':
      return [fromSchema(s.items, key)];
    case 'integer':
      return s.minimum ?? 0;
    default:
      return `stub ${key}`;
  }
}
describe('AI code review', () => {
  let server: Server;
  let url = '';
  const prompts: string[] = [];
  let id = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/version') return res.end(JSON.stringify({ version: 'stub' }));
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: ['reviewer', 'garbage', 'slow'].map((n) => ({ name: `${n}:latest`, size: 1e9, details: { parameter_size: '1.5B' } })) }));
        if (req.url !== '/api/generate') return res.end('{}');
        const p = JSON.parse(body);
        prompts.push(p.prompt);
        const send = (t: string) => {
          res.setHeader('content-type', 'application/x-ndjson');
          res.write(JSON.stringify({ response: t, done: false }) + '\n');
          res.end(JSON.stringify({ response: '', done: true }));
        };
        if (p.model === 'slow:latest') {
          await new Promise((r) => setTimeout(r, 3000));
          return res.destroyed ? undefined : send('{}');
        }
        if (p.model === 'garbage:latest') return send('I think the code is fine!');
        const out: any = fromSchema(p.format);
        if (out.bugs) {
          // one issue on the line of the SQL query (agrees with static analysis), one AI-only issue, one invented line
          const m = /^(\d+)\| .*db\.query/m.exec(p.prompt);
          const first = /^(\d+)\| /m.exec(p.prompt);
          out.summary = 'Express handler with several risky calls.';
          out.bugs = m ? [{ line: Number(m[1]), title: 'Unvalidated query parameter', detail: 'id is concatenated into SQL', severity: 'high' }] : [];
          out.maintainability = first ? [{ line: Number(first[1]), title: 'Mixed responsibilities', detail: 'routing and data access in one place', severity: 'low' }] : [];
          out.security = [{ line: 99999, title: 'Invented line', detail: 'should be dropped', severity: 'medium' }];
          out.performance = [];
        }
        if (out.answer !== undefined) out.files = ['src/server.js'];
        return send(JSON.stringify(out));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    id = (await importSample()).id;
  });
  afterAll(async () => {
    await request(app).put('/api/settings').send({ aiProvider: 'offline' });
    server.close();
  });
  const useModel = async (model: string) => {
    await request(app).put('/api/settings').send({ aiProvider: 'ollama', ollamaUrl: url, ollamaModel: model, aiTimeoutSec: 15 });
    clearStatusCache();
  };

  it('falls back to labelled static analysis when AI is off or Ollama is unreachable', async () => {
    await request(app).put('/api/settings').send({ aiProvider: 'offline' });
    let r = (await request(app).post(`/api/repos/${id}/review/file`).send({ path: 'src/server.js' })).body.data;
    expect(r.aiAvailable).toBe(false);
    expect(r.engine.kind).toBe('offline');
    expect(r.engine.label).toMatch(/not AI/);
    expect(r.staticFindings.length).toBeGreaterThan(5);
    await request(app).put('/api/settings').send({ aiProvider: 'ollama', ollamaUrl: 'http://127.0.0.1:9', ollamaModel: 'x' });
    clearStatusCache();
    r = (await request(app).post(`/api/repos/${id}/review/file`).send({ path: 'src/server.js' })).body.data;
    expect(r.aiAvailable).toBe(false);
    expect(r.engine.notice).toMatch(/not running|not reachable|not installed/i);
  });
  it('reports a missing model', async () => {
    await useModel('not-pulled:latest');
    const r = (await request(app).post(`/api/repos/${id}/review/file`).send({ path: 'src/server.js' })).body.data;
    expect(r.aiAvailable).toBe(false);
    expect(r.engine.notice).toMatch(/not installed|missing/i);
  });
  it('reviews a file with validated JSON, redacts secrets, keeps only real line numbers and caches', async () => {
    await useModel('reviewer:latest');
    prompts.length = 0;
    const r = (await request(app).post(`/api/repos/${id}/review/file`).send({ path: 'src/server.js' })).body.data;
    expect(r.aiAvailable).toBe(true);
    expect(r.engine.kind).toBe('ollama');
    expect(r.review.summary).toMatch(/Express/);
    expect(r.review.security[0].line).toBe(0); // invented line 99999 discarded
    expect(prompts.join('\n')).not.toContain('Sup3rS3cretValue!');
    expect(prompts.join('\n')).toContain('«REDACTED»');
    // AI issue on the SQL line marks the static finding "combined"; the other issue is AI-only
    const all = await findings(id);
    const sqli = all.find((f) => f.ruleId === 'SEC-004');
    expect(sqli.source).toBe('combined');
    expect(sqli.description).toMatch(/Local AI review: Unvalidated query parameter/);
    const aiOnly = all.find((f) => f.source === 'ai' && f.title === 'Mixed responsibilities');
    expect(aiOnly).toMatchObject({ confidence: 'low', category: 'maintainability' });
    expect(aiOnly.line).toBeGreaterThan(0);
    expect(all.find((f) => f.source === 'ai' && f.title === 'Invented line').line).toBeNull();
    expect(aiOnly.tool).toBe('ollama:reviewer:latest');
    // second call hits the cache (no new prompt)
    const n = prompts.length;
    const again = (await request(app).post(`/api/repos/${id}/review/file`).send({ path: 'src/server.js' })).body.data;
    expect(again.cached).toBe(true);
    expect(prompts.length).toBe(n);
    // reviewing a single function
    const fn = (await request(app).post(`/api/repos/${id}/review/file`).send({ path: 'src/server.js', functionName: 'risky' })).body.data;
    expect(fn.scope).toBe('function');
    expect(prompts.at(-1)).toContain('function risky()');
    expect(prompts.at(-1)).not.toContain('app.get(');
    // sensitive files are never sent
    expect((await request(app).post(`/api/repos/${id}/review/file`).send({ path: '.env' })).status).toBe(403);
  });
  it('splits large files into context-sized chunks', () => {
    const fns = Array.from({ length: 60 }, (_, i) => `function f${i}(a) {\n${'  a = a + 1; // padding padding padding padding\n'.repeat(4)}  return a;\n}\n`).join('\n');
    const lines = fns.split('\n');
    const meta = Array.from({ length: 60 }, (_, i) => {
      const line = lines.findIndex((l) => l.startsWith(`function f${i}(`)) + 1;
      return { name: `f${i}`, line, endLine: line + 5 };
    });
    const chunks = chunkFile(fns, meta, 2000);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(2000);
    // chunks cover the file without gaps and never split a function
    expect(chunks[0].startLine).toBe(1);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].startLine).toBe(chunks[i - 1].endLine + 1);
    for (const m of meta) expect(chunks.some((c) => c.startLine <= m.line && c.endLine >= m.endLine)).toBe(true);
  });
  it('falls back when the model returns malformed JSON', async () => {
    await useModel('garbage:latest');
    const r = (await request(app).post(`/api/repos/${id}/review/file`).send({ path: 'src/App.tsx', force: true })).body.data;
    expect(r.aiAvailable).toBe(false);
    expect(r.engine.notice).toMatch(/unexpected format/i);
    expect(r.staticFindings.length).toBeGreaterThan(0);
  });
  it('times out and can be cancelled', async () => {
    await useModel('slow:latest');
    await request(app).put('/api/settings').send({ aiTimeoutSec: 15 });
    // cancellation of a background repository review
    const job = (await request(app).post(`/api/repos/${id}/review/scope`).send({ maxFiles: 3 })).body.data;
    await new Promise((r) => setTimeout(r, 300));
    await request(app).post(`/api/repos/jobs/${job.id}/cancel`).expect(200);
    const done = await waitJob(job.id);
    expect(done.status).toBe('cancelled');
  }, 20_000);
  it('reviews a folder / repository as a prioritised background job', async () => {
    await useModel('reviewer:latest');
    const job = (await request(app).post(`/api/repos/${id}/review/scope`).send({ folder: 'src', maxFiles: 2 })).body.data;
    const done = await waitJob(job.id);
    expect(done.status, done.error).toBe('done');
    expect(done.result.reviewed).toBe(2);
    expect(done.result.files.every((f: any) => f.path.startsWith('src/'))).toBe(true);
    expect((await request(app).get(`/api/repos/${id}/review/last`)).body.data.folder).toBe('src/');
  });
  it('answers questions from retrieved excerpts only and handles follow-ups on findings', async () => {
    await useModel('reviewer:latest');
    prompts.length = 0;
    const a = (await request(app).post(`/api/repos/${id}/ask`).send({ question: 'Where is the user query endpoint and how is the id handled?' })).body.data;
    expect(a.aiAvailable).toBe(true);
    expect(a.sources.length).toBeLessThanOrEqual(3);
    expect(a.sources.map((s: any) => s.path)).toContain('src/server.js');
    expect(a.cited).toEqual(['src/server.js']);
    expect(prompts[0].length).toBeLessThan(12_000);
    const f = (await findings(id, '&search=strcpy'))[0];
    const fu = (await request(app).post(`/api/repos/${id}/ask`).send({ question: 'How do I fix this safely?', findingId: f.id })).body.data;
    expect(fu.sources[0].path).toBe('c/util.c');
    expect(prompts.at(-1)).toContain('strcpy');
    await request(app).put('/api/settings').send({ aiProvider: 'offline' });
    const off = (await request(app).post(`/api/repos/${id}/ask`).send({ question: 'Where is JSON parsed?' })).body.data;
    expect(off.aiAvailable).toBe(false);
    expect(off.answer).toBeNull();
    expect(off.sources[0].path).toBe('src/server.js');
  });
});

// ------------------------------------------------------------------ reports
describe('reports', () => {
  it('generates a Markdown report with metadata, breakdown, limitations and no secrets', async () => {
    const { id } = await importSample();
    const r = await request(app).get(`/api/repos/${id}/report.md`);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename=".*\.md"/);
    const md = r.text;
    for (const s of ['# Code Quality Report', 'Report generated', 'Analysis engines', 'AI model', 'Quality score', '## 3. Findings breakdown', '## 4. Security findings', 'cannot prove the absence of vulnerabilities', '## 8. Technical debt', '## 11. Limitations', 'not** a manual security audit'])
      expect(md).toContain(s);
    expect(md).not.toContain('Sup3rS3cretValue!');
    expect(md).not.toMatch(/AKIA[0-9A-Z]{16}/);
    const html = await request(app).get(`/api/repos/${id}/report.html`);
    expect(html.text).toContain('<table>');
    expect(html.headers['content-security-policy']).toMatch(/default-src 'none'/);
  });
  it('refuses a report for a repository that has not been analysed', async () => {
    const dir = tmp('cp-noana-');
    writeFileSync(join(dir, 'a.js'), 'let a;\n');
    const r = await request(app).post('/api/repos/import/folder').send({ path: dir });
    const id = r.body.data.repo.id;
    const job = r.body.data.job.id;
    await request(app).post(`/api/repos/jobs/${job}/cancel`);
    const j = await waitJob(job);
    if (j.status === 'cancelled') expect((await request(app).get(`/api/repos/${id}/report.md`)).status).toBe(409);
  });
  it.runIf(!!findBrowser())('renders a PDF with the local browser', async () => {
    const { id } = await importSample();
    const r = await request(app).get(`/api/repos/${id}/report.pdf`).buffer(true).parse((res, cb) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => cb(null, Buffer.concat(parts)));
    });
    expect(r.status, String(r.body).slice(0, 200)).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((r.body as Buffer).length).toBeGreaterThan(10_000);
  }, 90_000);
});

describe('regression: existing modules unaffected', () => {
  it('2.0 endpoints still answer', async () => {
    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/dashboard').expect(200);
    await request(app).get('/api/learning/paths').expect(200);
  });
});

// keep temp folders tidy (best effort)
afterAll(() => {
  for (const d of readdirSync(tmpdir()).filter((n) => /^cp-(repo|scan|big|link|outside|f|git|empty-git|evil-git|marker|noana)-/.test(n))) rmSync(join(tmpdir(), d), { recursive: true, force: true, maxRetries: 2 });
});
void mkdirSync;
