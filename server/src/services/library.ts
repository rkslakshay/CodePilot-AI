import { ALGORITHMS, type AlgorithmDef } from '../content/algorithms.js';
import { LANGS, type Lang } from '../engine/ir.js';
import { translate } from '../engine/index.js';
import { parseProgram } from '../engine/parser.js';
import { toFlowchart, toPseudocode } from '../engine/views.js';

export interface AlgorithmEntry extends Omit<AlgorithmDef, 'python' | 'code'> {
  code: Record<Lang, string>;
  pseudocode: string;
  flowchart: string;
  generated: Lang[];
}

let cache: AlgorithmEntry[] | null = null;

/** Builds the full library. Python-sourced entries get their other languages, pseudocode and flowchart from the offline pipeline. */
export function getLibrary(): AlgorithmEntry[] {
  if (cache) return cache;
  cache = ALGORITHMS.map((a) => {
    const code = { python: a.python } as Record<Lang, string>;
    const generated: Lang[] = [];
    let pseudocode = a.pseudocode ?? '';
    let flowchart = a.flowchart ?? '';
    if (a.source === 'python') {
      for (const l of LANGS) {
        if (l === 'python') continue;
        const r = translate(a.python, 'python', l);
        code[l] = r.ok ? r.code : `// Conversion failed: ${r.error?.message}`;
        generated.push(l);
      }
      const prog = parseProgram(a.python, 'python');
      if (!pseudocode) pseudocode = toPseudocode(prog);
      if (!flowchart) flowchart = toFlowchart(prog, { target: a.focus }).mermaid;
    } else {
      for (const l of LANGS) if (l !== 'python') code[l] = a.code?.[l] ?? '';
    }
    const { python: _p, code: _c, ...rest } = a;
    return { ...rest, code, pseudocode, flowchart, generated };
  });
  return cache;
}

export function getAlgorithm(id: string): AlgorithmEntry | undefined {
  return getLibrary().find((a) => a.id === id);
}
