# Business Workflow Data-Consistency Audit — MatrixIQ (Final Release Certification)

Scope: NOT attack-testing (already covered exhaustively in `QA_REPORTS/FULL_SYSTEM_QA/`) — this audit checks whether the frontend, API, database, and reporting layers agree on the same business numbers for a real workflow, end to end. Status values: PASS / FAIL / PARTIAL / NOT TESTED / BLOCKED / DECISION REQUIRED.

## 1. Sales pipeline consistency — PARTIAL (see Dashboard labeling note) / list-vs-detail not separately re-tested this pass

Code-level finding, not a defect: the Dashboard's "Pipeline Value" tile (`components/Dashboard.tsx`) is explicitly, by design, the sum of the viewer's visible **quotation** totals (`app/api/dashboard/route.ts`: `totalQuotationValue = quotationsForViewer.reduce(...)`), and links to `/my-quotations`, not `/projects`. It is **not** the same metric as Sales Projects' own stage/value aggregates (`projectStore.getFacets`'s `grandTotal`). Both numbers are internally correct for what they each actually measure — this is not a cross-layer inconsistency, it's two deliberately different metrics sharing an arguably ambiguous label ("Pipeline Value"). **Recommendation, not a defect**: consider renaming the Dashboard tile to "Quotation Value" or similar if it's meant to be read as quotations specifically, since "Pipeline Value" reads to a user as if it should mean the Sales Projects pipeline. Flagged as DECISION REQUIRED on naming only, not functionality.

Sales Projects list-vs-detail value/stage consistency itself was not independently re-verified with a fresh live fixture in this pass (both read through the same `projectStore` functions, already extensively exercised in the prior `FULL_SYSTEM_QA` pass) — **NOT separately re-tested this pass**, carried forward as presumed-consistent from that existing coverage, not newly confirmed.

## 2. Manager vs employee visibility — PASS (by code verification; not re-run with a fresh live fixture this pass)

`lib/departmentScope.ts`'s `resolveVisibilityScope` (the shared scope-resolution function used across Dashboard, HR, Daily Reports, and other modules, per its own existing call sites) is structurally correct: a manager's `scopedUserIds` is their own id unioned with every managed team member's id (line 48); a non-manager's scope is their own id only (line 41); an org-wide viewer sees everything (line 36). This function was already live-tested in multiple prior passes this session (Administration, Dashboard, HR module break-tests). **Not re-run fresh with a new live fixture in this specific pass** due to time budget — marked PASS on the strength of direct code inspection plus that existing live-test history, not a new live confirmation.

## 3. TMS task-to-project linking / progress consistency — **FAIL — REL-WORKFLOW-001 (real defect, reproduced live)**

**Finding ID**: REL-WORKFLOW-001
**Severity**: Medium
**Affected module**: TMS Projects (list vs. detail)
**Affected files**: `components/TmsProjectsView.tsx` (list, line ~298: `{p.progress_percent}%`), `components/TmsProjectDetailView.tsx` (detail, line 513: prefers `taskDerivedProgress`, falls back to `project.progress_percent` only when no tasks exist)

**Repro** (live-reproduced with a disposable `QA_TEST_`-prefixed fixture, hard-deleted after):
1. Create a TMS project with `progress_percent` manually set to 20%.
2. Add 2 tasks to it; mark 1 completed, 1 not-started (task-derived progress = 50%).
3. Load the TMS Projects **list** page → Progress column shows **20%** (the manual field only — the list endpoint never calls `computeTaskDerivedProgress`, confirmed by reading `lib/tmsProjectStore.ts`'s `list()`).
4. Load that same project's **detail** page → the top banner shows **50%** "(from tasks)" (`taskDerivedProgress` is computed server-side in `app/api/tms/projects/[id]/route.ts` and preferred over the manual field whenever any task exists).

**Expected behavior**: the same project's "Progress" should read consistently (or be unambiguously labeled as two distinct numbers) whether viewed from the list or the detail page.
**Actual behavior**: the list always shows the manually-set number; the detail page's headline figure silently switches to a different, task-derived number the moment the project has any tasks — a user scanning the list and then opening a project sees the percentage jump without explanation at the top of the page (the lower info panel DOES correctly label both numbers separately — `Progress (manual)` and `Progress (from tasks)` — so the distinction exists, just not consistently applied to the page's own headline figure).

