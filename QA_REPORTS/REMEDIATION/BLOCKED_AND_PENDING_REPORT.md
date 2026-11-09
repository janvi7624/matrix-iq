# Blocked and Pending Report — Phase B

Findings requiring credentials, external access, hardware, clarification, or another development session — none of these were fixed, and none were guessed at.

## BLOCKED — EXTERNAL DEPENDENCY

### REL-DB-003 — No backup/restore tooling or documentation in-repo

No infrastructure access from this environment to confirm what backup mechanism (if any) exists at the Supabase/Postgres level outside this repository. `ROLLBACK.md` (new this phase) documents this gap explicitly rather than assuming a backup exists. **Needs**: confirmation from whoever manages the Supabase/Postgres instance of the actual backup/restore policy, then documentation of it (either here or wherever that infrastructure's own runbooks live).

### REL-DEPLOY-005 — Hard vs. rolling restart strategy on the actual production deploy

Cannot be determined from this environment — no access to the Hostinger deploy configuration. Directly matters because this app's Node process caches Sequelize model definitions for its entire lifetime (proven by the session-epoch incident referenced in `DEPLOYMENT.md`). **Needs**: confirmation from whoever manages the production deploy of which restart strategy is actually used.

## DEFERRED — APPROVAL REQUIRED

### REL-DB-001 — 4 migrations marked `up` with no matching file in `db/migrations/`

Not something to guess at or reconstruct blind. **Needs**: the business/engineering owner to confirm whether `marketing-request-technical-workflow`, `create-daily-task-entries`, `daily-task-pipeline`, and `daily-task-submit` are a known, safe-to-document "daily-task"→"daily-report" rename (in which case this is just a documentation note), or genuinely missing files (in which case they need reconstruction from the live schema before this environment can be confidently rebuilt elsewhere).

### REL-DEP-012 — Dependency downgrade tradeoff

`npm audit fix --force` would downgrade `eslint-config-next` from 16.4.3 to 15.5.29 (below the app's own Next.js major version) since no patched 16.x release exists yet. The 12 underlying vulnerabilities are all confirmed non-exploitable in production (dev-tooling-only, verified via direct inspection of the production build output). Recommendation stands: wait for upstream rather than accept the downgrade — but this is the business/engineering owner's call to confirm, not a default I should make. **Needs**: explicit sign-off either way.

### BUG-042 — Unreachable `/admin` page

`app/admin/page.tsx` exists but renders Quotation History and is reachable only by typing/bookmarking the URL directly — nothing in the app links to it. **Needs**: a decision — delete the page, or build a real admin landing index/redirect.

### REL-WORKFLOW-DECISION-001 and REL-PERF-001's labeling decision

Already resolved — see `MASTER_REMEDIATION_REGISTER.csv`: `REL-WORKFLOW-DECISION-001` was fixed by a concurrent session's commit `5b02173` (Dashboard tile renamed "Pipeline Value" → "Quotation Value"). Listed here only for completeness; not pending.

## UNDER INVESTIGATION → now resolved

`OPSQA-DEF-004` was the only "under investigation" item carried into this phase — it has been fully investigated and resolved as a **FALSE POSITIVE** (see `SECURITY_REMEDIATION_REPORT.md`). Nothing remains under open investigation.

## RESOLVED — no longer pending (investigated this verification pass)

### REL-WORKFLOW-NOTTESTED-001 — Daily Report vs. HR dashboard consistency

Previously left as "not tested" rather than guessed at. Actually investigated end-to-end this pass, per the explicit instruction not to leave an application workflow pending without testing:

1. Searched for a separate HR-facing "completed today" compliance page distinct from the Dashboard's own widgets — checked `/hr/daily-reports` (confirmed: leave-claims/warnings review workflow only, no submission-count figure), `/hr/reports` (confirmed: an unrelated expense report), `/admin/daily-report-config` (confirmed: configuration only, no figures). **No such separate page exists.**
2. The only two places a Daily Report submission figure appears are the Dashboard's own `buildMyDailyReportStatus` (the individual viewer's "have I filed today") and `buildDailyReportAdminBrief` (the org-wide monthly compliance brief) — both read from the exact same `db.DailyReport` table/columns (`lib/dailyReportStore.ts`'s `findReportForDate` and `loadReportStatuses` respectively), with no intermediate cache or replica between them.
3. Live-verified with a disposable employee fixture: created a real `DailyReport` row for today, confirmed `buildMyDailyReportStatus` read `MISSING` before and `SUBMITTED` after, and the admin-brief-shaped `loadReportStatuses()` read agreed exactly (`SUBMITTED`) for the same employee/day, both before and after. Fixture hard-deleted after.

**Resolved as PASS** — the originally-suspected separate "HR dashboard" aggregate doesn't exist as a distinct feature to disagree with, and the two real read paths that do exist are provably consistent by shared source of truth, now confirmed live rather than inferred.

### REL-PERF-001 — Dashboard performance

Originally deferred here as too risky to attempt blind. Revisited as a dedicated follow-up once every downstream consumer was individually inventoried; fixed via column/join projection (not a SQL-aggregate rewrite) with a live parity check proving byte-for-byte identical results against the old full-fetch functions. See `BUG_FIX_REPORT.md` for full detail.

## Summary

| Status | Count | Items |
|---|---|---|
| BLOCKED — EXTERNAL DEPENDENCY | 2 | REL-DB-003, REL-DEPLOY-005 |
| DEFERRED — APPROVAL REQUIRED | 3 | REL-DB-001, REL-DEP-012, BUG-042 |

**5 items remain open**, all genuinely requiring input this environment cannot provide — either infrastructure access (2) or a business/product decision (3). None were fixed, guessed at, or marked FIXED without evidence. All are documented in `MASTER_REMEDIATION_REGISTER.csv` with their exact current status.
