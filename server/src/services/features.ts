/**
 * Feature services. Every function returns an `engine` descriptor so the UI can say exactly
 * what produced the result: local AI (Ollama), the offline rule-based engine, or a built-in template.
 */
import type { ZodTypeAny } from 'zod';
import { TOPIC_CATEGORY } from '../content/learning-paths.js';
import { LANG_LABEL, LANG_EXT, LANGS, type Lang } from '../engine/ir.js';
import { translate } from '../engine/index.js';
import { parseProgram } from '../engine/parser.js';
import { analyze as inferTypes } from '../engine/infer.js';
import { analyzeCode, estimateComplexity, findIssues, english, type CodeAnalysis, type Mode } from '../engine/analyzer.js';
import { toFlowchart, toPseudocode, buildFlow, pexpr } from '../engine/views.js';
import { interpretErrors, repairCode, type Diagnosis } from '../engine/debugger.js';
import { walkStmts } from '../engine/walk.js';
import { TEMPLATES, type TemplateDef } from '../content/templates.js';
import { matchAlgorithms, type AlgorithmDef } from '../content/algorithms.js';
import { getLibrary, getAlgorithm } from './library.js';
import { TOPICS, findTopic, type Mcq, type Viva } from '../content/learning.js';
import { aiJson, cleanCode, OFFLINE_ENGINE, type EngineInfo } from '../providers/index.js';
import { AI, contract } from '../providers/schemas.js';
import { executeCode, type ExecResult } from '../execution/executor.js';
import { getSettings } from './settings.js';
import { addHistory } from './repo.js';
import { AppError, badRequest, notFound } from '../utils/http.js';
import type { Program, Stmt } from '../engine/ir.js';

const LANG_SYSTEM = 'You are CodePilot, a precise programming assistant running locally. Always answer with a single valid JSON object and nothing else.';

const templateEngine = (title: string): EngineInfo => ({ kind: 'template', label: `Built-in template · ${title} (offline, not AI-generated)` });

// =====================================================================================
// CODE GENERATOR
// =====================================================================================
export interface GenerateRequest {
  prompt: string;
  language: Lang;
  difficulty: 'easy' | 'medium' | 'hard';
  requirements?: string;
  style: 'standard' | 'commented' | 'compact';
  variant?: number;
  record?: boolean;
}

interface Candidate {
  kind: 'template' | 'algorithm';
  id: string;
  title: string;
  score: number;
}

function scoreTemplates(text: string): Candidate[] {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9^!+ ]/g, ' ').replace(/\s+/g, ' ')} `;
  const out: Candidate[] = [];
  for (const tp of TEMPLATES) {
    let score = 0;
    for (const k of tp.keywords) if (t.includes(` ${k} `) || t.includes(` ${k}`)) score += k.split(' ').length * 3;
    if (score) out.push({ kind: 'template', id: tp.id, title: tp.title, score });
  }
  return out;
}

export function findCandidates(text: string): Candidate[] {
  const algos = matchAlgorithms(text).map((m) => ({ kind: 'algorithm' as const, id: m.algo.id, title: m.algo.name, score: m.score }));
  const all = [...scoreTemplates(text), ...algos].sort((a, b) => b.score - a.score);
  // de-duplicate concepts (e.g. "fibonacci" template + algorithm): keep both but prefer template for stdin programs
  return all;
}

function styleCode(code: string, lang: Lang, style: GenerateRequest['style'], header: string[]): string {
  const c = lang === 'python' ? '#' : '//';
  if (style === 'compact') {
    return code
      .split('\n')
      .filter((l) => !new RegExp(`^\\s*${c === '#' ? '#' : '//'}`).test(l))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  }
  if (style === 'commented') {
    const block = header.map((h) => `${c} ${h}`).join('\n');
    if (lang === 'java') return `${block}\n${code}`;
    return `${block}\n\n${code}`;
  }
  return code;
}

function skeleton(lang: Lang, prompt: string): string {
  const title = prompt.split('\n')[0].slice(0, 70);
  switch (lang) {
    case 'c':
      return `// Starter skeleton (not a solution): ${title}\n#include <stdio.h>\n\nint main() {\n    int n;\n    if (scanf("%d", &n) != 1) return 0;\n\n    // TODO: implement the solution here\n\n    printf("%d\\n", n);\n    return 0;\n}\n`;
    case 'cpp':
      return `// Starter skeleton (not a solution): ${title}\n#include <iostream>\n#include <vector>\nusing namespace std;\n\nint main() {\n    int n;\n    if (!(cin >> n)) return 0;\n\n    // TODO: implement the solution here\n\n    cout << n << endl;\n    return 0;\n}\n`;
    case 'java':
      return `// Starter skeleton (not a solution): ${title}\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        int n = sc.nextInt();\n\n        // TODO: implement the solution here\n\n        System.out.println(n);\n    }\n}\n`;
    case 'python':
      return `# Starter skeleton (not a solution): ${title}\n\n\ndef solve(n):\n    # TODO: implement the solution here\n    return n\n\n\nn = int(input())\nprint(solve(n))\n`;
    case 'javascript':
      return `// Starter skeleton (not a solution): ${title}\nconst input = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/);\nconst n = Number(input[0]);\n\nfunction solve(n) {\n  // TODO: implement the solution here\n  return n;\n}\n\nconsole.log(solve(n));\n`;
  }
}

function variablesFrom(a: CodeAnalysis) {
  const purpose = (name: string, type: string) => {
    const n = name.toLowerCase();
    if (/^(i|j|k)$/.test(n)) return 'Loop counter / index.';
    if (/sum|total/.test(n)) return 'Running total.';
    if (/count|cnt/.test(n)) return 'Counter.';
    if (/max|largest|best/.test(n)) return 'Largest value found so far.';
    if (/min|smallest/.test(n)) return 'Smallest value found so far.';
    if (/temp|tmp/.test(n)) return 'Temporary value used while swapping.';
    if (/^(n|size|len|length)$/.test(n)) return 'Number of elements / input size.';
    if (/arr|nums|list|data/.test(n) || /array|list/.test(type)) return 'Collection of input values.';
    if (/low|lo|left|start/.test(n)) return 'Left boundary of the current range.';
    if (/high|hi|right|end/.test(n)) return 'Right boundary of the current range.';
    if (/mid/.test(n)) return 'Middle index of the current range.';
    if (/result|res|ans|answer/.test(n)) return 'Final answer being built.';
    if (/rev/.test(n)) return 'Reversed value being built.';
    if (/digit|^d$/.test(n)) return 'Current digit.';
    return `Holds a ${type} value.`;
  };
  return a.variables.filter((v) => !v.name.startsWith('_')).slice(0, 12).map((v) => ({ name: v.name, type: v.type, scope: v.scope, purpose: purpose(v.name, v.type) }));
}

