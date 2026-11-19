// Starts the CodePilot API + production client for end-to-end tests with a fresh, throw-away database.
import { rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

const db = process.env.CODEPILOT_DB;
if (!db || !/codepilot-e2e/.test(db)) {
  console.error('Refusing to start: CODEPILOT_DB must point to the e2e temp folder.');
  process.exit(1);
}
const dir = dirname(db);
// fresh state on every run (the e2e folder is exclusively owned by the tests)
rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
mkdirSync(dir, { recursive: true });

const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { stdio: 'inherit', env: process.env });
const stop = () => child.kill();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
