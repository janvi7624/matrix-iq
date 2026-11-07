# Database Release Audit — MatrixIQ

Extension of `QA_REPORTS/FULL_SYSTEM_QA/DATABASE_INTEGRITY_REPORT.md` (read first — not repeated here). That pass covered structural consistency across all 87 models (PKs, FKs, soft-delete, timestamps, 5 orphan-risk pairs) and found one real issue (`users.username`/`quotations.quotation_number` unique indexes not soft-delete-aware). This pass covers 6 additional, deeper areas per the Final Release Certification directive. Read-only — no migration run, no real record modified.

## 1. Migration safety

**Reversibility — PASS.** All 133 migration files in `db/migrations/` have an `async down()` function. No irreversible migration found.

**Transaction wrapping — DECISION REQUIRED (process gap, not an active bug).** 109 of 133 migrations perform more than one DDL operation (`addColumn`/`createTable`/`addIndex`/etc.) with no explicit `queryInterface.sequelize.transaction(...)` wrapper. In Postgres, each unwrapped `queryInterface` call from Sequelize typically commits independently — if a multi-step migration fails partway (e.g. operation 5 of 10), operations 1-4 are already committed and the schema is left in a partially-migrated state requiring manual cleanup, with no automatic rollback. This is a systemic pattern across the migration history, not a new bug introduced recently, and every one of these migrations has already run successfully against this database — so there's no live defect, but it's a real structural risk for any FUTURE migration. **Recommendation**: wrap multi-step migrations in a transaction going forward (does not require touching the 109 existing, already-applied files).

**Migration-history drift — FAIL. Finding REL-DB-001.**

| Field | Value |
|---|---|
| Severity | Medium-High |
| Affected | `db:migrate:status` vs `db/migrations/` |
| Repro | `npx sequelize-cli db:migrate:status` shows 137 migrations marked `up`; `ls db/migrations/*.js` shows only 133 files present. `comm` diff identifies the 4 phantom entries. |
| Expected | Every migration recorded as applied in the live `SequelizeMeta` table has a corresponding file in `db/migrations/`, so the schema is fully reproducible from the current repo state alone. |
| Actual | 4 migrations are recorded as applied with **no corresponding file in the repo**: `20260820120000-marketing-request-technical-workflow.js`, `20261014120000-create-daily-task-entries.js`, `20261014140000-daily-task-pipeline.js`, `20261014160000-daily-task-submit.js`. |
| Evidence | Direct `comm -23` diff of `db:migrate:status`'s applied-list against `ls db/migrations/*.js`, both captured verbatim this pass. |
| Impact | **Reproducibility risk**: if this repository's `db/migrations/` were run against a brand-new empty database (a fresh dev environment, a disaster-recovery rebuild, a staging environment), the resulting schema would be MISSING whatever these 4 migrations did — unless fully superseded by a later migration. The naming ("daily-task-*") strongly suggests these are an early iteration of what's now the "daily-report" module (`20261014090000-create-daily-report-module.js`, the largest single migration at 25 DDL ops, created the same day as the last phantom entry) — plausibly these were squashed/renamed during a rename and the old files deleted without cleaning up `SequelizeMeta`, with the daily-report migration being the true current source of that schema. This is a reasonable hypothesis, not confirmed — resolving it with certainty requires git history archaeology outside this audit's scope. |
| Recommended correction | Confirm via git history whether these 4 are genuinely superseded (if so, this is an SequelizeMeta hygiene task — no schema risk, just delete the 4 stale rows from `SequelizeMeta` on every environment including this live DB). If NOT fully superseded, the missing schema pieces need to be captured in a new migration before this can be called reproducible. **This needs the business/engineering owner to confirm the "daily-task" → "daily-report" rename history** — recorded as DECISION REQUIRED since I cannot verify intent from the code alone. |
| Regression test | A CI check that fails if `db:migrate:status`'s applied-count ever exceeds the file count would catch this class of drift in the future. |

