import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/http.js';
import { log } from '../utils/logger.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ ok: false, error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  const e = err as { type?: string; status?: number; message?: string };
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ ok: false, error: { code: 'payload_too_large', message: `Request body is too large (limit ${Math.round(((e as { limit?: number }).limit ?? 1048576) / 1048576)} MB).` } });
    return;
  }
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ ok: false, error: { code: 'invalid_json', message: 'Request body is not valid JSON.' } });
    return;
  }
  if (typeof e?.message === 'string' && /UNIQUE constraint failed/.test(e.message)) {
    res.status(409).json({ ok: false, error: { code: 'conflict', message: 'An item with that name already exists.' } });
    return;
  }
  log.error(`${req.method} ${req.path} failed:`, (err as Error)?.stack ?? err);
  res.status(500).json({ ok: false, error: { code: 'internal_error', message: 'Something went wrong on the local server.' } });
}
