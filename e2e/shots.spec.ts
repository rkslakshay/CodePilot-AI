import { test } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sampleRepo } from './repo-helpers';
// Documentation screenshots (run on demand: npx playwright test e2e/shots.spec.ts --project=desktop)
test('documentation screenshots', async ({ page, request }) => {
  test.skip(!process.env.CP_SHOTS, 'set CP_SHOTS=1 to regenerate docs/screenshots');
  test.setTimeout(180_000);
  mkdirSync('docs/screenshots', { recursive: true });
  // project-local folder so screenshots show no personal paths
  const dir = sampleRepo(true, join(process.cwd(), 'e2e', '.tmp'));
  appendFileSync(join(dir, 'src/server.js'), 'function added() { eval(userInput); }\n');
  const { repo, job } = (await (await request.post('/api/repos/import/folder', { data: { path: dir, name: 'sample-shop' } })).json()).data;
  for (let i = 0; i < 100 && (await (await request.get(`/api/repos/jobs/${job.id}`)).json()).data.status === 'running'; i++) await page.waitForTimeout(100);
  const shots: [string, string, 'dark' | 'light'][] = [
    ['repo-overview', '', 'dark'],
    ['repo-files', 'files?path=src/server.js&line=8', 'light'],
    ['repo-security', 'security', 'dark'],
    ['repo-complexity', 'complexity', 'light'],
    ['repo-debt', 'debt', 'dark'],
    ['repo-git', 'git', 'dark'],
    ['repo-reports', 'reports', 'light'],
  ];
  for (const [name, path, theme] of shots) {
    await request.put('/api/settings', { data: { theme } });
    await page.goto(`/repos/${repo.id}/${path}`);
    await page.waitForLoadState('networkidle');
    if (name === 'repo-security') await page.getByRole('list', { name: 'Findings' }).getByRole('button').first().click();
    if (name === 'repo-git') {
      await page.getByRole('checkbox', { name: 'Explain with local AI' }).uncheck();
      await page.getByRole('button', { name: 'Review changes' }).click();
      await page.getByText('Findings on changed lines').waitFor();
    }
    await page.waitForTimeout(700);
    await page.screenshot({ path: `docs/screenshots/${name}.png` });
  }

  // other modules (demo data is clearly flagged as demo inside the app)
  await request.put('/api/settings', { data: { theme: 'dark', executionEnabled: true } });
  await request.post('/api/demo/load');
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'docs/screenshots/dashboard.png' });

  await page.goto('/studio?algo=merge-sort');
  await page.waitForLoadState('networkidle');
  for (let i = 0; i < 9; i++) await page.getByRole('button', { name: 'Next step' }).click();
  await page.screenshot({ path: 'docs/screenshots/algorithm-studio.png' });

  await request.put('/api/settings', { data: { theme: 'light' } });
  await page.goto('/converter');
  await page.waitForFunction(() => (window as any).monaco?.editor?.getEditors?.().length > 0);
  await page.evaluate(() => (window as any).monaco.editor.getEditors()[0].setValue('class Account:\n    def __init__(self, owner):\n        self.owner = owner\n        self.balance = 0\n\n    def deposit(self, amount):\n        if amount <= 0:\n            raise ValueError("amount must be positive")\n        self.balance += amount\n\n\nacc = Account("Asha")\nacc.deposit(50)\nprint(acc.owner, acc.balance)\n'));
  await page.getByRole('main').getByRole('button', { name: 'Convert', exact: true }).click();
  await page.getByRole('main').locator('.monaco-editor').nth(1).getByText('class').first().waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'docs/screenshots/code-converter.png' });

  await request.put('/api/settings', { data: { theme: 'dark' } });
  await page.goto('/compiler');
  await page.getByRole('main').getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('main').getByText('sandboxed').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/compiler.png' });

  await request.put('/api/settings', { data: { theme: 'light' } });
  await page.goto('/learning');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'docs/screenshots/learning-hub.png' });
  await request.post('/api/demo/clear');
});
