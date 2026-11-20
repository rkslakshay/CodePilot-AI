/** Natural language → UML: local AI (validated, bounded repair) with a deterministic offline fallback. */
import type { ZodTypeAny } from 'zod';
import { aiJson, resolveAI } from '../providers/index.js';
import { contract } from '../providers/schemas.js';
import type { EngineInfo } from '../providers/types.js';
import { AppError } from '../utils/http.js';
import { redactSecrets } from '../repo/analyze.js';
import { validateDiagram, pruneInvalid, DIAGRAM_LABEL, type Diagram, type DiagramType, type Issue } from '../../../shared/uml/index.js';
import { UML_AI, PROMPT_HINT, convertAi } from './ai.js';
import { generateWithRules } from './rules.js';

const SYSTEM = `You are a precise software architect who produces UML models.
Only use elements that the user's description states or clearly implies; do not add unrelated parts.
Refer to elements by the exact names you defined. Keep names short. Answer only with JSON matching the schema.`;

export interface GenerationResult {
  diagram: Diagram;
  engine: EngineInfo;
  method: 'ai' | 'rules';
  warnings: string[];
  repaired: boolean;
  validation: { valid: boolean; errors: Issue[]; warnings: Issue[] };
}

export async function generateFromText(type: DiagramType, text: string, opts: { useAi?: boolean; signal?: AbortSignal } = {}): Promise<GenerationResult> {
  const prompt = redactSecrets(text.trim()).slice(0, 4000);
  if (prompt.length < 8) throw new AppError(400, 'too_short', 'Describe the system in at least a sentence.');
  let notice: string | undefined;
  if (opts.useAi !== false) {
    const ai = await resolveAI();
    if (ai.provider) {
      const r = await runAi(type, prompt, opts.signal);
      if (r) return r;
      notice = 'The local AI model could not produce a valid diagram, so the offline rule-based generator was used.';
    } else notice = ai.engine.notice ?? 'Local AI is off (Settings → AI provider); the offline rule-based generator was used.';
  }
  const rules = generateWithRules(type, prompt);
  if (!rules)
    throw new AppError(422, 'not_understood', `The offline generator could not find ${DIAGRAM_LABEL[type].toLowerCase()} elements in the description. ${notice ?? ''} Try the structured notation (see the help panel), start from a template, or add elements manually.`.trim());
  const v = validateDiagram(rules.diagram);
  const d = rules.diagram;
  d.meta.generation = { ...d.meta.generation, prompt, at: new Date().toISOString(), warnings: [...(notice ? [notice] : []), ...rules.notes].slice(0, 40) };
  return {
    diagram: d,
    engine: { kind: 'offline', label: rules.method === 'structured' ? 'Structured text (offline, not AI)' : 'Rule-based extraction (offline, not AI)', notice },
    method: 'rules',
    warnings: d.meta.generation.warnings,
    repaired: false,
    validation: { valid: v.valid, errors: v.errors, warnings: v.warnings },
  };
}

async function runAi(type: DiagramType, prompt: string, signal?: AbortSignal): Promise<GenerationResult | null> {
  const c = { ...contract<ZodTypeAny>(UML_AI[type] as { zod: ZodTypeAny; json: object }, 1800), contextTokens: 6144, signal };
  const ask = (extra = '') => aiJson(`Create a UML ${DIAGRAM_LABEL[type].toLowerCase()}.\n${PROMPT_HINT[type]}\n\nDescription:\n${prompt}${extra}`, SYSTEM, c);
  const first = await ask();
  if (!first.data) return null;
  let { diagram, problems } = convertAi(type, first.data, prompt);
  let v = validateDiagram(diagram);
  let repaired = false;
  let engine: EngineInfo = first.engine;
  const errorsOf = (p: string[], vv: ReturnType<typeof validateDiagram>) => [...p, ...vv.errors.map((e) => e.message)];
  // bounded semantic repair: one more round with the concrete problems
  if (errorsOf(problems, v).length || diagram.elements.length === 0) {
    const list = errorsOf(problems, v).slice(0, 12);
    const second = await ask(`\n\nYour previous answer had these problems:\n- ${list.join('\n- ') || 'it contained no elements'}\nReturn the complete corrected JSON. Every relationship must refer to a defined name.`);
    if (second.data) {
      const again = convertAi(type, second.data, prompt);
      const v2 = validateDiagram(again.diagram);
      if (errorsOf(again.problems, v2).length < errorsOf(problems, v).length || (diagram.elements.length === 0 && again.diagram.elements.length)) {
        ({ diagram, problems } = again);
        v = v2;
        engine = second.engine;
      }
      repaired = true;
    }
  }
  if (diagram.elements.length === 0) return null;
  const warnings = [...problems];
  if (!v.valid) {
    // never silently accept: remove what is invalid and say exactly what was removed
    const pr = pruneInvalid(diagram);
    diagram = pr.diagram;
    if (pr.removed.length) warnings.push(...pr.removed.map((r) => `Removed invalid relationship from the AI answer: ${r}`));
    v = validateDiagram(diagram);
    if (!v.valid) warnings.push(...v.errors.map((e) => `Still invalid: ${e.message}`));
  }
  diagram.meta.generation = { method: 'ai', label: `Local AI (Ollama${engine.model ? ` · ${engine.model}` : ''})`, model: engine.model, prompt, at: new Date().toISOString(), warnings: warnings.slice(0, 40) };
  return { diagram, engine, method: 'ai', warnings: diagram.meta.generation.warnings, repaired, validation: { valid: v.valid, errors: v.errors, warnings: v.warnings } };
}
