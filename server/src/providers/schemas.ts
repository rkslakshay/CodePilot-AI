/**
 * Response contracts for local-model features. Each contract yields both a JSON schema
 * (sent to Ollama "structured outputs" so even small models emit valid JSON) and a Zod
 * validator (checked on the server before anything is shown to the user).
 */
import { z, type ZodTypeAny } from 'zod';

interface Field<Z extends ZodTypeAny = ZodTypeAny> {
  zod: Z;
  json: Record<string, unknown>;
}
const str = (max = 20000): Field<z.ZodString> => ({ zod: z.string().max(max), json: { type: 'string' } });
const int = (min: number, max: number): Field<z.ZodNumber> => ({ zod: z.coerce.number().int().min(min).max(max), json: { type: 'integer', minimum: min, maximum: max } });
const enm = <T extends [string, ...string[]]>(vals: T): Field<z.ZodEnum<T>> => ({ zod: z.enum(vals), json: { type: 'string', enum: vals } });
const arr = <F extends Field>(item: F, max = 40): Field<z.ZodArray<F['zod']>> => ({ zod: z.array(item.zod).max(max), json: { type: 'array', items: item.json } });
function obj<S extends Record<string, Field>>(shape: S, optional: (keyof S)[] = []) {
  const zshape: Record<string, ZodTypeAny> = {};
  const props: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(shape)) {
    zshape[k] = optional.includes(k) ? f.zod.optional() : f.zod;
    props[k] = f.json;
  }
  return {
    zod: z.object(zshape) as unknown as z.ZodObject<{ [K in keyof S]: S[K]['zod'] }>,
    json: { type: 'object', properties: props, required: Object.keys(shape).filter((k) => !optional.includes(k)) },
  };
}
/** Code must be a non-empty string. */
const code = (): Field<z.ZodString> => ({ zod: z.string().min(5).max(40000), json: { type: 'string' } });
const testCase = obj({ input: str(4000), expected: str(4000) });

export const AI = {
  generate: obj(
    {
      understanding: str(),
      code: code(),
      explanation: str(),
      variables: arr(obj({ name: str(100), purpose: str(400) })),
      timeComplexity: str(60),
      spaceComplexity: str(60),
      sampleInput: str(4000),
      sampleOutput: str(4000),
      testCases: arr(testCase, 10),
      edgeCases: arr(str(400), 12),
    },
    ['variables', 'sampleInput', 'sampleOutput', 'testCases', 'edgeCases'],
  ),
  convert: obj({ code: code(), explanation: str(), warnings: arr(str(500), 20) }, ['warnings']),
  explain: obj(
    {
      summary: str(2000),
      overview: arr(str(600), 10),
      lines: arr(obj({ line: int(1, 100000), text: str(600) }), 400),
      concepts: arr(obj({ name: str(100), description: str(500) }), 12),
    },
    ['overview', 'lines', 'concepts'],
  ),
  algorithm: obj(
    {
      title: str(200),
      understanding: str(),
      steps: arr(str(600), 30),
      pseudocode: str(),
      python: str(),
      timeComplexity: str(60),
      spaceComplexity: str(60),
      explanation: str(),
      dryRun: arr(str(600), 30),
      testCases: arr(testCase, 10),
    },
    ['understanding', 'python', 'explanation', 'dryRun', 'testCases'],
  ),
  pseudocode: obj({ steps: arr(str(600), 30), pseudocode: str(), explanation: str() }, ['explanation']),
  debug: obj({ explanation: str(), fixedCode: code(), changes: arr(str(600), 20) }, ['changes']),
  tests: obj({ testCases: arr(obj({ input: str(4000), expected: str(4000), note: str(400) }, ['note']), 10) }),
  viva: obj({ questions: arr(obj({ q: str(800), a: str(3000), level: enm(['beginner', 'advanced']) }), 15) }),
  mcq: obj({
    questions: arr(
      obj({
        q: str(800),
        options: { zod: z.array(z.string().max(400)).length(4), json: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 } },
        answer: int(0, 3),
        explanation: str(1500),
        level: enm(['beginner', 'advanced']),
      }),
      15,
    ),
  }),
};

export type AiContract = (typeof AI)[keyof typeof AI];
/** Convenience: options object for aiJson. */
export const contract = <Z extends ZodTypeAny>(c: { zod: Z; json: object }, maxTokens?: number) => ({ schema: c.json as Record<string, unknown>, validate: c.zod, maxTokens });

// ------------------------------------------------------------------ Repository Analyzer (3.0)
const sev = enm(['critical', 'high', 'medium', 'low', 'info']);
/** line 0 = the model could not point at a specific line */
const reviewItem = obj({ line: int(0, 1_000_000), title: str(200), detail: str(2000), severity: sev });
export const REVIEW = {
  file: obj({
    summary: str(3000),
    quality: arr(str(600), 10),
    bugs: arr(reviewItem, 12),
    performance: arr(reviewItem, 10),
    security: arr(reviewItem, 10),
    maintainability: arr(reviewItem, 10),
    recommendations: arr(str(600), 10),
    improvements: arr(obj({ title: str(200), detail: str(2000) }), 8),
  }),
  answer: obj({ answer: str(6000), files: arr(str(400), 10) }),
  diff: obj({ purpose: str(2000), impact: str(2000), risks: arr(obj({ title: str(200), detail: str(1500), severity: sev }), 10), testSuggestions: arr(str(500), 10) }),
};

/** Field builders (JSON schema + Zod) reused by other features, e.g. UML Studio. */
export const fields = { str, int, enm, arr, obj };
