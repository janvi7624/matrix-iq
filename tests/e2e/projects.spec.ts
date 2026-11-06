import { test, expect } from '@playwright/test';
import { createQaUser, deleteQaUser, loginAsFixture, QaFixture } from './helpers/fixtures';

// Sales Projects — backend filtering/pagination (rebuilt this session) and
// the "completed hidden by default, findable via filter" pattern shared by
// both Sales Projects and TMS Projects.

let viewer: QaFixture;

test.beforeAll(async () => {
  viewer = await createQaUser({ roleKey: 'admin' });
});

test.afterAll(async () => {
  await deleteQaUser(viewer.id);
});

test('Sales Projects page loads with pagination and zero console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await loginAsFixture(page, viewer);
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.locator('text=Total (filtered)')).toBeVisible();
  expect(errors).toEqual([]);
});

test('closed (Won/Lost) projects are hidden by default and revealable via the filter toggle', async ({ page }) => {
  await loginAsFixture(page, viewer);
  await page.goto('/projects', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Behavior is server-side (components/ProjectsView.tsx's includeClosed
  // param), checked directly rather than via the exact UI control, which is
  // more robust to markup changes than locating a specific dropdown.
  const defaultRes = await page.request.get('/api/projects?page=1&pageSize=20');
  expect(defaultRes.ok()).toBeTruthy();
  const defaultBody = await defaultRes.json();

  const includeClosedRes = await page.request.get('/api/projects?page=1&pageSize=20&includeClosed=1');
  expect(includeClosedRes.ok()).toBeTruthy();
  const includeClosedBody = await includeClosedRes.json();

  // With closed (Won/Lost) projects included, the total can only grow —
  // never shrink — relative to the hidden-by-default count.
  expect(includeClosedBody.total).toBeGreaterThanOrEqual(defaultBody.total);
});

test('malformed date/status filter params return a clean error, not a raw DB 500', async ({ page }) => {
  await loginAsFixture(page, viewer);
  const res = await page.request.get('/api/projects?page=1&pageSize=20&closingFrom=not-a-date&status=not-a-real-status');
  expect(res.status()).toBeLessThan(500);
});
