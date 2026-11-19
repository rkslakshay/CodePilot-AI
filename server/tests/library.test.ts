import { describe, it, expect } from 'vitest';
import { getLibrary } from '../src/services/library.js';
import { TEMPLATES } from '../src/content/templates.js';
import { TOPICS } from '../src/content/learning.js';
import { trace } from '../src/content/tracers.js';
import { translate } from '../src/engine/index.js';
import { executeCode } from '../src/execution/executor.js';
import { LANGS } from '../src/engine/ir.js';

const norm = (s: string) => s.replace(/\r/g, '');

describe('algorithm library — every program runs in all five languages', () => {
  for (const a of getLibrary()) {
    it(a.name, async () => {
      expect(a.pseudocode.length).toBeGreaterThan(20);
      expect(a.flowchart.startsWith('flowchart TD')).toBe(true);
      for (const l of LANGS) {
        const r = await executeCode(l, a.code[l]);
        expect(r.status, `${a.id}/${l}: ${r.compileOutput}${r.stderr}`).toBe('success');
        expect(norm(r.stdout), `${a.id}/${l}`).toBe(a.expectedOutput);
      }
    });
  }
});

describe('generator templates — expected outputs in all five languages', () => {
  for (const t of TEMPLATES) {
    it(t.title, async () => {
      for (const l of LANGS) {
        const code = l === 'python' ? t.python : translate(t.python, 'python', l).code;
        for (const tc of t.tests) {
          const r = await executeCode(l, code, tc.input);
          expect(norm(r.stdout), `${t.id}/${l} input ${JSON.stringify(tc.input)} ${r.compileOutput}${r.stderr}`).toBe(tc.expected);
        }
      }
    });
  }
});

describe('visualiser tracers', () => {
  for (const a of getLibrary()) {
    it(`${a.id} produces real execution steps`, () => {
      const t = trace(a.id, a.defaultInput);
      expect(t.steps.length).toBeGreaterThan(2);
      for (const s of t.steps) expect(typeof s.message).toBe('string');
    });
  }
  it('sorting tracers end with a sorted array for custom input', () => {
    for (const id of ['bubble-sort', 'selection-sort', 'insertion-sort', 'merge-sort', 'quick-sort', 'heap-sort']) {
      const t = trace(id, '9, -2, 7, 7, 0, 3');
      expect(t.steps.at(-1)!.array, id).toEqual([-2, 0, 3, 7, 7, 9]);
    }
  });
  it('Studio 2.0 tracers compute real results', () => {
    expect(trace('shell-sort', '9, -2, 7, 7, 0, 3').steps.at(-1)!.array).toEqual([-2, 0, 3, 7, 7, 9]);
    expect(trace('counting-sort', '5, 0, 3, 3, 1').steps.at(-1)!.array).toEqual([0, 1, 3, 3, 5]);
    expect(trace('jump-search', '1, 3, 5, 7, 9, 11, 13, 15, 17 | 13').steps.at(-1)!.hl?.found).toEqual([6]);
    expect(trace('jump-search', '1, 3, 5, 7 | 4').steps.at(-1)!.vars.result).toBe(-1);
    expect(trace('tree-traversal', '1, 2, 3, 4, 5, 6, 7 | preorder').steps.at(-1)!.vars.output).toBe('1 2 4 5 3 6 7');
    expect(trace('tree-traversal', '1, 2, 3, 4, 5, 6, 7 | inorder').steps.at(-1)!.vars.output).toBe('4 2 5 1 6 3 7');
    expect(trace('tree-traversal', '1, 2, 3, 4, 5, 6, 7 | postorder').steps.at(-1)!.vars.output).toBe('4 5 2 6 7 3 1');
    expect(trace('fast-power', '3 | 5').steps.at(-1)!.vars.result).toBe(243);
  });
  it('binary search tracer finds the target', () => {
    const t = trace('binary-search', '1, 3, 5, 7, 9, 11 | 9');
    expect(t.steps.at(-1)!.hl?.found).toEqual([4]);
  });
  it('dijkstra tracer computes the correct distances', () => {
    const t = trace('dijkstra', '0');
    expect(t.steps.at(-1)!.graph?.dist).toEqual({ 0: '0', 1: '4', 2: '1', 3: '5', 4: '8' });
  });
});

describe('learning content', () => {
  it('has 11 DSA topics with questions and practice problems', () => {
    expect(TOPICS).toHaveLength(11);
    for (const t of TOPICS) {
      expect(t.viva.length).toBeGreaterThanOrEqual(4);
      expect(t.mcq.length).toBeGreaterThanOrEqual(4);
      expect(t.practice.length).toBeGreaterThanOrEqual(2);
      for (const m of t.mcq) expect(m.answer).toBeLessThan(4);
    }
  });
  it('every practice solution produces its example output', async () => {
    for (const t of TOPICS) {
      for (const p of t.practice) {
        const r = await executeCode('python', p.solution, p.example.input + '\n');
        expect(norm(r.stdout).trim(), `${p.id}: ${r.stderr}`).toBe(p.example.output.trim());
      }
    }
  });
});
