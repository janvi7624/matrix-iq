# MatrixIQ — Master Operational QA Report (Ultimate Operational QA)

**Scope**: full multi-user, multi-role, cross-department operational testing — not source-code review alone. Six parallel QA passes were run live against the real running dev server using disposable `QA_TEST_`-prefixed fixtures (never real accounts, never real business data), covering: role/module permission matrix, module CRUD lifecycles, cross-department workflows, API-to-database integrity, UI/UX + notifications, and performance/concurrency.

**No application code, schema, or configuration was changed. No commits or pushes were made. No real user accounts or real business records were touched** (two notification rows unavoidably landed on two real staff accounts because they required a real department's real manager — both were identified, content-verified, and deleted immediately; see `BLOCKED_AND_UNTESTED_REPORT.md`).

## Git protection note

Before and during this pass, `git status` was checked repeatedly. The only files this pass added are under `QA_REPORTS/ULTIMATE_OPERATIONAL_QA/`. Separately, and **not caused by this pass**, 4 application files (`components/Dashboard.tsx`, `components/TmsProjectsView.tsx`, `lib/tmsProjectStore.ts`, `lib/types.ts`) are currently modified and uncommitted in the working tree — these line up with the Phase B remediation plan for `REL-WORKFLOW-001` and `REL-PERF-001` from the prior Final Release Certification pass, suggesting another concurrent session is actively implementing those fixes. This audit did not touch, revert, or assess those changes.

## Headline numbers

See `FINAL_OPERATIONAL_COVERAGE_REPORT.md` for the full breakdown. In short: 15 roles / 11 departments discovered, ~150+ discrete live test actions executed, 4 confirmed new defects (0 Critical, 0 High, 1 Medium, 2 Low/Low-Medium, plus 1 unconfirmed candidate and 1 Informational), 4 of 6 named cross-department workflows attempted (2 fully passed, 2 partially blocked by what look like test-setup gaps rather than confirmed app bugs), 1 workflow not attempted, several modules/pages explicitly out of scope this pass.

## New defects found this pass

| ID | Severity | Summary |
|---|---|---|
| OPSQA-DEF-001 | **Medium** | BOM request creation can silently write NULL `requested_by_id`/`created_by` when called within ~1-2s of login — deterministically reproduced. |
| OPSQA-DEF-002 | Low | Legacy `/api/leave` route/page/component is permanently dead for every role (retired in config, files never deleted) — housekeeping only, no live impact. |
| OPSQA-DEF-003 | Low-Medium | `general_tasks.assignee_id` FK lacks `ON DELETE SET NULL/CASCADE` — deleting a user with an assigned task throws a raw DB error instead of a clean app-level one. |
| OPSQA-DEF-004 (candidate, unconfirmed) | Low | Possible GET/POST auth-gate inconsistency on `/api/support/tickets` for role `user` — needs a direct code read to confirm. |
| OPSQA-DEF-005 | Informational | `/support` page fires 2 unnecessary 403 requests on every load for a role that can never access it. |

Full detail, repro steps, evidence, and recommended corrections are in `DEFECT_REGISTER.csv`.

## Workflow status

| Workflow | Status |
|---|---|
| 1 — Sales lead → manager reassign → convert to project | PARTIAL — blocked by what looks like a test-fixture/department-manager-registration gap, not a confirmed app bug |
| 2 — Employee reimbursement submit → manager → HR | BLOCKED at submission by a deadline-day check — appears to be correct, intentional behavior; needs a human sanity check on the deadline value |
| 3 — TMS project → task → engineer update → manager review | **PASS**, fully completed end-to-end |
| 4 — BOM request → Procurement → Purchase Order | **PASS** (core lifecycle), but surfaced OPSQA-DEF-001 along the way |
| 5 — Sales targets → Closed deals → MIS | NOT TESTED this pass |
| 6 — Cross-department access (denied + allowed sides) | Denied side **PASS**; allowed side NOT TESTED (test-script used the wrong HTTP verb) |

Full per-step detail in `CROSS_DEPARTMENT_WORKFLOW_REPORT.csv`, `END_TO_END_TEST_EXECUTION.csv`, and `BROKEN_WORKFLOW_REGISTER.csv`.

## Permission boundaries

~105 role × module × verb combinations were live-tested across 6 distinct roles (Sales/`user`, manager, hr, accounts, admin, partner-user) and 10 modules. **No incorrectly-allowed or incorrectly-blocked case was found**, aside from the one unconfirmed candidate above. Full matrix in `ROLE_MODULE_PERMISSION_MATRIX.csv`; role/department/permission inventory in `ALL_TEST_USERS_AND_ROLES.csv`.

## Performance and concurrency

4 list-endpoint timings sampled (all sub-second, consistent with the prior Dashboard-specific slowness being isolated to 3 aggregate calls, not a systemic list-endpoint problem) and one fresh concurrency race tested (simultaneous BOM approve-vs-reject on the same request) — **passed cleanly**, confirming the existing status-conditional UPDATE guard works as designed. Full detail in `PERFORMANCE_CONCURRENCY_REPORT.md`.

## Notifications

3/3 notification-generating actions verified with the correct recipient and content via direct DB inspection, not just a 200 response. Full detail in `NOTIFICATION_INTEGRATION_REPORT.md`.

## Final answer: Final Operational Status and System Assessment

**CONDITIONALLY PASS** this pass, consistent with the prior Final Release Certification's own **CONDITIONALLY READY FOR RELEASE** verdict.

## Final System Assessment: Operationally Healthy with Minor Issues

See `FINAL_OPERATIONAL_COVERAGE_REPORT.md` for the full question-by-question answer to the master prompt's 20 final questions, and for everything explicitly not covered this pass (Dealer management, Workflow 5, several UI modules, external integrations, true partner-role confinement).

## What this report does not include

`app/api/clients/route.ts` and `lib/clientMasterQuery.ts` (the unauthorized pagination change from the prior certification pass) and the 4 currently-uncommitted files noted above under "Git protection note" are **not assessed** by this operational QA pass — they are separate, ongoing items for the user's own review, not touched or evaluated here.
