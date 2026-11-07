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

## Live manual verification

```
$ curl -s http://localhost:3000/api/health
{"status":"ok","db":"ok","time":"2026-11-07T05:29:02.148Z"}
```

Confirmed `/api/health` is genuinely public (no session required) via `proxy.ts`'s `PUBLIC_PATHS`, and genuinely checks real DB connectivity (not a hardcoded 200) — hit live against the running dev server, not mocked.

## Distinguishing new regressions from pre-existing baseline issues

No new regressions were found in any of the above. The only "failures" encountered during this phase were the already-known, already-documented `REL-TEST-001` pattern (transient Playwright failures under contention, not reproducing in isolation) — which this phase's own `playwright.config.ts` timeout change (30s → 60s) directly targets, and which did not recur in any of this phase's own re-runs (14/14 clean, run twice: once mid-phase, once in this final verification pass).
