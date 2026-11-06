# Integration & Activity Report — MatrixIQ

## Notifications / Email
MatrixIQ sends transactional emails via `lib/email/notifications.ts` (account-created, account-changed, password-changed, payment-done, status-change, etc.). Per this session's QA convention, **no real emails were sent during testing** — every fixture user was created directly via Sequelize, bypassing `createUser()` (the only path that triggers SES), so email delivery itself was not live-tested this session.

What WAS verified:
- **Correctness of trigger conditions**: the double-pay/double-notify races found and fixed (BUG-002, BUG-004, BUG-005, BUG-006, BUG-011) were specifically about preventing a notification from firing twice for one real event — confirmed fixed by reproducing each race and observing exactly one winning transition.
- **Content/recipient correctness**: not independently re-verified against real email templates this session (no real SES send occurred) — **NOT TESTED** for template rendering/recipient-list accuracy beyond what unit tests already cover.

## Activity Timelines / Audit Logs
- Project timeline events (`project_timeline_events`), TMS task update history (`TmsTaskUpdate`), Support ticket status history (`SupportTicketStatusHistory`), and the Admin Audit Log page were all confirmed to load and render real entries during today's testing.
- The race-condition fixes in this session specifically targeted cases where a lost race would have produced a **duplicate** history entry (e.g. BUG-012's task history, BUG-004's warning history) — fixed by reordering the history write to only happen after the guarded status update succeeds.

## Webhooks / External Integrations
- `app/api/admin/meta-integration` (Meta/Facebook lead ads integration) — page loads correctly; its webhook signature verification was reviewed during the app-wide attack pass and found to be a **timing-safe HMAC check, correctly hardened** (not re-tested with a live webhook payload this session).
- No WhatsApp integration code was found in the inventory sweep — if one is expected to exist, it was not located in this codebase as of today's audit.

## Scheduled Jobs
- `lib/dailyReportScheduler.ts` / `lib/dailyReportAutoSweep.ts` — daily report deadline/auto-submit logic exists and the relevant migration (`draft_auto_submit_time`) is now applied to the DB. The scheduler's actual cron-trigger execution was **NOT independently re-tested live** this session (would require waiting for or simulating a scheduled tick) — code-reviewed only.

## Known gaps in this area (explicitly flagged, not silently passed)
- Real email delivery (content, recipient, deliverability) — NOT TESTED (by design, to avoid sending real messages).
- Scheduled/cron job actual execution — NOT TESTED live.
- WhatsApp or SMS integrations — none found in the codebase; NOT APPLICABLE unless expected elsewhere.
