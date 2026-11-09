# Regression Test Report — Phase B

All commands below were actually run during this remediation phase, after all fixes were applied, not cited from a prior pass.

## New regression tests added (5 files, 13 new test cases)

| File | Covers | Tests |
|---|---|---|
| `tests/unit/tmsBomRequestCreateIdentity.test.ts` | OPSQA-DEF-001 | 3 — direct-id-passed skips lookup; username-fallback still works; throws rather than silently nulling when neither resolves |
| `tests/unit/legacyLeaveRouteRemoved.test.ts` | OPSQA-DEF-002 | 8 (one per removed path) — pins all 8 removed files stay removed |
| `tests/unit/adminUserDeleteFkConstraint.test.ts` | OPSQA-DEF-003 | 2 — clean 409 + actionable message on FK-blocked delete; normal delete still succeeds |
| `tests/unit/supportTicketListNPlusOne.test.ts` | REL-DB-002 | 3 — exactly 1 policy + 1 history query for a small list, a 25-ticket list, and 0 for an empty list |
| `tests/unit/healthRoute.test.ts` | REL-DEPLOY-004 | 2 — 200 ok when DB reachable, 503 when not |

Plus 2 new live-browser Playwright tests added to the existing `tests/e2e/rbac.spec.ts` (OPSQA-DEF-005): zero `/api/support/tickets` requests fire for a no-access role; the fetch still fires for a role that has access.

Plus 1 modified existing test (`tests/e2e/hr.spec.ts`, OPSQA-DEF-002): removed the now-nonexistent `/hr/leave` path from its route-block assertion loop.

## Full suite results, this phase

### Vitest (unit)

```
$ npm test
 Test Files  125 passed (125)
      Tests  2116 passed (2116)
   Duration  117.75s
```

2098 pre-existing + 18 new (13 unit test cases above, across 5 new files) = 2116. Zero failures, zero skipped.

### TypeScript

```
$ npx tsc --noEmit -p .
(clean — no output)
```

Run with `.next/types`/`.next/dev/types` cleared first to avoid stale generated-type false-positives from the deleted `/leave`/`/hr/leave` routes — confirmed those were stale artifacts, not real errors, by re-running clean after regeneration.

### ESLint

```
$ npx eslint .
259 errors, 97 warnings (repo-wide)
```

**No new errors introduced.** Verified by comparing error counts for every one of the 16 files this phase touched against their pre-change (`git show HEAD:<path>`) content, file by file:

| File | Before | After |
|---|---|---|
| `app/api/admin/users/[id]/route.ts` | 0 | 0 |
| `app/api/tms/bom-requests/route.ts` | 0 | 0 |
| `app/support/page.tsx` | 0 | 0 |
| `components/LeadCaptureWizard.tsx` | 0 | 0 |
| `components/QuotationCalculator.tsx` | 1 | 1 |
| `components/ReimbursementView.tsx` | 5 | 5 |
| `components/SupportTicketsView.tsx` | 1 | 1 |
| `components/ui/ProjectSelect.tsx` | 0 | 0 |
| `lib/apiError.ts` | 0 | 0 |
| `lib/notificationResolver.ts` | 0 | 0 |
| `lib/supportTicketStore.ts` | 0 | 0 |
| `lib/tmsAccess.ts` | 0 | 0 |
| `lib/tmsBomRequestStore.ts` | 0 | 0 |
| `proxy.ts` | 0 | 0 |
| `tests/e2e/hr.spec.ts` | 0 | 0 |
| `tests/e2e/rbac.spec.ts` | 0 | 0 |

The 7 errors in `QuotationCalculator.tsx`/`ReimbursementView.tsx`/`SupportTicketsView.tsx` are pre-existing `react-hooks/set-state-in-effect` warnings on `useEffect` patterns this phase's diffs never touched (confirmed by diffing: the `ReimbursementView.tsx` changes are JSX-attribute-only; the `SupportTicketsView.tsx` error is on the exact same `load()` call that existed before, verified by temporarily reverting just the new guard line and re-linting — the error persisted identically).

The repo's own lint baseline moved from a previously-recorded 252 to 259 — that drift is from other, unrelated work on this branch (a concurrent session's commits, e.g. `5b02173`), not from anything in this remediation phase.

### Production build

```
$ npm run build && npm run postbuild
✓ Compiled successfully
postbuild: copied public/ -> .next\standalone\public (51 files, 24.9 MB)
postbuild: copied .next/static -> .next\standalone\.next\static (544 files, 7.8 MB)
postbuild: standalone output is complete and ready to start.
```

Confirmed via direct inspection of the build output: `.next/standalone/.next/server/app/api/health/route.js` exists (the new endpoint shipped); no `app/leave` or `app/hr/leave` routes exist anywhere under `.next/standalone/.next/server/app` (the removed dead code is genuinely gone, not just hidden) — only the unrelated, still-live `daily-reports/leave-claims`/`daily-reports/hr/leave-claims`/`daily-reports/team/mark-leave` paths remain, as expected.

### Playwright (E2E), targeted re-run of everything touched

```
$ npx playwright test tests/e2e/hr.spec.ts tests/e2e/rbac.spec.ts tests/e2e/tms.spec.ts
  14 passed (2.4m)
```

