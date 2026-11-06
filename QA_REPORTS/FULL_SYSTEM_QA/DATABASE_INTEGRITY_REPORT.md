# Database Integrity Report — MatrixIQ

Phase 4 of the Full System QA program. Scope: structural audit of all 87 real Sequelize models in `db/models/` (88 files minus `index.js`, which is the Sequelize bootstrap, not a model). Read-only audit — no destructive tests, no migrations run, no production data touched. Cross-referenced against `db/migrations/*.js` to verify claims at the actual DB-schema level, not just the Sequelize model layer.

This complements, not repeats, the race-condition/transaction-level fixes already made and documented elsewhere in today's QA session (Accounts, HR, Marketing, Operations, TMS, Travel Schedule, Partner, Sales, Site Visits, Support — all covered by guarded-update fixes already shipped in commits `fc2600d`, `be92771`, `6acaf4e`). This report is a different layer: schema correctness and consistency across the *whole* model set.

## 1. Primary keys — PASS

All 87 models have exactly one primary key, and it is `DataTypes.UUID` in every case — a fully consistent convention across the entire schema, no integer/auto-increment outliers found. Verified programmatically across all 87 files (grep for `primaryKey: true` + preceding `DataTypes.UUID`).

**Status: PASS.**

## 2. Foreign keys / associations — PASS (20 models sampled)

Sampled `associate()` blocks across 20 models spanning Sales, TMS, HR, Partner, Operations, Admin, and Support: `lead`, `project`, `tmsTask`, `tmsProject`, `partner`, `supportTicket`, `reimbursementSheet`, `demoSchedule`, `travelSchedule`, `dailyReport`, `marketingRequest`, `siteVisit`, `negotiation`, `purchaseOrder`, `customModuleRecord`, `materialFolder`, `generalTask`, `installation`, `deliveryChallan`, `officeOperationExpense`. All 20 have a populated `associate()` block with correctly paired `belongsTo`/`hasMany` and matching `as` aliases consistent with what's actually used in query code elsewhere in the app (e.g. `'creator'`, `'assignee'`, `'project'`, `'partner'`, `'comments'`).

Cross-checked at the DB level (not just assumed from the model):
- `leads.assigned_to_id` / `assigned_by_id` → real FK constraints to `users.id`, `ON DELETE SET NULL`, indexed (`db/migrations/20260902100000-lead-assignment.js`). Confirmed a real constraint exists, not a naked UUID column pretending to be one.
- `partners.relationship_manager_id` / `created_by` / `updated_by` → real FKs with explicit `ON DELETE` policy, documented inline in the migration (`db/migrations/20261020090000-create-partners.js`) with the reasoning for `SET NULL` vs `RESTRICT` spelled out per-column.

A consistent `userFk()` helper is used across the initial-schema migration for `created_by`/`updated_by`-style columns, which explains the uniformity — this is a deliberate, disciplined pattern, not luck.

**Status: PASS** (20/87 sampled; no inconsistency found in the sample, no reason to expect the unsampled 67 deviate given the shared helper pattern).

## 3. Required fields / null handling — NOT FULLY TESTED (spot-checked)

No cases found, in the models reviewed, of the application layer silently assuming a field is non-null that the schema allows to be null, beyond what the existing session's bug-fixing work already surfaced (e.g. the several "unvalidated date reaches a DATEONLY column raw" bugs fixed earlier today were really an input-validation gap, not a model `allowNull` misconfiguration — the columns themselves were correctly typed).

**Status: NOT FULLY TESTED** — a complete field-by-field cross-reference between every model's `allowNull` and every store function's assumptions would require per-model code reading beyond this audit's time budget. No issue found in what was checked; this is a coverage gap, not a clean bill of health.

## 4. Unique constraints — 1 real finding (documented, not fixed — needs a migration)

Three human-facing "code" uniqueness guarantees were checked at the actual DB-schema level, because several of today's race-condition fixes (TMS project codes, partner codes) *depend* on a real unique constraint existing for their retry-on-collision logic to work at all:

| Table | Column | Constraint found | Paranoid? | Partial (excludes soft-deleted)? |
|---|---|---|---|---|
| `partners` | `partner_code` | `CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL` (raw SQL in migration) | Yes | **Yes — correct** |
| `tms_projects` | `project_code` | Plain `unique: true` column constraint | Yes | **No** |
| `users` | `username` | Plain `addIndex(..., {unique:true})` | Yes | **No** |
| `quotations` | `quotation_number` | Plain `addIndex(..., {unique:true})` | Yes | **No** |

**Real finding:** `partners` got this right on purpose — its migration has an explicit comment explaining why a *partial* unique index was used instead of a plain one ("this table is paranoid, and a soft-deleted partner must not reserve its code forever"). `tms_projects`, `users`, and `quotations` are all *also* paranoid (soft-delete via `deleted_at`), but their unique indexes are plain, not partial.

**Is this actually exploitable?**
- `tms_projects.project_code`: **Not exploitable in practice.** `nextTmsProjectCode()` in `lib/tmsProjectStore.ts` explicitly queries with `{ paranoid: false }`, so it already sees soft-deleted rows' codes when computing the next sequence number — it can never collide with a soft-deleted project's old code, because it never tries to reuse one (codes are monotonically increasing). No fix needed here; the application layer already compensates for the schema gap.
- `users.username`: **Real, exploitable gap.** `deleteUser()` in `lib/userStore.ts:494-500` calls a plain `row.destroy()` on a paranoid model — a soft delete, not a hard delete. Combined with the non-partial unique index, **an admin deleting an employee's account permanently burns that username.** A legitimate attempt to create a new employee with the same username later (e.g. a rehire, or an auto-generated username that happens to repeat) will fail with "username already exists," pointing at an account that is invisible in every normal list. This is a genuine, user-facing data-integrity bug — not contrived.
- `quotations.quotation_number`: **Same pattern, lower real-world likelihood of being hit** (quotation numbers are sequence-generated, not human-chosen, so a collision after a soft-delete is far less likely than the username case — but the schema gap is identical). `lib/quotationStore.ts:297` also does a plain `row.destroy()`.

