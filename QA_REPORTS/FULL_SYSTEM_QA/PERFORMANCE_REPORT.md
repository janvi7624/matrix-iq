# MatrixIQ — Performance Report

Phase 9 of the Full System QA program. All numbers below are real, measured
against the live dev server (`localhost:3000`) using an authenticated
disposable `QA_TEST_perf_*` fixture (hard-deleted after this pass), via
`curl -w "%{time_total}"`, 3–5 samples per target, median reported. **These
are Next.js dev-server numbers, not production** — dev mode adds per-route
on-demand compilation on a cold hit and has no production minification/
caching, so these are a conservative upper bound, not a representative
production figure. A first ("cold") hit to any route is excluded from the
reported median where it was an outlier from on-demand compilation; this is
noted per section.

## 1. Page load times (warm, median of 5 samples, seconds)

| Route | Median | Min | Max | Status |
|---|---|---|---|---|
| `/` (Dashboard) | 0.439 | 0.354 | 0.799 | PASS |
| `/leads` | 0.346 | 0.279 | 0.980 | PASS |
| `/projects` | 0.275 | 0.239 | 0.744 | PASS |
| `/tms/projects` | 0.537 | 0.435 | 1.477 | PASS |
| `/tms/tasks` | 0.379 | 0.320 | 0.763 | PASS |
| `/quotation` | 0.375 | 0.279 | 0.467 | PASS |
| `/reimbursement` | 0.504 | 0.377 | 1.539 | PASS |
| `/support` | 0.137 | 0.124 | 0.964 | PASS |

All 8 pages render well within a acceptable interactive-feel budget
(sub-second median) once past the dev-mode cold-compile hit on first visit.
No page showed a sustained slow pattern across repeated samples.

## 2. API response times (median, seconds)

| Endpoint | Median | Min | Max | Status |
|---|---|---|---|---|
| `GET /api/leads?page=1&pageSize=20` | 0.565 | 0.420 | 1.574 | PASS |
| `GET /api/projects?page=1&pageSize=20` | 0.731 | 0.726 | 0.753 | PASS |
| `GET /api/projects/facets` | 0.934 | 0.682 | 1.071 | PASS |
| `GET /api/projects/filter-options` | 0.563 | 0.370 | 0.794 | PASS |
| `GET /api/hr/reports` | 0.179 | 0.146 | 4.140 (cold outlier) | PASS |
| `GET /api/tms/projects` | 1.288 | 1.003 | 1.810 | **FLAG** |
| `GET /api/tms/tasks` | 1.095 | 0.759 | 1.396 | **FLAG** |
| `GET /api/dashboard` | **~4.1s** (see §5) | 2.569 | 5.135 | **FLAG** |

`tms/projects` and `tms/tasks` are both consistently in the ~1–1.8s range
even warm — noticeably slower than the comparable Sales Projects/Leads list
endpoints at similar data volumes (234/1262 rows vs. TMS's 30 projects). Not
re-architected in this pass (out of scope — "no caching, no
correctness-risking optimization" without a confirmed root cause), but
flagged for a dedicated look: candidate causes are the `departments`
many-to-many join (`tms_project_departments`) and the per-row
`resolveTeamNames` follow-up query, both already confirmed single-query/
batched (§3) so NOT an N+1 — more likely an unindexed join column or simply
running cold relative to the other endpoints tested earlier in the pass.

## 3. N+1 query check — confirmed CLEAN (code review, not live query-log
capture — the dev server's own console output wasn't accessible to this
fork; verified by reading the actual query-construction code instead)

Checked `lib/leadStore.ts`, `lib/projectStore.ts`, `lib/tmsProjectStore.ts`,
`lib/tmsTaskStore.ts` for the classic N+1 smell — an `await` inside a
`.map()`/`for` loop over already-fetched rows. **None found.** Every list
function in all four files does exactly one `findAll` for the primary rows,
plus (where needed) one additional batched follow-up query keyed by
`WHERE id IN (...)` over the gathered ids (e.g. `tmsProjectStore.ts`'s
`resolveTeamNames` — one query for ALL rows' team members combined, not one
per row). This matches the pattern already called out in several of those
files' own code comments from earlier in today's session. **Status: PASS.**

The Dashboard (`app/api/dashboard/route.ts`) itself is not an N+1 either —
it's ~19 independent single-query/aggregation calls run together via one
`Promise.all`, each hitting a different module's store once. Verified by
reading the route directly (lines 97–168). The breadth (not a loop
structure) is what makes it slow — see §5.

## 4. Bundle size (First Load JS per route)

**Status: NOT TESTED this pass — BLOCKED.** A genuine, currently-in-progress
`next build` process was already running on this machine (confirmed via
`Get-CimInstance Win32_Process`, PID 41264 and its parent chain) when this
fork attempted its own build run, and correctly refused with "Another next
build process is already running." This fork does not know whether that
build belongs to another concurrent QA/dev session or a prior attempt of its
own that didn't fully exit — rather than kill an unconfirmed process (this
exact mistake caused real disruption earlier in today's session), this was
left alone.

Full `npm run build` has already been independently confirmed clean (exit 0,
all 96 routes compiled, postbuild standalone copy succeeded) multiple times
earlier in today's broader QA session — recommend re-running
`npm run build` once no other build is in flight to get the exact per-route
First Load JS table; the build's own correctness is not in question, only
the byte-size breakdown is outstanding.

## 5. Dashboard performance — the one real, confirmed bottleneck

**Status: FLAG — real, measured, not fixed (out of scope for a safe fix in
this pass).**

`GET /api/dashboard`, measured BEFORE any concurrent build contention
(3 clean warm samples): **5.135s, 4.147s, 2.569s — median ~4.1s.** This is
4–10x slower than every other endpoint tested, on every sample, not an
outlier.

Root cause (confirmed by reading `app/api/dashboard/route.ts` directly, not
guessed): it is architecturally sound — not an N+1, not a missing index
"just forgotten" — but it fans out to ~19 parallel queries/aggregations
across Leads, Projects, Site Visits, Demo Schedule (x2), Marketing Requests,
Quotations, Delivery Challans, Targets, Celebrations, Daily Report status,
then a second wave of 5 more (quotations count, pending handovers, travel
records, technical approvals, sales roster) that depend on the first wave's
results. For an org-wide/superadmin viewer specifically, several of these
list() calls are genuinely unscoped (the whole table, not "my stuff"), so
the real cost is data breadth × 19 separate round trips, not a bug.

**Not fixed in this pass**, per the explicit instruction against introducing
caching or risky optimization without a clear, safe, well-understood target.
This is a real architectural cost worth a dedicated follow-up (candidates:
scope more of those 19 calls to summary/count queries instead of full-row
fetches for the org-wide case, or cache the org-wide aggregate for a short
TTL) — flagging with real numbers rather than forcing a change blind.

## Summary

| Area | Status |
|---|---|
| Page load times (8 routes) | PASS |
| API response times (6 of 8 endpoints) | PASS |
| TMS Projects/Tasks API latency | FLAG (not fixed — no confirmed root cause yet) |
| N+1 query audit (4 stores + Dashboard) | PASS — confirmed clean by code review |
| Bundle size / First Load JS | NOT TESTED — blocked by a concurrent build process, not re-attempted to avoid process interference |
| Dashboard aggregate endpoint | FLAG — confirmed real, ~4.1s median, root cause understood, not fixed (architectural, out of safe scope for this pass) |

No code changes were made in this pass — every number above is
observational. Nothing was broken; nothing needed a correctness fix.
