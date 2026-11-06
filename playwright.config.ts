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
  timeout: 30_000,
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
