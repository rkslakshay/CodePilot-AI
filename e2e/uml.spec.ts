/** UML Studio end-to-end journeys (offline; throw-away database). */
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, expectNoOverflow, expectAccessibleControls, resetState } from './fixtures';
import { sampleRepo } from './repo-helpers';
import type { Page } from '@playwright/test';

test.beforeEach(async ({ api }) => resetState(api));

const TYPES = ['Class', 'Use case', 'Sequence', 'Activity', 'State machine', 'Component', 'Deployment', 'Object'];
const canvas = (p: Page) => p.getByTestId('uml-canvas');
const els = (p: Page) => canvas(p).locator('[data-el]');
const rels = (p: Page) => canvas(p).locator('[data-rel]');
const inspector = (p: Page) => p.getByTestId('uml-inspector');
async function openExample(page: Page, type: string) {
  await page.goto('/uml');
  await page.getByRole('button', { name: `Example ${type} diagram` }).click();
  await expect(page.getByTestId('uml-editor')).toBeVisible();
  await expect(els(page).first()).toBeVisible();
}
async function waitJob(api: (p: string) => Promise<any>, id: number) {
  await expect.poll(async () => (await api(`/repos/jobs/${id}`)).status, { timeout: 30_000 }).toBe('done');
}

test('U1 · UML Studio is reachable from the sidebar and the dashboard', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('main').getByRole('link', { name: /UML Studio/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'UML Studio' })).toBeVisible();
  await page.getByRole('navigation').first().getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('navigation').first().getByRole('link', { name: 'UML Studio' }).click();
  await expect(page.getByTestId('uml-type-cards').getByText('State machine diagram')).toBeVisible();
  await expectAccessibleControls(page);
});

test('U2 · every diagram type opens, renders its notation and validates cleanly', async ({ page }) => {
  for (const t of TYPES) {
    await openExample(page, t);
    expect(await els(page).count(), t).toBeGreaterThan(2);
    expect(await rels(page).count(), t).toBeGreaterThan(0);
    await expect(page.getByTestId('uml-validate'), t).toHaveText('Validate');
    await expectNoOverflow(page);
  }
});

test('U3 · build a class diagram by hand, connect, edit members, save and reopen', async ({ page }) => {
  await page.goto('/uml');
  await page.getByRole('button', { name: 'Blank Class diagram' }).click();
  await page.getByRole('button', { name: 'Add Class' }).click();
  await inspector(page).getByLabel('Element name').fill('Vehicle');
  await inspector(page).getByLabel('Element name').press('Enter');
  await inspector(page).getByRole('button', { name: 'Add attribute' }).click();
  await inspector(page).getByLabel('Attribute name').fill('wheels');
  await inspector(page).getByLabel('Attribute name').press('Enter');
  await inspector(page).getByLabel('Attribute type').fill('int');
  await inspector(page).getByLabel('Attribute type').press('Enter');
  await inspector(page).getByRole('button', { name: 'Add operation' }).click();
  await inspector(page).getByLabel('Operation name').fill('drive');
  await inspector(page).getByLabel('Operation name').press('Enter');
  await page.getByRole('button', { name: 'Add Class' }).click();
  await inspector(page).getByLabel('Element name').fill('Car');
  await inspector(page).getByLabel('Element name').press('Enter');
  await expect(canvas(page)).toContainText('- wheels: int');
  await expect(canvas(page)).toContainText('+ drive()');

  await page.getByRole('button', { name: 'Connect with Inheritance (generalization)' }).click();
  await expect(page.getByRole('status')).toContainText('click the source');
  await els(page).filter({ hasText: 'Car' }).click();
  await els(page).filter({ hasText: 'Vehicle' }).click();
  await expect(rels(page)).toHaveCount(1);
  await expect(inspector(page).getByLabel('Relationship kind')).toHaveValue('inheritance');
  await page.getByLabel('Diagram name').fill('Vehicles');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/uml\/\d+$/);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(els(page)).toHaveCount(2);
  await expect(rels(page)).toHaveCount(1);
  await expect(canvas(page)).toContainText('- wheels: int');
  await expect(page.getByLabel('Diagram name')).toHaveValue('Vehicles');
});