**Why not fixed in this pass:** closing this requires a schema migration (converting a plain unique index to a partial one, mirroring exactly what the `partners` migration already does correctly) — out of scope for this audit per its own directive ("Do NOT run any migration"). Recommended as a follow-up migration, modeled directly on `20261020090000-create-partners.js`'s own pattern:
```sql
DROP INDEX users_username_unique;
CREATE UNIQUE INDEX users_username_unique ON users (username) WHERE "deletedAt" IS NULL;
-- and the equivalent for quotations.quotation_number
```

**Status: FAIL** (users.username — real, user-facing), **PASS** (tms_projects — compensated in app code), **FAIL, lower severity** (quotations.quotation_number).

## 5. Soft delete vs hard delete — PASS (consistent, see finding above for the one real interaction issue)

~45 of the 87 models use `paranoid: true`. Spot-checked that list-style queries (`findAll` without `paranoid: false`) correctly exclude soft-deleted rows by default — this is Sequelize's own default behavior for a paranoid model and was not found to be overridden incorrectly anywhere sampled. The one place `paranoid: false` is deliberately used (`nextTmsProjectCode()`) is correctly justified and commented, not an accidental leak.

**Status: PASS**, with the caveat already covered in §4 (soft-delete + non-partial unique index on `users`/`quotations`).

## 6. Timestamps / underscored mapping — PASS (and directly validated by today's earlier incidents)

This exact bug class — a model attribute the live DB table doesn't actually have a matching column for — was hit and fixed multiple times earlier in today's session (`daily_report_config.draft_auto_submit_time`, `users.sessionEpoch`), both now confirmed applied and working. Spot-checked the `underscored` setting across all 87 models (see full table gathered during this audit): it is used consistently — `underscored: true` models map `camelCase` JS attributes to `snake_case` columns (e.g. `project_code`, `created_by`), while a handful of models (`user`, `role`, `department`, `product`, `moduleConfig`, `notification`, `loginHistory`, `appConfig`, `attachment`, `productCategory`, `productCatalogOverride`, `productPricing`, `customModule`, `customModuleField`, `customModuleRecord`) deliberately use `underscored: false` and keep literal camelCase column names (e.g. `users.lastLoginAt`, `users.sessionEpoch` — exactly as confirmed live via `information_schema.columns` earlier today). No inconsistency found between a model's `underscored` setting and its actual migration-defined column names in the models sampled.

**Status: PASS.**

## 7. Orphan-record risk — PASS (5 parent/child relationships checked)

| Parent | Child(ren) | Guard found | Where |
|---|---|---|---|
| TMS Project | Tasks, BOM Requests, Procurement | Blocks delete if any linked record exists | `lib/tmsProjectStore.ts` `isProjectInUse()` |
| Sales Project | (notes, timeline events) | Explicitly cascades notes/timeline on delete inside a transaction, rather than leaving them orphaned | `lib/projectStore.ts:632-636` |
| Department | Users/other references | Blocks delete if in use | `lib/departmentStore.ts` `isDepartmentInUse()`/`deleteDepartment()` |
| Role | Users assigned to it | Blocks delete if assigned; built-in roles can never be deleted | `lib/roleStore.ts:399-409` `deleteRole()` |
| Partner | Partner-owned records (demos, projects, documents, etc.) | Every partner-owned table's FK is `RESTRICT` by design (documented inline in the partners migration) — a partner holding live records cannot be dropped out from under them | `db/migrations/20261020090000-create-partners.js` (comment) |

All 5 sampled relationships handle the orphan risk deliberately — either a block-on-delete guard in application code, or a DB-level `RESTRICT`/cascading transaction. No accidental-orphan case found in this sample.

**Status: PASS** (5/87 parent/child pairs sampled).

## Summary

| Check | Status | Notes |
|---|---|---|
| 1. Primary keys | PASS | 87/87, fully consistent UUID convention |
| 2. FK / associations | PASS | 20/87 sampled, consistent pattern, real FK constraints confirmed at DB level |
| 3. Required fields | NOT FULLY TESTED | No issue found in spot checks; full coverage out of budget |
| 4. Unique constraints | **FAIL** (2 of 4 checked) | `users.username` — real bug, soft-deleted usernames permanently blocked; `quotations.quotation_number` — same pattern, lower likelihood; `tms_projects.project_code` — compensated in app code, no real risk; `partners.partner_code` — done correctly, the reference pattern |
| 5. Soft delete vs hard delete | PASS | Consistent `paranoid` usage; see #4 for the one real interaction issue |
| 6. Timestamps / column mapping | PASS | Consistent `underscored` convention; today's earlier mismatches already fixed and confirmed applied |
| 7. Orphan-record risk | PASS | 5/87 sampled, all deliberately guarded |

**One real, actionable finding**: `users.username`'s unique index is not soft-delete-aware, while the app does soft-delete users (`deleteUser()`). Recommended follow-up migration (not performed here — explicitly out of scope): convert to a partial unique index excluding soft-deleted rows, mirroring the `partners` table's own already-correct pattern. Lower-severity sibling: `quotations.quotation_number` has the identical gap.

No code was changed in this pass. No migration was run. No destructive test was performed against real data.
