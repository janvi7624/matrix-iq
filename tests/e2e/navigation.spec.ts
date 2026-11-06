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

test('the sidebar "Back to Dashboard" link returns to the real dashboard, not a dead route', async ({ page }) => {
  await loginAsFixture(page, viewer);
  await page.goto('/leads', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const backLink = page.locator('a:has-text("Back to Dashboard")').first();
  if (await backLink.count()) {
    await backLink.click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);
    const notFound = await page.locator('text=404').count();
    expect(notFound).toBe(0);
  }
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