export async function generateCode(req: GenerateRequest) {
  const s = getSettings();
  const started = Date.now();
  const promptText = `${req.prompt}${req.requirements ? `\nAdditional requirements: ${req.requirements}` : ''}`;
  // ---- Local AI path
  const ai = await aiJson(
    `Write a complete, runnable ${LANG_LABEL[req.language]} program for this problem.
Problem: ${promptText}
Difficulty: ${req.difficulty}. Style: ${req.style}.${req.variant ? ` Provide an alternative approach (variant ${req.variant}).` : ''}
The program must read its input from standard input and print to standard output.${req.language === 'java' ? ' Use a public class named Main.' : ''}
Return JSON with keys: understanding (string), code (string, full program), explanation (string), variables (array of {name, purpose}), timeComplexity (string), spaceComplexity (string), sampleInput (string), sampleOutput (string), testCases (array of {input, expected}), edgeCases (array of strings).`,
    LANG_SYSTEM,
    contract(AI.generate, 3500),
  );
  if (ai.data && typeof ai.data.code === 'string' && ai.data.code.trim()) {
    const code = cleanCode(ai.data.code);
    const analysis = analyzeCode(code, req.language, s.explanationMode);
    const result = {
      engine: ai.engine,
      matched: true,
      match: null,
      alternatives: [],
      understanding: ai.data.understanding ?? '',
      code,
      explanation: ai.data.explanation ?? analysis.summary,
      variables: ai.data.variables?.length ? ai.data.variables.map((v) => ({ name: v.name, type: '', scope: '', purpose: v.purpose })) : variablesFrom(analysis),
      functions: analysis.functions,
      timeComplexity: ai.data.timeComplexity || analysis.complexity.time,
      spaceComplexity: ai.data.spaceComplexity || analysis.complexity.space,
      complexityNote: ai.data.timeComplexity ? 'Reported by the local model.' : 'Estimated by static analysis.',
      sampleInput: ai.data.sampleInput ?? '',
      sampleOutput: ai.data.sampleOutput ?? '',
      testCases: (ai.data.testCases ?? []).slice(0, 8).map((t) => ({ input: String(t.input ?? ''), expected: String(t.expected ?? '') })),
      edgeCases: ai.data.edgeCases ?? [],
      issues: analysis.issues,
      durationMs: Date.now() - started,
    };
    record(req.record, { kind: 'generation', title: req.prompt.slice(0, 100), language: req.language, engine: 'ollama', input: req, output: result });
    return result;
  }

  // ---- Offline path: built-in templates and algorithm library
  const cands = findCandidates(promptText);
  if (!cands.length) {
    const suggestions = [...TEMPLATES.slice(0, 6).map((t) => ({ kind: 'template', id: t.id, title: t.title })), ...getLibrary().slice(0, 6).map((a) => ({ kind: 'algorithm', id: a.id, title: a.name }))];
    const result = {
      engine: ai.engine.notice ? ai.engine : OFFLINE_ENGINE,
      matched: false,
      message:
        'The offline engine cannot write a solution for an arbitrary problem description — that requires a language model. It recognises common problems (prime check, factorial, sorting, searching, graph traversal, …). Rephrase using one of the suggestions below, or enable Local AI (Ollama) in Settings.',
      suggestions,
      code: skeleton(req.language, req.prompt),
      codeIsSkeleton: true,
      durationMs: Date.now() - started,
    };
    record(req.record, { kind: 'generation', title: req.prompt.slice(0, 100), language: req.language, engine: 'offline', status: 'no_match', input: req, output: { matched: false } });
    return result;
  }
  const pick = cands[(req.variant ?? 0) % cands.length];
  let code: string;
  let title: string;
  let understanding: string;
  let explanation: string;
  let edgeCases: string[];
  let sampleInput: string;
  let sampleOutput: string;
  let testCases: { input: string; expected: string }[];
  let steps: string[] = [];
  let complexity: { time: string; space: string; note: string };
  if (pick.kind === 'template') {
    const tp = TEMPLATES.find((t) => t.id === pick.id)!;
    title = tp.title;
    code = req.language === 'python' ? tp.python : translate(tp.python, 'python', req.language).code;
    understanding = tp.understanding;
    explanation = tp.explanation;
    edgeCases = tp.edgeCases;
    sampleInput = tp.sampleInput;
    sampleOutput = tp.tests.find((t) => t.input === tp.sampleInput)?.expected ?? tp.tests[0].expected;
    testCases = tp.tests;
    const a = analyzeCode(code, req.language, s.explanationMode);
    complexity = { time: a.complexity.time, space: a.complexity.space, note: 'Estimated by static analysis of the template.' };
  } else {
    const al = getAlgorithm(pick.id)!;
    title = al.name;
    code = al.code[req.language];
    understanding = `${al.summary} Input: ${al.input} Output: ${al.output}`;
    explanation = al.description;
    edgeCases = edgeCasesFor(al);
    sampleInput = '';
    sampleOutput = al.expectedOutput;
    testCases = [{ input: '', expected: al.expectedOutput }];
    steps = al.steps;
    complexity = { time: al.complexity.average, space: al.complexity.space, note: `Best ${al.complexity.best}, worst ${al.complexity.worst}.${al.complexity.note ? ' ' + al.complexity.note : ''}` };
  }
  const header = [title, `Language: ${LANG_LABEL[req.language]}`, `Time: ${complexity.time}, Space: ${complexity.space}`, 'Source: CodePilot built-in template (offline)'];
  code = styleCode(code, req.language, req.style, header);
  const analysis = analyzeCode(code, req.language, s.explanationMode);
  const notes: string[] = [];
  if (req.requirements?.trim()) notes.push('Additional requirements are not applied by the offline engine; the built-in template is shown unchanged.');
  const tplDifficulty = pick.kind === 'template' ? TEMPLATES.find((t) => t.id === pick.id)!.difficulty : getAlgorithm(pick.id)!.difficulty;
  if (tplDifficulty.toLowerCase() !== req.difficulty) notes.push(`The closest built-in match is rated ${tplDifficulty}.`);
  const result = {
    engine: { ...templateEngine(title), notice: ai.engine.notice },
    matched: true,
    match: { ...pick, difficulty: tplDifficulty },
    alternatives: cands.filter((c) => c.id !== pick.id).slice(0, 5),
    understanding,
    code,
    explanation,
    steps,
    variables: variablesFrom(analysis),
    functions: analysis.functions,
    timeComplexity: complexity.time,
    spaceComplexity: complexity.space,
    complexityNote: complexity.note,
    sampleInput,
    sampleOutput,
    testCases,
    edgeCases,
    issues: analysis.issues.filter((i) => i.severity !== 'info'),
    notes,
    durationMs: Date.now() - started,
  };
  record(req.record, { kind: 'generation', title: req.prompt.slice(0, 100), language: req.language, engine: 'template', input: req, output: result });
  return result;
}

