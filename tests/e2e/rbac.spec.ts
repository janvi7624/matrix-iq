import { test, expect } from '@playwright/test';
import { createQaUser, deleteQaUser, loginAsFixture, QaFixture } from './helpers/fixtures';

// Server-side role-based access control — a hidden sidebar link is not a
// security boundary; every check here hits the API directly.

let salesUser: QaFixture;
let adminUser: QaFixture;

test.beforeAll(async () => {
  salesUser = await createQaUser({ roleKey: 'user' });
  adminUser = await createQaUser({ roleKey: 'admin' });
});

test.afterAll(async () => {
  await deleteQaUser(salesUser.id);
  await deleteQaUser(adminUser.id);
});

test('an unauthenticated request is rejected on a protected API route', async ({ page }) => {
  const res = await page.request.get('/api/admin/users');
  expect(res.status()).toBe(401);
});

test('a Sales user cannot reach HR-only daily-report review routes', async ({ page }) => {
  await loginAsFixture(page, salesUser);
  // maxRedirects: 0 — see hr.spec.ts's note; the request API follows
  // redirects by default, which silently turns a real 307 into a 200.
  const pageRes = await page.request.get('/daily-reports/team', { maxRedirects: 0 });
  // HR pages redirect a non-HR viewer rather than render — a 307/302 to
  // the dashboard counts as correctly blocked, same as a 403 would.
  expect([302, 307, 403]).toContain(pageRes.status());
  const apiRes = await page.request.get('/api/daily-reports/hr/warnings');
  expect(apiRes.status()).toBe(403);
});

test('a Sales user cannot reach Administration (user management)', async ({ page }) => {
  await loginAsFixture(page, salesUser);
  const res = await page.request.get('/api/admin/users');
  expect(res.status()).toBe(403);
});

test('an admin user CAN reach Administration', async ({ page }) => {
  await loginAsFixture(page, adminUser);
  const res = await page.request.get('/api/admin/users');
  expect(res.status()).toBe(200);
});

test('deleting a user requires superadmin specifically — an admin is rejected', async ({ page }) => {
  await loginAsFixture(page, adminUser);
  const res = await page.request.delete(`/api/admin/users/${salesUser.id}`);
  expect(res.status()).toBe(403);
});
