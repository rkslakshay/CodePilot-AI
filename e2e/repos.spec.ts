import { appendFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, expectNoOverflow, expectAccessibleControls, resetState } from './fixtures';
import { sampleRepo, buildZip, SAMPLE } from './repo-helpers';

test.beforeEach(async ({ api }) => resetState(api));
const main = (page: import('@playwright/test').Page) => page.getByRole('main');

async function importViaUi(page: import('@playwright/test').Page, dir: string) {
  await page.goto('/repos');
  await main(page).getByRole('button', { name: 'Import repository' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Folder path' }).fill(dir);
  await dialog.getByRole('button', { name: 'Import and analyse' }).click();
  await expect(page).toHaveURL(/\/repos\/\d+$/, { timeout: 30_000 });
  await expect(main(page).getByRole('img', { name: /Quality score \d+ out of 100/ })).toBeVisible();
  return Number(page.url().split('/').pop());
}

test('R1 · import a local folder and see an overview computed from the real files', async ({ page }) => {
  const dir = sampleRepo();
  await importViaUi(page, dir);
  const m = main(page);
  // numbers match the sample repository
  await expect(m.getByText('Source files', { exact: true }).locator('..')).toContainText('9');
  await expect(m.getByRole('list', { name: 'Lines by language' })).toContainText('javascript');
  await expect(m.getByRole('img', { name: /Findings by severity/ })).toBeVisible();
  await expect(m.getByText('Express').first()).toBeVisible();
  await expectNoOverflow(page);
  await expectAccessibleControls(page);
});

test('R2 · file explorer shows source with findings and refuses secret files', async ({ page, api, guard }) => {
  guard.allow(/status of 403/); // the refusal to display .env is an expected 403
  const { repo, job } = await api('/repos/import/folder', { method: 'POST', body: { path: sampleRepo() } });
  await expect.poll(async () => (await api(`/repos/jobs/${job.id}`)).status).toBe('done');
  await page.goto(`/repos/${repo.id}/files`);
  const m = main(page);
  await m.getByRole('button', { name: /^src\s*(,|$)/ }).click();
  await m.getByRole('button', { name: /^server\.js\s*(,|$)/ }).click();
  await expect(m.locator('.monaco-editor').first()).toContainText('db.query');
  await expect(m.getByText('Possible SQL injection').first()).toBeVisible();
  await m.getByRole('button', { name: /Possible SQL injection/ }).first().click();
  await expect(m.getByText('Why it matters')).toBeVisible();
  await m.getByRole('button', { name: /^\.env\s*(,|$)/ }).click();
  await expect(m.getByText(/probably contains secrets/)).toBeVisible();
  await expect(page.getByText('do-not-read-me')).toHaveCount(0);
});

test('R3 · security scanner: filter, triage a false positive and keep it dismissed after re-analysis', async ({ page, api }) => {
  const { repo, job } = await api('/repos/import/folder', { method: 'POST', body: { path: sampleRepo() } });
  await expect.poll(async () => (await api(`/repos/jobs/${job.id}`)).status).toBe('done');
  await page.goto(`/repos/${repo.id}/security`);
  const m = main(page);
  await expect(m.getByText('Static analysis cannot prove that code is secure')).toBeVisible();
  await m.getByRole('group', { name: 'Filter by severity' }).getByRole('button', { name: /High/ }).click();
  const list = m.getByRole('list', { name: 'Findings' });
  await expect(list.getByRole('listitem').first()).toContainText('High');
  await m.getByRole('textbox', { name: 'Search findings' }).fill('Plain HTTP');
  await m.getByRole('group', { name: 'Filter by severity' }).getByRole('button', { name: /High/ }).click();
  await list.getByRole('button', { name: /Insecure HTTP URL/ }).click();
  await m.getByRole('button', { name: 'False positive' }).click();
  await expect(page.getByText('Dismissed as false positive')).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(0);
  // re-run the analysis from the header; the finding stays dismissed
  await m.getByRole('button', { name: 'Re-run analysis' }).click();
  await expect(page.getByText('Analysis complete')).toBeVisible({ timeout: 30_000 });
  await m.getByRole('combobox', { name: 'Filter by status' }).selectOption('dismissed');
  await m.getByRole('textbox', { name: 'Search findings' }).fill('Plain HTTP');
  await expect(m.getByRole('list', { name: 'Findings' }).getByRole('listitem')).toHaveCount(1);
});

test('R4 · import a ZIP archive and reject a malicious one', async ({ page, guard }) => {
  guard.allow(/status of 400/); // the rejected archive is an expected 400 response
  const dir = mkdtempSync(join(tmpdir(), 'cp-e2e-zip-'));
  const good = join(dir, 'shop-main.zip');
  writeFileSync(good, buildZip(Object.entries(SAMPLE).filter(([p]) => !p.startsWith('.env')).map(([p, c]) => ({ name: `shop-main/${p}`, data: c }))));
  const evil = join(dir, 'evil.zip');
  writeFileSync(evil, buildZip([{ name: '../../escape.txt', data: 'x' }]));
  await page.goto('/repos');
  await main(page).getByRole('button', { name: 'Import repository' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'ZIP archive' }).click();
  await dialog.locator('input[type=file]').setInputFiles(evil);
  await dialog.getByRole('button', { name: 'Import and analyse' }).click();
  await expect(dialog.getByText(/Path traversal in archive/)).toBeVisible();
  await dialog.locator('input[type=file]').setInputFiles(good);
  await dialog.getByRole('button', { name: 'Import and analyse' }).click();
  await expect(page).toHaveURL(/\/repos\/\d+$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'shop-main' })).toBeVisible();
  await expect(main(page).getByText('ZIP archive · managed copy')).toBeVisible();
});

