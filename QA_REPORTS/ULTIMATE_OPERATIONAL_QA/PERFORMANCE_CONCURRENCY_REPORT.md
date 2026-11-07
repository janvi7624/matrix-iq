# Performance & Concurrency Report — Ultimate Operational QA

Scope: (1) real response-time measurements for 4 pages/endpoints not already
covered by `QA_REPORTS/FINAL_RELEASE_CERTIFICATION/PERFORMANCE_BASELINE.md`
(which already root-caused Dashboard load, ~2959ms median, to
`leadStore.list` + `projectStore.listLight` + `searchQuotationsFiltered` —
cited, not repeated here); (2) one genuine, freshly-run concurrency test
against a shared resource, distinct from the existing Playwright
`leads.spec.ts` "two reps cannot both successfully claim the same lead" test
(cited, not re-run). All work used disposable `QA_TEST_`-prefixed fixtures
created directly via Sequelize per `tests/e2e/helpers/fixtures.ts`'s
convention, hard-deleted (`force: true`) in a `finally` block. No real user,
account, or business record was touched. No application code was changed.
No commits were made.

Dev server confirmed reachable before testing: `GET http://localhost:3000/`
returned `307` (redirect to `/login`, i.e. server up and routing normally).

## 1. Response times — 4 endpoints not in the existing baseline

Methodology: one disposable `admin`-role fixture, logged in through the real
`/api/auth/login` endpoint (not a bypass), 5 consecutive timed `GET`
requests per endpoint, cookie-authenticated, timed end-to-end (request sent
to response body fully read) from a local script using the system clock.
Same caveats as the existing baseline apply: single-fixture, single-machine,
dev-mode server — this is a measurement, not a load test, and no scalability
conclusion is drawn from it.

| Endpoint | Samples (ms) | Median |
|---|---|---|
| **Leads list, filtered** (`GET /api/leads?page=1&priority=hot`) | 403, 265, 362, 382, 267 | 362ms |
| **TMS Tasks list** (`GET /api/tms/tasks`) | 889, 458, 427, 364, 449 | 449ms |
| **BOM Requests list** (`GET /api/tms/bom-requests`) | 621, 469, 883, 410, 462 | 469ms |
| **Support Tickets list** (`GET /api/support/tickets`) | 382, 236, 235, 268, 270 | 268ms |

**Finding: all 4 endpoints are consistently sub-second** (268ms–889ms across
25 total samples, worst single sample 889ms on a cold-ish TMS Tasks request).
None of these approaches the multi-second Dashboard behavior already
identified in `PERFORMANCE_BASELINE.md`. This is consistent with the existing
baseline's own diagnosis: the Dashboard's slowness is specifically caused by
3 unpaginated full-table-scan-shaped aggregate calls (`leadStore.list`,
`projectStore.listLight`, `searchQuotationsFiltered`) that these other list
endpoints — which already paginate/filter server-side, per the `page` param
branch seen in `app/api/leads/route.ts` — don't share. **No new performance
defect found in this check; no severity rating is assigned (nothing to rate).**

## 2. Concurrency test — simultaneous approve vs. reject on the same BOM request

