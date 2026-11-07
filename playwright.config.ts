import { defineConfig } from '@playwright/test';

// Real-browser regression suite for critical MatrixIQ workflows (login,
// session revocation, RBAC, Leads/Projects/TMS/HR). Assumes a dev server is
// already running on :3000 (reuseExistingServer) — these tests create and
// hard-delete their own QA_TEST_-prefixed fixtures via Sequelize directly
// (tests/e2e/helpers/fixtures.ts), never createUser(), and never touch real
// accounts or data. Run serially (workers: 1): several tests share the
// single long-running dev server and the same Postgres connection pool, and
// the fixture helpers are not designed for concurrent fixture creation
// racing each other.
export default defineConfig({
  testDir: './tests/e2e',
  // REL-TEST-001: raised from 30_000. db/config/config.js's Sequelize pool
  // has its own `acquire: 30000` (how long it waits for a free connection
  // under load before giving up) — a test's `beforeAll` doing DB-heavy
  // fixture creation while something else (another test run, a manual QA
  // script) is hammering the same pool could still be legitimately waiting
  // on a connection at almost exactly the moment this timeout used to fire,
  // turning real-but-slow success into an apparent test failure. 60s gives
  // that wait room to resolve instead of racing it.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000
  }
});
