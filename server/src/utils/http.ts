import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const badRequest = (msg: string, details?: unknown) => new AppError(400, 'bad_request', msg, details);

/** Consistent success envelope: { ok: true, data }. */
export function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ ok: true, data });
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
export const h =
  (fn: Handler) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new AppError(400, 'validation_error', 'Invalid request', formatZod(r.error));
  return r.data;
}

export function formatZod(e: ZodError) {
  return e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export function toInt(v: unknown, name = 'id'): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`);
  return n;
}
