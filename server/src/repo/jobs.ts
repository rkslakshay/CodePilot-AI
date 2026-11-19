/** In-memory background jobs (analysis, AI review) with progress and cancellation. */
import { randomUUID } from 'node:crypto';

export type JobStatus = 'running' | 'done' | 'error' | 'cancelled';
export interface Job {
  id: string;
  kind: 'analysis' | 'review';
  repoId: number;
  status: JobStatus;
  progress: { done: number; total: number; message: string };
  result: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const jobs = new Map<string, Job & { controller: AbortController }>();

export class CancelledError extends Error {
  constructor() {
    super('Cancelled by the user');
  }
}

export function startJob<T>(kind: Job['kind'], repoId: number, run: (ctx: { signal: AbortSignal; progress: (done: number, total: number, message: string) => void }) => Promise<T>): Job {
  const controller = new AbortController();
  const job: Job & { controller: AbortController } = { id: randomUUID(), kind, repoId, status: 'running', progress: { done: 0, total: 0, message: 'Starting…' }, result: null, error: null, startedAt: new Date().toISOString(), finishedAt: null, controller };
  jobs.set(job.id, job);
  // keep the registry small
  if (jobs.size > 50) for (const [id, j] of jobs) if (j.status !== 'running') { jobs.delete(id); if (jobs.size <= 50) break; }
  void (async () => {
    try {
      job.result = await run({ signal: controller.signal, progress: (done, total, message) => (job.progress = { done, total, message }) });
      job.status = controller.signal.aborted ? 'cancelled' : 'done';
    } catch (e) {
      job.status = controller.signal.aborted || e instanceof CancelledError ? 'cancelled' : 'error';
      job.error = (e as Error).message;
    } finally {
      job.finishedAt = new Date().toISOString();
    }
  })();
  return publicJob(job);
}

const publicJob = (j: Job & { controller?: AbortController }): Job => {
  const { controller: _c, ...rest } = j as Job & { controller: AbortController };
  return { ...rest };
};
export const getJob = (id: string): Job | null => (jobs.has(id) ? publicJob(jobs.get(id)!) : null);
export const activeJob = (repoId: number, kind: Job['kind']): Job | null => {
  for (const j of jobs.values()) if (j.repoId === repoId && j.kind === kind && j.status === 'running') return publicJob(j);
  return null;
};
export function cancelJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j || j.status !== 'running') return false;
  j.controller.abort();
  return true;
}
export const yieldNow = () => new Promise<void>((r) => setImmediate(r));
