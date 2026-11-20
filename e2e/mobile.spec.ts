import { test, expect, expectNoOverflow, expectAccessibleControls, resetState } from './fixtures';
import { NAV_PAGES } from './pages';

test.beforeEach(async ({ api }) => resetState(api));

test('M1 · phone: drawer navigation reaches every module without horizontal scrolling', async ({ page }) => {
  await page.goto('/');
  for (const p of NAV_PAGES.slice(1)) {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation').getByRole('link', { name: p.label }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoOverflow(page);
    await expectAccessibleControls(page);
  }
});

test('M2 · phone: generate code and read it without overflow', async ({ page }) => {
  await page.goto('/generator');
  await page.getByRole('main').getByRole('button', { name: 'Print the Fibonacci series' }).click();
  await page.getByRole('main').getByRole('button', { name: 'Generate code' }).click();
  await expect(page.getByRole('main').locator('.monaco-editor').first()).toContainText(/fib|def /i);
  await expectNoOverflow(page);
});

test('M3 · phone: repository overview and findings fit the screen', async ({ page, api }) => {
  const { sampleRepo } = await import('./repo-helpers');
  const { repo, job } = await api('/repos/import/folder', { method: 'POST', body: { path: sampleRepo() } });
  await expect.poll(async () => (await api(`/repos/jobs/${job.id}`)).status).toBe('done');
  for (const s of ['', 'security', 'files?path=src/server.js', 'dependencies', 'reports']) {
    await page.goto(`/repos/${repo.id}/${s}`);
    await page.waitForLoadState('networkidle');
    await expectNoOverflow(page);
  }
});

test('M-UML · phone: UML Studio editor fits the screen', async ({ page }) => {
  await page.goto('/uml');
  await page.getByRole('button', { name: 'Example Class diagram' }).click();
  await expect(page.getByTestId('uml-canvas').locator('[data-el]').first()).toBeVisible();
  await expectNoOverflow(page);
  await expectAccessibleControls(page);
});
