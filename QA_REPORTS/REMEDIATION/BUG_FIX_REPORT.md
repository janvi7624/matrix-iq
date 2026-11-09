# Bug Fix Report — Phase B Remediation

Every confirmed defect fixed this phase, with root cause, the actual code change, and verification evidence. See `MASTER_REMEDIATION_REGISTER.csv` for the full register including everything NOT touched this phase (already-fixed history, deferred/blocked items, decisions pending).

## OPSQA-DEF-001 — BOM requester identity race (Medium)

**Root cause**: `lib/tmsAccess.ts`'s `getTmsViewer()` re-derived the authenticated user's id via a second, independent `findUserByUsername()` lookup instead of reusing the id `getViewerContext()` had already verified from the session (`session.sub`, resolved via a primary-key `findUserStatusById()` lookup). That second lookup could transiently come back empty, silently blanking `viewer.userId` — and `app/api/tms/bom-requests/route.ts` fed that blanked id straight into `requested_by_id`. Separately, `lib/tmsBomRequestStore.ts`'s `create()` did its OWN third, independent username→id lookup for `created_by`, with the same silent-null-on-miss behavior.

**Fix**:
- `lib/tmsAccess.ts`: `getTmsViewer()` now calls `findUserById(viewer.userId)` (a primary-key lookup on the id `getViewerContext()` already verified) instead of `findUserByUsername(viewer.username)`, and always returns that same verified id as `userId` — it can no longer be silently blanked by a second lookup's own, separate failure mode.
- `lib/tmsBomRequestStore.ts`: `create()` now accepts an optional `createdById` parameter. The route (`app/api/tms/bom-requests/route.ts`) passes `viewer.userId` directly — no lookup needed. If neither a passed id nor a username-based fallback resolves, `create()` now **throws** rather than silently writing `created_by: null`.

**Files changed**: `lib/tmsAccess.ts`, `lib/tmsBomRequestStore.ts`, `app/api/tms/bom-requests/route.ts`.

