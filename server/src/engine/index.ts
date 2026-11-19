import type { Lang } from './ir.js';
import { parseProgram, ParseError } from './parser.js';
import { LexError } from './lexer.js';
import { emitProgram } from './emit.js';

export interface TranslateResult {
  ok: boolean;
  code: string;
  warnings: string[];
  notes: string[];
  error?: { message: string; line?: number };
}

/** Offline, rule-based source-to-source translation through the shared IR. */
export function translate(code: string, from: Lang, to: Lang): TranslateResult {
  try {
    const prog = parseProgram(code, from);
    const r = emitProgram(prog, to);
    return { ok: true, code: r.code, warnings: r.warnings, notes: [...new Set(r.notes)] };
  } catch (e) {
    const line = e instanceof ParseError || e instanceof LexError ? e.line : undefined;
    return { ok: false, code: '', warnings: [], notes: [], error: { message: (e as Error).message, line } };
  }
}
export { parseProgram };