test('U4 · drag an element, then undo and redo the move', async ({ page }) => {
  await openExample(page, 'Class');
  const target = canvas(page).locator('[data-el="Enrollment"]');
  const before = (await target.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + 8);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 160, before.y + 70, { steps: 8 });
  await page.mouse.up();
  const after = (await target.boundingBox())!;
  expect(after.x - before.x).toBeGreaterThan(60);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  // (the selection outline widens the box by a few pixels, so compare with a tolerance)
  await expect.poll(async () => Math.abs((await target.boundingBox())!.x - before.x)).toBeLessThan(5);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => Math.abs((await target.boundingBox())!.x - after.x)).toBeLessThan(5);
});

test('U5 · deleting an element removes its relationships; undo brings them back', async ({ page }) => {
  await openExample(page, 'Class');
  const n = await rels(page).count();
  await canvas(page).locator('[data-el="Enrollment"]').click();
  await canvas(page).focus();
  await page.keyboard.press('Delete');
  await expect(canvas(page).locator('[data-el="Enrollment"]')).toHaveCount(0);
  expect(await rels(page).count()).toBeLessThan(n);
  await page.keyboard.press('Control+z');
  await expect(canvas(page).locator('[data-el="Enrollment"]')).toHaveCount(1);
  await expect(rels(page)).toHaveCount(n);
});

test('U6 · invalid notation is flagged and explained', async ({ page }) => {
  await openExample(page, 'Use case');
  await page.getByRole('button', { name: 'Connect with «include»' }).click();
  await canvas(page).locator('[data-kind="actor"]').first().click();
  await canvas(page).locator('[data-kind="usecase"]').first().click();
  await expect(page.getByTestId('uml-validate')).toHaveText(/Validate \(\d+\)/);
  await page.getByTestId('uml-validate').click();
  await expect(page.getByTestId('uml-issues')).toContainText(/error/);
  await expect(page.getByTestId('uml-issues')).toContainText(/include/i);
});

test('U7 · generate offline from a description — labelled as rule-based, not AI', async ({ page }) => {
  await page.goto('/uml');
  await page.getByTestId('uml-open-generate').click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Diagram type').selectOption('class');
  await dlg.getByRole('button', { name: 'Use an example' }).click();
  await expect(dlg.getByText('Offline rule-based generator (not AI)')).toBeVisible();
  await page.getByTestId('uml-generate-run').click();
  await expect(page.getByTestId('uml-engine')).toContainText('Rule-based extraction (offline, not AI)');
  for (const c of ['Book', 'Member', 'Librarian', 'Loan', 'Reservation']) await expect(els(page).filter({ hasText: c }).first()).toBeVisible();
  await expect(canvas(page)).toContainText('borrows');
  await expect(page.getByTestId('uml-origin')).toContainText('not AI');
  // regenerate repeats the same request
  await page.getByRole('button', { name: 'Regenerate' }).click();
  await expect(els(page)).toHaveCount(5);
});

test('U8 · each type can be generated from a description offline', async ({ page }) => {
  for (const t of ['usecase', 'sequence', 'activity', 'state', 'component', 'deployment', 'object']) {
    await page.goto('/uml');
    await page.getByTestId('uml-open-generate').click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('Diagram type').selectOption(t);
    await dlg.getByRole('button', { name: 'Use an example' }).click();
    await page.getByTestId('uml-generate-run').click();
    await expect(page.getByTestId('uml-editor'), t).toBeVisible();
    expect(await els(page).count(), t).toBeGreaterThan(1);
  }
});

test('U9 · class, sequence and activity diagrams from pasted source code', async ({ page }) => {
  const code = 'class Wallet:\n    def __init__(self):\n        self.items = []\n    def pay(self, shop: "Shop", amount: int):\n        if amount > 0:\n            shop.charge(amount)\n        return True\nclass Shop:\n    def charge(self, amount: int):\n        pass\n';
  await page.goto('/uml');
  await page.getByTestId('uml-open-generate').click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('tab', { name: 'Source code' }).click();
  await dlg.getByLabel('Source language').selectOption('python');
  await dlg.getByLabel('Source code').fill(code);
  await page.getByTestId('uml-generate-run').click();
  await expect(page.getByTestId('uml-engine')).toContainText('Tree-sitter');
  await expect(els(page)).toHaveCount(2);
  await expect(canvas(page)).toContainText('+ pay(shop: Shop, amount: int)');

  for (const kind of ['sequence', 'activity']) {
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await dlg.getByRole('tab', { name: 'Source code' }).click();
    await dlg.getByLabel('Diagram from source').selectOption(kind);
    await dlg.getByLabel('Source language').selectOption('python');
    await dlg.getByLabel('Source code').fill(code);
    await expect(dlg.getByLabel('Function or method')).toContainText('Wallet.pay');
    await dlg.getByLabel('Function or method').selectOption({ label: 'Wallet.pay (line 4)' });
    await page.getByTestId('uml-generate-run').click();
    await expect(page.getByTestId('uml-editor')).toBeVisible();
    await expect(canvas(page)).toContainText(kind === 'sequence' ? 'charge(amount)' : 'amount > 0');
  }
});