test('R5 · complexity, dependencies and technical debt sections show evidence', async ({ page, api }) => {
  const { repo, job } = await api('/repos/import/folder', { method: 'POST', body: { path: sampleRepo() } });
  await expect.poll(async () => (await api(`/repos/jobs/${job.id}`)).status).toBe('done');
  await page.goto(`/repos/${repo.id}/complexity`);
  await expect(main(page).getByRole('cell', { name: 'classify()' })).toBeVisible();
  await page.goto(`/repos/${repo.id}/dependencies`);
  await expect(main(page).getByText('no vulnerability database was consulted', { exact: false })).toBeVisible();
  await expect(main(page).getByRole('cell', { name: 'left-pad' })).toBeVisible();
  await expect(main(page).getByText('Missing lockfile').first()).toBeVisible();
  await page.goto(`/repos/${repo.id}/debt`);
  await expect(main(page).getByRole('heading', { name: 'Complex functions' })).toBeVisible();
  await expect(main(page).getByText(/No effort or time estimates/)).toBeVisible();
  await expectNoOverflow(page);
});

test('R6 · Git changes: status, diff and change review (read-only)', async ({ page, api }) => {
  const dir = sampleRepo(true);
  appendFileSync(join(dir, 'src/server.js'), 'function added() { eval(userInput); }\n');
  const { repo, job } = await api('/repos/import/folder', { method: 'POST', body: { path: dir } });
  await expect.poll(async () => (await api(`/repos/jobs/${job.id}`)).status).toBe('done');
  await page.goto(`/repos/${repo.id}/git`);
  const m = main(page);
  await expect(m.getByText('main', { exact: true })).toBeVisible();
  await m.getByRole('button', { name: /src\/server\.js/ }).click();
  await expect(m.getByLabel('Diff')).toContainText('+function added() { eval(userInput); }');
  await m.getByRole('checkbox', { name: 'Explain with local AI' }).uncheck();
  await m.getByRole('button', { name: 'Review changes' }).click();
  await expect(m.getByText('High-severity findings on changed lines')).toBeVisible();
  await expect(m.getByText('Source changed without test changes')).toBeVisible();
});

test('R7 · AI review falls back to clearly labelled static analysis when local AI is off', async ({ page, api }) => {
  const { repo, job } = await api('/repos/import/folder', { method: 'POST', body: { path: sampleRepo() } });
  await expect.poll(async () => (await api(`/repos/jobs/${job.id}`)).status).toBe('done');
  await page.goto(`/repos/${repo.id}/review?path=src/server.js`);
  const m = main(page);
  await m.getByRole('button', { name: 'Run review' }).click();
  await expect(m.getByText('Local AI review was not available')).toBeVisible();
  await expect(m.getByText(/produced by rules, not by AI/)).toBeVisible();
  await m.getByRole('textbox', { name: 'Question about the repository' }).fill('Where is JSON parsed?');
  await m.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(m.getByRole('button', { name: /src\/server\.js:\d+/ }).first()).toBeVisible();
});

test('R8 · reports: Markdown and PDF downloads, preview renders', async ({ page, api }) => {
  const { repo, job } = await api('/repos/import/folder', { method: 'POST', body: { path: sampleRepo() } });
  await expect.poll(async () => (await api(`/repos/jobs/${job.id}`)).status).toBe('done');
  await page.goto(`/repos/${repo.id}/reports`);
  const m = main(page);
  const md = page.waitForEvent('download');
  await m.getByText('Markdown (.md)').click();
  expect((await md).suggestedFilename()).toMatch(/\.md$/);
  await expect(page.frameLocator('iframe[title="Report preview"]').getByRole('heading', { name: /Code Quality Report/ })).toBeVisible();
  const pdf = page.waitForEvent('download', { timeout: 60_000 });
  await m.getByRole('button', { name: 'PDF' }).click();
  const file = await pdf;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
});

test('R9 · repositories persist, can be removed, and the original folder is untouched', async ({ page, api }) => {
  const dir = sampleRepo();
  const { repo, job } = await api('/repos/import/folder', { method: 'POST', body: { path: dir, name: 'Removable repo' } });
  await expect.poll(async () => (await api(`/repos/jobs/${job.id}`)).status).toBe('done');
  await page.goto('/repos');
  await expect(main(page).getByRole('link', { name: 'Open Removable repo' })).toBeVisible();
  await page.reload();
  await main(page).getByRole('link', { name: 'Open Removable repo' }).click();
  await main(page).getByRole('button', { name: 'Remove repository' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove repository' }).click();
  await expect(page).toHaveURL(/\/repos$/);
  await expect(main(page).getByRole('link', { name: 'Open Removable repo' })).toHaveCount(0);
  const fs = await import('node:fs');
  expect(fs.existsSync(join(dir, 'src/server.js'))).toBe(true);
  void repo;
});
