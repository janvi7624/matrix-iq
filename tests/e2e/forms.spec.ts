import { test, expect } from '@playwright/test';
import { createQaUser, deleteQaUser, loginAsFixture, QaFixture } from './helpers/fixtures';

// Form validation — both client- and server-side, across a sample of
// representative forms rather than every form in the app.

let viewer: QaFixture;

test.beforeAll(async () => {
  viewer = await createQaUser({ roleKey: 'admin' });
});

test.afterAll(async () => {
  await deleteQaUser(viewer.id);
});

test('creating a lead with no name and no company is rejected server-side', async ({ page }) => {
  await loginAsFixture(page, viewer);
  const res = await page.request.post('/api/leads', { data: { leadSource: 'other' } });
  expect(res.status()).toBe(400);
});

test('creating a lead with an invalid leadSource is rejected server-side', async ({ page }) => {
  await loginAsFixture(page, viewer);
  const res = await page.request.post('/api/leads', {
    data: { name: 'QA Test', leadSource: 'not-a-real-source' }
  });
  expect(res.status()).toBe(400);
});

test('creating a TMS project without a technical department is rejected server-side', async ({ page }) => {
  await loginAsFixture(page, viewer);
  const res = await page.request.post('/api/tms/projects', {
    data: { name: 'QA_TEST_project' }
  });
  expect(res.status()).toBe(400);
});

test('a malformed date on TMS project creation is rejected cleanly, not a raw 500', async ({ page }) => {
  await loginAsFixture(page, viewer);
  const res = await page.request.post('/api/tms/projects', {
    data: { name: 'QA_TEST_project', departmentId: '00000000-0000-0000-0000-000000000000', startDate: 'garbage' }
  });
  expect(res.status()).toBeLessThan(500);
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

// NOT covered here: duplicate-username rejection on POST /api/admin/users.
// That route calls lib/userStore.ts's createUser(), which unconditionally
// fires a real SES "account created" email (see its `sendUserCreatedEmail`
// call) — exercising it from a repeatable, CI-runnable suite would send
// real email on every run, which is exactly what this project's QA
// convention (used throughout this session's manual testing) forbids. The
// fix itself (catching SequelizeUniqueConstraintError -> clean 409) is
// covered by this project's existing Vitest unit tests instead.