function edgeCasesFor(a: AlgorithmDef | ReturnType<typeof getAlgorithm>): string[] {
  const cat = a!.category;
  if (cat === 'Sorting') return ['Empty array', 'Single element', 'Already sorted input', 'Reverse-sorted input', 'Duplicate values', 'Negative numbers'];
  if (cat === 'Searching') return ['Target at the first or last position', 'Target absent', 'Single-element array', 'Duplicates (which index is returned?)'];
  if (cat === 'Graphs') return ['Disconnected graph (unreachable vertices)', 'Single vertex', 'Self-loops / parallel edges', 'Start vertex out of range'];
  if (cat === 'Recursion' || cat === 'Dynamic Programming') return ['n = 0 and n = 1 (base cases)', 'Large n (overflow / deep recursion)', 'Negative input'];
  return ['Empty input', 'Single element', 'Large input', 'Invalid operations (underflow / overflow)'];
}

// =====================================================================================
// CONVERTER
// =====================================================================================
interface Structure {
  functions: string[];
  loops: Record<string, number>;
  conditionals: number;
  prints: number;
  reads: number;
  recursion: string[];
  collections: { name: string; type: string }[];
}

function structureOf(prog: Program): Structure {
  const s: Structure = { functions: prog.funcs.map((f) => `${f.name}(${f.params.map((p) => p.name).join(', ')})`), loops: {}, conditionals: 0, prints: 0, reads: 0, recursion: [], collections: [] };
  const all: Stmt[] = [...prog.globals, ...prog.main, ...prog.funcs.flatMap((f) => f.body)];
  walkStmts(all, {
    stmt: (st) => {
      const kind = { range: 'counting for', foreach: 'for-each', while: 'while', dowhile: 'do-while', for: 'for' }[st.k as string];
      if (kind) s.loops[kind] = (s.loops[kind] ?? 0) + 1;
      if (st.k === 'if') s.conditionals += 1 + st.elifs.length;
      if (st.k === 'print') s.prints++;
      if (st.k === 'read') s.reads++;
    },
  });
  try {
    const an = inferTypes(prog);
    for (const [name, info] of an.funcs) if (info.recursive) s.recursion.push(name);
    const seen = new Set<string>();
    for (const m of [an.globals, an.main, ...[...an.funcs.values()].map((f) => f.locals)])
      for (const [k, t] of m) if (t.dims > 0 && !seen.has(k)) {
        seen.add(k);
        s.collections.push({ name: k, type: t.base + '[]'.repeat(t.dims) + (t.dynamic || an.dynamic.has(k) ? ' (growable)' : '') });
      }
  } catch {
    /* ignore */
  }
  return s;
}

const COLLECTION_NAME: Record<Lang, (dyn: boolean, base: string) => string> = {
  c: (dyn, b) => (dyn ? `fixed ${b} array + length counter` : `${b}[] array`),
  cpp: (_d, b) => `vector<${b === 'long' ? 'long long' : b}>`,
  java: (dyn, b) => (dyn ? `ArrayList<${b === 'int' ? 'Integer' : b === 'double' ? 'Double' : b}>` : `${b === 'bool' ? 'boolean' : b}[]`),
  python: () => 'list',
  javascript: () => 'Array',
};

const SYNTAX_CHANGES: Record<Lang, string[]> = {
  c: ['Blocks use { } braces', 'Statements end with ;', 'Variables need explicit static types', 'printf/scanf with format specifiers for I/O', 'Program starts in int main()'],
  cpp: ['Blocks use { } braces', 'Statements end with ;', 'Static types (auto allowed)', 'cin / cout streams for I/O', 'Program starts in int main()'],
  java: ['Everything lives inside a class', 'Statements end with ;', 'Static types; methods are static inside class Main', 'Scanner / System.out for I/O', 'Program starts in public static void main'],
  python: ['Indentation instead of braces', 'No semicolons or type declarations', 'input() / print() for I/O', 'range() based for-loops', 'and / or / not instead of && / || / !'],
  javascript: ['Blocks use { } braces', 'Dynamic types declared with let / const', 'console.log for output, stdin read through fs', '=== for strict equality', 'Numbers are 64-bit floating point'],
};

