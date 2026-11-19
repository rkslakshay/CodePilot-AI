import type { NextFunction, Request, Response } from 'express';

/** Tiny in-memory fixed-window rate limiter for expensive local endpoints. */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const cur = hits.get(key);
    if (!cur || cur.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    cur.count++;
    if (cur.count > max) {
      res.setHeader('Retry-After', Math.ceil((cur.reset - now) / 1000));
      res.status(429).json({ ok: false, error: { code: 'rate_limited', message: 'Too many requests — please wait a moment.' } });
      return;
    }
    next();
  };
}
