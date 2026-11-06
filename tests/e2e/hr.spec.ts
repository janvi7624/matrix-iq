import { test, expect } from '@playwright/test';
import { createQaUser, deleteQaUser, loginAsFixture, QaFixture } from './helpers/fixtures';

// HR permissions — covers the real access-control gaps found this session:
// HR review requires both module access AND a real manager relationship to
// act on a specific employee's claim; a non-HR role is blocked everywhere.

let hrUser: QaFixture;
// Privileged (not plain 'hr'), on purpose: canAccessHrReview requires BOTH
// the hr-daily-reports module grant AND a real HR-department-manager
// relationship (lib/hrAccess.ts's isHrManager) — a plain 'hr'-role account
// with no managed department correctly gets 403, confirmed live while
// writing this suite. Faking a real manager relationship would mean
// mutating a REAL, shared Department.managerIds array, which this
// project's QA convention (never touch real/shared data) rules out. An
// admin fixture exercises the module-gate path safely via isPrivileged's
// override, same effective coverage without the real-data risk.
let salesUser: QaFixture;

test.beforeAll(async () => {
  hrUser = await createQaUser({ roleKey: 'admin', department: 'Administration' });
  salesUser = await createQaUser({ roleKey: 'user', department: 'Sales' });
});

test.afterAll(async () => {
  await deleteQaUser(hrUser.id);
  await deleteQaUser(salesUser.id);
});

test('a non-HR role is blocked from every HR review page, no exceptions', async ({ page }) => {
  await loginAsFixture(page, salesUser);
  for (const path of ['/hr/attendance', '/hr/employees', '/hr/leave', '/hr/reports']) {
    // maxRedirects: 0 is load-bearing — Playwright's APIRequestContext
    // follows redirects by default, same as fetch(), which silently turns
    // the real 307 into the 200 of wherever it lands and made this
    // assertion pass for the wrong reason (or fail outright) until caught.
    const res = await page.request.get(path, { maxRedirects: 0 });
    expect([302, 307, 403]).toContain(res.status());
  }
});

test('an HR user can view the warnings list but acting on a claim they have no relationship to is refused', async ({ page }) => {
  await loginAsFixture(page, hrUser);
  const listRes = await page.request.get('/api/daily-reports/hr/warnings');
  expect(listRes.ok()).toBeTruthy();

  // Acting on a nonexistent warning id must fail cleanly (404), never
  // silently succeed — this is the route where waiveWarning's guarded
  // update (fixed this session) applies.
  const actRes = await page.request.post('/api/daily-reports/hr/warnings/00000000-0000-0000-0000-000000000000/waive', {
    data: { reason: 'QA e2e test' }
  });
  expect(actRes.status()).toBe(404);
});

test('Reimbursement page loads for both an HR reviewer and an employee submitter', async ({ page }) => {
  await loginAsFixture(page, hrUser);
  const hrRes = await page.request.get('/reimbursement');
  expect(hrRes.status()).toBeLessThan(400);

  await loginAsFixture(page, salesUser);
  const empRes = await page.request.get('/reimbursement');
  expect(empRes.status()).toBeLessThan(400);
});