function behaviouralDifferences(from: Lang, to: Lang, code: string): string[] {
  const d: string[] = [];
  const dynFrom = from === 'python' || from === 'javascript';
  const staticTo = to === 'c' || to === 'cpp' || to === 'java';
  if (from === 'python' && to !== 'python') d.push('Python integers never overflow; C, C++ and Java integers wrap around or overflow at 32/64 bits.');
  if (to === 'javascript' && from !== 'javascript') d.push('JavaScript stores every number as a 64-bit float: integers above 2^53 lose precision.');
  if (/\/(?!\/)/.test(code.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')) && (dynFrom !== (to === 'python' || to === 'javascript')))
    d.push("Division semantics differ: '/' on two integers truncates in C/C++/Java but produces a float in Python and JavaScript.");
  if (/%/.test(code)) d.push("The remainder of negative numbers differs: -7 % 3 is -1 in C/Java/JS but 2 in Python.");
  if (dynFrom && staticTo) d.push('Types were inferred from usage; review variables that could hold mixed types.');
  if (/print|cout|printf|console\.log|System\.out/.test(code) && /\d\.\d|double|float/.test(code)) d.push('Floating-point values may be printed with a different number of decimals.');
  if (/True|False|true|false|bool/.test(code)) d.push('Booleans print as True/False in Python but true/false (or 1/0 with cout) elsewhere.');
  if ((from === 'c' || from === 'cpp') && to !== 'c' && to !== 'cpp') d.push('Out-of-bounds array access is undefined behaviour in C/C++ but raises an error in the target language.');
  return d;
}

export async function convertCode(req: { code: string; from: Lang; to: Lang; record?: boolean }) {
  if (req.from === req.to) throw badRequest('Source and target languages must differ');
  const started = Date.now();
  const offline = translate(req.code, req.from, req.to);
  let srcProg: Program | null = null;
  try {
    srcProg = parseProgram(req.code, req.from);
  } catch {
    srcProg = null;
  }
  const ai = await aiJson(
    `Convert this ${LANG_LABEL[req.from]} program to ${LANG_LABEL[req.to]}. Keep the same behaviour and output format.${req.to === 'java' ? ' Use a public class named Main.' : ''}
Return JSON with keys: code (string, the full converted program), explanation (string: what changed), warnings (array of strings: behavioural differences or anything that could not be converted exactly).

${LANG_LABEL[req.from]} source:
${req.code}`,
    LANG_SYSTEM,
    contract(AI.convert, 3500),
  );
  let engine: EngineInfo = ai.engine;
  let code = offline.code;
  let warnings = offline.warnings;
  let explanation = '';
  if (ai.data?.code) {
    code = cleanCode(ai.data.code);
    warnings = ai.data.warnings ?? [];
    explanation = ai.data.explanation ?? '';
  } else if (!offline.ok) {
    const result = {
      engine,
      ok: false,
      error: offline.error,
      message: `The offline converter could not parse the ${LANG_LABEL[req.from]} source${offline.error?.line ? ` (line ${offline.error.line})` : ''}: ${offline.error?.message}. Fix the syntax error, or enable Local AI for free-form conversions.`,
    };
    record(req.record, { kind: 'conversion', title: `${LANG_LABEL[req.from]} → ${LANG_LABEL[req.to]}`, language: req.from, targetLanguage: req.to, engine: 'offline', status: 'error', input: req, output: result });
    return result;
  }
  let dstProg: Program | null = null;
  try {
    dstProg = parseProgram(code, req.to);
  } catch {
    dstProg = null;
  }
  const s1 = srcProg ? structureOf(srcProg) : null;
  const s2 = dstProg ? structureOf(dstProg) : null;
  const dataStructures = (s1?.collections ?? []).map((c) => {
    const dyn = c.type.includes('growable');
    const base = c.type.replace(/\[\]| \(growable\)/g, '');
    return { name: c.name, from: COLLECTION_NAME[req.from](dyn, base), to: COLLECTION_NAME[req.to](dyn, base) };
  });
  const unconverted = offline.warnings.filter((w) => /could not convert|not supported|Not converted/i.test(w)).length;
  if (!explanation) {
    explanation = `The ${LANG_LABEL[req.from]} program was parsed into CodePilot's language-neutral representation and re-generated as ${LANG_LABEL[req.to]}. ${
      s1 ? `${s1.functions.length} function(s), ${Object.values(s1.loops).reduce((a, b) => a + b, 0)} loop(s) and ${s1.conditionals} condition(s) were translated` : 'Structure was translated'
    }; input/output statements were mapped to ${LANG_LABEL[req.to]} equivalents.${unconverted ? ` ${unconverted} section(s) could not be converted and are left as comments.` : ''}`;
  }
  const result = {
    engine: ai.data?.code ? engine : { ...OFFLINE_ENGINE, label: 'Offline structured translator (rule-based)', notice: ai.engine.notice },
    ok: true,
    code,
    explanation,
    warnings,
    notes: offline.notes,
    verified: false,
    verification: 'Not verified: equivalence is not guaranteed. Use "Verify by running" to compare outputs on real input.',
    comparison: {
      original: s1,
      converted: s2,
      syntaxChanges: SYNTAX_CHANGES[req.to],
      dataStructures,
      behaviouralDifferences: [...new Set([...behaviouralDifferences(req.from, req.to, req.code), ...offline.notes])],
      logic: s1 && s2 ? describeLogic(s1, s2) : [],
    },
    durationMs: Date.now() - started,
  };
  record(req.record, { kind: 'conversion', title: `${LANG_LABEL[req.from]} → ${LANG_LABEL[req.to]}`, language: req.from, targetLanguage: req.to, engine: ai.data?.code ? 'ollama' : 'offline', input: req, output: result });
  return result;
}

function describeLogic(a: Structure, b: Structure): { aspect: string; original: string; converted: string; same: boolean }[] {
  const loops = (s: Structure) => Object.entries(s.loops).map(([k, v]) => `${v} ${k}`).join(', ') || 'none';
  const rows = [
    { aspect: 'Functions', original: a.functions.join(', ') || 'main only', converted: b.functions.join(', ') || 'main only' },
    { aspect: 'Loops', original: loops(a), converted: loops(b) },
    { aspect: 'Decisions', original: String(a.conditionals), converted: String(b.conditionals) },
    { aspect: 'Output statements', original: String(a.prints), converted: String(b.prints) },
    { aspect: 'Input statements', original: String(a.reads), converted: String(b.reads) },
    { aspect: 'Recursion', original: a.recursion.join(', ') || 'none', converted: b.recursion.join(', ') || 'none' },
  ];
  return rows.map((r) => ({ ...r, same: r.original === r.converted }));
}

export async function verifyConversion(req: { source: string; from: Lang; converted: string; to: Lang; stdin: string }) {
  requireExecution();
  const s = getSettings();
  const a = await executeCode(req.from, req.source, req.stdin, { timeoutMs: s.executionTimeoutMs });
  const b = await executeCode(req.to, req.converted, req.stdin, { timeoutMs: s.executionTimeoutMs });
  const norm = (x: string) => x.replace(/\r/g, '').replace(/[ \t]+$/gm, '').trimEnd();
  const same = a.status === 'success' && b.status === 'success' && norm(a.stdout) === norm(b.stdout);
  return { same, original: slimExec(a), converted: slimExec(b), note: same ? 'Both programs produced identical output for this input. This is evidence of equivalence for this input only.' : 'Outputs differ or a program failed — review the converted code.' };
}

// =====================================================================================
// EXPLAINER
// =====================================================================================
export async function explainCode(req: { code: string; language: Lang; mode: Mode; record?: boolean }) {
  const started = Date.now();
  const analysis = analyzeCode(req.code, req.language, req.mode);
  const ai = await aiJson(
    `Explain this ${LANG_LABEL[req.language]} code for a ${req.mode === 'beginner' ? 'beginner programmer, using simple words' : 'experienced developer, concisely and technically'}.
Return JSON with keys: summary (string), overview (array of strings), lines (array of {line: number, text: string} for every important line), concepts (array of {name, description}).

Code (line numbers added):
${req.code.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}`,
    LANG_SYSTEM,
    contract(AI.explain),
  );
  let engine: EngineInfo = { ...OFFLINE_ENGINE, label: 'Offline syntax-based analyser (not AI)', notice: ai.engine.notice };
  if (ai.data) {
    engine = ai.engine;
    if (ai.data.summary) analysis.summary = ai.data.summary;
    if (ai.data.overview?.length) analysis.overview = ai.data.overview;
    if (ai.data.lines?.length) {
      const byLine = new Map(ai.data.lines.map((l) => [Number(l.line), l.text]));
      analysis.lines = analysis.lines.map((l) => (byLine.has(l.line) ? { ...l, text: byLine.get(l.line)! } : l));
    }
    if (ai.data.concepts?.length) analysis.concepts = ai.data.concepts;
  }
  const result = { engine, ...analysis, structureSource: 'Functions, variables, loops, complexity and issues come from CodePilot’s offline static analyser.', durationMs: Date.now() - started };
  record(req.record, { kind: 'explanation', title: `Explain ${LANG_LABEL[req.language]} code (${analysis.stats.codeLines} lines)`, language: req.language, engine: ai.data ? 'ollama' : 'offline', input: req, output: { summary: result.summary, complexity: result.complexity, issues: result.issues.length } });
  return result;
}

// =====================================================================================
// ALGORITHM STUDIO
// =====================================================================================
function stepsFromProgram(prog: Program, focus?: string): string[] {
  const fn = focus ? prog.funcs.find((f) => f.name === focus) : undefined;
  const body = fn ? fn.body : prog.main.length ? prog.main : prog.funcs[0]?.body ?? [];
  const out: string[] = [];
  const describe = (s: Stmt): string | null => {
    switch (s.k) {
      case 'decl':
        return s.init ? `Set ${s.name} to ${pexpr(s.init)}.` : `Create ${s.name}.`;
      case 'expr':
        return s.expr.k === 'assign' ? `Update ${pexpr(s.expr.target)} (${pexpr(s.expr)}).` : `Call ${pexpr(s.expr)}.`;
      case 'read':
        return `Read ${s.targets.map(pexpr).join(', ')} from input.`;
      case 'print':
        return `Output ${s.parts.map((p) => (p.text !== undefined ? `"${p.text.trim()}"` : pexpr(p.expr))).filter((x) => x !== '""').join(' ')}.`;
      case 'if':
        return `If ${english(pexpr(s.cond))}, ${summarize(s.then)}${s.else ? `; otherwise ${summarize(s.else)}` : ''}.`;
      case 'range':
        return `Repeat for ${s.var} from ${pexpr(s.start)} while ${s.var} ${s.step > 0 ? '<' : '>'} ${pexpr(s.end)}: ${summarize(s.body)}.`;
      case 'foreach':
        return `For each ${s.var} in ${pexpr(s.iter)}: ${summarize(s.body)}.`;
      case 'while':
        return `While ${english(pexpr(s.cond))}: ${summarize(s.body)}.`;
      case 'for':
        return `Loop while ${s.cond ? english(pexpr(s.cond)) : 'true'}: ${summarize(s.body)}.`;
      case 'return':
        return s.value ? `Return ${pexpr(s.value)}.` : 'Return.';
      default:
        return null;
    }
  };
  const summarize = (ss: Stmt[]) =>
    ss
      .map((x) => describe(x))
      .filter(Boolean)
      .map((t) => t!.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()))
      .slice(0, 3)
      .join(', then ') || 'do nothing';
  if (fn) out.push(`Function ${fn.name}(${fn.params.map((p) => p.name).join(', ')}):`);
  for (const s of body) {
    const d = describe(s);
    if (d) out.push(d);
  }
  return out.slice(0, 20);
}

export async function studioFromCode(req: { code: string; language: Lang; target?: string; record?: boolean; useAi?: boolean }) {
  let prog: Program;
  try {
    prog = parseProgram(req.code, req.language);
  } catch (e) {
    throw new AppError(422, 'parse_error', `Could not parse the code: ${(e as Error).message}${(e as any).line ? ` (line ${(e as any).line})` : ''}`);
  }
  const flow = toFlowchart(prog, { target: req.target });
  const target = req.target && flow.targets.includes(req.target) ? req.target : flow.targets[0];
  const analysis = analyzeCode(req.code, req.language, 'beginner');
  const complexity = analysis.complexity.time !== 'unknown' ? analysis.complexity : estimateComplexity(prog);
  const offlineSteps = stepsFromProgram(prog, target === 'main' ? undefined : target);
  const offlinePseudo = toPseudocode(prog);
  const ai = req.useAi === false ? null : await aiJson(
    `Describe the algorithm implemented by this ${LANG_LABEL[req.language]} code${target !== 'main' ? ` (focus on the function ${target})` : ''}.
Return JSON: steps (array of short imperative algorithm steps), pseudocode (structured pseudocode using IF/ELSE/END IF, WHILE/END WHILE, FOR/END FOR, FUNCTION/END FUNCTION, RETURN), explanation (2-3 sentences).

Code:
${req.code}`,
    LANG_SYSTEM,
    contract(AI.pseudocode, 1500),
  );
  const useAi = !!ai?.data;
  const result = {
    engine: useAi ? ai!.engine : ({ ...OFFLINE_ENGINE, label: 'Offline transformer: code → IR → algorithm / pseudocode / flowchart', notice: ai?.engine.notice } as EngineInfo),
    sections: { steps: useAi ? 'ollama' : 'offline', pseudocode: useAi ? 'ollama' : 'offline', flowchart: 'offline', complexity: 'offline' },
    title: target === 'main' ? 'Your program' : `${target}()`,
    steps: useAi ? ai!.data!.steps : offlineSteps,
    pseudocode: useAi ? ai!.data!.pseudocode : offlinePseudo,
    offlinePseudocode: offlinePseudo,
    aiExplanation: useAi ? ai!.data!.explanation ?? '' : '',
    flowchart: flow.mermaid,
    flowTargets: flow.targets,
    flowTarget: target,
    complexity,
    explanation: analysis.overview.join(' '),
    issues: analysis.issues,
    conversions: Object.fromEntries(LANGS.filter((l) => l !== req.language).map((l) => [l, translate(req.code, req.language, l).code])),
    testCases: suggestTests(req.code, req.language),
    warnings: prog.warnings,
  };
  record(req.record, { kind: 'algorithm', title: `Algorithm from ${LANG_LABEL[req.language]} code`, language: req.language, engine: 'offline', input: { language: req.language, code: req.code }, output: { steps: result.steps, complexity } });
  return result;
}

export async function studioFromProblem(req: { problem: string; language: Lang; record?: boolean }) {
  const ai = await aiJson(
    `Design an algorithm for this problem: ${req.problem}
Return JSON with keys: title, understanding, steps (array of strings), pseudocode (string), python (string: a simple Python 3 implementation using only functions, lists, loops, if/else and print — no classes, no dictionaries, no list comprehensions), timeComplexity, spaceComplexity, explanation, dryRun (array of strings describing a sample execution step by step), testCases (array of {input, expected}).`,
    LANG_SYSTEM,
    contract(AI.algorithm, 3500),
  );
  if (ai.data?.steps?.length) {
    let flowchart = '';
    let code: string | null = null;
    if (ai.data.python) {
      try {
        const prog = parseProgram(ai.data.python, 'python');
        flowchart = toFlowchart(prog).mermaid;
        code = req.language === 'python' ? ai.data.python : translate(ai.data.python, 'python', req.language).code;
      } catch {
        flowchart = '';
      }
    }
    if (!flowchart) flowchart = stepsFlow(ai.data.steps);
    const result = {
      engine: ai.engine,
      matched: true,
      title: ai.data.title ?? 'Algorithm',
      understanding: ai.data.understanding ?? '',
      steps: ai.data.steps,
      pseudocode: ai.data.pseudocode ?? '',
      flowchart,
      code,
      complexity: { time: ai.data.timeComplexity ?? 'unknown', space: ai.data.spaceComplexity ?? 'unknown', reasons: ['Reported by the local model.'] },
      explanation: ai.data.explanation ?? '',
      dryRun: ai.data.dryRun ?? [],
      testCases: ai.data.testCases ?? [],
    };
    record(req.record, { kind: 'algorithm', title: req.problem.slice(0, 100), language: req.language, engine: 'ollama', input: req, output: { title: result.title, steps: result.steps } });
    return result;
  }
  const cands = findCandidates(req.problem);
  const best = cands[0];
  if (!best) {
    return {
      engine: { ...OFFLINE_ENGINE, notice: ai.engine.notice },
      matched: false,
      message: 'The offline engine could not recognise this problem. It understands the algorithms in the library (searching, sorting, graphs, recursion, data structures) and common exercises. Paste source code instead to get pseudocode and a flowchart, or enable Local AI.',
      suggestions: getLibrary().map((a) => ({ id: a.id, title: a.name, category: a.category })),
    };
  }
  if (best.kind === 'algorithm') {
    const al = getAlgorithm(best.id)!;
    const result = {
      engine: { ...templateEngine(al.name), notice: ai.engine.notice },
      matched: true,
      algorithmId: al.id,
      title: al.name,
      understanding: `${al.summary} Input: ${al.input} Output: ${al.output}`,
      steps: al.steps,
      pseudocode: al.pseudocode,
      flowchart: al.flowchart,
      code: al.code[req.language],
      complexity: { time: al.complexity.average, space: al.complexity.space, reasons: [`Best ${al.complexity.best}, average ${al.complexity.average}, worst ${al.complexity.worst}.`, ...(al.complexity.note ? [al.complexity.note] : [])] },
      explanation: al.description,
      dryRun: [`Example input: ${al.example.input}`, al.example.explanation, `Output: ${al.example.output}`],
      testCases: [{ input: al.example.input, expected: al.example.output }],
      alternatives: cands.slice(1, 5),
      visual: al.visual,
    };
    record(req.record, { kind: 'algorithm', title: req.problem.slice(0, 100), language: req.language, engine: 'template', input: req, output: { title: result.title, steps: result.steps } });
    return result;
  }
  const tp = TEMPLATES.find((t) => t.id === best.id)!;
  const prog = parseProgram(tp.python, 'python');
  const code = req.language === 'python' ? tp.python : translate(tp.python, 'python', req.language).code;
  const result = {
    engine: { ...templateEngine(tp.title), notice: ai.engine.notice },
    matched: true,
    title: tp.title,
    understanding: tp.understanding,
    steps: stepsFromProgram(prog),
    pseudocode: toPseudocode(prog),
    flowchart: toFlowchart(prog).mermaid,
    code,
    complexity: estimateComplexity(prog),
    explanation: tp.explanation,
    dryRun: tp.tests.slice(0, 2).map((t) => `Input ${JSON.stringify(t.input.trim())} → output ${JSON.stringify(t.expected.trim())}`),
    testCases: tp.tests,
    alternatives: cands.slice(1, 5),
  };
  record(req.record, { kind: 'algorithm', title: req.problem.slice(0, 100), language: req.language, engine: 'template', input: req, output: { title: result.title, steps: result.steps } });
  return result;
}

function stepsFlow(steps: string[]): string {
  const prog: Stmt[] = steps.map((s) => ({ k: 'raw', text: s, reason: '' }) as Stmt);
  return buildFlow(prog, 'Start');
}

// =====================================================================================
// EXECUTION & DEBUGGING
// =====================================================================================
export function requireExecution() {
  if (!getSettings().executionEnabled)
    throw new AppError(403, 'execution_disabled', 'Local code execution is turned off. Review the safety notice and enable it in the Compiler & Debugger or in Settings.');
}

function slimExec(r: ExecResult) {
  return r;
}

export async function runCode(req: { code: string; language: Lang; stdin: string; record?: boolean; title?: string }) {
  requireExecution();
  const s = getSettings();
  const r = await executeCode(req.language, req.code, req.stdin, { timeoutMs: s.executionTimeoutMs });
  let diagnostics: Diagnosis[] = [];
  if (r.status === 'compile_error') diagnostics = interpretErrors(r.compileOutput, req.language, 'compile');
  else if (r.status === 'runtime_error' || (r.status === 'success' && r.stderr.trim())) diagnostics = interpretErrors(r.stderr, req.language, 'runtime', r.exitCode);
  const warnings = r.compileOutput && r.status !== 'compile_error' ? interpretErrors(r.compileOutput, req.language, 'compile') : [];
  record(req.record, {
    kind: 'execution',
    title: req.title ?? `Run ${LANG_LABEL[req.language]} program`,
    language: req.language,
    engine: 'local',
    status: r.status,
    input: { code: req.code, stdin: req.stdin, language: req.language },
    output: { status: r.status, stdout: r.stdout.slice(0, 4000), stderr: r.stderr.slice(0, 2000), compileOutput: r.compileOutput.slice(0, 2000), timeMs: r.timeMs },
  });
  return { ...r, diagnostics, warnings };
}

export async function runTests(req: { code: string; language: Lang; tests: { input: string; expected: string }[] }) {
  requireExecution();
  const s = getSettings();
  const norm = (x: string) => x.replace(/\r/g, '').replace(/[ \t]+$/gm, '').trimEnd();
  const results = [];
  for (const t of req.tests.slice(0, 20)) {
    const r = await executeCode(req.language, req.code, t.input, { timeoutMs: s.executionTimeoutMs });
    const passed = r.status === 'success' && norm(r.stdout) === norm(t.expected);
    results.push({ input: t.input, expected: t.expected, actual: r.stdout, status: r.status, passed, timeMs: r.timeMs, error: r.status === 'success' ? '' : (r.compileOutput || r.stderr || r.message || '').slice(0, 1500) });
    if (r.status === 'compile_error') break;
  }
  const passed = results.filter((r) => r.passed).length;
  record(true, { kind: 'debug', title: `Test run: ${passed}/${results.length} passed`, language: req.language, engine: 'local', status: passed === results.length ? 'success' : 'failed', input: { code: req.code, tests: req.tests }, output: { passed, total: results.length } });
  return { passed, total: results.length, results };
}

export async function diagnose(req: { code: string; language: Lang; stdin: string; run: boolean }) {
  const started = Date.now();
  let exec: ExecResult | null = null;
  let diagnostics: Diagnosis[] = [];
  const s = getSettings();
  if (req.run && s.executionEnabled) {
    exec = await executeCode(req.language, req.code, req.stdin, { timeoutMs: s.executionTimeoutMs });
    if (exec.status === 'compile_error') diagnostics = interpretErrors(exec.compileOutput, req.language, 'compile');
    else if (exec.status === 'runtime_error') diagnostics = interpretErrors(exec.stderr, req.language, 'runtime', exec.exitCode);
    if (exec.compileOutput && exec.status !== 'compile_error') diagnostics.push(...interpretErrors(exec.compileOutput, req.language, 'compile'));
  }
  let prog: Program | null = null;
  try {
    prog = parseProgram(req.code, req.language);
  } catch {
    prog = null;
  }
  const issues = findIssues(req.code, req.language, prog);
  const repair = repairCode(req.code, req.language, diagnostics);
  let engine: EngineInfo = { ...OFFLINE_ENGINE, label: 'Offline debugger (rule-based)' };
  let aiFix: { fixed: string; explanation: string } | null = null;
  const ai = await aiJson(
    `Find and fix the bugs in this ${LANG_LABEL[req.language]} program.${exec ? `\nWhen run it produced status "${exec.status}".\nCompiler output:\n${exec.compileOutput.slice(0, 1500)}\nRuntime error output:\n${exec.stderr.slice(0, 1500)}` : ''}
Return JSON with keys: explanation (string), fixedCode (string, the full corrected program), changes (array of strings).

Code:
${req.code}`,
    LANG_SYSTEM,
    contract(AI.debug, 3500),
  );
  if (ai.data?.fixedCode) {
    engine = ai.engine;
    aiFix = { fixed: cleanCode(ai.data.fixedCode), explanation: ai.data.explanation ?? (ai.data.changes ?? []).join('\n') };
  } else if (ai.engine.notice) engine = { ...engine, notice: ai.engine.notice };
  const result = {
    engine,
    executed: !!exec,
    executionSkipped: req.run && !s.executionEnabled ? 'Execution is disabled; only static analysis was performed.' : undefined,
    exec,
    diagnostics,
    issues,
    repair: aiFix ? { fixed: aiFix.fixed, changes: [{ line: 0, description: aiFix.explanation }], source: 'ollama' } : { ...repair, source: 'offline' },
    durationMs: Date.now() - started,
  };
  record(true, { kind: 'debug', title: `Debug ${LANG_LABEL[req.language]} program (${diagnostics.length + issues.length} findings)`, language: req.language, engine: aiFix ? 'ollama' : 'offline', status: diagnostics.length ? 'issues' : 'success', input: { code: req.code, stdin: req.stdin }, output: { diagnostics, issues: issues.length, changes: result.repair.changes.length } });
  return result;
}

/** Suggest test inputs from the program's input statements. Expected outputs are only filled when known. */
export function suggestTests(code: string, language: Lang): { input: string; expected: string | null; note: string }[] {
  let prog: Program;
  try {
    prog = parseProgram(code, language);
  } catch {
    return [];
  }
  const reads: string[][] = [];
  let readsInLoop = false;
  const all = [...prog.main, ...prog.funcs.flatMap((f) => f.body)];
  walkStmts(all, {
    stmt: (st, depth) => {
      if (st.k === 'read') {
        reads.push(st.kinds);
        if (depth > 0) readsInLoop = true;
      }
    },
  });
  if (!reads.length) return [{ input: '', expected: null, note: 'The program reads no input; run it once and compare with the expected output.' }];
  const kinds = reads.flat();
  const val = (k: string, v: number) => (k === 'double' ? (v + 0.5).toFixed(1) : k === 'word' || k === 'line' ? ['hello', 'a', 'Racecar', 'x y'][Math.abs(v) % 4] : String(v));
  if (readsInLoop && kinds[0] === 'int') {
    return [
      { input: '5\n3\n1\n4\n1\n5\n', expected: null, note: 'Typical case: n = 5 followed by 5 values.' },
      { input: '1\n42\n', expected: null, note: 'Single element.' },
      { input: '4\n-3\n-1\n-7\n-2\n', expected: null, note: 'All negative values.' },
      { input: '6\n9\n9\n9\n9\n9\n9\n', expected: null, note: 'All values equal.' },
    ];
  }
  return [
    { input: kinds.map((k, i) => val(k, 7 + i * 5)).join(' ') + '\n', expected: null, note: 'Typical values.' },
    { input: kinds.map((k) => val(k, 0)).join(' ') + '\n', expected: null, note: 'Zero / empty-like values.' },
    { input: kinds.map((k, i) => val(k, -(3 + i))).join(' ') + '\n', expected: null, note: 'Negative values.' },
    { input: kinds.map((k) => val(k, 1000000)).join(' ') + '\n', expected: null, note: 'Large values (overflow check).' },
  ];
}

export async function generateTests(req: { code: string; language: Lang }) {
  const ai = await aiJson(
    `Create test cases for this ${LANG_LABEL[req.language]} program. Each test supplies the exact standard input and the exact expected standard output. Include edge cases.
Return JSON: {"testCases": [{"input": string, "expected": string, "note": string}]}

Code:
${req.code}`,
    LANG_SYSTEM,
    contract(AI.tests),
  );
  if (ai.data?.testCases?.length) return { engine: ai.engine, tests: ai.data.testCases.slice(0, 10).map((t) => ({ input: String(t.input ?? ''), expected: String(t.expected ?? ''), note: t.note ?? '' })) };
  // offline: match a known template to get real expected outputs
  const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
  for (const tp of TEMPLATES) {
    const sample = req.language === 'python' ? tp.python : translate(tp.python, 'python', req.language).code;
    if (norm(sample) === norm(req.code)) return { engine: templateEngine(tp.title), tests: tp.tests.map((t) => ({ ...t, note: 'From the built-in template test suite.' })) };
  }
  return {
    engine: { ...OFFLINE_ENGINE, label: 'Offline test-input generator', notice: ai.engine.notice },
    tests: suggestTests(req.code, req.language).map((t) => ({ input: t.input, expected: t.expected ?? '', note: `${t.note} Expected output unknown — fill it in.` })),
  };
}

// =====================================================================================
// LEARNING HUB
// =====================================================================================
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let x = seed || 1;
  for (let i = a.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function generateQuestions(req: { topicId: string; type: 'viva' | 'mcq'; level: 'beginner' | 'advanced' | 'mixed'; count: number; seed?: number; record?: boolean }) {
  const topic = findTopic(req.topicId);
  if (!topic) throw notFound('Topic');
  const ai = await aiJson(
    req.type === 'viva'
      ? `Write ${req.count} ${req.level === 'mixed' ? '' : req.level + ' '}viva (oral exam) questions with model answers about "${topic.name}" in data structures and algorithms. Return JSON: {"questions": [{"q": string, "a": string, "level": "beginner"|"advanced"}]}`
      : `Write ${req.count} ${req.level === 'mixed' ? '' : req.level + ' '}multiple-choice questions about "${topic.name}" in data structures and algorithms. Each has exactly 4 options. Return JSON: {"questions": [{"q": string, "options": [string, string, string, string], "answer": index 0-3, "explanation": string, "level": "beginner"|"advanced"}]}`,
    LANG_SYSTEM,
    req.type === 'viva' ? contract<ZodTypeAny>(AI.viva) : contract<ZodTypeAny>(AI.mcq, 3000),
  );
  let questions: (Viva | Mcq)[];
  let engine: EngineInfo;
  if (ai.data?.questions?.length) {
    engine = ai.engine;
    questions = ai.data.questions
      .filter((q: any) => q && typeof q.q === 'string')
      .map((q: any) => (req.type === 'viva' ? { q: q.q, a: String(q.a ?? ''), level: q.level === 'advanced' ? 'advanced' : 'beginner' } : { q: q.q, options: (q.options ?? []).slice(0, 4).map(String), answer: Math.min(3, Math.max(0, Number(q.answer) || 0)), explanation: String(q.explanation ?? ''), level: q.level === 'advanced' ? 'advanced' : 'beginner' })) as (Viva | Mcq)[];
  } else {
    engine = { kind: 'template', label: 'Built-in question bank (offline, not AI-generated)', notice: ai.engine.notice };
    const bank = (req.type === 'viva' ? topic.viva : topic.mcq) as (Viva | Mcq)[];
    const filtered = bank.filter((q) => req.level === 'mixed' || q.level === req.level);
    questions = seededShuffle(filtered.length ? filtered : bank, req.seed ?? Date.now()).slice(0, req.count);
  }
  record(req.record, { kind: 'learning', title: `${req.type === 'viva' ? 'Viva questions' : 'MCQ quiz'}: ${topic.name}`, language: null, engine: engine.kind === 'ollama' ? 'ollama' : 'template', input: req, output: { count: questions.length } });
  return { engine, topic: { id: topic.id, name: topic.name }, type: req.type, questions, bankSize: (req.type === 'viva' ? topic.viva : topic.mcq).length };
}

export function learningTopics() {
  return TOPICS.map((t) => ({ id: t.id, name: t.name, icon: t.icon, summary: t.summary, category: TOPIC_CATEGORY[t.id] ?? 'Foundations', difficulty: t.practice.map((p) => p.difficulty), counts: { viva: t.viva.length, mcq: t.mcq.length, practice: t.practice.length }, algorithms: t.algorithms }));
}

// =====================================================================================
// helpers
// =====================================================================================
function record(enabled: boolean | undefined, h: Parameters<typeof addHistory>[0]) {
  if (enabled === false) return;
  try {
    addHistory(h);
  } catch {
    /* history is best-effort */
  }
}

export function fileExtension(lang: Lang) {
  return LANG_EXT[lang];
}
export type { TemplateDef };
