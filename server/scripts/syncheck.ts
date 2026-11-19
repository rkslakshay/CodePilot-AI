import { analyzeSyntax } from '../src/engine/syntax.js';
import { getLibrary } from '../src/services/library.js';
import { readFileSync } from 'node:fs';
for (const f of ['sum.c','algo.py','algo.java']) {
  const lang = f.endsWith('.c') ? 'c' : f.endsWith('.py') ? 'python' : 'java';
  const s = analyzeSyntax(readFileSync('tests/fixtures/'+f,'utf8'), lang as any)!;
  console.log(f, s.complexity.time, s.complexity.confidence, s.functions.map(x=>`${x.name}:${x.complexity.time}/${x.complexity.confidence}${x.recursive?'R':''}`).join(' '), 'loops', s.loops.length, 'conds', s.conditionals.length, 'vars', s.variables.length, 'errs', s.errors.length);
}
for (const a of getLibrary()) {
  const row = (['c','cpp','java','python','javascript'] as const).map(l => { const s = analyzeSyntax(a.code[l], l)!; return `${s.complexity.time}${s.complexity.confidence[0]}`; });
  console.log(a.id.padEnd(16), a.complexity.average.padEnd(12), row.join(' | '));
}