test('U10 · repository → UML from the Repository Analyzer', async ({ page, api }) => {
  const { repo, job } = await api('/repos/import/folder', { method: 'POST', body: { path: sampleRepo() } });
  await waitJob(api, job.id);
  await page.goto(`/repos/${repo.id}`);
  await page.getByRole('button', { name: 'UML diagrams' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('Repository', { exact: true })).toHaveValue(String(repo.id));
  await dlg.getByLabel('Repository diagram').selectOption('class');
  await page.getByTestId('uml-generate-run').click();
  await expect(page.getByTestId('uml-engine')).toContainText('Generated from the repository');
  await expect(els(page).filter({ hasText: 'Main' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/uml\/\d+$/);
  // deployment: derived from frameworks, explicitly low confidence
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await dlg.getByRole('tab', { name: 'Repository' }).click();
  await dlg.getByLabel('Repository', { exact: true }).selectOption(String(repo.id));
  await dlg.getByLabel('Repository diagram').selectOption('deployment');
  await page.getByTestId('uml-generate-run').click();
  await expect(page.getByTestId('uml-inspector')).toContainText('No container configuration was found');
  // diagrams saved for the repository are listed for it
  await page.goto(`/uml?repoId=${repo.id}`);
  await expect(page.getByTestId('uml-saved-list')).toContainText('— classes');
});

test('U11 · no deployment diagram is invented without evidence', async ({ page, api, guard }) => {
  guard.allow(/status of 422/); // the refusal is an expected 422
  const dir = mkdtempSync(join(tmpdir(), 'cp-e2e-uml-empty-'));
  writeFileSync(join(dir, 'notes.py'), 'print("hello")\n');
  const { repo, job } = await api('/repos/import/folder', { method: 'POST', body: { path: dir, name: 'Notes only' } });
  await waitJob(api, job.id);
  await page.goto(`/uml?generate=repository&repoId=${repo.id}`);
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Repository diagram').selectOption('deployment');
  await page.getByTestId('uml-generate-run').click();
  await expect(dlg.getByText(/would have to be invented/)).toBeVisible();
});

test('U12 · My Workspace file → UML diagram', async ({ page, api }) => {
  const p = await api('/projects', { method: 'POST', body: { name: 'UML e2e', language: 'java' } });
  const f = await api(`/projects/${p.id}/files`, { method: 'POST', body: { name: 'Bank.java', language: 'java', content: 'public class Account { private double balance; public void deposit(double x) { balance += x; } }\npublic class Savings extends Account { private double rate; }\n' } });
  await page.goto('/workspace');
  await page.goto(`/uml?generate=source&fileId=${f.id}`);
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByLabel('Source location')).toHaveValue('workspace');
  await expect(dlg.getByRole('checkbox', { name: 'Bank.java' })).toBeChecked();
  await page.getByTestId('uml-generate-run').click();
  await expect(els(page)).toHaveCount(2);
  await expect(rels(page)).toHaveCount(1);
  await expect(canvas(page)).toContainText('- balance: double');
});

test('U13 · export SVG, PNG, PDF, PlantUML and Mermaid', async ({ page }) => {
  await openExample(page, 'Class');
  const grab = async (item: string) => {
    await page.getByTestId('uml-export').click();
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: item }).or(page.getByRole('button', { name: item })).first().click()]);
    return { name: d.suggestedFilename(), body: readFileSync((await d.path())!) };
  };
  const svg = await grab('SVG (vector)');
  expect(svg.name).toBe('Student_management_system.svg');
  expect(svg.body.toString()).toMatch(/^<\?xml[\s\S]*<svg[\s\S]*Student/);
  const png = await grab('PNG (2× resolution)');
  expect(png.body.subarray(1, 4).toString()).toBe('PNG');
  expect(png.body.length).toBeGreaterThan(5000);
  const puml = await grab('PlantUML source (.puml)');
  expect(puml.body.toString()).toMatch(/^@startuml[\s\S]*Person <\|-- Student[\s\S]*@enduml/);
  const mmd = await grab('Mermaid source (.mmd)');
  expect(mmd.body.toString()).toMatch(/^classDiagram/);
  const pdf = await grab('PDF (vector)');
  expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');
  // Mermaid has no notation for deployment diagrams, so it is not offered
  await openExample(page, 'Deployment');
  await page.getByTestId('uml-export').click();
  await expect(page.getByText('PlantUML source (.puml)')).toBeVisible();
  await expect(page.getByText('Mermaid source (.mmd)')).toHaveCount(0);
});

