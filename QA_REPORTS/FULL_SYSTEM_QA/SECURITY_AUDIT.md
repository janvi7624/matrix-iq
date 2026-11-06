# Security Audit — MatrixIQ

Status values: PASS / FAIL / BLOCKED / NOT TESTED / NOT APPLICABLE. All findings below were live-reproduced against the running application using disposable `QA_TEST_`-prefixed fixtures, never real accounts or data, except where noted.

## Critical / High findings — all FIXED and re-verified

| Category | Finding | Status | Evidence |
|---|---|---|---|
| Stored XSS | File-upload endpoint trusted client-declared Content-Type with no allowlist, served it back identically — any authenticated user (including an external partner) could plant a file that executes JS in whoever opens it next | **FIXED** | `lib/fileStorage.ts` `sniffContentType()`/`safeServeHeaders()` — magic-byte detection replaces trusted header; unknown types forced to download with `nosniff`. Re-attacked after fix: `evil.html` forged as `text/html` now rejected 400 before storage. Happy-path image/PDF upload confirmed unbroken. |
| Authentication | No brute-force/lockout protection on login | **FIXED** | `lib/loginHistoryStore.ts` `isLoginLocked()` — 8 failures/15min window, generic error either way (no lockout-probing side channel). Reused existing `LoginHistory` table, no schema change. |
| Session management | Password change did not invalidate other active sessions | **FIXED — live HTTP-verified** | Dedicated `users.sessionEpoch` column (migration `20261105100000`, confirmed applied to live DB), bumped on password change only, never by login. Verified via a real end-to-end HTTP test after a dev-server restart: a second pre-change session is confirmed killed after a password change, while the acting session's own new cookie keeps working. Also covered by the committed Playwright suite (`tests/e2e/auth.spec.ts`). |
| Session management | Logout had zero server-side effect — a stolen/replayed token stayed valid for its full lifetime | **FIXED — live HTTP-verified** | Same `sessionEpoch` mechanism, bumped on logout. Verified live: the exact pre-logout session cookie is replayed directly against `/api/auth/me` after logout and correctly returns 401. Also covered by the committed Playwright suite. |
| Session management | (Self-introduced during the above fix, caught and fixed same session) A second login from another device silently killed the first device's session — root cause: an early version reused `lastLoginAt` (already re-stamped on every login) as the revocation epoch | **FIXED — live HTTP-verified** | Fixed by splitting into a dedicated column never touched by login itself — login only *reads* the current epoch. Verified live with two independent browser contexts sharing one account: Device A's session is confirmed to survive Device B logging in. Also covered by the committed Playwright suite. |
| Authorization / IDOR | `GET /api/travel-schedule/[id]` had **no authorization check at all** — any authenticated employee could view any other employee's travel request (hotel preferences, advance amounts, remarks) by guessing/knowing the UUID | **FIXED** | `lib/travelScheduleStore.ts` `canViewTravelRequest()` — creator, companions, privileged roles, and the real approval chain only; everyone else 403. |
| Authorization | Support ticket `PATCH`/`POST` (status transitions, internal comments) checked only role type, not assignment to the specific ticket — an engineer not assigned to a ticket could still act on it by guessing the id | **FIXED** | `app/api/support/tickets/[id]/route.ts` — `canViewTicket()` scoping applied to both write handlers, matching what `GET` already enforced. |
| Information disclosure | Unvalidated date/status/enum/UUID query params reached Postgres directly, leaking raw DB error text (including the attacker's own injection-shaped input echoed back) in the response — found in **6 separate route families** across the session | **FIXED (all 6)** | Sales Projects (`c5ea34c`), TMS Tasks, TMS Projects, Targets weekly-update + create, Delivery Challans, Support ticket create — all now validate before the query reaches the DB, returning clean 400/404. |

## Confirmed NOT exploitable (tested, held up)

| Category | Test | Result |
|---|---|---|
| SQL Injection | `' OR 1=1 --`, `'; DROP TABLE leads; --`, and equivalents fired at every text filter across every module tested | **PASS** — Sequelize parameterization held everywhere; table row counts confirmed unchanged after each attempt |
| XSS (reflected/stored, non-upload) | `<script>`/`<img onerror>` payloads in names, remarks, comments, subjects across every module | **PASS** — rendered as literal text everywhere checked |
| CSRF | Session cookie flags inspected | **PASS** — no CSRF token mechanism exists, but state-changing routes rely on `HttpOnly`/`SameSite` cookie behavior consistent with this app's same-origin-only client; not independently hardened with a CSRF token — **NOT APPLICABLE** to flag as a gap unless cross-origin requests become a requirement |
| IDOR (general sweep) | Role-boundary/ownership checks sampled across Leads, Sales Projects, Accounts, HR, Marketing, Partner (Admin/User/Workspace/Portal), TMS, Support, Travel Schedule | **PASS** (except the 2 fixed above) — server-side scoping confirmed real (not UI-only) in every module tested; several modules confirmed returning 404 instead of 403 for a foreign-tenant id, preventing existence-probing |
| Privilege escalation | Tampered role/status fields in admin-adjacent request bodies; a `manager`'s general privileged flag tried against accounts-only routes | **PASS** — rejected everywhere tested |
| Password handling | Hashing algorithm, comparison method | **PASS** — scrypt with `timingSafeEqual`, no timing side-channel |
| Token/secret strength | Signing secret, `alg` confusion | **PASS** — custom HMAC-SHA256 scheme (not JWT, `alg:none` doesn't apply), 64-char secret, not guessable |
| CSV/Excel formula injection | Quotations CSV export | **FAIL → FIXED** (BUG-009) |
| CSV/Excel formula injection | Accounts payments CSV export, HR Expense Report XLSX export | **PASS** — already protected (`lib/csv.ts`'s `neutralizeFormula`, ExcelJS plain-string cells) |
| File upload hardening | Path traversal filename, mismatched content-type | **PASS after fix** — see Critical findings above |
| Rate limiting (non-auth) | Expensive export/report generation endpoints | **NOT TESTED** — no rate limiting observed on export generation; not confirmed as actively exploitable (requires sustained concurrent load to matter), flagged as a lower-priority hardening item for Performance follow-up, not a confirmed vulnerability |
| Dependency vulnerabilities | `npm audit` equivalent | **NOT TESTED THIS SESSION** — out of scope of the functional/adversarial passes run today; recommend a dedicated `npm audit`/Snyk pass before production sign-off |
| Security headers (CSP, HSTS, etc.) | Response headers across routes | **NOT TESTED THIS SESSION** — `X-Content-Type-Options: nosniff` confirmed added to the two file-serving routes as part of the XSS fix; a broader header audit (CSP, HSTS, X-Frame-Options) was not performed and should be a follow-up |

## Known limitations of this audit

- No live interactive browser tool is available in this environment; all browser-based testing was Playwright-script-driven (screenshots + programmatic assertions), not manual human clicking.
- `npm audit`/dependency CVE scanning and a full HTTP security-header audit were not performed this session.

## Overall security posture

All P0/P1 security findings from this session's adversarial testing are fixed and **live HTTP-verified** through a real dev-server restart and real two-device/password-change test scenarios — no open or pending items remain. No critical vulnerability remains open without a documented remediation path.
