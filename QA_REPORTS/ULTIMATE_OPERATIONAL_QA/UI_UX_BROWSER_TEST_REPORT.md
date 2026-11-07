# UI/UX Browser Test Report — ULTIMATE_OPERATIONAL_QA

Method: Playwright, driving the real dev server (`localhost:3000`) through the actual login form and real page navigation (not API-only). Fixtures were disposable `QA_TEST_`-prefixed users created directly via Sequelize (`createQaUser`) and always hard-deleted (`force: true`) afterward — see Cleanup section. The test script itself was a temporary file (`tests/e2e/zzqa_ultimate.spec.ts`) deleted at the end of this session; it is not part of the committed suite.

Scope: pages NOT already covered by the committed `tests/e2e/*.spec.ts` suite (which already covers login/session/RBAC/Leads/Projects/TMS/HR/navigation). Does not repeat the earlier `FRONTEND_ACCESSIBILITY_REPORT.md` work (4 forms already covered there).

Roles used: 3 disposable fixtures across 3 different roles — `user` (Sales), `admin`, `accounts`.

## Pages tested (7 new pages)

### 1. `/support` — role: Sales (`user`)
- Load status: 200, page rendered.
- Console/network errors: **2× 403 Forbidden** on `GET /api/support/tickets?queue=open`.
- Behavior: the page itself handles this gracefully — it shows "You do not have access to the support module" instead of crashing, and the ticket counters sit at 0 rather than showing stale/wrong data. This looks like **correct, intentional** RBAC (Sales shouldn't see the support queue), not a bug — but it is worth a reviewer's eye since it still fires two failed network requests on every load for a role that will never have access, rather than skipping the fetch client-side. **Minor / cosmetic**, not a functional defect.
- Interactive control: looked for a "New Ticket"/"Create" button — **NOT FOUND** in the DOM for this role (consistent with the access-denied state above).
- Separately verified (via the real ticket-creation API used by this page's underlying form) that submitting a ticket as Sales **does** succeed (201) even though the queue view is blocked for this role — i.e., "raise a ticket" and "see the queue" are correctly separated permissions.
- Screenshot: `support.png` (scratch dir, not retained).

### 2. `/travel-schedule` — role: Sales (`user`)
- Load status: 200, clean load, zero console/network errors.
- Data: correct empty state — "No travel requests yet." with the full column header row rendered (Code/Dates/Origin/Destination/Purpose/Status/Requested By/Companions/Tickets).
- Interactive control: a filter/date control was present but clicking it had no observable effect in this short pass — **not conclusively tested**, marking as **NOT FULLY TESTED** (the fixture has no travel data to filter, so a positive-result click test wasn't possible without seeding real-looking records, which was out of scope to avoid creating noise).
- Screenshot: `travel-schedule.png`.

### 3. `/site-visits` — role: Sales (`user`)
- Load status: 200, clean load, zero console/network errors.
- Data: real multi-step "Register new visit" wizard renders (Client Information → Visit Information → Products Interested…).
- Interactive control: clicked the first tab/button — it responded (step navigation present). Confirmed working.
- Screenshot: `site-visits.png`.

### 4. `/demo-schedule` — role: Sales (`user`)
- Load status: 200, clean load, zero console/network errors.
- Data: real "Request a demo" form renders with Project/Quotation pickers.
- Interactive control: clicked the first tab/button — responded. Confirmed working.
- Screenshot: `demo-schedule.png`.

### 5. `/admin/task-assignment` — role: Admin
- Load status: 200, clean load, zero console/network errors.
- Data: real Task Planner dashboard rendered with live counts (10 Total Tasks, 1 Not Started, 2 In Progress, 7 Under Review, 0 Completed, 0 Overdue) — confirmed this is real existing data, not a placeholder/empty state.
- Interactive control (API-level, same action the page's own form performs): submitted a real task assignment (title/department/deadline/priority/assignee) — got **201** with a fully-formed task record back. Confirmed working end-to-end, see notification report for the resulting notification check.
- Screenshot: `admin-task-assignment.png`.

### 6. `/accounts/payments` — role: Accounts
- Load status: 200, clean load, zero console/network errors.
- Data: correct empty state (dashes for Pending/Due Today/Overdue/Paid This Month) with the Payment Queue / Payment History / Reimbursement Report tabs and source filters (All Sources / Reimbursement / Admin Expense / …) all rendered.
- Interactive control: clicked the first tab — responded, no errors.
- Screenshot: `accounts-payments.png`.

### 7. Lead capture + handover flow — role: Sales (`user`, two fixtures)
- Not a separate "page" visit per se (lead creation UI itself is already covered by the existing suite), but included here because it was the vehicle for notification verification #2 (see notification report). Creating a lead with a `handoverToId` set in the same request returned `201` with `handover: { status: 'handed_over', toName: '...' }` in the response — confirmed the handover actually completed, not just accepted.

## Defects / findings worth flagging

1. **No functional defects found** in the 6 new pages' happy-path load/render/empty-state behavior across 3 roles.
2. **`general_tasks.assignee_id` has no `ON DELETE SET NULL/CASCADE`.** Attempting to hard-delete a `User` who has an assigned `general_tasks` row throws `SequelizeForeignKeyConstraintError: general_tasks_assignee_id_fkey`, not a clean application-level error. This was discovered purely as a side effect of this QA session's own fixture cleanup (deleting a disposable employee fixture after assigning them a test task) — it will affect any real attempt to delete a user who currently has any task assigned to them (including an admin trying to deactivate/delete an account via the Users screen, if that screen ever does a hard delete rather than a soft one). Worth checking whether the real user-delete path already avoids this (e.g. by reassigning/soft-deleting tasks first) — **flagging for review, not fixed**, per this task's no-source-changes rule.
3. **`/support`** fires two 403-returning requests on every load for a role with no support access, rather than gating the fetch client-side on a known-forbidden role. Cosmetic only — the user-visible behavior is correct.

## NOT TESTED (explicitly, rather than guessed)

- BOM/procurement pages, Purchase Orders (`/po`), Marketing Requests, Partner portal pages — not reached in this pass; time was spent going deep (full page load + control + notification verification) on 7 pages across 3 roles rather than wide across all candidates. These remain open for a follow-up pass.
- `/travel-schedule` filter control's actual filtering effect — click registered but no data existed to observe a before/after difference; marked NOT FULLY TESTED rather than assumed working.
- Admin config screens beyond `/admin/task-assignment` (e.g. `/admin/settings`, `/admin/product-catalog`, `/admin/meta-integration`) — not visited this pass.

## Cleanup performed
All disposable `QA_TEST_` fixtures (7 across the 4 test runs) were hard-deleted. The one ULTQA support ticket, one ULTQA lead, and one ULTQA general_task created during testing were all hard-deleted. Two stray `Notification` rows left on the **real** department-manager accounts `naresh.pawar` (support ticket assignee notification) and `manoj` (Sales dept-manager task-assignment notifications, 3 rows across repeated test runs due to the FK issue above forcing re-runs) were identified and deleted by exact row id — these were unavoidable side effects of the app's own notification-fan-out logic (department managers are notified of every task/ticket in their department, including test ones) and were cleaned up immediately once discovered, per the "QA never touches real people" rule. No real person's notification *badge count has anything attributable to this session now. Screenshots and the temporary spec file have been deleted.
