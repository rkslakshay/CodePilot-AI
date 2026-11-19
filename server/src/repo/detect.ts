/** Project profile: languages, frameworks, entry points, structure — derived from the scanned files only. */
import type { ScannedFile } from './scan.js';
import type { Dependency } from './deps.js';

export interface ProjectProfile {
  name: string;
  languages: { language: string; files: number; lines: number; bytes: number }[];
  frameworks: { name: string; evidence: string }[];
  projectTypes: string[];
  entryPoints: { path: string; reason: string }[];
  testDirs: string[];
  docs: string[];
  configFiles: string[];
  buildConfig: string[];
}

const FRAMEWORKS: { name: string; npm?: string[]; py?: string[]; java?: RegExp; file?: RegExp }[] = [
  { name: 'React', npm: ['react'] },
  { name: 'Next.js', npm: ['next'] },
  { name: 'Vue', npm: ['vue'] },
  { name: 'Angular', npm: ['@angular/core'] },
  { name: 'Svelte', npm: ['svelte'] },
  { name: 'Vite', npm: ['vite'] },
  { name: 'Express', npm: ['express'] },
  { name: 'NestJS', npm: ['@nestjs/core'] },
  { name: 'Fastify', npm: ['fastify'] },
  { name: 'Electron', npm: ['electron'] },
  { name: 'Tailwind CSS', npm: ['tailwindcss'] },
  { name: 'Jest', npm: ['jest'] },
  { name: 'Vitest', npm: ['vitest'] },
  { name: 'Playwright', npm: ['@playwright/test'] },
  { name: 'Django', py: ['django'] },
  { name: 'Flask', py: ['flask'] },
  { name: 'FastAPI', py: ['fastapi'] },
  { name: 'pytest', py: ['pytest'] },
  { name: 'NumPy', py: ['numpy'] },
  { name: 'pandas', py: ['pandas'] },
  { name: 'Spring Boot', java: /spring-boot/ },
  { name: 'JUnit', java: /junit/ },
];

export function profileProject(name: string, files: ScannedFile[], deps: Dependency[]): ProjectProfile {
  const langs = new Map<string, { files: number; lines: number; bytes: number }>();
  for (const f of files) {
    if (!f.language || f.binary || f.kind === 'other') continue;
    const l = langs.get(f.language) ?? { files: 0, lines: 0, bytes: 0 };
    l.files++;
    l.lines += f.lines;
    l.bytes += f.size;
    langs.set(f.language, l);
  }
  const languages = [...langs.entries()].map(([language, v]) => ({ language, ...v })).sort((a, b) => b.lines - a.lines);

  const frameworks: ProjectProfile['frameworks'] = [];
  for (const fw of FRAMEWORKS) {
    const d = deps.find((x) => x.direct && ((fw.npm && x.ecosystem === 'npm' && fw.npm.includes(x.name)) || (fw.py && x.ecosystem === 'pypi' && fw.py.includes(x.name)) || (fw.java && (x.ecosystem === 'maven' || x.ecosystem === 'gradle') && fw.java.test(x.name))));
    if (d) frameworks.push({ name: fw.name, evidence: `${d.name} in ${d.manifest}` });
  }
  if (!frameworks.some((f) => f.name === 'Django') && files.some((f) => /(^|\/)manage\.py$/.test(f.path) && /django/.test(f.content ?? ''))) frameworks.push({ name: 'Django', evidence: 'manage.py' });

  const has = (n: string) => frameworks.some((f) => f.name === n);
  const langSet = new Set(languages.map((l) => l.language));
  const types: string[] = [];
  const frontend = has('React') || has('Vue') || has('Angular') || has('Svelte') || has('Next.js');
  const backend = has('Express') || has('NestJS') || has('Fastify') || has('Django') || has('Flask') || has('FastAPI') || has('Spring Boot');
  if (frontend && backend) types.push('Full-stack application');
  if (has('React')) types.push('React');
  if (frontend && !has('React')) types.push('Front-end application');
  if (files.some((f) => /(^|\/)package\.json$/.test(f.path))) types.push('Node.js');
  if (langSet.has('typescript') || langSet.has('tsx')) types.push('TypeScript');
  if (langSet.has('javascript')) types.push('JavaScript');
  if (langSet.has('python')) types.push('Python');
  if (langSet.has('java')) types.push('Java');
  if (langSet.has('c')) types.push('C');
  if (langSet.has('cpp')) types.push('C++');
  if ((langSet.has('html') || langSet.has('css')) && !frontend) types.push('HTML/CSS');

  const entryPoints: ProjectProfile['entryPoints'] = [];
  for (const f of files.filter((x) => /(^|\/)package\.json$/.test(x.path) && x.content)) {
    try {
      const pkg = JSON.parse(f.content!);
      const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : '';
      if (typeof pkg.main === 'string') entryPoints.push({ path: dir + pkg.main.replace(/^\.\//, ''), reason: `"main" in ${f.path}` });
      if (pkg.bin) for (const b of typeof pkg.bin === 'string' ? [pkg.bin] : Object.values<string>(pkg.bin)) entryPoints.push({ path: dir + String(b).replace(/^\.\//, ''), reason: `"bin" in ${f.path}` });
      if (pkg.scripts?.start) entryPoints.push({ path: f.path, reason: `npm start: ${String(pkg.scripts.start).slice(0, 80)}` });
    } catch {
      /* reported by the dependency analyser */
    }
  }
  const ENTRY = /(^|\/)(index\.html|main\.(py|c|cpp|cc|go|rs|tsx?|jsx?)|app\.(py|tsx?|jsx?)|server\.(tsx?|jsx?)|index\.(tsx?|jsx?)|manage\.py|__main__\.py|wsgi\.py|asgi\.py)$/i;
  for (const f of files) {
    if (f.kind === 'test' || entryPoints.some((e) => e.path === f.path)) continue;
    if (ENTRY.test(f.path) && f.path.split('/').length <= 4) entryPoints.push({ path: f.path, reason: 'conventional entry-point name' });
    else if (f.content && f.language === 'java' && /public\s+static\s+void\s+main\s*\(/.test(f.content)) entryPoints.push({ path: f.path, reason: 'contains public static void main' });
    else if (f.content && f.language === 'python' && /^if\s+__name__\s*==\s*['"]__main__['"]/m.test(f.content)) entryPoints.push({ path: f.path, reason: 'has an if __name__ == "__main__" block' });
    else if (f.content && (f.language === 'c' || f.language === 'cpp') && /\bint\s+main\s*\(/.test(f.content)) entryPoints.push({ path: f.path, reason: 'defines main()' });
  }

  const testDirs = [...new Set(files.filter((f) => f.kind === 'test').map((f) => {
    const m = /^(.*?(?:^|\/)(?:tests?|__tests__|spec|specs|e2e|testing))\//i.exec(f.path);
    return m ? m[1] : f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
  }))].sort();
  const docs = files.filter((f) => f.kind === 'doc').map((f) => f.path);
  const configFiles = files.filter((f) => f.kind === 'config').map((f) => f.path);
  const buildConfig = configFiles.filter((p) => /(vite|webpack|rollup|babel|tsconfig|jsconfig|tailwind|postcss)[^/]*$|pom\.xml$|build\.gradle|CMakeLists\.txt$|Makefile$|Dockerfile$|setup\.(py|cfg)$|pyproject\.toml$/i.test(p));
  return { name, languages, frameworks, projectTypes: [...new Set(types)], entryPoints: entryPoints.slice(0, 40), testDirs, docs, configFiles, buildConfig };
}
