import { test as base, expect, type Page, type ConsoleMessage, type Request } from '@playwright/test';

/**
 * Shared fixture: every test automatically fails if the page logs a console error, throws an
 * uncaught exception, a request fails at the network level, or an API call returns a 5xx.
 * It also checks that the page never scrolls horizontally (layout overflow).
 */
export interface Guard {
  errors: string[];
  allow: (re: RegExp) => void;
}

export const test = base.extend<{ guard: Guard; api: (path: string, init?: { method?: string; body?: unknown }) => Promise<any> }>({
  guard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const allowed: RegExp[] = [];
      const push = (s: string) => {
        if (!allowed.some((re) => re.test(s))) errors.push(s);
      };
      page.on('console', (m: ConsoleMessage) => {
        if (m.type() === 'error') push(`console.error: ${m.text()}`);
      });
      page.on('pageerror', (e) => push(`page error: ${e.message}`));
      page.on('requestfailed', (r: Request) => {
        const f = r.failure()?.errorText ?? '';
        // navigation aborts (e.g. leaving a page mid-request) are not failures
        if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(f)) return;
        push(`request failed: ${r.method()} ${r.url()} ${f}`);
      });
      page.on('response', (r) => {
        if (r.status() >= 500) push(`HTTP ${r.status()}: ${r.request().method()} ${r.url()}`);
      });
      await use({ errors, allow: (re) => allowed.push(re) });
      expect(errors, 'no console errors, page errors or failed requests').toEqual([]);
    },
    { auto: true },
  ],
  api: async ({ request }, use) => {
    await use(async (path, init = {}) => {
      const r = await request.fetch(`/api${path}`, { method: init.method ?? 'GET', data: init.body as any });
      const json = await r.json().catch(() => null);
      if (!r.ok()) throw new Error(`${init.method ?? 'GET'} ${path} -> ${r.status()} ${JSON.stringify(json)}`);
      return json?.data ?? json;
    });
  },
});

export { expect };

/** Fails when the document is wider than the viewport (horizontal overflow). */
export async function expectNoOverflow(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, 'page must not scroll horizontally').toBeLessThanOrEqual(cw + 1);
}

/** Every visible button/link/input has an accessible name. */
export async function expectAccessibleControls(page: Page) {
  const unnamed = await page.evaluate(() => {
    const out: string[] = [];
    const els = document.querySelectorAll<HTMLElement>('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch]');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('.monaco-editor')) continue; // Monaco manages its own accessibility
      const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || (el as HTMLInputElement).labels?.length || el.textContent?.trim() || el.getAttribute('placeholder');
      if (!labelled) out.push(el.outerHTML.slice(0, 140));
    }
    return out;
  });
  expect(unnamed, 'controls without an accessible name').toEqual([]);
}

/** Sets editor content through Monaco's model (typing into Monaco is slow and auto-indents). */
export async function setEditor(page: Page, code: string, index = 0) {
  await page.waitForFunction(() => (window as any).monaco?.editor?.getEditors?.().length > 0 || document.querySelectorAll('.monaco-editor').length > 0);
  await page.evaluate(
    ({ code, index }) => {
      const m = (window as any).monaco;
      if (m) {
        const eds = m.editor.getEditors().filter((e: any) => !e.getOption(m.editor.EditorOption.readOnly));
        eds[index].setValue(code);
      }
    },
    { code, index },
  );
}

export async function resetState(api: (p: string, i?: any) => Promise<any>) {
  await api('/settings/reset', { method: 'POST' });
  await api('/settings', { method: 'PUT', body: { aiProvider: 'offline' } });
}
