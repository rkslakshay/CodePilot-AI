import { readFileSync } from 'node:fs';
import { translate } from '../src/engine/index.js';
import { executeCode } from '../src/execution/executor.js';
import { LANGS, LANG_EXT, type Lang } from '../src/engine/ir.js';

const name = process.argv[2] ?? 'sum';
const stdin = process.argv[3] ?? '5\n4\n8\n15\n16\n23\n';
const only = process.argv[4] as Lang | undefined;
const show = process.env.SHOW === '1';
for (const from of LANGS) {
  if (only && from !== only) continue;
  let src: string;
  try { src = readFileSync(`tests/fixtures/${name}.${LANG_EXT[from]}`, 'utf8'); } catch { continue; }
  const orig = await executeCode(from, src, stdin);
  console.log(`== ${from} original: ${orig.status} ${JSON.stringify(orig.stdout)} ${orig.compileOutput.slice(0,300)} ${orig.stderr.slice(0,300)}`);
  for (const to of LANGS) {
    if (to === from) continue;
    const r = translate(src, from, to);
    if (!r.ok) { console.log(`  ${from}->${to}: PARSE FAIL ${r.error?.message} @${r.error?.line}`); continue; }
    const ex = await executeCode(to, r.code, stdin);
    const same = ex.stdout.replace(/\r/g,'') === orig.stdout.replace(/\r/g,'');
    console.log(`  ${from}->${to}: ${ex.status} ${same ? 'MATCH' : 'DIFF ' + JSON.stringify(ex.stdout)} warnings=${r.warnings.length}`);
    if (!same || ex.status !== 'success' || show) {
      console.log(r.code.split('\n').map(l => '      | ' + l).join('\n'));
      console.log('      warnings:', r.warnings, (ex.compileOutput + ex.stderr).slice(0, 600));
    }
  }
}