## 2. Schema-vs-code consistency (15 NEW models, different from the prior pass's 20)

Queried `information_schema.columns` directly for each table and diffed against the model's declared `rawAttributes` (including explicit `field:` mappings, not just attribute names) for: `AttendanceRecord`, `AuditLog`, `BackOfficeMonthlySummaryRun`, `CustomerResponse`, `DailyReportWarning`, `DeliveryChallanItem`, `LeaveRequest`, `LoginHistory`, `PaymentHold`, `Product`, `ProjectHandoverRequest`, `QuotationFollowUp`, `SalesTarget`, `SupportSlaPolicy`, `TmsTaskDeadlineExtension`.

**Result: 15/15 fully consistent — PASS.** Zero missing-in-DB or extra-in-DB columns found in any of the 15. Combined with the prior pass's structural sweep of all 87 and this session's earlier live fixes to the two real instances of this bug class (`daily_report_config.draft_auto_submit_time`, `users.sessionEpoch`, both now confirmed applied), there is no remaining evidence of this bug class anywhere currently checked (35 of 87 models now directly verified at the column level across the two passes).

## 3. N+1 / query performance (5 NEW list functions, different modules than the Performance Report)

| Module | Function | Result |
|---|---|---|
| Materials | `listFolderTree()`/`listRoleScopedFolders()` (`lib/materialFolderStore.ts`) | PASS — single batched `findAll`, mapped in memory |
| Support (partner view) | `listPartnerTickets()` (`lib/supportTicketStore.ts`) | PASS — single batched `findAll` with `include`, no per-row SLA lookup (passes `null` for SLA deliberately) |
| Support (internal queue) | `listInternalTickets()` (`lib/supportTicketStore.ts`) | **FAIL — Finding REL-DB-002, see below** |
| Sales Targets | `listSalesTargets()` (`lib/salesTargetStore.ts`) | PASS — single batched `findAll` with `include` |
| Customer Response | `customerResponseStore` (`lib/customerResponseStore.ts`) | PASS — built on the shared `createRecordStore` factory (`lib/recordStore.ts`), already verified clean this session for a sibling module (Negotiation); inherits the same guarantee structurally, not re-verified query-by-query |

**Finding REL-DB-002 — confirmed N+1 in the Support internal ticket queue.**