**Why this race, not the lead-claim one:** the lead-claim race (two reps
claiming the same unassigned lead) is already covered by the existing
Playwright test `tests/e2e/leads.spec.ts` ("two reps cannot both successfully
claim...") — cited rather than re-run, per instructions. This test instead
targets a different shared resource and a different kind of conflict: two
different users taking **opposite, mutually exclusive decisions** (approve
vs. reject) on the same pending approval record at the same instant — the
BOM Request Stage-1 approval (`app/api/tms/bom-requests/[id]/approve` and
`.../reject`), which the code (`lib/tmsBomRequestStore.ts`'s `decide()`)
itself documents as a known race it was specifically written to guard
against:

> "Conditional on the status read above still holding at write time — the
> caller already checked status is submitted/under_review against this same
> read, but without this WHERE two concurrent decisions (a double-click, or
> an approve racing a reject) would both pass and both write, with the
> loser's notification/email still firing for a decision that never actually
> stuck."

### Setup

- Two disposable `QA_TEST_`-prefixed `admin`-role fixtures (A and B), each
  logged in independently through the real `/api/auth/login` endpoint,
  giving each its own session cookie (two genuinely separate sessions, as
  required).
- `admin` is `isPrivileged`, which `canDecideBomStageOne` short-circuits to
  `true` regardless of department — chosen specifically so the test
  exercises the approve/reject race itself, not department-routing logic
  (already covered elsewhere), and so no real department/project data needed
  to be created or modified.
- One disposable `tms_bom_requests` row was created directly via Sequelize
  (`status: 'submitted'`), attached to an existing `TmsProject` found by a
  read-only lookup (no project record was modified).
- Fixture A fired `POST /api/tms/bom-requests/{id}/approve`; fixture B fired
  `POST /api/tms/bom-requests/{id}/reject` (with a required `reason` body),
  both via `Promise.all` — genuinely concurrent requests issued in the same
  tick, not sequential.

### Actual observed outcome (transcript)

```
Firing simultaneous approve (A) + reject (B) requests...
Elapsed: 4840ms
Approve response: 200 {"...":"...","status":"approved","reviewed_by_id":"b7ffccca-...","reviewed_at":"2026-11-07T03:59:15.685Z", ...}
Reject response: 400 {"error":"Only a request awaiting review can be declined"}

Final DB status: approved
Final reviewed_by_id: b7ffccca-02d4-4cfb-a120-d884a9860ab9
Final rejection_reason: (empty)
```

- **Approve (A) won**: `200`, row updated to `status: 'approved'`,
  `reviewed_by_id` stamped to fixture A, `reviewed_at` stamped.
- **Reject (B) lost cleanly**: `400 — "Only a request awaiting review can be
  declined"`. B's request reached the route's own pre-check
  (`existing.status !== 'submitted' && !== 'under_review'`) *after* A's
  request had already completed its full write — Node's single-threaded
  event loop interleaved the two requests at their `await` points, and by
  the time B's `findById` ran, A's `decide()` had already committed. B never
  reached the `decide()` conditional `UPDATE ... WHERE id = ? AND status = ?`
  at all in this particular interleaving, so the 409 branch
  ("This request was already decided by someone else") that the code comment
  describes was not the one exercised this run — but the net effect is
  identical: **exactly one decision stuck, the other was rejected with a
  clear error, no duplicate write, no lost update, no corrupted state.**
- Final DB row confirms a single consistent state: `status = 'approved'`,
  `rejection_reason` empty (B's attempted rejection never touched the row).

### Verdict

**PASS — correct single-winner behavior.** No race condition, no duplicate
approval/rejection, no lost update was observed. The explicit
status-conditional `UPDATE` in `decide()`, plus the route's own pre-check,
together prevented the exact scenario the code comment warns about. Because
this was a single clean test run (not a many-iteration fuzz), **no severity
rating is assigned** — there is no defect to rate. This should be read as
one successful confirmation of the existing guard, not as proof the guard
is race-free under all possible timings (e.g., a tighter race where both
requests' `findByPk` reads land before either's `UPDATE` executes was not
reproduced here, since Postgres connection-pool scheduling and Node's event
loop didn't interleave the two requests closely enough in this run to
exercise it — a note for a future pass with a larger number of concurrent
attempts, not a finding against this one).

## Cleanup confirmation

All fixtures and records created by this pass were hard-deleted
(`force: true`) in `finally` blocks, confirmed by each script's own logged
`DELETE` statements:

- `DELETE FROM tms_bom_requests WHERE id = '0871aab7-...'`
- `DELETE FROM users WHERE id = 'b7ffccca-...'` (fixture A, approve)
- `DELETE FROM users WHERE id = '9c878240-...'` (fixture B, reject)
- A separate single fixture used for the 4-endpoint timing pass was likewise
  created and hard-deleted in its own `finally` block.

No real user, lead, project, BOM request, or ticket was created, modified,
or deleted. The two scratch Node/tsx scripts used to drive these tests were
written to the local temp scratchpad directory (outside the repo) and
deleted after use; nothing was added to `QA_REPORTS/` other than this file.

## Summary

| Check | Result |
|---|---|
| Dev server reachable | Confirmed (307 redirect to /login) |
| Leads list (filtered) timing | 265–403ms, median 362ms |
| TMS Tasks list timing | 364–889ms, median 449ms |
| BOM Requests list timing | 410–883ms, median 469ms |
| Support Tickets list timing | 235–382ms, median 268ms |
| New performance defect found | None |
| Concurrency test (approve vs. reject race) | PASS — single winner, clean loser rejection, no corruption |
| Severity of concurrency finding | None assigned (clean pass, not a defect) |
| Fixtures/records cleaned up | Yes, confirmed via logged DELETE statements |
