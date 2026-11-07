# Notification Integration Report — ULTIMATE_OPERATIONAL_QA

Method: triggered each action through the real route the UI itself calls (not a mocked/stubbed path), then queried the `notifications` table directly via Sequelize (`db.Notification.findOne`) to confirm a row actually exists for the correct recipient with the correct content — not just that the triggering API call returned 2xx.

All three actions used disposable `QA_TEST_`-prefixed fixtures as both actor and intended recipient. All fixture rows and their test data (lead, ticket, task) were hard-deleted afterward. Two stray notification rows that landed on real department-manager accounts (`naresh.pawar`, `manoj`) as an unavoidable side effect of the app's own "notify the department manager too" fan-out logic were found and deleted by exact id — see the UI/UX report's Cleanup section for detail.

## 1. Lead handover notification

- **Action**: `POST /api/leads` with `handoverToId` set to a second Sales fixture (`app/api/leads/route.ts` — the handover happens inline in lead creation, calling `handOverCapturedLead` from `lib/leadHandover.ts`).
- **Expected recipient**: the fixture passed as `handoverToId`.
- **API response**: `201`, record included `"handover": { "status": "handed_over", "toName": "ULTQA QA_TEST_e2e_user_..._2" }` — handover actually completed, not just accepted.
- **DB verification**: `Notification` row found for the recipient's user id.
  - `type`: `lead_handover` ✓ (matches `lib/leadHandover.ts`)
  - `title`: `"Lead handed over to you"` ✓
  - `body`: `"ULTQA QA_TEST_e2e_user_..._1 captured ULTQA Lead (ULTQA Co) and passed it to you."` ✓ — correctly includes the actor's name, the lead's name, and company.
- **Result: CORRECT.** Recipient, content, and entity linkage all verified.

## 2. Support ticket assignment notification

- **Action**: `POST /api/support/tickets` (same endpoint the real "Raise Ticket" form on `/support` uses) as a Sales fixture, with a real department id (department picked from the live `departments` table, not fabricated).
- **Expected recipient**: `notifySupportAssignee` (`lib/supportTicketNotify.ts`) notifies `result.assignedToUserId` — the department's real manager, since this QA session used a real department to get a realistic routing path.
- **API response**: `201`, `{ ticket_number: "TKT-2026-0001", assignedToUserId: "dad4885d-..." }`.
- **DB verification**: `Notification` row found for `assignedToUserId`, which resolved to the real account `naresh.pawar`.
  - `type`: `support_ticket_created` ✓
  - `title`: `"Support ticket assigned to you"` ✓
  - `body`: `"TKT-2026-0001: ULTQA test ticket — assign an engineer"` ✓ — correct ticket number and title.
- **Result: CORRECT.** Recipient, content, and entity linkage all verified.
- **Note**: because the real department's manager was the notification target (there is no way to create a ticket against a disposable fake department — ticket creation requires an existing department id), this one *did* land a real notification on `naresh.pawar`. That row was deleted immediately after verification, by its exact id. No other effect on that account.

## 3. Task assignment notification

- **Action**: `POST /api/admin/task-assignment` (same endpoint `/admin/task-assignment`'s form uses) as an Admin fixture, assigning a task to a second Sales fixture in the real "Sales" department. (Note: `employeeBelongsToDepartment` checks the `User.departmentId` foreign key, not the plain `department` string field the QA fixture helper sets by default — the fixture's `departmentId` had to be set directly via `User.update` to exercise the real assignment path; this is a fixture-helper gap, not an app defect, and is worth fixing in `tests/e2e/helpers/fixtures.ts` in a future pass so `createQaUser({ department })` also sets the FK.)
- **Expected recipients**: the assignee, **and** the department's manager(s) (`app/api/admin/task-assignment/route.ts` lines ~165-180 — both get `notifyUsers`).
- **API response**: `201`, full task record returned with `assignee_id`/`reviewer_id` set.
- **DB verification**: `Notification` row found for the assignee fixture.
  - `type`: `general_task_assigned` ✓
  - `title`: `"New Task Assigned"` ✓
  - `body`: `"\"ULTQA notification test task\"\nDepartment: Sales\nAssigned By: ULTQA QA_TEST_e2e_admin_..._1\nPriority: medium\nDeadline: 2026-11-08"` ✓ — title, department, assigner, priority, and deadline all correct.
- **Result: CORRECT** for the assignee.
- **Side effect confirmed and cleaned up**: as documented in the route, the real Sales department manager (`manoj`) also received a matching notification for each test run (this is correct, intended app behavior — managers are meant to see every task assigned in their department). Three such rows accumulated across repeated test runs (caused by retrying after the FK-constraint cleanup failure described in the UI/UX report) and were deleted by exact id once identified.

## Summary

| # | Action | Recipient | Found in DB | Content correct |
|---|--------|-----------|--------------|------------------|
| 1 | Lead handover | 2nd Sales fixture | Yes | Yes |
| 2 | Support ticket creation | Dept manager (real: naresh.pawar) | Yes | Yes |
| 3 | Task assignment | 2nd Sales fixture (assignee) | Yes | Yes |

**3/3 notification-generating actions verified correct** — right recipient, right type, right title/body content, in all three cases. No notification defects found.

## Incidental finding (not a notification bug, flagged for awareness)

While testing #3, deleting the assignee fixture failed on the first attempt with `SequelizeForeignKeyConstraintError: general_tasks_assignee_id_fkey` — the `general_tasks.assignee_id` FK has no `ON DELETE SET NULL/CASCADE`. This forced deleting the `general_tasks` row before the user could be deleted. See the UI/UX report's "Defects / findings" section #2 for detail; not fixed here per this task's rules.
