import { z } from 'zod';

export const LangSchema = z.enum(['c', 'cpp', 'java', 'python', 'javascript']);
const code = z.string().max(100_000, 'Code is too long (100 KB limit)');
const stdin = z.string().max(50_000).default('');

export const GenerateSchema = z.object({
  prompt: z.string().trim().min(3, 'Describe the problem in a few words').max(4000),
  language: LangSchema,
  difficulty: z.enum(['easy', 'medium', 'hard']).default('easy'),
  requirements: z.string().max(2000).optional(),
  style: z.enum(['standard', 'commented', 'compact']).default('standard'),
  variant: z.number().int().min(0).max(50).optional(),
});

export const ConvertSchema = z.object({ code: code.min(1, 'Paste some code to convert'), from: LangSchema, to: LangSchema });
export const VerifySchema = z.object({ source: code, from: LangSchema, converted: code, to: LangSchema, stdin });
export const ExplainSchema = z.object({ code: code.min(1, 'Paste some code to explain'), language: LangSchema, mode: z.enum(['beginner', 'advanced']).default('beginner') });
export const StudioCodeSchema = z.object({ code: code.min(1), language: LangSchema, target: z.string().max(100).optional(), useAi: z.boolean().optional() });
export const StudioProblemSchema = z.object({ problem: z.string().trim().min(3).max(4000), language: LangSchema.default('python') });
export const TraceSchema = z.object({ input: z.string().max(500).default('') });

export const RunSchema = z.object({ code: code.min(1, 'There is no code to run'), language: LangSchema, stdin, title: z.string().max(200).optional() });
export const TestsSchema = z.object({
  code: code.min(1),
  language: LangSchema,
  tests: z.array(z.object({ input: z.string().max(20_000), expected: z.string().max(20_000) })).min(1).max(20),
});
export const DiagnoseSchema = z.object({ code: code.min(1), language: LangSchema, stdin, run: z.boolean().default(true) });
export const GenTestsSchema = z.object({ code: code.min(1), language: LangSchema });

export const ProjectCreateSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(100),
  description: z.string().max(500).default(''),
  language: z.enum(['c', 'cpp', 'java', 'python', 'javascript', 'mixed']).default('mixed'),
});
export const ProjectUpdateSchema = ProjectCreateSchema.partial();
const fileName = z
  .string()
  .trim()
  .min(1, 'File name is required')
  .max(120)
  .regex(/^[\w\-. ()]+$/, 'Use letters, numbers, spaces, dots, dashes and underscores only');
export const FileCreateSchema = z.object({ name: fileName, language: LangSchema, content: z.string().max(500_000).default('') });
export const FileUpdateSchema = z.object({ name: fileName.optional(), language: LangSchema.optional(), content: z.string().max(500_000).optional() });
export const SnippetSchema = z.object({ projectId: z.number().int().positive().optional(), name: fileName, language: LangSchema, content: z.string().max(500_000) });

export const SavedAlgorithmSchema = z.object({
  title: z.string().trim().min(1).max(160),
  algorithmId: z.string().max(60).nullable().optional(),
  language: LangSchema.nullable().optional(),
  code: z.string().max(200_000).default(''),
  pseudocode: z.string().max(100_000).default(''),
  flowchart: z.string().max(100_000).default(''),
  steps: z.array(z.string().max(2000)).max(100).default([]),
  complexity: z.record(z.unknown()).default({}),
  notes: z.string().max(5000).default(''),
});

export const QuestionsSchema = z.object({
  topicId: z.string().max(60),
  type: z.enum(['viva', 'mcq']),
  level: z.enum(['beginner', 'advanced', 'mixed']).default('mixed'),
  count: z.number().int().min(1).max(15).default(5),
  seed: z.number().int().optional(),
});
export const TopicStatusSchema = z.object({ status: z.enum(['not_started', 'in_progress', 'completed']) });
export const AnswerSchema = z.object({
  question: z.string().min(1).max(2000),
  options: z.array(z.string().max(500)).min(2).max(6),
  answer: z.number().int().min(0).max(5),
  chosen: z.number().int().min(0).max(5),
  explanation: z.string().max(4000).optional(),
  level: z.string().max(20).optional(),
});
export const QuizResultSchema = z.object({
  topicId: z.string().max(60),
  correct: z.number().int().min(0).max(100),
  total: z.number().int().min(1).max(100),
  answers: z.array(AnswerSchema).max(100).optional(),
});
export const RevisionAnswerSchema = AnswerSchema.extend({ topicId: z.string().max(60) });
export const SaveQuestionSchema = z.object({ topicId: z.string().max(60), type: z.enum(['viva', 'mcq', 'practice']), question: z.string().min(1).max(4000), payload: z.unknown().default({}) });
export const PracticeSchema = z.object({ topicId: z.string().max(60), problemId: z.string().max(80), status: z.enum(['attempted', 'solved']), language: LangSchema.optional() });

export const HistoryQuerySchema = z.object({
  search: z.string().max(200).optional(),
  kind: z.enum(['generation', 'conversion', 'explanation', 'algorithm', 'execution', 'debug', 'learning']).optional(),
  language: LangSchema.optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export const ProfileSchema = z.object({ name: z.string().trim().min(1).max(80) });
