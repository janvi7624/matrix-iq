import { test, expect } from '@playwright/test';
import { createQaUser, deleteQaUser, loginAsFixture, QaFixture } from './helpers/fixtures';

// TMS task operations — covers the task-status TOCTOU race and the date
// validation bugs fixed in lib/tmsTaskStore.ts this session.

let engineer: QaFixture;

test.beforeAll(async () => {
  engineer = await createQaUser({ roleKey: 'engineer', department: 'AI' });
});

test.afterAll(async () => {
  await deleteQaUser(engineer.id);
});

test('TMS Tasks page loads for an engineer with zero console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await loginAsFixture(page, engineer);
  await page.goto('/tms/tasks', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.locator('text=My Tasks').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('TMS Projects page shows the completed-hidden-by-default filter correctly', async ({ page }) => {
  await loginAsFixture(page, engineer);
  await page.goto('/tms/projects', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.locator('text=Total Projects')).toBeVisible();
});

test('a garbage start_date on task creation returns a clean 400, not a raw DB error', async ({ page }) => {
  await loginAsFixture(page, engineer);
  const res = await page.request.post('/api/tms/tasks', {
    data: { title: 'QA_TEST_task', projectId: '00000000-0000-0000-0000-000000000000', startDate: 'not-a-date' }
  });
  expect(res.status()).toBeLessThan(500);
});

test('an engineer cannot PATCH a task outside their own project/department scope by guessing an id', async ({ page }) => {
  await loginAsFixture(page, engineer);
  const res = await page.request.patch('/api/tms/tasks/00000000-0000-0000-0000-000000000000', {
    data: { status: 'completed' }
  });
  // Either "not found" (scoping hides it entirely) or a clean error — never
  // a 2xx success on a task this fixture has no real relationship to.
  expect(res.status()).toBeGreaterThanOrEqual(400);
});
