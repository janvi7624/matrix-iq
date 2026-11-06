import { test, expect } from '@playwright/test';
import { createQaUser, deleteQaUser, loginAsFixture, QaFixture } from './helpers/fixtures';

// Sales lead operations — covers the Leads self-claim race fixed this
// session (two reps claiming the same unassigned lead at once).

let repA: QaFixture;
let repB: QaFixture;

test.beforeAll(async () => {
  repA = await createQaUser({ roleKey: 'user', department: 'Sales' });
  repB = await createQaUser({ roleKey: 'user', department: 'Sales' });
});

test.afterAll(async () => {
  await deleteQaUser(repA.id);
  await deleteQaUser(repB.id);
});

test('Leads page loads with real stats, zero unexpected console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  // The browser's own "Failed to load resource: ... 403" console line
  // carries no URL in msg.text() (checked directly — it's a fixed string),
  // so filtering it by matching the request URL has to come from the
  // network response event instead, not the console text.
  const expected403Urls: string[] = [];
  page.on('response', (res) => {
    if (res.status() === 403 && res.url().includes('/api/leads/assignees')) expected403Urls.push(res.url());
  });

  await loginAsFixture(page, repA);
  await page.goto('/leads', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.locator('text=Total Leads')).toBeVisible();

  // GET /api/leads/assignees 403ing for a plain rep is deliberate, documented
  // behavior (components/LeadsView.tsx's loadAssignees: "A 403 here is the
  // expected answer for a rep rather than an error" — it's how the page
  // decides whether to show assignment controls at all). One "Failed to
  // load resource" console error is allowed ONLY if it corresponds exactly
  // to that known, expected request — confirmed via the response event
  // above rather than guessed from the console text.
  const allowedErrorCount = expected403Urls.length;
  expect(errors.length, `Unexpected console errors: ${JSON.stringify(errors)}`).toBeLessThanOrEqual(allowedErrorCount);
});

test('the leads list endpoint rejects a malformed page param cleanly, not a raw 500', async ({ page }) => {
  await loginAsFixture(page, repA);
  const res = await page.request.get('/api/leads?page=not-a-number&pageSize=20');
  expect(res.status()).toBeLessThan(500);
});

test('two reps cannot both successfully claim the same unassigned lead (self-claim race)', async ({ page, browser }) => {
  await loginAsFixture(page, repA);
  // The mobile number must be unique PER RUN, not a fixed constant: the app
  // correctly merges a second lead sharing an existing mobile into the
  // original (lib/leadStore.ts's createOrMergeLead — "two reps scanning the
  // same card at an event must not fork into two records") — a hardcoded
  // number here collided with that real feature across repeated test runs,
  // silently merging into a stale lead from a PRIOR run whose creator had
  // already been hard-deleted, which is what actually produced this test's
  // original failure (both claims 403'd as "not available to you"), not a
  // race-condition regression. Caught by inspecting the created lead
  // directly (`created_by` was null — an orphaned merge target) before
  // concluding this was a test bug, not an app bug.
  const uniqueMobile = `9${Date.now().toString().slice(-9)}`;
  const createRes = await page.request.post('/api/leads', {
    data: {
      name: 'QA Test Race Contact',
      company: 'QA_TEST_RaceCo',
      mobile: uniqueMobile,
      leadSource: 'other'
    }
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  // Fails loudly, with a clear message, if this ever collides again —
  // rather than surfacing as a confusing downstream 403.
  expect(created.duplicate, 'Lead creation merged into an existing lead instead of creating fresh — mobile number collided').toBeFalsy();
  const leadId: string = created.id;
  expect(leadId).toBeTruthy();

  try {
    const ctxB = await browser.newContext();
    try {
      const pageB = await ctxB.newPage();
      await loginAsFixture(pageB, repB);

      const [resA, resB] = await Promise.all([
        page.request.post('/api/leads/assign', { data: { leadIds: [leadId], claim: true } }),
        pageB.request.post('/api/leads/assign', { data: { leadIds: [leadId], claim: true } })
      ]);

      const bodyA = await resA.json();
      const bodyB = await resB.json();
      // `assigned` in this response is a COUNT, not an array of ids
      // (confirmed live: `{"assigned":1,"failed":[],...}`) — a lost race
      // still returns 200 with `assigned: 0` and the lead id inside
      // `failed`, not an error status, so `assigned > 0` is the correct
      // per-request success signal.
      const succeededCount = [bodyA, bodyB].filter((b) => typeof b?.assigned === 'number' && b.assigned > 0).length;

      // The regression this guards: both reps told they succeeded while the
      // lead silently belongs to only one of them. Exactly one may win.
      expect(succeededCount).toBe(1);
    } finally {
      await ctxB.close();
    }
  } finally {
    // Best-effort cleanup of the QA lead this test created.
    await page.request.delete(`/api/leads/${leadId}`).catch(() => undefined);
  }
});
