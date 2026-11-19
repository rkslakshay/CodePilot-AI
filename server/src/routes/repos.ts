/** Repository Analyzer API (/api/repos). Read-only with respect to imported repositories. */
import express, { Router, type Response } from 'express';
import { z } from 'zod';
import { h, ok, parse, toInt, AppError } from '../utils/http.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as S from '../repo/service.js';
import * as RV from '../repo/review.js';
import { gitOverview, gitDiff, detectGit, GitError } from '../repo/git.js';
import { getJob, cancelJob } from '../repo/jobs.js';
import { detectTools } from '../repo/tools.js';
import { buildReport, markdownToHtml, renderPdf, findBrowser } from '../repo/report.js';
import { ZIP_LIMITS } from '../repo/zip.js';
import { SCAN_LIMITS, DEFAULT_IGNORES } from '../repo/scan.js';

export const repos = Router();
const heavy = rateLimit(30, 60_000);

const FolderSchema = z.object({ path: z.string().min(1).max(1000), name: z.string().max(200).optional() });
const FindingPatch = z.object({ status: z.enum(['open', 'reviewed', 'dismissed', 'fixed']).optional(), note: z.string().max(4000).optional(), userVerified: z.boolean().optional() }).refine((v) => Object.keys(v).length > 0, 'Nothing to update');
const FindingQuery = z.object({
  search: z.string().max(200).optional(),
  severity: z.string().max(100).optional(),
  category: z.string().max(200).optional(),
  status: z.string().max(100).optional(),
  source: z.enum(['static', 'tool', 'ai', 'combined']).optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  path: z.string().max(1000).optional(),
  sort: z.enum(['severity', 'confidence', 'path', 'newest']).optional(),
  includeResolved: z.enum(['0', '1']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const ReviewFile = z.object({ path: z.string().min(1).max(1000), functionName: z.string().max(200).optional(), force: z.boolean().optional() });
const ReviewScope = z.object({ folder: z.string().max(1000).optional(), maxFiles: z.number().int().min(1).max(40).optional() });
const Ask = z.object({ question: z.string().min(3).max(1500), findingId: z.number().int().positive().optional(), path: z.string().max(1000).optional() });

/** Aborts long AI work when the browser cancels the request. */
function abortOnClose(res: Response): AbortSignal {
  const c = new AbortController();
  // 'close' before the response finished = the browser went away / cancelled the request
  res.on('close', () => {
    if (!res.writableFinished) c.abort();
  });
  return c.signal;
}
const gitErr = (e: unknown) => (e instanceof GitError ? new AppError(e.code === 'not_installed' ? 501 : 422, `git_${e.code}`, e.message) : e);

repos.get('/', (_req, res) => ok(res, S.listRepos()));
repos.get('/capabilities', (req, res) =>
  ok(res, {
    tools: detectTools(req.query.refresh === '1'),
    git: detectGit(req.query.refresh === '1'),
    pdf: { available: !!findBrowser(), engine: findBrowser() ? 'Microsoft Edge / Chrome (headless)' : null },
    limits: { zipMaxMb: ZIP_LIMITS.maxArchiveBytes / 1024 / 1024, maxFiles: SCAN_LIMITS.maxFiles, maxFileKb: SCAN_LIMITS.maxFileBytes / 1024 },
    defaultIgnores: DEFAULT_IGNORES,
  }),
);
repos.get('/rules', (_req, res) => ok(res, S.rulesCatalogue()));
repos.post('/import/folder', heavy, (req, res) => ok(res, S.importFolder(parse(FolderSchema, req.body)), 201));
repos.post(
  '/import/zip',
  heavy,
  express.raw({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], limit: ZIP_LIMITS.maxArchiveBytes }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError(415, 'unsupported_media_type', 'Send the ZIP archive as the request body (Content-Type: application/zip).');
    const fileName = decodeURIComponent(String(req.headers['x-file-name'] ?? 'repository.zip')).slice(0, 255);
    ok(res, S.importZip(req.body, fileName, typeof req.query.name === 'string' ? req.query.name : undefined), 201);
  },
);
repos.get('/jobs/:jobId', (req, res) => {
  const j = getJob(String(req.params.jobId));
  if (!j) throw new AppError(404, 'not_found', 'Job not found (it may have finished long ago).');
  ok(res, j);
});
repos.post('/jobs/:jobId/cancel', (req, res) => ok(res, { cancelled: cancelJob(String(req.params.jobId)) }));

repos.get('/:id', (req, res) => ok(res, S.overview(toInt(req.params.id))));
repos.delete('/:id', (req, res) => {
  if (req.query.confirm !== 'yes') throw new AppError(400, 'confirmation_required', 'Add ?confirm=yes to remove the repository from CodePilot.');
  ok(res, S.deleteRepo(toInt(req.params.id)));
});
repos.post('/:id/analyze', heavy, (req, res) => ok(res, S.analyzeRepo(toInt(req.params.id)), 202));
repos.get('/:id/events', (req, res) => ok(res, S.listEvents(toInt(req.params.id), 50)));
repos.get('/:id/files', (req, res) => ok(res, S.fileTree(toInt(req.params.id))));
repos.get('/:id/file', (req, res) => {
  const path = String(req.query.path ?? '');
  if (!path) throw new AppError(400, 'bad_request', 'path is required');
  ok(res, S.readRepoFile(toInt(req.params.id), path));
});
repos.get('/:id/findings', (req, res) => {
  const q = parse(FindingQuery, req.query);
  ok(res, S.listFindings(toInt(req.params.id), { ...q, includeResolved: q.includeResolved === '1' }));
});
repos.get('/:id/findings/:fid', (req, res) => ok(res, S.getFinding(toInt(req.params.id), toInt(req.params.fid, 'finding id'))));
repos.patch('/:id/findings/:fid', (req, res) => ok(res, S.updateFinding(toInt(req.params.id), toInt(req.params.fid, 'finding id'), parse(FindingPatch, req.body))));
repos.get('/:id/dependencies', (req, res) => ok(res, S.dependencies(toInt(req.params.id))));
repos.get('/:id/complexity', (req, res) => ok(res, S.complexity(toInt(req.params.id))));
repos.get('/:id/debt', (req, res) => ok(res, S.debt(toInt(req.params.id))));

repos.get(
  '/:id/git',
  h(async (req, res) => {
    const r = S.getRepo(toInt(req.params.id));
    try {
      ok(res, await gitOverview(r.rootPath));
    } catch (e) {
      throw gitErr(e);
    }
  }),
);
repos.get(
  '/:id/git/diff',
  h(async (req, res) => {
    const r = S.getRepo(toInt(req.params.id));
    const path = typeof req.query.path === 'string' ? req.query.path : undefined;
    const commit = typeof req.query.commit === 'string' ? req.query.commit : undefined;
    try {
      const diff = await gitDiff(r.rootPath, { path, staged: req.query.staged === '1', commit });
      ok(res, { diff: diff.length > 400_000 ? diff.slice(0, 400_000) + '\n… (diff truncated)' : diff });
    } catch (e) {
      throw gitErr(e);
    }
  }),
);
repos.post(
  '/:id/git/review',
  heavy,
  h(async (req, res) => {
    try {
      ok(res, await RV.reviewGitChanges(toInt(req.params.id), { useAi: req.body?.useAi !== false, signal: abortOnClose(res) }));
    } catch (e) {
      throw gitErr(e);
    }
  }),
);

repos.post('/:id/review/file', heavy, h(async (req, res) => {
  const b = parse(ReviewFile, req.body);
  ok(res, await RV.reviewFile(toInt(req.params.id), b.path, { functionName: b.functionName, force: b.force, signal: abortOnClose(res) }));
}));
repos.get('/:id/review/file', (req, res) => ok(res, RV.cachedFileReview(toInt(req.params.id), String(req.query.path ?? ''))));
repos.post('/:id/review/scope', heavy, (req, res) => ok(res, RV.startScopeReview(toInt(req.params.id), parse(ReviewScope, req.body ?? {})), 202));
repos.get('/:id/review/last', (req, res) => ok(res, RV.lastScopeReview(toInt(req.params.id))));
repos.post('/:id/ask', heavy, h(async (req, res) => {
  const b = parse(Ask, req.body);
  ok(res, await RV.askRepository(toInt(req.params.id), b.question, { findingId: b.findingId, path: b.path, signal: abortOnClose(res) }));
}));

const report = (id: number) => {
  try {
    return buildReport(id);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status) throw new AppError(err.status, 'not_analysed', err.message);
    throw e;
  }
};
const fileName = (title: string, ext: string) => `${title.replace(/[^\w.-]+/g, '_').slice(0, 80)}.${ext}`;
repos.get('/:id/report.md', (req, res) => {
  const r = report(toInt(req.params.id));
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(r.title, 'md')}"`);
  res.send(r.markdown);
});
repos.get('/:id/report.html', (req, res) => {
  const r = report(toInt(req.params.id));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // previewed in a same-origin iframe on the Reports section
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.send(markdownToHtml(r.markdown, r.title));
});
repos.get('/:id/report.pdf', heavy, h(async (req, res) => {
  const r = report(toInt(req.params.id));
  try {
    const pdf = await renderPdf(markdownToHtml(r.markdown, r.title));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName(r.title, 'pdf')}"`);
    res.send(pdf);
  } catch (e) {
    const err = e as Error & { status?: number };
    throw new AppError(err.status ?? 500, 'pdf_failed', err.message);
  }
}));
