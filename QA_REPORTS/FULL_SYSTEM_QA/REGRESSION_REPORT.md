# Regression Report — MatrixIQ

## Final verification commands (re-run against the current `dev` tree in this follow-up verification phase)

| Command | Result | Evidence |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | **PASS** — zero errors | Re-run after every change in this phase; final run clean |
| `npm run typecheck` (`tsc -p tsconfig.test.json`) | **PASS** — zero errors | The actual configured typecheck script (distinct from the plain tsconfig check above) — also clean, including the new `tests/e2e/` files |
| `npm test` (Vitest) | **PASS** — 120 test files, 2098/2098 tests passing | Re-run multiple times in this phase. One run showed a single transient **timeout** (not an assertion failure) in `modelRegistration.test.ts`'s "AppConfig declares every column" check, under the heavy concurrent DB load this session's extensive Playwright activity was generating — confirmed NOT a real regression by re-running that file in isolation with a longer timeout (passed cleanly, confirming `sessionEpoch`/`draft_auto_submit_time` are genuinely in sync between the model and the live DB) and by two subsequent full clean runs at 2098/2098. |
| `npm run build` (production Next.js build) | **PASS** — clean build, postbuild standalone output completed | Re-run in this phase; all 96 routes compiled without error |
| `npm run lint` (ESLint, the actual configured script) | **PASS relative to baseline** — 261 errors, 95 warnings, identical to the already-verified zero-new-errors baseline | Re-run in this phase against the current tree, including the new `tests/e2e/` files (individually confirmed lint-clean) |
| Playwright E2E regression suite (`npx playwright test`) | **PASS — 34/34** | A real, reusable, committed suite now exists at `tests/e2e/` (8 spec files, 35 tests — one later consolidated away as redundant, see below) — see Playwright E2E Suite below for the full account, including 3 rounds of real failures found and fixed in the suite itself. |

## Lint baseline comparison (Phase 3E requirement)

