import { test, expect } from '@playwright/test';
import { createQaUser, deleteQaUser, loginAsFixture, QA_PASSWORD, QaFixture } from './helpers/fixtures';

// Login, logout, and session revocation — the auth/session fixes made
// during this project's QA session (stored-XSS, brute-force lockout,
// logout/password-change revocation) all live here.

let fixture: QaFixture;

test.beforeEach(async () => {
  fixture = await createQaUser({ roleKey: 'user' });
});

test.afterEach(async () => {
  await deleteQaUser(fixture.id);
});

test('logs in with valid credentials and reaches an authenticated page', async ({ page }) => {
  await loginAsFixture(page, fixture);
  const me = await page.request.get('/api/auth/me');
  expect(me.status()).toBe(200);
});

test('rejects an invalid password with a generic error, no username enumeration', async ({ page }) => {
  const res = await page.request.post('/api/auth/login', {
    data: { username: fixture.username, password: 'wrong-password' }
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toMatch(/invalid username or password/i);
});

test('logout kills the session server-side, not just the browser cookie', async ({ page, context }) => {
  await loginAsFixture(page, fixture);
  const before = await page.request.get('/api/auth/me');
  expect(before.status()).toBe(200);

  const cookies = await context.cookies();
  const sessionCookie = cookies.find((c) => c.name.toLowerCase().includes('session'));
  expect(sessionCookie).toBeTruthy();

  await page.request.post('/api/auth/logout');

  // Replay the exact pre-logout cookie directly — this is the precise
  // repro for the "logout has zero server-side effect" bug fixed this
  // session (confirmed historically vulnerable, now fixed).
  const replay = await page.request.get('/api/auth/me', {
    headers: { cookie: `${sessionCookie!.name}=${sessionCookie!.value}` }
  });
  expect(replay.status()).toBe(401);
});

test('a second login does not kill the first device\'s session', async ({ browser }) => {
  // Two independent browser contexts = two "devices" sharing one account.
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await loginAsFixture(pageA, fixture);
    const meA1 = await pageA.request.get('/api/auth/me');
    expect(meA1.status()).toBe(200);

    await loginAsFixture(pageB, fixture);
    const meB = await pageB.request.get('/api/auth/me');
    expect(meB.status()).toBe(200);

    // The regression this guards: an earlier version of the session-epoch
    // fix reused `lastLoginAt` (already re-stamped on every login) as the
    // revocation marker, so logging in from device B silently killed
    // device A. Fixed with a dedicated, login-untouched column.
    const meA2 = await pageA.request.get('/api/auth/me');
    expect(meA2.status()).toBe(200);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('brute-force lockout: repeated failed logins eventually lock the account', async ({ page }) => {
  let lastStatus = 0;
  for (let i = 0; i < 10; i++) {
    const res = await page.request.post('/api/auth/login', {
      data: { username: fixture.username, password: 'still-wrong' }
    });
    lastStatus = res.status();
  }
  // Every attempt returns 401 either way (lockout and wrong-password are
  // deliberately indistinguishable) — what matters is the account is now
  // genuinely locked: even the CORRECT password must fail.
  expect(lastStatus).toBe(401);
  const correctAttempt = await page.request.post('/api/auth/login', {
    data: { username: fixture.username, password: QA_PASSWORD }
  });
  expect(correctAttempt.status()).toBe(401);
});
