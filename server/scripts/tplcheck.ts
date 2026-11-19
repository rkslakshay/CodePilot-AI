import { TEMPLATES } from '../src/content/templates.js';
import { translate } from '../src/engine/index.js';
import { executeCode } from '../src/execution/executor.js';
import { LANGS } from '../src/engine/ir.js';
let fails = 0;
for (const t of TEMPLATES) {
  if (process.argv[2] && t.id !== process.argv[2]) continue;
  for (const l of LANGS) {
    const code = l === 'python' ? t.python : translate(t.python, 'python', l);
    const src = typeof code === 'string' ? code : code.ok ? code.code : '';
    if (!src) { fails++; console.log('PARSE FAIL', t.id, l, (code as any).error); continue; }
    for (const tc of t.tests) {
      const r = await executeCode(l, src, tc.input);
      if (r.stdout.replace(/\r/g, '') !== tc.expected) { fails++; console.log(`FAIL ${t.id} ${l} ${r.status} got ${JSON.stringify(r.stdout)} want ${JSON.stringify(tc.expected)} ${(r.compileOutput + r.stderr).slice(0, 300)}`); if (process.env.SHOW) console.log(src); break; }
    }
    process.stdout.write('.');
  }
}
console.log('\nfails', fails);