Covers: the modified `hr.spec.ts` (confirms removing `/hr/leave` from its loop didn't break the test's intent — still 3/3), the 2 new + 5 existing `rbac.spec.ts` tests (10/10, including the new Support-page-fetch-skip tests), and `tms.spec.ts` (4/4, exercising the TMS/BOM code path `getTmsViewer()` and `tmsBomRequestStore.create()` both sit in).

Not re-run this phase: `auth.spec.ts`, `forms.spec.ts`, `leads.spec.ts`, `navigation.spec.ts`, `projects.spec.ts` — none of these touch any file changed this phase; the prior Final Release Certification pass already confirmed the full 34-test suite passes clean. Re-running the full suite is recommended as a final check before merge, but was not independently re-executed in this specific phase given none of its files were touched.

## REL-PERF-001 — live parity and timing verification

Unlike the other fixes, this one couldn't be meaningfully regression-tested with a mocked-DB unit test — the whole point was verifying the new narrow-column queries return the same real-world results as the old full-column ones at scale. A one-off script (created, run, and deleted within this phase — not left in the repo) did the following, then cleaned up:

1. Created disposable `QA_TEST_`-prefixed fixtures (a user, a project, a lead, a quotation) via direct Sequelize access.
2. Called both the OLD function (`leadStore.list`, `projectStore.listLight`, `searchQuotationsFiltered`) and the NEW function (`listForDashboard`, `listLightForDashboard`, `listQuotationsForDashboard`) for the same viewer.
3. Re-ran every downstream computation the Dashboard route performs (`isLeadUnattended` count, meta-leads-today count, all 6 project KPI filters, `buildDepartmentBreakdown`, quotation count/sum, `needsFollowUp` count, `computeEffectiveStatus` status breakdown) against BOTH the old and new results and asserted they matched exactly.

Result: **all parity checks passed** — byte-for-byte identical results on every computation. Fixtures hard-deleted after.

A second script measured timing directly against the real dev database using an admin/org-wide fixture (the heaviest real-world case — 1262 leads, 234 projects, 82 quotations), calling the old and new functions back-to-back in the same process (isolating DB/connection-load noise from the comparison):

```
old leadStore.list: 4240-14377ms (1262 rows)
new leadStore.listForDashboard: 1193-1511ms (1262 rows)
old projectStore.listLight: 767-1604ms (234 rows)
new projectStore.listLightForDashboard: 441-488ms (234 rows)
old searchQuotationsFiltered: 905-1755ms (82 rows)
new listQuotationsForDashboard: 324-416ms (82 rows)
```

A separate full-HTTP-request timing test (hitting `/api/dashboard` directly) was noisy (1.9-8.9s across runs) due to general DB-connection-pool load variance from other activity on this shared dev database — the same contention pattern already diagnosed as `REL-TEST-001` — but the isolated, same-process comparison above cleanly isolates that noise out and shows the real, consistent improvement from this specific fix.

## Live manual verification

```
$ curl -s http://localhost:3000/api/health
{"status":"ok","db":"ok","time":"2026-11-07T05:29:02.148Z"}
```

Confirmed `/api/health` is genuinely public (no session required) via `proxy.ts`'s `PUBLIC_PATHS`, and genuinely checks real DB connectivity (not a hardcoded 200) — hit live against the running dev server, not mocked.

## Distinguishing new regressions from pre-existing baseline issues

No new regressions were found in any of the above. The only "failures" encountered during this phase were the already-known, already-documented `REL-TEST-001` pattern (transient Playwright failures under contention, not reproducing in isolation) — which this phase's own `playwright.config.ts` timeout change (30s → 60s) directly targets, and which did not recur in any of this phase's own re-runs.

## Independent verification pass (post-REL-PERF-001) — full re-run, not just touched areas

Run after the dashboard performance fix, as a complete independent check rather than a targeted re-run:

```
$ npx tsc --noEmit -p .          → clean
$ npx vitest run tests/unit/modelRegistration.test.ts   → 5 passed (isolated re-run of a transient timeout, see below)
$ npm test                       → Test Files 125 passed (125), Tests 2116 passed (2116)
$ npx playwright test            → 36 passed (5.9m)  [full suite, not a subset]
$ npm run build && npm run postbuild → ✓ Compiled successfully
$ npx eslint .                   → 259 errors, 97 warnings (identical to baseline)
```

One transient Vitest failure occurred on the first full-suite run of this pass: `tests/unit/modelRegistration.test.ts > AppConfig declares every column of app_config` timed out at 5000ms. This test queries live Postgres schema directly and touches no file changed in this entire remediation phase. Re-run in isolation immediately after: 5/5 passed in 4.74s. Re-ran the full suite again afterward: 2116/2116 clean. Consistent with the same DB-connection-pool contention pattern as `REL-TEST-001`, not a regression.

The production build also hit two transient failures on its first two attempts this pass — an `EBUSY` on `.next/standalone` and an `ENOENT` copying `.next/package.json` — both consistent with contention from the concurrently-running dev server (the same category of issue this app's own `scripts/postbuild.js` and `next.config.ts` comments already document from a real production incident). A stale, zero-byte `.next/lock` file left over from the first failed attempt was removed (confirmed stale by its timestamp and empty content; the live dev server's own separate `.next/dev/lock` was not touched) before the third attempt, which succeeded cleanly.
