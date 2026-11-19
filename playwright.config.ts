import { defineConfig, devices } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * End-to-end tests. They run against the production build served by the real API server on a
 * separate port with a throw-away database, so your own CodePilot data is never touched.
 * The browser is the Microsoft Edge that ships with Windows (no browser download needed);
 * set PW_CHANNEL=chromium to use Playwright's bundled Chromium instead.
 */
const PORT = Number(process.env.E2E_PORT ?? 4417);
const DATA = process.env.E2E_DATA ?? join(tmpdir(), 'codepilot-e2e');
const channel = process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'e2e/.report', open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(channel && channel !== 'chromium' ? { channel } : {}),
  },
  projects: [
    { name: 'desktop', testIgnore: /mobile.spec.ts/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, ...(channel && channel !== 'chromium' ? { channel } : {}) } },
    { name: 'mobile', testMatch: /mobile\.spec\.ts/, use: { ...devices['Pixel 7'], ...(channel && channel !== 'chromium' ? { channel } : {}) } },
  ],
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      CODEPILOT_PORT: String(PORT),
      CODEPILOT_DB: join(DATA, 'e2e.db'),
      CODEPILOT_BACKUP_DIR: join(DATA, 'backups'),
    },
  },
});
