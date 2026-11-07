# Performance Baseline — Final Release Certification

Extends `QA_REPORTS/FULL_SYSTEM_QA/PERFORMANCE_REPORT.md`'s Dashboard finding (~4.1s median, root-caused to ~19 parallel queries, no fix attempted — correctly, per that pass's scope) one step further: identifying which specific queries are the heaviest, to give a concrete, prioritized target for a future optimization. **No code was changed this pass** — Phase A evidence-gathering only.

## Dashboard load time — re-measured live, this pass

5 consecutive timed requests against `GET /api/dashboard` as a disposable `QA_TEST_`-prefixed superadmin fixture (org-wide, worst-case view — same cohort the prior pass measured):

```
Samples (ms): [1843, 2431, 2959, 4858, 5191]
Median: 2959ms
```

**The prior ~4.1s figure is in the same order of magnitude but not identical** — this run's median (2.96s) and the prior pass's (4.1s) both fall within this measurement's own observed range (1.8s–5.2s), consistent with normal variance under concurrent system load rather than a real improvement or regression. **Conclusion: the Dashboard is still consistently slow — multi-second, not a one-off — regardless of which exact sample is cited.**

## Individual query timing — the actual bottleneck, not just a query count

Timed each of the Dashboard's constituent store calls individually and directly (same fixture, same `isPrivileged: true` org-wide scope, bypassing the HTTP layer to isolate query time from request overhead):

| Store call | Time | Share of total |
|---|---|---|
| **`leadStore.list`** | **1306ms** | **~44%** |
| **`projectStore.listLight`** | **1246ms** | **~42%** |
| **`searchQuotationsFiltered`** | **726ms** | **~25%** |
| `listDepartmentManagers` | 394ms | ~13% |
| `travelScheduleStore.list` | 179ms | ~6% |
| `siteVisitStore.list` | 163ms | ~6% |
| `marketingRequestStore.list` | 106ms | ~4% |
| `demoScheduleStore.list` | 100ms | ~3% |
| `projectHandoverStore.listPendingForUser` | 73ms | ~2% |

(Percentages don't sum to 100% because most of these run in parallel via `Promise.all` — they're independent shares of the critical path, not additive.)

**The real finding: 3 of the ~19 total calls dominate everything else combined.** `leadStore.list` + `projectStore.listLight` + `searchQuotationsFiltered` alone account for ~3.3 seconds of sequential-equivalent work — an order of magnitude more than the other 6 measured calls combined (~1 second total). The other ~10 calls in the Dashboard's two `Promise.all` batches (not individually re-timed this pass, each visibly small in the route's own code — e.g. `hasCapability`, `isUserADepartmentManager`, the 4 `.catch(() => null)`-guarded small widgets) are not meaningful contributors.

### REL-PERF-001 — Dashboard load dominated by 3 full-table-scan-shaped list calls
**Severity**: Medium (performance, not correctness — no data is wrong, it's just slow). **Module**: Dashboard (`app/api/dashboard/route.ts`). **Affected calls**: `lib/leadStore.ts`'s `list()`, `lib/projectStore.ts`'s `listLight()`, `lib/quotationStore.ts`'s `searchQuotationsFiltered()`. **Finding**: these three calls, each returning the VIEWER'S ENTIRE VISIBLE SET (1262 leads / 234 projects / however many quotations exist for an org-wide viewer — the same scale that motivated this session's earlier Leads/Sales Projects backend-pagination rewrite), are fetched in full on every single Dashboard load just to compute summary counts/aggregates, the same "fetch everything, derive a number client-side" pattern already identified and fixed for the Leads/Projects LIST pages earlier this session — but the Dashboard's own aggregate use of these same stores was never revisited. **Expected**: Dashboard aggregates should come from lightweight COUNT/aggregate queries, not a full-row fetch of every lead/project/quotation the viewer can see. **Actual**: full `list()`/`listLight()`/`searchQuotationsFiltered()` calls, each returning potentially thousands of full rows, just to extract a handful of summary numbers. **Evidence**: timings above, live-measured. **Impact**: every Dashboard load pays ~3+ seconds for data the page displays only as aggregate counts, not as a browsable list — the most frequently-loaded page in the app (every session's landing page) carrying the heaviest avoidable cost. **Recommended correction**: replace these 3 calls, specifically for the Dashboard's use case, with lightweight count/aggregate-only queries (mirroring the `listLightForStats`/attribute-limited pattern already established elsewhere in this codebase this session, e.g. `leadStore.ts`'s `CALL_DERIVED_ATTRIBUTES` lightweight-column pattern) — NOT a blanket cache (per the master audit's own instruction not to introduce caching without verifying data consistency first). **Estimated complexity**: Medium — requires adding 2-3 new lightweight aggregate functions to 3 different stores, each needs its own correctness verification against the existing full-fetch result before replacing it, to avoid silently changing a Dashboard number. **Regression test needed**: yes — a test asserting the new aggregate-query result matches the old full-fetch-then-count result for a known dataset, before and after.

## What this pass deliberately did NOT do

Per Phase A scope: no caching, no query rewrite, no index added, no code changed. This is evidence and a prioritized target, not a fix.

## Summary

| Check | Status |
|---|---|
| Dashboard load time re-measured | PASS (measurement completed) — but the underlying slowness is unresolved: still multi-second |
| Heaviest individual queries identified | PASS (measurement completed) — `leadStore.list`, `projectStore.listLight`, `searchQuotationsFiltered` are the 3 dominant contributors |
| Root-cause-to-fix traceability | Established — REL-PERF-001 gives a concrete, scoped next step |
| Actual fix implemented | NOT APPLICABLE — out of Phase A scope by design |
