# Remediation Plan — Final Release Certification

This plan covers the 15 findings in `OPEN_FINDINGS.csv`, ordered by recommended fix priority. **No changes described here have been made** — this is a plan for Phase B, which has not been authorized. Separately: `app/api/clients/route.ts` and `lib/clientMasterQuery.ts` have an unauthorized, uncommitted pagination change left in place at the user's explicit request ("keep it for review") — it is **not** included in this plan and is not assessed as fixed or broken here; it needs its own separate review.

## Priority 1 — Fix before release (real, user-facing or data-integrity impact)

| Finding | Files likely to change | Risk of the fix | Tests required after |
|---|---|---|---|
| REL-WORKFLOW-001 (list/detail progress mismatch) | `components/TmsProjectsView.tsx` | Low — switching the list view to the same task-derived calculation already proven correct in the detail view. Risk: if the list view fetches a lighter payload that lacks task data, may need to either add that data or call a shared helper. | Regression test comparing list vs. detail progress % for a project with tasks; re-run existing TMS Playwright coverage. |
| REL-UX-002 (Reimbursement selects unlabeled) | Reimbursement entry form component (category/month-year selects) | Very low — adding a label/aria-label does not change behavior. | Accessibility assertion both selects have an accessible name; manual screen-reader spot check optional. |
| REL-DB-002 (support ticket N+1) | `lib/supportTicketStore.ts` | Low-Medium — batching the SLA-policy and status-history lookups changes query shape; must preserve identical result mapping per ticket. | Existing support-ticket tests plus a new query-count assertion (flat count as N grows); full Vitest + Playwright regression. |

## Priority 2 — Fix soon, lower urgency

| Finding | Files likely to change | Risk of the fix | Tests required after |
|---|---|---|---|
| REL-PERF-001 (Dashboard slow load) | Dashboard data-loading code calling `leadStore.list()`, `projectStore.listLight()`, `searchQuotationsFiltered()` (likely a new lightweight aggregate method added to each store) | Medium — must produce numerically identical aggregate figures to the current full-fetch-then-count approach, or dashboard metrics silently drift. No caching, per existing instruction. | New aggregate result compared against old full-fetch result for a known dataset; re-measure dashboard median load time (target well under current ~3s). |
| REL-UX-001 (Leads hidden file inputs unlabeled) | Leads capture form component | Very low. | Accessibility assertion inputs have a name or are properly hidden from the a11y tree. |
| REL-UX-003 (Quotation Project-picker select unlabeled) | Quotation "Build the Quote" step component | Very low. | Optional accessibility assertion. |
| REL-DEPLOY-002 (4 undocumented env vars) | `.env.example` | None — documentation only. | None beyond a visual diff review. |

## Priority 3 — Decisions needed from the user/owner before any fix is written

| Finding | Decision needed | Why it can't just be "fixed" |
|---|---|---|
| REL-DB-001 (4 migrations marked up, no file) | Confirm whether these are a known superseded "daily-task"→"daily-report" rename (safe to document as historical) or genuinely missing files needing reconstruction. | Writing a "fix" without knowing the answer risks either hiding a real gap or wastefully reconstructing migrations for something already intentionally retired. |
| REL-DB-003 (no backup/restore tooling/docs in repo) | Confirm what backup mechanism actually exists outside this repo (e.g. a managed Postgres/Supabase backup policy) before deciding whether this is a documentation gap or a real Critical-severity absence. | This repo alone cannot tell us what infrastructure-level backups exist; documenting the wrong thing is worse than leaving it open. |
| REL-DEPLOY-005 (hard vs. rolling restart) | Confirm with whoever manages the Hostinger deploy which restart strategy is used. | Cannot be determined from this environment — no infrastructure access. Directly matters given the already-proven Sequelize model-caching behavior. |
| REL-WORKFLOW-DECISION-001 (Dashboard "Pipeline Value" tile labeling) | Decide whether to rename the tile or leave as-is with a tooltip. | Not a defect — a product/labeling decision. |
| REL-DEP-012 (forced dependency fix would downgrade eslint-config-next) | Confirm whether to wait for upstream (recommended) or accept the downgrade now. | Forcing now trades a non-exploitable vulnerability for a real, unreviewed tooling downgrade. |

## Priority 4 — Process/documentation improvements (no urgency, no release blocker)

- REL-DEPLOY-001 — add a CI/CD pipeline (GitHub Actions running build/test/Playwright on push).
- REL-DEPLOY-003 — add a deployment section to README or a DEPLOYMENT.md.
- REL-DEPLOY-004 — add an unauthenticated `/api/health` liveness endpoint and consider an error-tracking/APM integration.
- REL-DEPLOY-006 — write a short ROLLBACK.md.
- REL-WORKFLOW-NOTTESTED-001 — dedicated follow-up pass comparing Daily Report vs. HR dashboard figures (currently honestly marked NOT TESTED, not guessed at).

## Explicitly not included in this plan

- `app/api/clients/route.ts` / `lib/clientMasterQuery.ts` — unauthorized uncommitted change, kept for the user's own review per their explicit instruction, out of scope here.
- The 12 `npm audit` dependency findings beyond REL-DEP-012 are all the same root-cause chain — all resolved by the same single upstream wait, not independent fixes (see `DEPENDENCY_SECURITY_REPORT.md`).

## Suggested order of execution (once Phase B is approved)

1. REL-WORKFLOW-001, REL-UX-002, REL-DB-002 (Priority 1 — small, safe, real-impact fixes)
2. Gather the 5 Priority-3 decisions from the user/owner (no code change — just answers)
3. REL-PERF-001 (Priority 2 — larger, needs careful validation of aggregate correctness)
4. Remaining Priority 2 accessibility/doc items
5. Priority 4 process improvements, as capacity allows
