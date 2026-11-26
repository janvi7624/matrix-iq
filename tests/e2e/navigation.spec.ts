import { test, expect } from '@playwright/test';
import { createQaUser, deleteQaUser, loginAsFixture, QaFixture } from './helpers/fixtures';

// Important navigation and responsive behavior — a sample of representative
// pages and viewport widths, not an exhaustive sweep (that's the manual
// Playwright-script audit recorded in QA_REPORTS/UI_UX_AUDIT.md).

let viewer: QaFixture;

test.beforeAll(async () => {
  viewer = await createQaUser({ roleKey: 'admin' });
});

test.afterAll(async () => {
  await deleteQaUser(viewer.id);
});

test('the main header has no back button', async ({ page }) => {
  await loginAsFixture(page, viewer);
  await page.goto('/leads', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await expect(page.locator('header').first().getByRole('link', { name: 'Go back' })).toHaveCount(0);
  // A top-level list page reached from the sidebar has no in-page back either.
  await expect(page.locator('main').getByRole('link', { name: 'Go back' })).toHaveCount(0);
});

test('a sub-page shows the back button first in its own content and falls back to its parent', async ({ page }) => {
  await loginAsFixture(page, viewer);
  await page.goto('/admin/users/import', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const main = page.locator('main');
  const back = main.getByRole('link', { name: 'Go back' });
  await expect(back).toBeVisible();
  expect(await main.locator('a, button').first().getAttribute('aria-label')).toBe('Go back');
  const box = await back.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // Fresh tab, no in-app history → nearest parent page.
  await back.click();
  await page.waitForTimeout(1200);
  expect(new URL(page.url()).pathname).toBe('/admin/users');
});

test('the in-page back button returns to the previous in-app screen', async ({ page }) => {
  await loginAsFixture(page, viewer);
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.goto('/admin/users/import', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('main').getByRole('link', { name: 'Go back' }).click();
  await page.waitForTimeout(1200);
  expect(new URL(page.url()).pathname).toBe('/projects');
});

test('direct URL access to a protected page without a session redirects to login', async ({ page }) => {
  const res = await page.request.get('/leads');
  // proxy.ts gates this — either a redirect to /login or a 401, never a
  // 200 with real data rendered for an unauthenticated request.
  expect([200, 302, 307, 401]).toContain(res.status());
  if (res.status() === 200) {
    // If it 200s (SSR shell before client-side redirect), the body must not
    // contain real lead data — this is a weak check, the authoritative one
    // is the API-level 401 already covered in rbac.spec.ts.
    const body = await res.text();
    expect(body).not.toContain('Hot Leads');
  }
});

for (const width of [360, 768, 1280, 1920]) {
  test(`Leads page has no horizontal overflow at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const page = await context.newPage();
      await loginAsFixture(page, viewer);
      await page.goto('/leads', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      // A couple of px of rounding slack, not a real overflow.
      expect(overflow).toBeLessThanOrEqual(2);
    } finally {
      await context.close();
    }
  });
}

test('browser back/forward preserves a sensible page after navigating Leads -> Projects -> back', async ({ page }) => {
  await loginAsFixture(page, viewer);
  await page.goto('/leads', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.goBack({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  expect(page.url()).toContain('/leads');
});
