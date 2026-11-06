import { Page } from '@playwright/test';
import { db } from '../../../lib/db';
import { hashPassword } from '../../../lib/passwords';

/**
 * Disposable QA_TEST_-prefixed fixture users for the e2e suite — created
 * directly via Sequelize (never createUser(), which sends a real SES
 * account-created email) and always hard-deleted (`force: true`) by the
 * caller. Never touches a real account. Matches the convention used
 * throughout this project's manual QA sessions — see QA_REPORTS/.
 */

export const QA_PASSWORD = 'QaE2E@Test1234';

export interface QaFixtureOptions {
  roleKey: string;
  department?: string;
  namePrefix?: string;
}

export interface QaFixture {
  id: string;
  username: string;
  password: string;
}

let counter = 0;

/** Creates one disposable user with a guaranteed-unique QA_TEST_ username. */
export async function createQaUser(opts: QaFixtureOptions): Promise<QaFixture> {
  counter += 1;
  const username = `QA_TEST_e2e_${opts.roleKey}_${Date.now()}_${counter}`;
  const role = await db.Role.findOne({ where: { key: opts.roleKey } as never });
  if (!role) throw new Error(`No role with key "${opts.roleKey}" exists — cannot create fixture`);
  const passwordHash = await hashPassword(QA_PASSWORD);
  const user = await db.User.create(
    {
      username,
      passwordHash,
      name: opts.namePrefix ? `${opts.namePrefix} ${username}` : `QA E2E ${opts.roleKey}`,
      roleId: role.get('id'),
      status: 'active',
      department: opts.department || 'Sales'
    } as never
  );
  return { id: user.get('id') as string, username, password: QA_PASSWORD };
}

/** Hard-deletes a fixture created by createQaUser. Always call in a `finally`/afterEach. */
export async function deleteQaUser(id: string): Promise<void> {
  const row = await db.User.findByPk(id);
  if (row) await row.destroy({ force: true });
}

/** Logs a fixture in through the real /login form — not the API — so these tests exercise the actual UI. */
export async function loginAsFixture(page: Page, fixture: QaFixture): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  // The dev server's hot-reload socket keeps the page from ever reaching a
  // true `networkidle` state — waiting on it causes false timeouts (hit
  // repeatedly during this session's manual QA). A fixed settle delay after
  // domcontentloaded, long enough for React hydration to attach the form's
  // submit handler, is the reliable alternative here.
  await page.waitForTimeout(1200);
  await page.locator('input[type="text"], input[name="username"], input[id*="user" i]').first().fill(fixture.username);
  await page.locator('input[type="password"]').first().fill(fixture.password);

  // Wait for the actual POST /api/auth/login response, not a fixed delay —
  // scrypt hashing is deliberately slow, and this dev server runs with
  // heavy query logging under load, so a flat timeout (1000ms, tried first)
  // was not reliably long enough: the request was still in flight
  // ("Signing in…" still shown, disabled) when the next assertion ran,
  // which made this look like a login failure when it was only a race in
  // the test helper. Explicit navigation is also NOT a safe completion
  // signal here — a successful login does a client-side route transition,
  // not a full page load, so waitForLoadState('domcontentloaded') resolves
  // immediately and proves nothing.
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/auth/login') && res.request().method() === 'POST', { timeout: 20_000 }),
    page
      .locator('button[type="submit"], button:has-text("Log in"), button:has-text("Login"), button:has-text("Sign in")')
      .first()
      .click()
  ]);
  if (!response.ok()) {
    throw new Error(`loginAsFixture: POST /api/auth/login returned ${response.status()} for ${fixture.username}`);
  }
  // The cookie is set on this same response; give the client a brief moment
  // to finish its post-login redirect/state update before the caller
  // issues further requests.
  await page.waitForTimeout(500);
}

/** Closes the fixture's session server-side too (not just clearing the browser), to avoid leaking live sessions between tests. */
export async function logoutFixture(page: Page): Promise<void> {
  await page.request.post('/api/auth/logout').catch(() => undefined);
}
