# Test Evidence Index — Ultimate Operational QA

Index of where evidence for each deliverable lives. All live testing in this pass used disposable `QA_TEST_`-prefixed fixtures created directly via Sequelize (per `tests/e2e/helpers/fixtures.ts`'s convention) and hard-deleted afterward; no real accounts, no real business records, no application/schema/config changes, no commits.

| Report | What it covers | Evidence type |
|---|---|---|
| `ALL_TEST_USERS_AND_ROLES.csv` | 15 roles (13 active + 2 explicitly skipped as inactive), real permissions/restrictions cited from code | Code citation (`lib/permissions.ts`, `lib/departmentScope.ts`, `lib/auth.ts`) + live-test cross-reference |
| `ROLE_MODULE_PERMISSION_MATRIX.csv` | 6 roles × 10 modules × GET+mutating call, ~105 cells | Live HTTP calls via disposable fixtures, classified by real HTTP status codes |
| `MODULE_FUNCTIONAL_TEST_REPORT.csv` | 6 test IDs: Leads, Sales Projects, TMS Tasks, HR leave-claim full CRUD lifecycles | Live HTTP + DB read-back verification |
| `CROSS_DEPARTMENT_WORKFLOW_REPORT.csv` / `END_TO_END_TEST_EXECUTION.csv` | Workflows 1, 2, 3, 6 (Workflow 4/5 covered elsewhere/not tested) | Live multi-fixture HTTP sequences + DB verification |
| `API_BACKEND_VALIDATION_REPORT.csv` | 8 state-changing routes, HTTP response vs. independent DB query | Live HTTP + direct Postgres query comparison |
| `DATABASE_DATA_INTEGRITY_REPORT.md` | Transactional consistency (3 checks), N+1 spot-check (4 endpoints), the new NULL-attribution defect | Live HTTP + SQL query-log inspection |
| `UI_UX_BROWSER_TEST_REPORT.md` | 7 pages across 3 roles, console/network checks, control-click verification | Playwright-driven live page loads + screenshots (not retained) |
| `NOTIFICATION_INTEGRATION_REPORT.md` | 3 notification-generating actions, recipient+content verified | Live trigger + direct DB row inspection |
| `PERFORMANCE_CONCURRENCY_REPORT.md` | 4 endpoint timing samples, 1 fresh concurrency race test (BOM approve-vs-reject) | Live timed HTTP calls (5 samples each) + `Promise.all` concurrent-request test |
| `DEFECT_REGISTER.csv` | 5 defects (4 confirmed/code-confirmed, 1 unconfirmed candidate) consolidated from all forks above | Synthesized from the evidence in the reports above — see each defect's own Evidence column for its specific source |
| `BROKEN_WORKFLOW_REGISTER.csv` | Per-workflow status (PASS/PARTIAL/BLOCKED/NOT TESTED) for Workflows 1-6 | Synthesized from `CROSS_DEPARTMENT_WORKFLOW_REPORT.csv`, `END_TO_END_TEST_EXECUTION.csv`, and `API_BACKEND_VALIDATION_REPORT.csv` |

## Raw evidence note

Live query logs, HTTP response bodies, and screenshots generated during testing were inspected in-session by each fork but were NOT retained as separate artifact files (screenshots deleted, scratch test scripts deleted) — per the hygiene rule of not leaving scratch files behind. The written reports above contain the specific status codes, timings, and query results observed, quoted inline, which is the retained evidence of record for this pass.

## Cross-reference to prior QA passes (not re-run, cited for context only)

- `QA_REPORTS/FULL_SYSTEM_QA/` — the original exhaustive adversarial pass (40+ bugs found/fixed, 96/96-page sweep, security audit).
- `QA_REPORTS/FINAL_RELEASE_CERTIFICATION/` — the most recent prior certification pass (dependency security, HTTP headers, DB/migration audit, deployment/pipeline audit, accessibility numbers, performance baseline, business workflow audit including REL-WORKFLOW-001, REL-DB-002, REL-PERF-001).

This pass's own new findings (`OPSQA-DEF-001` through `OPSQA-DEF-005`) are distinct from and additive to those prior passes' findings — none are duplicates.
