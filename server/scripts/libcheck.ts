import { getLibrary } from '../src/services/library.js';
import { executeCode } from '../src/execution/executor.js';
import { LANGS } from '../src/engine/ir.js';
const only = process.argv[2];
let fails = 0;
for (const a of getLibrary()) {
  if (only && a.id !== only) continue;
  for (const l of LANGS) {
    const r = await executeCode(l, a.code[l]);
    const ok = r.stdout.replace(/\r/g, '') === a.expectedOutput;
    if (!ok) { fails++; console.log(`FAIL ${a.id} ${l} ${r.status} ${JSON.stringify(r.stdout)} ${(r.compileOutput + r.stderr).slice(0, 400)}`); if (process.env.SHOW) console.log(a.code[l]); }
    else process.stdout.write('.');
  }
}
console.log('\nfails', fails);