test('U14 · saved diagrams: rename, duplicate, delete', async ({ page, api }) => {
  const ex = await api('/uml/templates?type=state');
  await api('/uml/diagrams', { method: 'POST', body: { name: 'Order states', model: ex } });
  await page.goto('/uml');
  const list = page.getByTestId('uml-saved-list');
  await list.getByRole('button', { name: 'Rename Order states' }).click();
  await page.getByRole('dialog').getByLabel('Diagram name').fill('Order lifecycle');
  await page.getByRole('dialog').getByRole('button', { name: 'Rename' }).click();
  await expect(list).toContainText('Order lifecycle');
  await list.getByRole('button', { name: 'Duplicate Order lifecycle' }).click();
  await expect(list).toContainText('Order lifecycle (copy)');
  await list.getByRole('button', { name: 'Delete Order lifecycle (copy)' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(list).not.toContainText('(copy)');
  await page.getByLabel('Filter by type').selectOption('object');
  await expect(page.getByText('No saved diagrams yet')).toBeVisible();
});

test('U15 · zoom, fit, reset and grid controls', async ({ page }) => {
  await openExample(page, 'Activity');
  const zoom = page.getByTestId('uml-zoom');
  await page.getByRole('button', { name: 'Reset zoom to 100%' }).click();
  await expect(zoom).toHaveText('100%');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoom).toHaveText('120%');
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect(zoom).toHaveText('83%');
  await page.getByRole('button', { name: 'Fit to screen' }).click();
  await expect(zoom).not.toHaveText('83%');
  await page.getByRole('button', { name: 'Hide grid' }).click();
  await expect(page.getByRole('button', { name: 'Show grid' })).toBeVisible();
});

test('U16 · sequence editing: reorder messages, change kinds, add a fragment', async ({ page }) => {
  await openExample(page, 'Sequence');
  await page.getByRole('tab', { name: /Outline/ }).click();
  await page.getByTestId('uml-outline').getByRole('button', { name: /POST \/login/ }).click();
  await inspector(page).getByLabel('Message kind').selectOption('async');
  await inspector(page).getByRole('button', { name: 'Earlier' }).click();
  await page.getByRole('button', { name: 'Diagram', exact: true }).click();
  const before = await page.getByTestId('uml-fragment').count();
  await inspector(page).getByRole('button', { name: 'Add fragment' }).click();
  await expect(page.getByTestId('uml-fragment')).toHaveCount(before + 1);
  await expect(canvas(page).locator('text', { hasText: 'opt' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click();
  await expect(page.getByTestId('uml-fragment')).toHaveCount(before);
});

test('U17 · state and object property editing', async ({ page }) => {
  await openExample(page, 'State machine');
  await els(page).filter({ hasText: 'Shipped' }).first().click();
  await inspector(page).getByLabel('State entry').fill('print label');
  await inspector(page).getByLabel('State entry').press('Enter');
  await expect(canvas(page)).toContainText('entry / print label');
  await openExample(page, 'Object');
  await els(page).first().click();
  await inspector(page).getByRole('button', { name: 'Add slot' }).click();
  await inspector(page).getByLabel('Slot value').last().fill('42');
  await inspector(page).getByLabel('Slot value').last().press('Enter');
  await expect(canvas(page)).toContainText('attribute = 42');
});

test('U18 · dark theme renders the diagram with the dark palette', async ({ page, api }) => {
  await api('/settings', { method: 'PUT', body: { theme: 'dark' } });
  await openExample(page, 'Component');
  await expect(canvas(page).locator('svg').first()).toHaveAttribute('fill', '#e8eaf2');
  await api('/settings', { method: 'PUT', body: { theme: 'light' } });
  await page.reload();
  await expect(page.getByTestId('uml-editor')).toBeVisible();
});

test('U19 · leaving with unsaved changes asks first', async ({ page }) => {
  await openExample(page, 'Class');
  await page.getByRole('button', { name: 'Back to diagrams' }).click();
  await expect(page.getByRole('dialog')).toContainText('Leave without saving?');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('uml-editor')).toBeVisible();
});
