import { defineConfig } from 'vitest/config';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 180000,
    hookTimeout: 60000,
    pool: 'forks',
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      CODEPILOT_DB: ':memory:',
      CODEPILOT_BACKUP_DIR: join(tmpdir(), 'codepilot-test-backups'),
    },
  },
});