**Verification**: `tests/unit/tmsBomRequestCreateIdentity.test.ts` (3 tests) — direct-id-passed skips the lookup entirely; username-fallback still works when no id is passed; throws (doesn't silently null) when neither resolves. Full Vitest suite (2116/2116) and the TMS Playwright spec (`tms.spec.ts`, 4/4) re-run clean.

## OPSQA-DEF-002 — Legacy `/leave` + `/hr/leave` dead code (Low)

**Root cause**: both `'leave'` and `'hr-leave'` module keys were added to `lib/moduleConfigStore.ts`'s `RETIRED_KEYS` at some point (their `ModuleConfig` row is destroyed at startup), making `isModuleAccessAllowed`/`requireHrModule`/`requireHrPage` permanently return false for every role including admin — but the route/page/component files themselves were never deleted.

**Fix**: confirmed via a repo-wide reference search that nothing live depends on these files (the one apparent dependent, `lib/dailyReportLeaveClaimStore.ts`, only mentions `leaveRequestStore.ts` in a comment, not a real import), then removed: `app/api/leave/route.ts`, `app/api/leave/[id]/route.ts`, `app/leave/page.tsx`, `components/LeaveView.tsx`, `app/hr/leave/page.tsx`, `app/api/hr/leave/route.ts`, `components/HrLeaveOversightView.tsx`, `lib/leaveRequestStore.ts`. Also removed the now-dead `leave_request` notification-resolver entry from `lib/notificationResolver.ts` (it falls back to "non-actionable" gracefully when a key isn't listed — no behavior change for any still-possible notification). Updated `tests/e2e/hr.spec.ts` to drop the now-404 `/hr/leave` path from its "blocked" assertion loop, since the page no longer exists to redirect at all.

**Files changed**: 8 files deleted, `lib/notificationResolver.ts`, `tests/e2e/hr.spec.ts`.

**Verification**: `tests/unit/legacyLeaveRouteRemoved.test.ts` pins all 8 removed paths staying removed. `npx tsc --noEmit` clean (no dangling imports). Full Vitest suite (2116/2116) and `hr.spec.ts` (3/3) re-run clean.

## OPSQA-DEF-003 — FK constraint on user deletion (Low-Medium)

**Root cause**: `general_tasks.assignee_id` is `ON DELETE RESTRICT` by deliberate original design (see `db/migrations/20260909120000-create-general-tasks.js`'s own comments) — a task must always have a real assignee, and this preserves task history/audit trail rather than orphaning or cascade-deleting it. That design is correct and was **not** changed. What was actually broken: no route caught the resulting `SequelizeForeignKeyConstraintError`, so an admin trying to delete a user with an assigned task saw a raw Postgres error message in a bare 500.

**Fix**: `lib/apiError.ts` now maps any `SequelizeForeignKeyConstraintError` to a clean 409 with a generic "other records still depend on it" message (a defense-in-depth default for any route that doesn't handle the specific case). `app/api/admin/users/[id]/route.ts`'s `DELETE` handler additionally catches this specific case (table `general_tasks`) first, with a precise, actionable message: "This user cannot be deleted because they still have a task assigned to them. Reassign or complete their task(s) first."

**Files changed**: `lib/apiError.ts`, `app/api/admin/users/[id]/route.ts`.

**Verification**: `tests/unit/adminUserDeleteFkConstraint.test.ts` (2 tests) — confirms the 409 + actionable message on the FK-blocked case, and confirms deletion still succeeds normally when there's no blocking task. Full Vitest suite (2116/2116) re-run clean.

## OPSQA-DEF-004 — Unconfirmed GET/POST inconsistency on `/api/support/tickets`

**Resolved as FALSE POSITIVE**, not fixed (nothing was broken). See `SECURITY_REMEDIATION_REPORT.md` for the full investigation and evidence.

## OPSQA-DEF-005 — Unnecessary `/support` 403 requests (Informational)

**Root cause**: `components/SupportTicketsView.tsx`'s data-fetching effect fired unconditionally on every mount, regardless of whether the viewer's role could ever work the support queue (`canWorkSupportQueue()`, a server-only function keyed on role/partnerId). A role like Sales has no queue role at all, so every load of `/support` was a fetch guaranteed to come back 403.

**Fix**: `app/support/page.tsx` (a server component) now computes `canWorkSupportQueue()` itself — the exact same function the API route (`app/api/support/tickets/route.ts`) uses to authorize `GET` — and passes the result down as a `canWorkQueue` prop. `SupportTicketsView`'s effect now skips the fetch entirely when that prop is `false`, showing the same refusal message immediately instead of after a round-trip. The API's own authorization check is completely unchanged — this is purely a client-side courtesy to avoid a call that was always going to fail.

**Files changed**: `app/support/page.tsx`, `components/SupportTicketsView.tsx`.

**Verification**: 2 new live-browser Playwright tests in `tests/e2e/rbac.spec.ts` — confirms zero `/api/support/tickets` requests fire for a role with no queue access (and the refusal message still shows), and confirms the fetch still fires normally for a role that does have access. Both pass.

## Also fixed this phase (from the Final Release Certification's own open list)

### REL-DB-002 — N+1 query in `listInternalTickets()` (Medium)

**Root cause**: `lib/supportTicketStore.ts`'s `listInternalTickets()` called `slaFor()` per ticket, which itself called `policyFor()` (1 SLA-policy query) and `historyFor()` (1 status-history query) — 2N+1 total queries for a list of N tickets.

**Fix**: added `policiesByPriority()` (fetches every active SLA policy in 1 query, keyed by priority — the set of priorities is small and fixed) and `historiesByTicketIds()` (fetches every status-history row for the whole ticket list in 1 query, grouped in memory by ticket id). `listInternalTickets()` now calls both once and maps the results back onto each ticket via `assessSlaFor()` (the same SLA arithmetic, refactored to take pre-fetched data instead of querying itself). The single-ticket path (`findTicketById`, via the original `slaFor()`) is untouched — the N+1 was specific to the list endpoint.

**Files changed**: `lib/supportTicketStore.ts`.

**Verification**: `tests/unit/supportTicketListNPlusOne.test.ts` (3 tests) — confirms exactly 1 policy query + 1 history query for both a small (2-ticket) and much larger (25-ticket) list, and 0 history queries for an empty list. Full Vitest suite (2116/2116) re-run clean.

### REL-UX-001/002/003 — Accessibility label gaps (Low/Medium/Informational)

- **REL-UX-001**: `components/LeadCaptureWizard.tsx`'s 2 hidden camera/gallery file inputs now have `aria-label`.
- **REL-UX-002**: `components/ReimbursementView.tsx`'s month/year toolbar selects now have `aria-label`; the entry form's category (`descriptionType`) select now has a proper `htmlFor`/`id` label association plus `aria-label`.
- **REL-UX-003**: `components/ui/ProjectSelect.tsx` now accepts an optional `id` prop and defaults to `aria-label="Project"` when none is given; `components/QuotationCalculator.tsx` passes `id="projectSelect"` to match its existing label. This incidentally also fixed the identical latent gap at `ProjectSelect`'s other 5 call sites (none of which had passed any id/label association either), at zero extra risk since the default only applies when a caller doesn't already supply an id.

**Verification**: visual/attribute changes only, no logic changed; `npx tsc --noEmit` clean; full Vitest suite (2116/2116) unaffected.

### REL-DEPLOY-001/002/003/004/006 and REL-TEST-001 — process/documentation + 1 real endpoint

See `DATABASE_REMEDIATION_REPORT.md` and `REGRESSION_TEST_REPORT.md` for `/api/health` and the Playwright timeout fix specifically; `DEPLOYMENT.md`, `ROLLBACK.md`, `.github/workflows/ci.yml`, and the 5 new `.env.example` entries close out the rest.

## REL-PERF-001 — Dashboard performance (Medium) — FIXED (follow-up pass)

Initially deferred in the first remediation pass as too risky to attempt blind (see git history of this file for that reasoning). Revisited as a dedicated follow-up once the full inventory of downstream consumers was mapped out.

**Root cause**: `leadStore.list()`, `projectStore.listLight()`, and `searchQuotationsFiltered()` each fetched the viewer's entire visible row set with their FULL column/join shape (36+ columns, 2-4 joins each) — built for callers that display full records (the Leads/Projects/Quotations screens) — even though the Dashboard route only ever reads a small, fixed subset of fields from each: counts, sums, and a handful of specific fields consumed by `isLeadUnattended`, `buildSalesTeamSummary`, `buildDepartmentBreakdown`, `needsFollowUp`, and `computeEffectiveStatus`.

**Fix** (column/join projection, NOT a SQL-aggregate rewrite — the actual business logic was never touched):
- `lib/leadStore.ts`: new `listForDashboard()` — same visibility scope (`leadVisibilityWhere`), narrowed to 11 columns and 2 joins (`creator`, `assignee`) instead of 36+ columns and 4 joins. Mirrors the exact pattern this codebase already uses for `/api/sidebar`'s `listLeadsForBadges()`.
- `lib/projectStore.ts`: new `listLightForDashboard()` — same visibility scope (`resolveOwnerWhere`), narrowed to 8 columns and 1 join (`creator`) instead of ~40 columns and 4 joins.
- `lib/quotationStore.ts`: new `listQuotationsForDashboard()` — same visibility scope as `searchQuotationsFiltered({viewerUsername})`, narrowed to 10 columns and 1 join, and skips the `followUps` association entirely (`last_follow_up_at` is a raw column, not derived from it) plus 2 extra per-project-id queries (`attachSalesPersons`/`attachPartnerShareState`) that resolve display fields no Dashboard consumer reads.
- `app/api/dashboard/route.ts` now calls all three new functions instead of the originals. No other route was touched — the original, full-shape functions remain exactly as they were for every other caller (the Leads/Projects/Quotations list screens).

**Why this is safe** (unlike a SQL-aggregate rewrite): `isLeadUnattended`, `buildSalesTeamSummary`, `buildDepartmentBreakdown`, `needsFollowUp`, and `computeEffectiveStatus` are **unchanged** — same JavaScript functions, same business rules, just called with narrower-but-still-correct row objects (every field they actually read is still fetched; only unused fields were dropped).

**Verification**:
- **Correctness**: a live parity script created real disposable fixtures (a project, a lead, a quotation) and compared the OLD and NEW functions' outputs for the same viewer, re-running every downstream computation (`unattendedLeads`, `metaLeadsToday`, all 6 project KPI filters, `buildDepartmentBreakdown`, quotation count/sum/`followUpCount`/status-breakdown) against both — **byte-for-byte identical results** in every case. Fixtures hard-deleted after.
- **Performance**: isolated, same-process timing against a real 1262-lead/234-project/82-quotation dataset (an admin/org-wide viewer, the heaviest case) — leads ~3-10x faster (4.2-14.4s → 1.2-1.5s), projects ~2-3.5x faster (0.8-1.6s → 0.4-0.5s), quotations ~3-5x faster (0.9-1.8s → 0.3-0.4s).
- **Regression**: full Vitest suite (2116/2116), `npx tsc --noEmit` (clean), lint (0 new errors/warnings — verified file-by-file against the pre-change baseline), and a full production build all re-run clean after this change.

**Files changed**: `lib/leadStore.ts`, `lib/projectStore.ts`, `lib/quotationStore.ts`, `app/api/dashboard/route.ts`.

## REL-WORKFLOW-NOTTESTED-001 — Daily Report vs. HR dashboard consistency — INVESTIGATED, RESOLVED AS PASS (not a code fix)

Previously left as "not tested" after a prior pass couldn't locate the exact HR-facing aggregate function in its time budget. Investigated end-to-end this verification pass rather than left pending:

1. **Searched for a separate comparison target**: checked `/hr/daily-reports` (`components/HrDailyReportReviewView.tsx` — confirmed it's a leave-claims/warnings review workflow with no submission-count figure at all), `/hr/reports` (`components/HrReportsView.tsx` → `/api/hr/reports` — confirmed it's an unrelated Reimbursement/Admin-Expense/Office-Operation spend report), and `/admin/daily-report-config` (confirmed configuration only — deadline/sweep settings, no compliance figures). **No separate "HR dashboard" daily-report compliance page exists in this app.**
2. **Identified what actually exists**: the Dashboard's own two Daily-Report widgets — `buildMyDailyReportStatus` (individual viewer's "have I filed today", via `lib/dailyReportStore.ts`'s `findReportForDate`) and `buildDailyReportAdminBrief` (org-wide monthly compliance brief, via `loadReportStatuses`) — both read the exact same `db.DailyReport` table and `submission_status` column, with no intermediate cache, replica, or independently-maintained copy of the logic.
3. **Live-verified** with a disposable employee fixture (role `user`, a department with an active configured daily-report template): called `buildMyDailyReportStatus` — read `MISSING` (no report yet). Created a real `DailyReport` row for today with `submission_status: 'SUBMITTED'`. Called `buildMyDailyReportStatus` again — read `SUBMITTED`. Called `loadReportStatuses` (the exact function `buildDailyReportAdminBrief` uses) for the same employee/day — also read `SUBMITTED`. Both agreed, both times. Fixture and report row hard-deleted after.

**Conclusion**: **PASS**, not a defect. The originally-suspected inconsistency target doesn't exist as a separate feature, and the two real read paths that do carry Daily Report status are provably consistent by shared source of truth — now confirmed live, not just inferred from reading the code. No code change was needed or made.
