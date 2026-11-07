# Security Remediation Report — Phase B

Covers authentication, RBAC, authorization, and data-isolation findings reviewed this phase.

## Investigated and resolved

### OPSQA-DEF-004 — `/api/support/tickets` GET/POST permission asymmetry — FALSE POSITIVE

**The concern**: an earlier operational QA pass observed `GET /api/support/tickets` returning 401/403 for role `user` (Sales) while `POST` to the same route returned 400 — flagged as a possible missing auth check on `POST`.

**Investigation** (`app/api/support/tickets/route.ts`, `lib/supportTicketAccess.ts`, `lib/supportTicketStore.ts`):

1. Both `GET` and `POST` start identically: `getViewerContext(request)`, returning 401 if there's no valid session. **Unauthenticated access is rejected identically on both verbs** — confirmed, no gap there.
2. `GET` additionally requires `canWorkSupportQueue(viewer)` — true only for the manager tier (`superadmin`/`admin`/`technical-manager`) or the engineer tier (`engineer`/`technician`/`team-lead`). This is the queue-WORKER gate: "may this viewer work the support queues at all?"
3. `POST` has **no such gate**, by explicit, documented design. The route's own comment reads: *"Internal staff raising a ticket (a site engineer reporting a failure)."* `lib/supportTicketAccess.ts`'s `resolveSupportActor()` is even more explicit: *"Everyone else — Sales, Marketing, Accounts, HR — may RAISE a ticket and follow their own, but has no queue role."*
4. The 400 originally observed for role `user` is `createTicket()`'s ordinary field-validation path (`SupportTicketError`, e.g. `"A title is required"`, `"Describe the issue"`) — not a disguised authorization rejection. Confirmed by reading `lib/supportTicketStore.ts` lines 222+.
5. Checked object-level isolation separately: `createTicket()` scopes the new ticket to the viewer's own department/project inputs; it does not let a caller impersonate another user or write into another department's queue state. No cross-user data isolation gap found.

**Conclusion**: this is an intentional, two-tiered permission model — "who may WORK the queue" (GET: manager/engineer tiers) vs. "who may RAISE a ticket for themselves" (POST: any authenticated internal user) — not a security defect. **No code change made.**

## Re-verified as part of this phase's other fixes (not new findings, confirmed still correct)

- `app/api/admin/users/[id]/route.ts`'s `DELETE` still correctly requires superadmin-for-last-superadmin protection and ordinary admin authorization — the only change was adding a specific error message for the FK-constraint case (OPSQA-DEF-003), authorization logic itself untouched.
- `app/support/page.tsx`'s new server-side `canWorkSupportQueue()` pre-check (OPSQA-DEF-005) calls the exact same function the API enforces — it is a courtesy UI optimization, not a second, independently-maintained copy of the authorization rule that could drift from the API's own check over time.
- `proxy.ts`'s new `/api/health` exemption (REL-DEPLOY-004) was reviewed for exposure risk before adding: the route reveals only `{status, db, time}` — no business data, no internal paths, no stack traces on failure (its own `catch` returns a flat `{status:'error', db:'unreachable', time}`, nothing from the caught error object itself).

## No new security defects found this phase.

All findings reviewed resolved either as FIXED AND VERIFIED (real defects — see `BUG_FIX_REPORT.md`) or FALSE POSITIVE — EVIDENCE ATTACHED (this one). Nothing in this phase weakened any existing authentication, RBAC, or authorization check.
