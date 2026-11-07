# Database Remediation Report — Phase B

Covers constraints, integrity, migrations, and historical-data protection findings addressed this phase.

## OPSQA-DEF-003 — Foreign-key constraint on user deletion (Low-Medium) — FIXED

**The constraint itself was correct and was NOT changed.** `general_tasks.assignee_id` is `allowNull: false, onDelete: 'RESTRICT'` by deliberate original design (`db/migrations/20260909120000-create-general-tasks.js`) — a general task must always have a real, existing assignee, and `RESTRICT` prevents deleting a user out from under their own assigned work, preserving task history and the audit trail rather than silently nulling or cascade-deleting it.

What was actually missing: no application-level handling of the resulting `SequelizeForeignKeyConstraintError`, so it surfaced as a raw database error in a bare HTTP 500 instead of a clean, actionable response.

**Fix** (application-layer error handling only, no schema change, no migration):
- `lib/apiError.ts` — a generic 409 fallback for any route that throws `SequelizeForeignKeyConstraintError` without its own specific handling.
- `app/api/admin/users/[id]/route.ts`'s `DELETE` — a specific, actionable 409 message when the blocking table is `general_tasks`: *"This user cannot be deleted because they still have a task assigned to them. Reassign or complete their task(s) first."*

**Options considered and rejected**:
- Cascading the delete (removing the task along with the user) — rejected: destroys task history/audit trail, exactly what the original `RESTRICT` design was protecting against.
- Nullable `assignee_id` with `ON DELETE SET NULL` — rejected: a general task with no assignee is a different, larger business-logic change (who owns an orphaned task? does it need reassignment UI?) than this finding's actual scope, and the existing design's intent (every task has a real owner) is sound.
- A new migration changing the FK rule — not needed once the real problem (raw error leakage, not the constraint itself) was identified.

**Regression tests**: `tests/unit/adminUserDeleteFkConstraint.test.ts` — the FK-blocked case returns 409 with the specific message (never the raw Sequelize error text), and a normal delete (no blocking task) still succeeds with 200.

**Historical data protection**: unaffected — no existing task, migration, or audit record was touched. The fix is purely a cleaner surface for an outcome the schema was already designed to produce.

## REL-DB-002 — N+1 query pattern in support ticket listing (Medium) — FIXED

See `BUG_FIX_REPORT.md` for full detail. Summary: `listInternalTickets()` fired one SLA-policy query and one status-history query PER ticket (2N+1 total). Batched to exactly 2 queries total regardless of list size, via `policiesByPriority()` and `historiesByTicketIds()`. No schema change — purely a query-shape fix in `lib/supportTicketStore.ts`. Regression-tested in `tests/unit/supportTicketListNPlusOne.test.ts`, asserting the query count stays flat at 2-10 and 25-ticket list sizes.

## Infra health check now covers DB reachability (REL-DEPLOY-004) — FIXED

`GET /api/health` (new, unauthenticated) calls `sequelize.authenticate()` and returns 200 `{status:'ok', db:'ok'}` if Postgres is reachable, or 503 `{status:'error', db:'unreachable'}` otherwise — giving infrastructure (a load balancer, uptime monitor, deploy script) a real database-connectivity signal that did not exist before. See `BUG_FIX_REPORT.md` and `DEPLOYMENT.md` for detail.

## Not touched this phase — explicitly deferred/blocked (unchanged from the Final Release Certification)

- **REL-DB-001** (4 migrations marked `up` in `SequelizeMeta` with no corresponding file in `db/migrations/`) — still `DEFERRED — APPROVAL REQUIRED`. Needs the business/engineering owner to confirm whether these are a known, safe-to-document "daily-task"→"daily-report" rename, or genuinely missing files needing reconstruction. Not something to guess at or reconstruct blind.
- **REL-DB-003** (no backup/restore tooling or documentation in-repo for the core database) — still `BLOCKED — EXTERNAL DEPENDENCY`. No infrastructure access from this environment to confirm what backup mechanism (if any) exists at the Supabase/Postgres level. `ROLLBACK.md` (new this phase) explicitly calls this out rather than assuming a backup exists.
- **REL-PERF-001** (Dashboard's 3 full-row-fetch store calls) — see `BUG_FIX_REPORT.md`'s "Deliberately NOT fixed" section. Not a data-integrity issue — a performance finding deferred due to the real risk of corrupting business-reporting correctness if rewritten blind.

No destructive database operations were performed. No new migrations were written this phase (none were needed for the fixes made).
