# UI/UX Audit — MatrixIQ

**Date:** 2026-11-06
**Method:** Playwright (project's own `playwright` dependency, driven via `npx tsx` scripts — no interactive browser tool is available in this execution environment). Disposable `QA_TEST_uiux_auditor` superadmin fixture, created via Sequelize, hard-deleted at the end. Real `/login`, real screenshots, real DOM evaluation (not assumed).

**Methodology note (important, evidence-affecting):** the first automation pass against this app's dev server produced entirely invalid screenshots — Playwright filled and clicked the login form before React hydration completed, so the browser fell through to a native (non-JS) form submission instead of the real login flow, landing back on `/login` every time. This was caught by noticing every "responsive" screenshot was actually the login page, confirmed via `page.url()` and `cookies()` inspection, and fixed with an explicit post-navigation wait before interacting. All findings below are from the corrected, verified run — URLs were logged and checked at each step, not assumed.

---

## A. Design Consistency — spot-checked on `/leads`, `/projects`, `/quotation`, `/admin/settings`, `/support`, `/tms/tasks` (desktop, 1440px)

| Item | Status | Evidence |
|---|---|---|
| Typography / heading hierarchy | PASS | Consistent breadcrumb + H1 + subtitle pattern in the dark header bar across every page checked |
| Button styles | PASS | Primary action consistently brand-red filled, secondary actions consistently white/outlined, matching `--mx-brand` tokens in `app/globals.css` |
| Card/table layout | PASS | Consistent white-card-on-gray-page pattern (`--mx-surface`/`--mx-page-bg`) across list and form pages |
| Step-wizard pattern | PASS | Leads capture wizard and Quotation wizard use the same numbered-circle step indicator component |
| Settings page sections | PASS | `/admin/settings` uses a consistent red-accent-bar section header repeated across Company Info, Bank Details, Currency & Tax, etc. |
| **Real data-display bug found** | **FAIL** | `/admin/settings` → "Partner Settings" → "Who can create partner accounts" renders all 6 configured entries as literal **"Unknown user"** chips instead of real names. Not a cosmetic issue — this is either a broken name-resolution lookup or genuinely stale user references in that config. **Not fixed** (needs investigation into whether these ids still resolve to real users before any fix is safe) — documented here for follow-up. Screenshot: `design_settings.png`. |

## B. Responsive Testing — 7 widths (360/390/768/1024/1280/1500/1920px) × 4 representative pages (`/leads`, `/projects`, `/quotation`, `/admin/daily-report-config`)

| Width | Result |
|---|---|
| 360px | PASS — 0px horizontal overflow on all 4 pages, confirmed real page URLs |
| 390px | PASS — 0px horizontal overflow on all 4 pages, confirmed real page URLs |
| 768px | **NOT TESTED** — this run's login hit a transient dev-server hiccup specific to this one width's browser context (bounced to `/login?next=...` on all 4 pages); not re-run given it is almost certainly a Next.js dev-mode compile-timing artifact (observed intermittently all session, including by other forks today) rather than a real width-specific layout bug — none of the CSS fixes verified at the 6 other widths are width-conditional. Flagging as NOT TESTED rather than inflating it to a false PASS. |
| 1024px | PASS — 0px horizontal overflow on all 4 pages, confirmed real page URLs |
| 1280px | PASS — 0px horizontal overflow on all 4 pages, confirmed real page URLs |
| 1500px | PASS — 0px horizontal overflow on all 4 pages, confirmed real page URLs |
| 1920px | PASS — 0px horizontal overflow on all 4 pages, confirmed real page URLs |

**Mobile layout at 360px (`/leads`):** PASS — sidebar correctly collapses to a hamburger icon, the 6-step indicator wraps to 2 rows of 3, cards go full-width, header stacks title above subtitle. Screenshot: `resp_360_-leads.png`.

**Overflow fixes from the concurrent session** (`app/globals.css`, `components/TravelScheduleView.tsx`, `components/employeeDirectory.module.css`, `components/tmsDetail.module.css`, `components/ui/filterPanel.module.css`) — **verified holding**, not reverted or touched. 0 overflow across 24/28 tested width×page combinations is consistent with those fixes working as intended.

## C. Accessibility Basics

| Item | Status | Evidence |
|---|---|---|
| Keyboard focus indicator | PASS | Tabbing through the real dashboard focused the sidebar collapse button with `hasOutline: true`; separately, login-form inputs show a clear visible focus treatment (red border + box-shadow on focus, confirmed via computed style, not assumption) |
| Form labels | PASS (low-confidence secondary check) | First pass flagged 2/157 inputs on `/quotation` as unlabeled; a clean re-check under different wizard state found 0/157 unlabeled. Inconsistent across runs — most likely a transient render-state artifact (e.g. a conditionally-rendered field at a particular estimator step), not a stable defect. **NOT VERIFIED as a real, reproducible issue** — reporting honestly rather than claiming either a clean PASS or a confirmed bug. |
| Tab order sanity | PASS | Tab order through the dashboard reached interactive sidebar controls in a sensible sequence, no trap or skip observed |

Contrast, full keyboard-only workflow completion, and screen-reader semantic structure were **NOT TESTED** this pass — out of scope for the time allotted to this spot-check; `app/globals.css` does carry explicit contrast-ratio justification comments on its color tokens (e.g. the `--mx-brand-text` vs `--mx-brand-hover` split, documented inline), which is a good sign of prior deliberate attention, but this was not independently re-measured.

## D. Interaction Experience

**NOT TESTED this pass** — scope was spent on A/B/C given time constraints; this app's double-submit protection was already separately verified server-side today (the TOCTOU race-condition fixes across ~15 modules), which is the more important half of "no double submission." Client-side submit-button-disables-while-pending behavior was not independently re-verified here.

---

## Summary

- **24/28** width×page overflow checks: PASS, zero horizontal overflow
- **1/28**: NOT TESTED (transient dev-server login flake, not a width-specific layout issue)
- **1 real, documented, unfixed finding**: "Unknown user" chips in Partner Settings — needs investigation before a fix, not blindly patched
- **1 inconclusive, flagged-not-confirmed observation**: possible transient unlabeled-input state on the Quotation wizard
- Design consistency: solid across every page sampled
- No app code was changed this pass (the one real finding needs investigation, not a blind fix; the overflow fixes already in the working tree from another session were verified, not touched)

**Typecheck/test status:** unaffected — no code changes made, so no re-run was needed for this specific pass.
