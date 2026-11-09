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

## NOT TESTED (carried forward, not attempted this phase — out of this phase's scope)

- `REL-WORKFLOW-NOTTESTED-001` — Daily Report vs. HR dashboard consistency. Still not independently verified by any pass to date (the exact HR-facing aggregate function was not located within a prior pass's time budget). Needs a dedicated follow-up pass, not a code fix from this remediation phase specifically (this phase's scope was fixing confirmed/candidate defects, not performing new exploratory QA).

## Resolved since the first pass

**REL-PERF-001** (Dashboard performance) — originally deferred here as too risky to attempt blind. Revisited as a dedicated follow-up once every downstream consumer was individually inventoried; fixed via column/join projection (not a SQL-aggregate rewrite) with a live parity check proving byte-for-byte identical results against the old full-fetch functions. See `BUG_FIX_REPORT.md` for full detail. No longer pending.

## Summary

| Status | Count | Items |
|---|---|---|
| BLOCKED — EXTERNAL DEPENDENCY | 2 | REL-DB-003, REL-DEPLOY-005 |
| DEFERRED — APPROVAL REQUIRED | 3 | REL-DB-001, REL-DEP-012, BUG-042 |
| NOT TESTED (carried forward) | 1 | REL-WORKFLOW-NOTTESTED-001 |

None of these 6 remaining items were fixed, guessed at, or marked FIXED without evidence. All are documented in `MASTER_REMEDIATION_REGISTER.csv` with their exact current status.