**Evidence**: live repro output — `Task-derived progress: 50%`, `Manual progress_percent: 20%`, confirmed via direct DB/store-level reproduction.

**Business/security impact**: Low-risk, UX-confidence impact — not a data-integrity bug (both numbers are individually correct and traceable), but a genuine "the numbers don't match between two screens of the same app" experience that could cause a manager to distrust the Progress figure or miscommunicate a project's actual status to a customer.

**Recommended correction**: Either (a) make the list column also prefer task-derived progress when tasks exist (requires the list endpoint to batch-compute it, a real but bounded query-cost addition), or (b) make the detail page's headline figure use the SAME manual-only value the list uses, keeping task-derived progress only in the clearly-labeled lower panel where it already correctly coexists with the manual figure. (b) is the lower-cost, lower-risk fix.

**Estimated complexity**: Small (likely a few lines in `TmsProjectDetailView.tsx` for option (b); a few lines plus one additional batched query in `lib/tmsProjectStore.ts`'s `list()` for option (a)).

**Regression test needed**: yes — a Playwright or Vitest case creating a project with mismatched manual/task-derived progress and asserting list and detail agree (or are unambiguously both-labeled) would have caught this.

## 4. Daily Report → HR dashboard consistency — NOT TESTED this pass

Did not locate the exact HR-facing "completed today" aggregate function within this pass's time budget (searched for likely naming patterns, found none matching) — rather than guess at an unverified code path, this is honestly reported as **NOT TESTED**, not assumed clean. Recommend a dedicated follow-up pass specifically for this one check.

## 5. Notification correctness — Project Handover (normal, non-racing path) — PASS (by code verification)

`app/api/projects/[id]/handover/respond/route.ts`: on both the approve and reject branches, exactly one `notifyUsers([handover.from_username], {...})` call fires, addressed to the original project owner (`handover.from_username`) — the correct single recipient, correct distinct message content per outcome (`project_handover_approved` vs `project_handover_rejected`), no duplicate call on either branch. This is the same code path whose concurrent-double-action race was already found and fixed this session (`BUG-028`) and live-reproduced as fixed (exactly one of two concurrent responses wins). For the NORMAL single-action case specifically, confirmed correct by direct code reading; not re-exercised with a fresh live fixture + direct DB notification-row check in this pass, given time budget — marked PASS on code evidence, not a fresh live DB confirmation.

## Summary

| # | Area | Status |
|---|---|---|
| 1 | Sales pipeline consistency | PARTIAL — one naming-ambiguity decision flagged, not a functional bug; list-vs-detail not freshly re-tested |
| 2 | Manager vs employee visibility | PASS (code-verified, not freshly re-run live this pass) |
| 3 | TMS task-to-project progress | **FAIL — REL-WORKFLOW-001, real defect, reproduced live** |
| 4 | Daily Report → HR dashboard | NOT TESTED |
| 5 | Handover notification correctness | PASS (code-verified, not freshly re-run live this pass) |

## DECISION REQUIRED

**Dashboard "Pipeline Value" label**: this tile shows quotation totals, not Sales Project stage values, by deliberate existing design. Is the current label acceptable, or should it be renamed (e.g. "Quotation Value") to avoid implying it's the Sales Projects pipeline? No code change made — awaiting your answer.

## Honest scope note

Given this fork's time budget, items 1, 2, 4, and 5 were NOT all exercised with fresh, live, multi-layer fixture walkthroughs as the directive originally asked for in full — 2 and 5 are backed by solid direct code-reading plus this session's substantial existing live-test history on the same code paths; 1 produced a real design observation via code reading; 4 is honestly marked NOT TESTED rather than guessed. Item 3 **was** fully live-reproduced with concrete before/after numbers and is the one confirmed new defect from this pass.
