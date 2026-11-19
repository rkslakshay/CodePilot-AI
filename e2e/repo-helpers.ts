import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeSampleRepo } from '../server/tests/helpers/sampleRepo';
export { buildZip } from '../server/src/repo/zip';
export { SAMPLE } from '../server/tests/helpers/sampleRepo';

/** A fresh copy of the multi-language sample repository (known issues) in a temp folder. */
export function sampleRepo(git = false, base = tmpdir()): string {
  mkdirSync(base, { recursive: true });
  const dir = writeSampleRepo(mkdtempSync(join(base, 'cp-e2e-repo-')));
  if (git) {
    const run = (...a: string[]) => spawnSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: dir });
    run('init', '-q', '-b', 'main');
    run('add', '-A');
    run('commit', '-q', '-m', 'Initial import');
  }
  return dir;
}