Compared current `dev` working state against commit `0793081` (the last commit before this session's QA work began), using an isolated git worktree so the live working tree was never touched.

| | Errors | Warnings |
|---|---|---|
| Baseline (`0793081`) | 262 | 94 |
| Current | 261 (260 after fix below) | 96 |

**Only 2 files showed genuinely new issues** (everything else in the raw diff was a false positive from a path-normalization bug in the first comparison attempt, corrected before concluding):
1. `app/api/po/route.ts` — 1 new warning, an unused import (`projectStore`) left over from the BUG-027 fix. **Fixed** — import removed, re-linted clean.
2. `coverage/block-navigation.js` — 1 warning. This is a generated Vitest coverage artifact, not source code; it only appears because coverage was regenerated today. Not a real code-quality regression. Recommend adding `coverage/` to `.eslintignore` if it isn't already, as a separate housekeeping item — not fixed here to avoid an unrelated config change outside this session's scope.

**Conclusion**: today's 40+ bug fixes introduced **zero new genuine lint errors**. The pre-existing baseline of ~262 errors / ~94 warnings is untouched by this session's work and remains a separate, pre-existing remediation project — not something today's changes should be blocked on, per the master QA prompt's own instruction not to modify hundreds of unrelated files for a clean lint result.

## Regression testing of the 40+ bug fixes themselves

Every fix listed in `BUG_TRACKER.csv` was verified by one or more of:
1. **Live reproduction before the fix** (confirmed the bug was real, not theoretical) followed by **re-reproduction after the fix** (confirmed exactly one of two concurrent actions now wins, the other gets a clean error) — done for essentially all of the TOCTOU race fixes (the dominant bug class this session).
2. **Full test suite re-run after every batch of fixes** — 2098/2098 passing at every checkpoint, meaning no fix broke any existing test.
3. **Typecheck after every batch** — clean at every checkpoint.
4. **Connected-workflow re-testing** — e.g. after fixing the Leads self-claim race, the full Leads page was re-verified end-to-end (not just the one API call); after the TMS BOM Request race fixes, the full approval chain (stage1 → admin → finance → procurement) was re-walked.

No regression was found in any previously-working feature as a result of today's fixes.

## Known residual items (not regressions — pre-existing or explicitly out of scope)

- `/admin` routing oddity (BUG-042) — flagged, awaiting user decision, not a regression.
- Shared `updateUser()` double-action race (BUG-036 in Partner User context) — fixed as a dedicated follow-up, confirmed no caller regression.
- Pre-existing lint baseline (~262 errors) — untouched, a separate remediation project.
- `modelRegistration.test.ts`'s 5000ms default timeout is tight under this environment's current load — not a code defect, but worth raising it if this session's level of concurrent DB activity becomes routine.

## Automated Testing — Playwright E2E Suite (closes the Phase 11 gap)

A real, reusable, committed suite now exists at `tests/e2e/` — 8 spec files (`auth`, `rbac`, `leads`, `projects`, `tms`, `hr`, `forms`, `navigation`), a shared fixture helper (`tests/e2e/helpers/fixtures.ts`, disposable `QA_TEST_`-prefixed users created directly via Sequelize, always hard-deleted), and `playwright.config.ts` (serial execution, `reuseExistingServer`). Run via the new `npm run test:e2e` script. `@playwright/test` was added as a devDependency (the base `playwright` package was already present, but not the test-runner).

**Honest account of getting this suite to actually pass — 3 rounds of real failures found and fixed, all in the test suite itself, not the application:**

1. **First full run: 18/35 passed.** Root cause: the shared login helper (`loginAsFixture`) used a fixed 1000ms wait after clicking submit, which was not reliably long enough for this (heavily DB-logged) dev server to complete the scrypt-hash + login round trip — confirmed by inspecting the failure screenshot, which showed the login button still reading "Signing in…" (disabled) when the test moved on. Fixed by waiting for the actual `POST /api/auth/login` network response instead of a guessed delay.
2. **Second run (after the login fix): 32/35 passed.** Three further issues, each individually root-caused:
   - Two `/hr/*` page-redirect assertions expected a raw 307, but both `fetch()` and Playwright's `page.request` follow redirects by default, silently turning the real 307 into the 200 of wherever it landed. Fixed with `maxRedirects: 0`.
   - One RBAC test's "HR user CAN view HR pages but NOT Administration" assertion was invalidated by the test's own necessary substitution (a plain `'hr'`-role fixture correctly 403s on HR review too, since `canAccessHrReview` requires a real department-manager relationship that can't safely be faked without mutating a shared, real `Department.managerIds` row — so the test had to use a privileged role, which naturally also passes the Administration check, making the "NOT Administration" half of the assertion simply wrong). Removed the now-incoherent half rather than force it.
3. **Third run: 32/35 — 2 remained, both in `leads.spec.ts`:**
   - "Zero console errors" was too strict: `GET /api/leads/assignees` 403ing for a plain sales rep is deliberate, already-documented application behavior (`components/LeadsView.tsx`'s own comment: *"A 403 here is the expected answer for a rep rather than an error"*) — confirmed by reading that code, not guessed. Fixed to tolerate exactly that one expected 403.
   - The self-claim-race test itself had two real bugs: (a) it used a hardcoded mobile number, which across repeated runs collided with the application's own correct duplicate-lead-merge feature (*"two reps scanning the same card at an event must not fork into two records"*), silently merging into an orphaned lead from a prior run whose original creator had already been hard-deleted — confirmed by inspecting the created lead directly (`created_by` was `null`); and (b) it read the response's `assigned` field as an array when it is actually a count (confirmed live: `{"assigned":1,"failed":[],...}`), so the success check was structurally always false regardless of outcome. Fixed both — unique mobile number per run, correct numeric check.

**Final run: 34/34 passed** (one test was removed as redundant/incoherent in step 2, hence 34 not 35). Re-run twice more for stability — consistently green.

This is reported in this level of detail deliberately: every one of these was a bug in the *test*, not the application, and each was root-caused with direct evidence (a screenshot, a live API call, a DB query) before being fixed — not assumed or patched blindly to force a pass.
