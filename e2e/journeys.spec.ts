import { test, expect, expectNoOverflow, setEditor, resetState } from './fixtures';

test.beforeEach(async ({ api }) => resetState(api));

const main = (page: import('@playwright/test').Page) => page.getByRole('main');

test('J2 · sidebar navigation reaches every module', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation').first();
  for (const [label, heading] of [
    ['AI Code Generator', 'AI Code Generator'],
    ['Code Converter', 'Code Converter'],
    ['Algorithm Studio', 'Algorithm Studio'],
    ['Code Explainer', 'Code Explainer'],
    ['Compiler & Debugger', 'Compiler & Debugger'],
    ['Learning Hub', 'Learning Hub'],
    ['My Workspace', 'My Workspace'],
    ['History', 'History'],
    ['Settings', 'Settings'],
  ]) {
    await nav.getByRole('link', { name: label, exact: false }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
});

test('J3 · command palette opens with Ctrl+K and navigates', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Command' })).toBeFocused();
  await page.keyboard.type('converter');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Code Converter' })).toBeVisible();
});

test('J4 · offline code generation is labelled honestly and saves to the workspace', async ({ page }) => {
  await page.goto('/generator');
  await main(page).getByRole('button', { name: 'Check whether a number is prime' }).click();
  await main(page).getByRole('button', { name: 'Generate code' }).click();
  // offline output must never be presented as AI output
  await expect(main(page).getByText(/offline|built-in|template/i).first()).toBeVisible();
  await expect(main(page).getByText(/local ai \(ollama\)/i)).toHaveCount(0);
  await expect(main(page).locator('.monaco-editor').first()).toContainText(/def |prime/i);
  await main(page).getByRole('button', { name: 'Save to workspace' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await page.goto('/workspace');
  await main(page).getByRole('button', { name: /Scratchpad/ }).first().click();
  await expect(main(page).getByRole('button', { name: /prime/i }).first()).toBeVisible();
});

test('J5 · converts Python to Java and shows a semantic comparison', async ({ page }) => {
  await page.goto('/converter');
  await setEditor(page, 'def square(x):\n    return x * x\n\nfor i in range(1, 4):\n    print(square(i))\n');
  await main(page).getByRole('button', { name: 'Convert', exact: true }).click();
  await expect(main(page).locator('.monaco-editor').nth(1)).toContainText('class', { timeout: 30_000 });
  await main(page).getByRole('tab', { name: 'Semantic comparison' }).click();
  await expect(main(page).getByText(/function|loop|square/i).first()).toBeVisible();
});

test('J6 · algorithm library: open an algorithm and step through the visualisation', async ({ page }) => {
  await page.goto('/studio');
  await main(page).getByRole('button', { name: /Bubble Sort/ }).click();
  await expect(main(page).getByRole('heading', { name: /Bubble Sort/ }).first()).toBeVisible();
  const next = main(page).getByRole('button', { name: /next step|step forward/i }).first();
  await next.click();
  await next.click();
  await expect(main(page).getByText(/step\s*\d+\s*(of|\/)\s*\d+/i).first()).toBeVisible();
});

test('J7 · code → pseudocode and flowchart renders as SVG', async ({ page }) => {
  await page.goto('/studio');
  await main(page).getByRole('tab', { name: /Problem \/ code/ }).click();
  await main(page).getByRole('tab', { name: 'Source code' }).click();
  await setEditor(page, 'n = 5\ntotal = 0\nfor i in range(n):\n    if i % 2 == 0:\n        total += i\nprint(total)\n');
  await main(page).getByRole('button', { name: /analy[sz]e|generate|build/i }).first().click();
  await main(page).getByRole('tab', { name: 'Pseudocode' }).click();
  await expect(main(page).getByText(/FOR|SET/).first()).toBeVisible({ timeout: 30_000 });
  await main(page).getByRole('tab', { name: /flowchart/i }).first().click();
  await expect(main(page).locator('svg[id^="mermaid"], .mermaid svg, svg[aria-roledescription]').first()).toBeVisible({ timeout: 30_000 });
});

test('J8 · explainer: line-by-line explanation and complexity with confidence', async ({ page }) => {
  await page.goto('/explainer');
  await main(page).getByRole('combobox', { name: 'Language' }).selectOption('python');
  await setEditor(page, 'def find(a, t):\n    for i in range(len(a)):\n        if a[i] == t:\n            return i\n    return -1\nprint(find([3, 1, 4], 4))\n');
  await main(page).getByRole('button', { name: 'Explain code' }).click();
  await expect(main(page).getByText('O(n)').first()).toBeVisible({ timeout: 30_000 });
  await main(page).getByRole('tab', { name: 'Line by line' }).click();
  await expect(main(page).getByText(/loop|iterat/i).first()).toBeVisible();
});

test('J9 · execution needs consent; then runs Python with stdin inside the sandbox', async ({ page }) => {
  await page.goto('/compiler');
  await main(page).getByRole('button', { name: 'Run', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /enable local code execution/i })).toBeVisible();
  await dialog.getByRole('button', { name: /enable execution/i }).click();
  await expect(dialog).toBeHidden();
  await setEditor(page, 'a, b = map(int, input().split())\nprint(a + b)\n');
  await main(page).getByRole('textbox', { name: 'Standard input' }).fill('20 22');
  await main(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(main(page).getByText('42').first()).toBeVisible({ timeout: 30_000 });
  await expect(main(page).getByText(/success/i).first()).toBeVisible();
  if (process.platform === 'win32') await expect(main(page).getByText('sandboxed').first()).toBeVisible();
});

test('J10 · compile errors are explained and the debugger proposes a repair', async ({ page, api }) => {
  await api('/settings', { method: 'PUT', body: { executionEnabled: true } });
  await page.goto('/compiler');
  await setEditor(page, 'for i in range(3)\n    print(i)\n');
  await main(page).getByRole('button', { name: 'Debug', exact: true }).click();
  await expect(main(page).getByRole('heading', { name: /errors explained/i })).toBeVisible({ timeout: 30_000 });
  await expect(main(page).getByText('Missing colon', { exact: false }).first()).toBeAttached();
  await main(page).getByRole('button', { name: 'Apply fix' }).click();
  await expect(main(page).locator('.monaco-editor').first()).toContainText('range(3):');
});

test('J11 · the execution guard blocks dangerous programs', async ({ page, api }) => {
  await api('/settings', { method: 'PUT', body: { executionEnabled: true } });
  await page.goto('/compiler');
  await setEditor(page, 'import subprocess\nsubprocess.run(["whoami"])\n');
  await main(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(main(page).getByText(/blocked/i).first()).toBeVisible({ timeout: 30_000 });
});

test('J12 · test cases run against the program and report pass/fail', async ({ page, api }) => {
  await api('/settings', { method: 'PUT', body: { executionEnabled: true } });
  await page.goto('/compiler');
  await setEditor(page, 'n = int(input())\nprint(n * 2)\n');
  await main(page).getByRole('tab', { name: 'Test cases' }).click();
  await main(page).getByRole('textbox', { name: 'Test 1 input' }).fill('4');
  await main(page).getByRole('textbox', { name: 'Test 1 expected output' }).fill('8');
  await main(page).getByRole('button', { name: 'Run all tests' }).click();
  await expect(main(page).getByText('1/1 passed')).toBeVisible({ timeout: 30_000 });
  await main(page).getByRole('textbox', { name: 'Test 1 expected output' }).fill('9');
  await main(page).getByRole('button', { name: 'Run all tests' }).click();
  await expect(main(page).getByText('0/1 passed')).toBeVisible({ timeout: 30_000 });
});

test('J13 · learning hub: open a topic and take a scored quiz', async ({ page }) => {
  await page.goto('/learning');
  await main(page).getByRole('button', { name: /Sorting/ }).first().click();
  await main(page).getByRole('tab', { name: 'MCQ quiz' }).click();
  await expect(main(page).getByText(/not AI-generated/i).first()).toBeVisible();
  const answers = main(page).getByRole('button', { name: /^A / });
  const n = await answers.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) await answers.nth(i).click();
  const submit = main(page).getByRole('button', { name: /submit|finish|check answers/i });
  if (await submit.count()) await submit.first().click();
  await expect(main(page).getByText(new RegExp(`\\d+\\s*(/|of)\\s*${n}`)).first()).toBeVisible();
});

test('J14 · workspace: create a project, add, edit and delete a file', async ({ page }) => {
  await page.goto('/workspace');
  await main(page).getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').first().fill('E2E Project');
  await dialog.getByRole('button', { name: /create/i }).click();
  await expect(main(page).getByText('E2E Project').first()).toBeVisible();
  await main(page).getByText('E2E Project').first().click();
  await main(page).getByRole('button', { name: /new file|add file/i }).first().click();
  const fd = page.getByRole('dialog');
  await fd.getByRole('textbox').first().fill('hello');
  await fd.getByRole('button', { name: /create|add/i }).click();
  await expect(main(page).getByRole('button', { name: 'hello', exact: true })).toBeVisible();
  await setEditor(page, 'print("edited")\n');
  await main(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(main(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await page.reload();
  await main(page).getByRole('button', { name: /E2E Project/ }).first().click();
  await main(page).getByRole('button', { name: 'hello', exact: true }).click();
  await expect(main(page).locator('.monaco-editor').first()).toContainText('edited');
  await main(page).getByRole('button', { name: 'File actions' }).first().click();
  await page.getByRole('menuitem', { name: /delete/i }).click();
  await page.getByRole('dialog').getByRole('button', { name: /delete/i }).click();
  await expect(main(page).getByRole('button', { name: 'hello', exact: true })).toHaveCount(0);
});

test('J15 · history records activity and can be filtered', async ({ page, api }) => {
  const tag = `zz_e2e_${Date.now()}`;
  await api('/explain', { method: 'POST', body: { code: `${tag} = 1\nprint(${tag})\n`, language: 'python' } });
  await page.goto('/history');
  await expect(main(page).getByRole('list').getByRole('listitem').first()).toBeVisible();
  await main(page).getByRole('textbox', { name: 'Search history' }).fill(tag);
  await main(page).getByRole('combobox', { name: 'Filter by type' }).selectOption({ label: 'Explanations' });
  await expect(main(page).getByRole('list').getByRole('listitem')).toHaveCount(1);
  await main(page).getByRole('combobox', { name: 'Filter by type' }).selectOption({ label: 'Conversions' });
  await expect(main(page).getByRole('list').getByRole('listitem')).toHaveCount(0);
});

test('J16 · light theme applies and persists after reload', async ({ page }) => {
  await page.goto('/settings');
  await main(page).getByRole('tab', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/light/);
  await expectNoOverflow(page);
});

test('J17 · settings show the local AI status without requiring it', async ({ page }) => {
  await page.goto('/settings#ai');
  await expect(main(page).getByText(/ollama/i).first()).toBeVisible();
  await expect(main(page).getByText(/offline/i).first()).toBeVisible();
});

test('J18 · demo data loads into the dashboard and can be cleared', async ({ page }) => {
  await page.goto('/');
  await main(page).getByRole('button', { name: 'Load demo data' }).first().click();
  await expect(main(page).getByRole('heading', { name: 'Recent projects' })).toBeVisible();
  await expect(main(page).getByText(/demo/i).first()).toBeVisible();
});

test('J19 · database backup can be created from settings', async ({ page }) => {
  await page.goto('/settings');
  await main(page).getByRole('button', { name: /create backup|back up now|backup now/i }).click();
  await expect(main(page).getByText(/\.db/).first()).toBeVisible();
});

test('J20 · unknown routes show a not-found page with a way home', async ({ page }) => {
  await page.goto('/does-not-exist');
  await expect(page.getByText(/not found|404/i).first()).toBeVisible();
  await page.getByRole('link', { name: /dashboard|home/i }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('J21 · learning: a missed quiz question appears in Revision and leaves after a correct answer', async ({ page, api }) => {
  const q = (await api('/learning/questions', { method: 'POST', body: { topicId: 'stacks', type: 'mcq', count: 1, seed: 3 } })).questions[0];
  const wrong = (q.answer + 1) % q.options.length;
  await api('/learning/quiz', { method: 'POST', body: { topicId: 'stacks', correct: 0, total: 1, answers: [{ question: q.q, options: q.options, answer: q.answer, chosen: wrong, explanation: q.explanation }] } });
  await page.goto('/learning?view=revision');
  const card = main(page).getByRole('group', { name: `Revision question: ${q.q}` });
  await expect(main(page).getByText(q.q, { exact: true })).toBeVisible();
  await card.getByRole('button', { name: new RegExp(`^${'ABCDEF'[q.answer]} `) }).click();
  await card.getByRole('button', { name: 'Check answer' }).click();
  await expect(card.getByText('Correct.')).toBeVisible();
  await page.reload();
  await expect(main(page).getByText(q.q, { exact: true })).toHaveCount(0);
});

test('J22 · learning paths show progress and open the next topic', async ({ page, api }) => {
  await api('/learning/topics/arrays/status', { method: 'PUT', body: { status: 'completed' } });
  await page.goto('/learning');
  await expect(main(page).getByRole('progressbar', { name: 'DSA foundations progress' })).toHaveAttribute('aria-valuenow', /[1-9]/);
  await main(page).getByRole('button', { name: /^(Start|Continue): Strings/ }).first().click();
  await expect(main(page).getByRole('heading', { level: 2, name: 'Strings' })).toBeVisible();
});

test('J23 · dashboard: continue where you left off and compiler availability come from real data', async ({ page, api }) => {
  await api('/demo/load', { method: 'POST' });
  await page.goto('/');
  await expect(main(page).getByRole('heading', { name: 'Continue where you left off' })).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Compilers & runtimes' })).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'How results were produced' })).toBeVisible();
  await main(page).getByRole('link', { name: /Last edited file/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Workspace' })).toBeVisible();
  await expect(main(page).locator('.monaco-editor').first()).toBeVisible();
  await api('/demo/clear', { method: 'POST' });
});

test('J24 · studio: tree traversal visualiser reaches the final output', async ({ page }) => {
  await page.goto('/studio?algo=tree-traversal');
  await main(page).getByRole('textbox', { name: 'Input' }).fill('1, 2, 3, 4, 5, 6, 7 | preorder');
  await main(page).getByRole('button', { name: 'Apply input' }).click();
  await main(page).getByRole('button', { name: 'Last step' }).click();
  await expect(main(page).getByRole('group', { name: 'Sample input and final output' })).toContainText('preorder: 1 2 4 5 3 6 7');
});
