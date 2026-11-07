# Remediation Plan — Phase A (Audit & Planning Only)

**No code has been changed.** This is the consolidated audit and prioritized plan required before Phase B. Waiting for explicit approval before any implementation begins, per the assignment's instruction.

## Git state at time of this audit

- Branch: `dev`, ahead of `origin/dev`.
- `git status --short`: clean except this session's new `QA_REPORTS/ULTIMATE_OPERATIONAL_QA/` and (now) `QA_REPORTS/REMEDIATION/` directories.
- The 4 files previously reported as being actively modified by another concurrent session (`components/Dashboard.tsx`, `components/TmsProjectsView.tsx`, `lib/tmsProjectStore.ts`, `lib/types.ts`) have since been **committed** by that session as `5b02173` ("fix: clarify label for pipeline value and unify progress display logic"). Verified via `git show 5b02173` — this commit fully and correctly resolves `REL-WORKFLOW-001` (TMS list/detail progress mismatch) and `REL-WORKFLOW-DECISION-001` (Dashboard tile labeling). No conflict remains on these files; both findings are marked ALREADY FIXED — VERIFIED in the register.
- No other uncommitted or conflicting work was found. Safe to proceed with Phase B on a clean tree once approved.

## Consolidated findings summary

See `MASTER_REMEDIATION_REGISTER.csv` for the full 68-row register across all three QA sources (`FULL_SYSTEM_QA`, `FINAL_RELEASE_CERTIFICATION`, `ULTIMATE_OPERATIONAL_QA`). Breakdown:

- **ALREADY FIXED — VERIFIED**: 39 (all 40 fixed `FULL_SYSTEM_QA` bugs + `REL-WORKFLOW-001` + `REL-WORKFLOW-DECISION-001` + `REL-DEP-001..011`'s shared root cause).
- **FALSE POSITIVE — EVIDENCE ATTACHED**: 1 (`BUG-037`).
- **CONFIRMED — NOT FIXED**: 13 (`REL-DB-002`, `REL-DEPLOY-001/002/003/004/006`, `REL-UX-001/002/003`, `REL-PERF-001`, `REL-TEST-001`, `OPSQA-DEF-001/002/003/005`).
- **UNDER INVESTIGATION**: 2 (`REL-WORKFLOW-NOTTESTED-001`, `OPSQA-DEF-004`).
- **DEFERRED — APPROVAL REQUIRED**: 3 (`BUG-042`, `REL-DB-001`, `REL-DEP-012`).
- **BLOCKED — EXTERNAL DEPENDENCY**: 2 (`REL-DB-003`, `REL-DEPLOY-005`).

**0 Critical, 0 High-severity items remain open.** The entire open list is Medium-and-below, plus a handful of decisions that are not code defects at all.

## Priority 1 — Fix now (the 4 new Operational QA findings, as directed)

| Finding | Scope of fix | Risk | Regression tests |
|---|---|---|---|
| `OPSQA-DEF-001` (BUG-01) — BOM requester identity race | `lib/tmsAccess.ts` (`getTmsViewer()`), `lib/tmsBomRequestStore.ts` (`create()`). Fix must derive requester identity from the verified session server-side and reject (not silently null) if it can't be established — no timeout/delay hack. | Medium — touches a shared viewer-resolution helper likely used elsewhere in TMS; must verify no other TMS route regresses. | Immediate-after-login submission, normal-timing submission, expired session, missing/invalid identity, concurrent submissions. |
| `OPSQA-DEF-003` (BUG-02) — FK constraint on user deletion | The `general_tasks.assignee_id` migration/FK definition, and the admin user-delete route handler. Must preserve task history, not blind-cascade. | Medium — a schema-adjacent change (new migration) plus an API-error-handling change; must not alter existing task reporting/audit history. | No tasks, open task, completed task, multiple tasks, historical-activity retention. |
| `OPSQA-DEF-002` (BUG-03) — Legacy `/api/leave` dead code | Repo-wide reference search first; then conditional removal of `app/api/leave/route.ts`, the `/leave` page, `components/LeaveView.tsx`, and any now-unused imports. | Low — but must confirm zero live consumers (including background jobs) before deleting anything. | Route-coverage test update confirming the route is gone (or confirming why retained, if kept). |
| `OPSQA-DEF-005` (BUG-04) — Unnecessary `/support` 403s | Frontend component(s) initiating the 2 calls on `/support`; short-circuit on known-denied role, no backend RBAC change. | Low — purely a frontend call-ordering change. | Confirm unauthorized roles no longer trigger the 2 calls AND still can't reach the protected endpoints directly. |

## Priority 1b — Investigate the unconfirmed candidate

`OPSQA-DEF-004` — compare `/api/support/tickets` GET vs POST authorization logic directly in code across all relevant roles (not just role `user`), including unauthenticated and cross-user cases. Fix only if confirmed as a genuine inconsistency; otherwise document reproducible evidence that the 400 is itself an auth-shaped rejection (or a legitimate, intentionally different permission requirement for POST vs GET).

## Priority 2 — Other confirmed, not-yet-fixed findings (from the prior certification pass)

Grouped by theme, in recommended order:

1. **Database/Performance**: `REL-DB-002` (N+1 on `listInternalTickets()`) and `REL-PERF-001` (Dashboard's 3 heavy aggregate calls) — both are real, bounded, well-understood query-shape fixes.
2. **Accessibility**: `REL-UX-002` (Reimbursement selects, Medium — used monthly by every employee) before `REL-UX-001`/`REL-UX-003` (lower-impact).
3. **Process/documentation** (`REL-DEPLOY-001/002/003/004/006`, `REL-TEST-001`): no urgency, no release blocker, do as capacity allows — CI/CD pipeline, `.env.example` sync, deployment docs, a real `/api/health` endpoint, a rollback runbook, and Playwright timeout/concurrency tuning.

## Decisions required before touching these (do NOT fix speculatively)

| Finding | Decision needed from the business/infra owner |
|---|---|
| `BUG-042` | Delete the unreachable `/admin` page, or build a real admin landing index? |
| `REL-DB-001` | Are the 4 unmatched migrations a known, safe-to-document "daily-task"→"daily-report" rename, or genuinely missing files needing reconstruction? |
| `REL-DEP-012` | Wait for an upstream `eslint-config-next` fix (recommended), or accept a downgrade now? |
| `REL-DB-003` | What backup/restore mechanism actually exists at the infrastructure level outside this repo? |
| `REL-DEPLOY-005` | Does the production deploy do a hard restart or a rolling restart? |

These stay out of Phase B's code changes until answered. Independent fixes proceed regardless.

## Implementation approach for Phase B (once approved)

1. Priority 1 fixes first (the 4 directed findings), each with its own commit-ready change + regression test, verified independently before moving to the next.
2. Priority 1b investigation (code-only, no risk) resolves `OPSQA-DEF-004` to either a fix or a documented false positive.
3. Priority 2 items in the order above, as time/scope allows.
4. After every fix: run the full existing test suite (`npm test`, `npx playwright test`), `npm run build`, `npx tsc --noEmit` (or equivalent), and `npm run lint` (diffed against the existing ~252-error baseline, not treated as a hard gate).
5. Final verification pass confirming no concurrent-session work was overwritten, and that every "FIXED" status in the register has real evidence attached (test output, not just "looks right").

## Risks

- The BOM-attribution fix (`OPSQA-DEF-001`) touches session/viewer resolution shared by TMS broadly — needs careful regression coverage beyond just BOM requests to be confident nothing else that depends on `getTmsViewer()` regresses.
- The FK-constraint fix (`OPSQA-DEF-002`) is schema-adjacent (a new migration) — any schema change on this live system needs the same care applied throughout this engagement (migration `up`/`down` both correct, applied and verified against the real DB, not just assumed).
- Deleting the legacy `/leave` code (`OPSQA-DEF-002`) carries a small risk if some undiscovered background job or external client still calls it — the repo-wide reference search must be exhaustive before any deletion, and if any doubt remains, retain-and-document is the safer choice over delete.

## Explicitly not in scope for Phase B without further instruction

- `app/api/clients/route.ts` / `lib/clientMasterQuery.ts` — already committed by another session (`ac6cf16`) outside this conversation's review; not part of this remediation register, not touched here.
- Anything marked BLOCKED/DEFERRED above stays untouched until a decision is made.

---

**Waiting for approval before proceeding to Phase B.**
