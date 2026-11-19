import { test, expect, expectNoOverflow, expectAccessibleControls, resetState } from './fixtures';
import { NAV_PAGES } from './pages';

test.beforeEach(async ({ api }) => resetState(api));

// Journey 1: every module loads, has its heading, accessible controls and no layout overflow.
for (const p of NAV_PAGES) {
  test(`page loads cleanly: ${p.label}`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.getByRole('heading', { level: 1, name: p.heading })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expectNoOverflow(page);
    await expectAccessibleControls(page);
  });
}
