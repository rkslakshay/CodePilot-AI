import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { api } from './routes/index.js';
import { repos } from './routes/repos.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { config } from './config.js';
import { log } from './utils/logger.js';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  // Security headers. The API is only bound to 127.0.0.1; reject cross-site browser requests.
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // Everything (scripts, fonts, Monaco workers) is bundled locally, so the page needs no other origin.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    // DNS-rebinding protection: a hostile site that re-points its domain to 127.0.0.1 sends its own Host header.
    const host = (req.headers.host ?? '').toLowerCase();
    if (!LOCAL_HOST.test(host)) {
      res.status(421).json({ ok: false, error: { code: 'forbidden_host', message: 'CodePilot only answers requests addressed to localhost.' } });
      return;
    }
    const origin = req.headers.origin;
    if (origin && req.path.startsWith('/api') && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin)) {
      res.status(403).json({ ok: false, error: { code: 'forbidden_origin', message: 'Requests from other websites are not allowed.' } });
      return;
    }
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  // request logging (method, path, status, duration) — request bodies are never logged
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.startsWith('/api')) log.info(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  app.use('/api/repos', repos);
  app.use('/api', api);
  app.use('/api', notFoundHandler);

  // Serve the built client in production mode.
  if (existsSync(join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(config.clientDist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}
