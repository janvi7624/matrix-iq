# Database / API Data Integrity — Fresh Verification Pass

Scope: live authenticated POST/PATCH calls against the running `next dev` server (localhost:3000) and the real Postgres database, using disposable `QA_TEST_` fixture users created and hard-deleted directly via Sequelize (never `createUser()`, so no real SES mail was sent). All test rows were deleted immediately after each verification. No real business data was read, modified, or deleted.

This pass does **not** re-report `REL-DB-002` (the support-tickets N+1 already documented in `QA_REPORTS/FINAL_RELEASE_CERTIFICATION/DATABASE_RELEASE_AUDIT.md`) — it is referenced here only for context: that finding stands as-is.

Note: while this pass ran, at least one other concurrent QA session/suite was also writing `QA_TEST_cross_*` / `QA_TEST_e2e_*` fixture users and a `QA_TEST Cross Task` row to the same live database (visible via a `SELECT ... WHERE username LIKE 'QA_TEST%'` sweep). Per the project's own convention, those were left untouched — only rows this session created were inspected or deleted.

## 1. New finding — BOM request FK attribution can be silently NULL for ~1-2s after login (real defect)

**Severity: Medium**

`POST /api/tms/bom-requests` returned HTTP 201 with an apparently successful create immediately after a fresh login, but the inserted row had `requested_by_id = NULL` and `created_by = NULL` — i.e. the API claimed success and the DB write happened, but the attribution linking the request to the user who made it was lost.

Root cause, traced through the code:
- `app/api/tms/bom-requests/route.ts`'s `POST` calls `getTmsViewer(request)` (`lib/tmsAccess.ts`), which does `const user = await findUserByUsername(viewer.username)` and sets `userId: user?.id ?? ''`.
- The route then writes `requested_by_id: viewer.userId` into the record, and `lib/tmsBomRequestStore.ts`'s `create()` separately re-resolves `created_by` via `db.User.findOne({ where: { username: record.created_by } })`.
- Immediately after a user's first login, calling this route produced `viewer.userId === ''` (so `requested_by_id` landed as `NULL` via the field's `toAttr(..., 'nullable')` handling), **and** the second, separate `created_by` lookup also returned no match — both resolving to `NULL`.
- Retrying the identical request ~2 seconds after login resolved correctly every time (`requested_by_id` and `created_by` both populated with the real user id).

This was reproduced deterministically: without a delay after login, the very first authenticated write against this route nulled both attribution fields; with a 2-second delay, it never did, across every repeat run. The authorization/permission gate (`requireTmsAction`) itself was never fooled — the request correctly returned 201 either way, and a superadmin's admin-tier checks don't depend on `userId` — but any check or report that depends on `requested_by_id`/`created_by` (ownership-scoped `list()` in the same file, the Technical Manager's "pending with me" approvals, audit trails) would show this request as having no requester for calls made in that narrow window.

**Who is actually affected:** not every first API call after login — only routes that independently re-resolve the user's id/username inside the request (as `getTmsViewer` and `tmsBomRequestStore.create()`'s separate `db.User.findOne` do) are exposed to this race; a route that simply trusts the session payload's own fields would not be. Given this class of lookup pattern appears in several TMS stores (bom-requests, tasks resolve `assignee`/`created_by` similarly), the same symptom is plausible wherever a newly-created or freshly-logged-in user's very first write happens within ~1-2 seconds of their session being issued — e.g. a scripted bulk-onboarding flow that creates a user, logs them in, and immediately has them act on behalf of the system. Normal human logins (type username, type password, click submit) are unlikely to hit this window, which is likely why it has not surfaced before.

**Recommendation:** investigate why `findUserByUsername`/`db.User.findOne` momentarily fail to find a row that unquestionably exists and was just used to authenticate the same request's own session (possibly a pooled-connection read-replica lag, or the dev server's Sequelize connection pool handing the request a stale/different connection immediately post-login). At minimum, `tmsBomRequestStore.create()` (and any sibling store doing the same two-step username→id lookup) should treat "creator not found" as an error worth logging/rejecting rather than silently writing `NULL` into an FK the rest of the system treats as always-present.

## 2. Transactional consistency — 3 checked actions

