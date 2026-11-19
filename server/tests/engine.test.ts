import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { sandboxStatus } from '../src/execution/sandbox.js';
import { translate } from '../src/engine/index.js';
import { parseProgram } from '../src/engine/parser.js';
import { analyzeCode, estimateComplexity } from '../src/engine/analyzer.js';
import { toPseudocode, toFlowchart } from '../src/engine/views.js';
import { interpretErrors, repairCode } from '../src/engine/debugger.js';
import { executeCode } from '../src/execution/executor.js';
import { scanCode } from '../src/execution/guard.js';
import { LANGS, LANG_EXT, type Lang } from '../src/engine/ir.js';

const fixture = (name: string, l: Lang) => readFileSync(new URL(`./fixtures/${name}.${LANG_EXT[l]}`, import.meta.url), 'utf8');
const norm = (s: string) => s.replace(/\r/g, '');

describe('offline converter (executed with real compilers)', () => {
  for (const name of ['sum', 'algo']) {
    for (const from of LANGS) {
      let src: string;
      try {
        src = fixture(name, from);
      } catch {
        continue;
      }
      it(`${name}.${LANG_EXT[from]} converts to every other language with identical output`, async () => {
        const stdin = '5\n4\n8\n15\n16\n23\n';
        const original = await executeCode(from, src, stdin);
        expect(original.status).toBe('success');
        for (const to of LANGS) {
          if (to === from) continue;
          const r = translate(src, from, to);
          expect(r.ok, `${from}->${to} parse`).toBe(true);
          const out = await executeCode(to, r.code, stdin);
          expect(out.status, `${from}->${to}: ${out.compileOutput}${out.stderr}`).toBe('success');
          expect(norm(out.stdout), `${from}->${to}`).toBe(norm(original.stdout));
        }
      });
    }
  }

  // Phase 3: classes, constructors, methods, exceptions, maps, sets, string operations.
  // C has no maps / exceptions / string library, so it is only expected to work for plain numeric classes.
  const rich: [string, Lang, Lang[]][] = [
    ['oop', 'python', ['cpp', 'java', 'javascript']],
    ['oop', 'java', ['cpp', 'python', 'javascript']],
    ['oop', 'javascript', ['cpp', 'java', 'python']],
    ['maps', 'python', ['cpp', 'java', 'javascript']],
    ['strs', 'python', ['cpp', 'java', 'javascript']],
    ['point', 'python', ['c', 'cpp', 'java', 'javascript']],
  ];
  for (const [name, from, targets] of rich) {
    it(`${name}.${LANG_EXT[from]} (classes / maps / sets / exceptions / strings) converts with identical output`, async () => {
      const src = fixture(name, from);
      const original = await executeCode(from, src, '');
      expect(original.status).toBe('success');
      for (const to of targets) {
        const r = translate(src, from, to);
        expect(r.ok, `${from}->${to}`).toBe(true);
        const out = await executeCode(to, r.code, '');
        expect(out.status, `${from}->${to}: ${out.compileOutput}${out.stderr}\n${r.code}`).toBe('success');
        expect(norm(out.stdout), `${from}->${to}`).toBe(norm(original.stdout));
      }
    });
  }

  it('warns instead of silently producing C code for maps', () => {
    const r = translate(fixture('maps', 'python'), 'python', 'c');
    expect(r.warnings.some((w) => /maps and sets have no standard C equivalent/.test(w))).toBe(true);
  });

  it('reports unsupported constructs honestly instead of inventing code', () => {
    const r = translate('with open("data.txt") as fh:\n    print(fh.read())\nf = lambda v: v * 2\nprint(f(3))\n', 'python', 'c');
    expect(r.ok).toBe(true);
    expect(r.code).toContain('Not converted');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('marks broken source as unconverted rather than guessing', () => {
    const r = translate('int main() {\n  int x = (3 + ;\n  return 0;\n}\n', 'c', 'python');
    expect(!r.ok || r.warnings.length > 0).toBe(true);
  });
});

describe('analyzer', () => {
  it('explains code line by line and estimates complexity', () => {
    const a = analyzeCode(fixture('algo', 'python'), 'python', 'beginner');
    expect(a.parsed).toBe(true);
    expect(a.functions.map((f) => f.name)).toEqual(['factorial', 'is_prime', 'bubble_sort']);
    expect(a.functions[0].recursive).toBe(true);
    expect(a.lines.find((l) => l.line === 1)?.kind).toBe('function');
    expect(a.complexity.time).toBe('O(n²)');
  });

  it('detects logarithmic and exponential patterns', () => {
    const bs = parseProgram('def bs(a, t):\n    lo = 0\n    hi = len(a) - 1\n    while lo <= hi:\n        mid = (lo + hi) // 2\n        if a[mid] < t:\n            lo = mid + 1\n        else:\n            hi = mid - 1\n    return lo\n', 'python');
    expect(estimateComplexity(bs).time).toBe('O(log n)');
    const fib = parseProgram('def fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n', 'python');
    expect(estimateComplexity(fib).time).toBe('O(2ⁿ)');
  });

  it('finds common mistakes', () => {
    const code = '#include <stdio.h>\nint main() {\n    int n, sum;\n    scanf("%d", n);\n    for (int i = 1; i <= n; i++) {\n        sum += i;\n    }\n    if (n = 5) printf("five");\n    return 0;\n}\n';
    const msgs = analyzeCode(code, 'c').issues.map((i) => i.message).join(' | ');
    expect(msgs).toMatch(/address/);
    expect(msgs).toMatch(/initialised/);
    expect(msgs).toMatch(/Assignment/);
  });
});

describe('views (pseudocode & flowchart)', () => {
  const prog = parseProgram(fixture('algo', 'python'), 'python');
  it('produces structured pseudocode', () => {
    const p = toPseudocode(prog);
    expect(p).toContain('FUNCTION factorial(n)');
    expect(p).toContain('WHILE');
    expect(p).toContain('END FOR');
  });
  it('produces a Mermaid flowchart with decisions and labelled branches', () => {
    const f = toFlowchart(prog, { target: 'is_prime' });
    expect(f.targets).toContain('bubble_sort');
    expect(f.mermaid.startsWith('flowchart TD')).toBe(true);
    expect(f.mermaid).toMatch(/\{".*\?"\}/);
    expect(f.mermaid).toMatch(/-->\|Yes\|/);
  });
});

describe('debugger', () => {
  it('interprets gcc errors and repairs a missing semicolon', async () => {
    const code = '#include <stdio.h>\n\nint main() {\n    int a = 10\n    int b = 20;\n    printf("%d\\n", a + b);\n    return 0;\n}\n';
    const r = await executeCode('c', code);
    expect(r.status).toBe('compile_error');
    const d = interpretErrors(r.compileOutput, 'c', 'compile');
    expect(d.some((x) => /semicolon/i.test(x.title))).toBe(true);
    const fix = repairCode(code, 'c', d);
    expect(fix.changes.length).toBeGreaterThan(0);
    const again = await executeCode('c', fix.fixed);
    expect(again.status).toBe('success');
    expect(norm(again.stdout)).toBe('30\n');
  });
  it('repairs a missing Python colon', () => {
    const r = repairCode('def f(x)\n    return x * 2\nprint(f(4))\n', 'python');
    expect(r.fixed).toContain('def f(x):');
  });
  it('explains Python runtime errors with the right line', () => {
    const d = interpretErrors('Traceback (most recent call last):\n  File "main.py", line 3, in <module>\nZeroDivisionError: division by zero', 'python', 'runtime');
    expect(d[0].title).toBe('Division by zero');
    expect(d[0].line).toBe(3);
  });
});

describe('execution safety', () => {
  it('guard blocks dangerous APIs before running', async () => {
    expect(scanCode('import subprocess\nsubprocess.run(["dir"])', 'python').length).toBeGreaterThan(0);
    expect(scanCode('#include <stdlib.h>\nint main(){ system("del x"); }', 'c').length).toBeGreaterThan(0);
    expect(scanCode('const cp = require("child_process");', 'javascript').length).toBeGreaterThan(0);
    expect(scanCode('Runtime.getRuntime().exec("calc");', 'java').length).toBeGreaterThan(0);
    const r = await executeCode('python', 'import socket\n');
    expect(r.status).toBe('blocked');
  });
  it('Python audit hook blocks file writes at runtime', async () => {
    const r = await executeCode('python', 'f = open("x.txt", "w")\nf.write("hi")\n');
    expect(r.status).toBe('runtime_error');
    expect(r.stderr).toMatch(/execution guard/);
  });
  it('Node permission model blocks file writes', async () => {
    const r = await executeCode('javascript', 'require("fs").writeFileSync("x.txt", "hi");');
    expect(r.status).toBe('runtime_error');
    expect(r.stderr).toMatch(/ERR_ACCESS_DENIED/);
  });
  it('enforces the time limit and kills runaway programs', async () => {
    const r = await executeCode('python', 'while True:\n    pass\n', '', { timeoutMs: 1500 });
    expect(r.status).toBe('timeout');
  });
  it('caps output size', async () => {
    const r = await executeCode('javascript', 'for(;;) console.log("xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");', '', { timeoutMs: 5000, maxOutput: 10000 });
    expect(r.truncated || r.status === 'timeout').toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(10000);
  });
  it('does not leak server environment variables to programs', async () => {
    process.env.CODEPILOT_SECRET_TEST = 'top-secret';
    const r = await executeCode('python', 'import os\nprint(os.environ.get("CODEPILOT_SECRET_TEST", "absent"))\n');
    expect(norm(r.stdout)).toBe('absent\n');
  });
});

describe.runIf(process.platform === 'win32')('Windows sandbox (OS-enforced, bypassing the static guard)', () => {
  const sb = sandboxStatus();
  // The static guard can be evaded (function pointers, computed modes); these tests prove the OS still blocks it.
  const evasive = (body: string) => `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\nint main(){\n${body}\n}\n`;
  it('builds, self-tests and reports job+lowil isolation', () => {
    expect(sb.available).toBe(true);
    expect(sb.level).toBe('job+lowil');
  });
  it('runs normal programs and reports the isolation level', async () => {
    for (const [lang, code] of [['c', '#include <stdio.h>\nint main(){printf("ok\\n");return 0;}'], ['python', 'print("ok")'], ['javascript', 'console.log("ok")'], ['java', 'public class Main { public static void main(String[] a){ System.out.println("ok"); } }']] as const) {
      const r = await executeCode(lang, code);
      expect(r.status, `${lang}: ${r.stderr}${r.message ?? ''}`).toBe('success');
      expect(norm(r.stdout)).toBe('ok\n');
      expect(r.isolation).toBe('job+lowil');
    }
  });
  it('blocks writing to the user profile even when the guard is evaded', async () => {
    const target = join(homedir(), `codepilot-sbx-${process.pid}.txt`).split('\\').join('/');
    const code = evasive(`char m[3]; m[0]='w'; m[1]=0; FILE *f = fopen("${target}", m); printf(f ? "WROTE\\n" : "DENIED\\n"); if (f) fclose(f); return 0;`);
    expect(scanCode(code, 'c')).toEqual([]);
    const r = await executeCode('c', code);
    expect(norm(r.stdout)).toBe('DENIED\n');
    expect(existsSync(target)).toBe(false);
  });
  it('blocks starting child processes even when the guard is evaded', async () => {
    const code = evasive(`int (*run)(const char*) = system; int rc = run("cmd /c echo SPAWNED"); printf("rc=%d\\n", rc); return 0;`);
    expect(scanCode(code, 'c')).toEqual([]);
    const r = await executeCode('c', code);
    expect(r.stdout).not.toMatch(/SPAWNED/);
  });
  it('enforces the memory limit', async () => {
    const r = await executeCode('c', evasive('char *p = malloc(900u*1024u*1024u); if (p) memset(p, 1, 900u*1024u*1024u); printf(p ? "GOT\\n" : "REFUSED\\n"); return 0;'));
    expect(r.stdout).not.toMatch(/GOT/);
  });
  it('cannot read a folder protected with no-read-up', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cp-prot-'));
    const file = join(dir, 'secret.txt');
    writeFileSync(file, 'TOPSECRET');
    expect(spawnSync(sb.path!, ['protect', dir], { windowsHide: true }).status).toBe(0);
    const r = await executeCode('python', `print(open(${JSON.stringify(file)}).read())`);
    expect(r.stdout).not.toMatch(/TOPSECRET/);
    expect(r.stderr).toMatch(/PermissionError|denied/i);
    rmSync(dir, { recursive: true, force: true });
  });
});