| Field | Value |
|---|---|
| Severity | Medium (performance, not correctness/security) |
| Affected | `lib/supportTicketStore.ts` `listInternalTickets()`, called by the internal Support queue views (`/support`, all queue filters: unassigned/mine/escalated/open/etc.) |
| Repro | Read the call chain directly: `listInternalTickets` → `Promise.all(rows.map(async r => ... await slaFor(plain)))` → `slaFor()` calls BOTH `policyFor(priority)` (a `SupportSlaPolicy.findOne()` query) AND `historyFor(ticketId)` (a `SupportTicketStatusHistory.findAll()` query) — **per ticket**, inside the map. |
| Expected | A list of N tickets should require a small, constant number of queries (1 for tickets + maybe 1-2 batched lookups), not one that scales with N. |
| Actual | For a queue of N tickets, this fires 1 (tickets) + N (SLA policy lookups) + N (status history lookups) = `2N + 1` queries. The SLA-policy lookup is especially wasteful since there are only a handful of distinct priority values (low/medium/high/critical) — the same policy row gets re-fetched from the DB redundantly for every ticket sharing a priority. |
| Evidence | Direct code read, `lib/supportTicketStore.ts` lines ~140-169 (`slaFor`/`historyFor`/`policyFor`) and ~371-377 (`listInternalTickets`'s per-row map). |
| Impact | A support queue with, say, 50 open tickets fires ~100 extra queries on every page load/refresh of that view. Not catastrophic at current data volumes (support ticket counts are typically far smaller than Leads' 1200+), but a genuine, real, fixable inefficiency that will worsen as the ticket volume grows — and it is the exact bug class (N+1 on a list view) that this session already fixed proactively in several other modules (Leads, Sales Projects) before it became a real problem. |
| Recommended correction | Batch both lookups outside the per-row loop: (a) fetch all distinct `SupportSlaPolicy` rows once (there are only ~4), build a `Map<priority, policy>`, and look up from the map per ticket instead of querying; (b) batch `historyFor` into one `SupportTicketStatusHistory.findAll({ where: { ticket_id: { [Op.in]: allTicketIds } } })` query, then group the results by `ticket_id` in memory — same "gather every id, one follow-up query" pattern already established and reused throughout this codebase (e.g. `lib/departmentStore.ts`'s `resolveManagerNames`). |
| Estimated complexity | Small — isolated to one function, no schema change, no API contract change (same return shape). |
| Regression test required | Yes — an assertion that `listInternalTickets` issues a bounded number of queries regardless of ticket count (or an integration test comparing query-count at N=5 vs N=50 tickets). |

## 4. Connection pool management — PASS, with a cross-reference note

`db/config/config.js` already configures `pool: { max: 10, min: 0, idle: 10000, acquire: 30000 }`, with an inline comment explaining the reasoning (the default `max: 5` was too tight for a single Node process serving pages with many concurrent API calls; the DB connection is via Supabase's PgBouncer pooler, which already holds far more concurrent connections than this app's own pool cap, so raising it modestly is safe). This is a deliberate, justified configuration, not an oversight.

**Cross-reference note** (not a new defect, a connective observation for the Performance report): the Dashboard's already-documented ~19 parallel queries (`QA_REPORTS/FULL_SYSTEM_QA/PERFORMANCE_REPORT.md`) would partially queue behind this 10-connection pool cap on a single Dashboard load, which is a plausible contributing factor to its measured ~4.1s load time beyond pure query cost — worth considering together with that report's own findings if the Dashboard is prioritized for a fix.

## 5. Backup and restore — FAIL. Finding REL-DB-003.

| Field | Value |
|---|---|
| Severity | High (release-readiness gap — not an active bug, but a real operational risk) |
| Affected | The entire repository — no scope narrower than "the whole database" |
| Repro | `find . -iname "*backup*"` (excluding node_modules): zero results. `scripts/` directory inspected directly: contains `restore-supabase-attachments.js` (file/attachment storage recovery only, not database schema/data), `migrate-files-to-s3.js`, `list-missing-bills.js`, `build.js`, `postbuild.js`, `generate-sop-library.ts` — no database backup or restore script anywhere. `README.md` and both files under `docs/` grepped for "backup"/"restore"/"disaster" — zero matches (one unrelated false-positive hit on the word "restore" inside "restoreSupabaseAttachments"-adjacent documentation text). |
| Expected | A production application should have either a documented backup/restore procedure in the repo, OR an explicit, documented statement that backups are handled entirely by the hosting platform (Supabase) with a reference to that platform's own backup policy/retention and a tested restore procedure. |
| Actual | Neither exists in this repository. The database is hosted on Supabase (confirmed via `db/config/config.js`'s own comments referencing the PgBouncer pooler), which DOES offer automated backups as a managed-Postgres platform feature — but this is a platform-level fact, not something verified or documented from within this codebase, and there is no evidence anyone has tested a restore. |
| Business/security impact | If the production database were lost or corrupted (accidental mass-delete, a bad migration, infrastructure failure), there is currently no in-repo guidance on how to recover, what the actual backup frequency/retention is, or whether a restore has ever been rehearsed. This is a genuine release-readiness gap for a live system handling real financial/HR/sales data. |
| Recommended correction | **DECISION REQUIRED** from the business/infrastructure owner: confirm what Supabase's actual backup plan/retention is for this project's tier, document it (even briefly) in this repo or an ops runbook, and ideally perform one test restore to a non-production environment to confirm the procedure actually works before relying on it. This is infrastructure-level work this audit cannot perform or verify from inside the codebase. |
| Estimated complexity | Low to document the existing platform behavior; Medium to actually rehearse a restore. |
| Regression test required | No — this is a documentation/operational gap, not a code defect. |

## 6. Orphan/duplicate record risk (3 NEW parent/child relationships checked — fewer than the planned 5, given time budget; honestly reported)

| Parent | Child | Delete path | Result |
|---|---|---|---|
| Quotation | `quotation_products`, `quotation_follow_ups` | `deleteQuotation()` (`lib/quotationStore.ts`) does a plain `.destroy()` — but `Quotation` is `paranoid: true`, so this is a soft-delete, not a real `DELETE`. The children's real DB-level FK (`quotation_id`, `onDelete: CASCADE`, confirmed in `db/migrations/20260804000000-initial-schema.js:314-321`) never actually triggers, since no hard delete occurs — children correctly continue referencing the still-existing (just hidden) parent. | PASS |
| TMS BOM Request | TMS Procurement (via `bom_request_id`) | `remove()` (`lib/tmsBomRequestStore.ts:339-346`) does a plain `.destroy()` with no explicit "is this BOM request linked to a procurement record" guard — UNLIKE TMS Project, which has a deliberate `isProjectInUse()` block. However, `TmsBomRequest` is also `paranoid: true`, and the FK is `onDelete: SET NULL` (confirmed in `db/migrations/20260820090000-tms-module.js:108`) — since no hard delete occurs in practice, this never triggers either. Not a bug, but a real **pattern inconsistency** worth noting: some modules (TMS Project) defend against this explicitly, others (BOM Request) rely implicitly on paranoid mode never actually hard-deleting. If `remove()` were ever changed to a hard delete without re-adding a guard, this would silently orphan-link procurement records to a nonexistent BOM request (mitigated only by `SET NULL`, which would just blank the link rather than error — a silent data-integrity softening, not a crash). | PASS (currently), flagged as a latent-risk pattern inconsistency, not a defect |
| Support Ticket | Comments, Status History | No `DELETE` handler exists anywhere for support tickets (`app/api/support/tickets/route.ts`, `app/api/support/tickets/[id]/route.ts` both grepped directly — zero `DELETE`/`destroy` references). Tickets can only be status-transitioned (closed/cancelled via the already-fixed `transitionTicket`), never deleted. | PASS — no delete path exists, so no orphan risk is possible by construction |

## Summary

| Check | Status | Notes |
|---|---|---|
| Migration reversibility | PASS | 133/133 have `down()` |
| Migration transaction-safety | DECISION REQUIRED | 109/133 multi-step migrations unwrapped — systemic, process-level, not an active bug; recommend wrapping future migrations |
| Migration-history drift | **FAIL — REL-DB-001** | 4 phantom migrations in `SequelizeMeta` with no file; needs owner confirmation of the daily-task→daily-report rename history |
| Schema-vs-code (15 new models) | PASS | 0/15 mismatches |
| N+1 queries (5 new functions) | **FAIL — REL-DB-002** | Support internal queue, `2N+1` queries instead of ~2-3 batched |
| Connection pool | PASS | Deliberately configured, documented reasoning |
| Backup/restore | **FAIL — REL-DB-003** | No in-repo tooling or documentation at all; DECISION REQUIRED from infra owner |
| Orphan risk (3 new pairs) | PASS (2 clean, 1 latent-pattern note) | All currently safe via paranoid mode; one module (BOM Request) relies on it implicitly rather than an explicit guard |

**3 new findings this pass** (REL-DB-001, REL-DB-002, REL-DB-003), plus 1 DECISION REQUIRED on migration transaction-wrapping as a process recommendation. Combined with the prior pass's 1 finding (users/quotations unique-index gap), the database layer now has **4 documented, unfixed findings** heading into the release-readiness decision — none of them Critical, two are genuine operational/reproducibility gaps (REL-DB-001, REL-DB-003) that deserve explicit sign-off rather than silent acceptance.

No code was changed in this pass. No migration was run. No destructive test was performed against real data. All verification was read-only (`information_schema.columns` queries, `db:migrate:status`, direct source reads).