| Action | Multi-step? | Observed consistency |
|---|---|---|
| `POST /api/tms/bom-requests/[id]/approve` | Yes — status transition (`submitted`→`approved`) + reviewer attribution (`reviewed_by_id`, `reviewed_at`) | Both sides landed together in the same read-back; no partial state observed (status updated without reviewer, or vice versa) across repeated runs. |
| `POST /api/tms/bom-requests` (create, `submit:true`) | Yes — row insert + `nextTmsBomRequestCode()` sequence advance + (per code) a department-manager notification fire | Row and its generated `bom_request_code` (`BOM-00NN`) were always both present together; not independently re-verified whether the notification send is wrapped in the same DB transaction as the insert (it is explicitly fire-and-forget per the route's own comments), so a notification failure would not roll back the BOM request — this is a known/accepted async pattern in this codebase, not flagged as a defect here. |
| `PATCH /api/notifications` (mark read) | No multi-step side effect — single-row `isRead` flip scoped to the caller's own `userId`. Noted explicitly as the one single-step case out of the three checked, per the task's "where no multi-step action exists, note that" instruction. | N/A — consistent single-row write confirmed. |

No torn/partial writes were observed in any of the three. This is a narrow sample (one approve action, one create action, one simple flag flip); it does not clear every multi-step TMS/BOM/reimbursement flow (e.g. finance-approve → payment-mark → received chain, or reimbursement sheet manager/HR decide chain) for transactional safety — those remain unverified by this pass.

## 3. N+1 / excessive-query spot-check — 3 list endpoints (beyond REL-DB-002's support tickets)

The live dev server's SQL query logging (Sequelize's default `logging` to console, confirmed on by inspecting `lib/db.ts`/`db/config/config.js`) was available, but a usable way to attribute individual logged statements to one specific HTTP request in a shared, concurrently-used dev server (another QA session was actively hitting the same server throughout this run — see note above) was not reliably available without enabling `pg_stat_statements` (not installed/available on this database) or restarting the server in isolation, which this task's "don't touch config" constraint rules out. Given that, this check was done by reading the actual store code backing each endpoint, which is a direct, reliable proxy for query-count behavior (eager `include` → one JOIN query; a loop issuing a query per row → N+1), rather than by eyeballing a shared log stream:

- **`GET /api/leads` → `lib/leadStore.ts`'s `listLeads()`**: single `db.Lead.findAll({ include: LEAD_INCLUDES(), ... })` — one query with joins, independent of row count (currently 1,282 leads in this database). No N+1.
- **`GET /api/tms/bom-requests` → `lib/tmsBomRequestStore.ts`'s `list()`/`readAll()`**: single `db.TmsBomRequest.findAll({ include: ALL_INCLUDES, ... })` (currently 19 rows, plus this session's disposable test rows). No N+1.
- **`GET /api/tms/tasks` → `lib/tmsTaskStore.ts`'s `list()`**: single `db.TmsTask.findAll({ include: ALL_INCLUDES, ... })` (currently 72 rows). No N+1.
- Also spot-checked `GET /api/projects` → `lib/projectStore.ts`'s `list()`/`listLight()`: same pattern, single `findAll({ include, ... })` (currently 251 rows). No N+1.

None of these four show the per-row-query pattern that makes `REL-DB-002` a real problem. This is a **negative finding** (nothing new to report) for these four, not a confirmation that the whole codebase is clean — only these specific list routes were checked.

## 4. Orphaned records / FK check after fixture cleanup

After deleting every row and user this session created (8 API test iterations: 1 lead, 1 PATCH-only lead, 1 TMS task, 1 TMS BOM request + its approve transition, 1 reimbursement, 1 support ticket, 1 synthetic notification row, and the superadmin fixture users themselves), a sweep of each touched table for any surviving `QA_TEST_%`-named row from this session found zero. The one remaining `QA_TEST%` row observed (`tms_tasks` — "QA_TEST Cross Task") and 27 remaining `QA_TEST_cross_*`/`QA_TEST_e2e_*` users belong to the other concurrently-running QA session's fixtures (see note above) and were correctly left in place.

No orphaned rows, broken FKs, or leftover sessions from this pass's own test records were found.

## Summary

- 8/8 state-changing API routes tested: HTTP response and direct DB state agreed in all 8 (after isolating and documenting the timing defect above, which was itself caught precisely because the first attempt disagreed).
- 1 new, reproducible defect found and documented: **Medium severity** — BOM request creator/requester FK attribution can land as `NULL` for writes made very soon (<~2s) after login, despite the API returning success.
- 3/3 transactional-behavior checks: consistent, no partial writes observed, with the caveat that the sample only covers one approve action, one create action, and one single-step flag flip — broader multi-stage chains remain unverified.
- 4 list endpoints statically spot-checked for N+1 (leads, TMS BOM requests, TMS tasks, projects): all use eager-loaded single-query `findAll({ include })`, no new N+1 found, distinct from the already-documented `REL-DB-002`.
- No orphaned records or leftover fixtures from this session's own testing.
