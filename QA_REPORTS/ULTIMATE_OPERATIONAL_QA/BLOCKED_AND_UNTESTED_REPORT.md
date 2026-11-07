# Blocked and Untested Items — Ultimate Operational QA

Honest accounting of what this pass could not test, or tested inconclusively, and why. Nothing here is converted to PASS or FAIL — per the mandate, BLOCKED/NOT TESTED stays BLOCKED/NOT TESTED.

## Blocked

- **Role-permission matrix row for `POST /api/admin/users`** — deliberately never called live (it creates a real account and sends a real SES email). Marked "code-verified, not live-tested" in `ROLE_MODULE_PERMISSION_MATRIX.csv` instead, per the standing QA-never-touches-real-people rule.
- **Workflow 6's "authorized" side** (same-department manager, org-wide admin cross-department access) — the agent testing it used the wrong HTTP verb (GET on a route that only implements PATCH/DELETE), getting 405s instead of real results. This is a test-script limitation, not an application result — needs a re-run with a valid verb before any conclusion.
- **Partner-user/partner-admin role rows in the permission matrix** — `createQaUser` has no `partnerId` support, so the live test exercised an *unbound* account under that role key, not true partner-portal-confined access. Flagged clearly rather than overstated as a real partner-scope test.

## Not Tested

- **Workflow 5 (Sales targets → Closed deals → MIS)** — not attempted this pass; scope existed in the plan but no fork picked it up in the time available. Needs a dedicated follow-up: create a disposable sales target, progress a lead to Closed/Won, verify MIS/dashboard figures against the real qualifying record.
- **Daily Report → HR dashboard consistency** — already honestly marked NOT TESTED in the prior Final Release Certification pass (`REL-WORKFLOW-NOTTESTED-001`); not picked up again this pass either.
- **BOM/Procurement pages, Purchase Orders, Marketing Requests, Partner portal, and admin config screens beyond task-assignment** — explicitly out of scope for the UI/UX fork this pass (named as open follow-up items in its own report).
- **Multi-stage financial chains** (e.g. finance-approve → payment → received) — the API/DB-integrity fork's transactional checks covered BOM approve/create and notification mark-read only; longer chains remain unverified.
- **Sales Projects list-vs-detail progress consistency** (the direct analogue of REL-WORKFLOW-001 for Sales Projects rather than TMS) — the module-CRUD fork's list-row lookup didn't match the shape the detail endpoint returned, so no clean comparison was possible. No mismatch was found, but none was ruled out either — this is **inconclusive**, not a clean pass.
- **Lead reassignment/conversion for a plain `manager`-role fixture** — got 403 then 404, most likely because department-manager authority in this app comes from `Department.managerIds`, not the role key alone, and the disposable fixture wasn't registered as a department manager. Flagged as a likely test-setup gap needing a follow-up with a properly-registered fixture, not a confirmed defect.
- **Reimbursement submission blocked by the configured deadline day** — appears to be correct, intentional behavior given today's date (2026-11-07) relative to the configured deadline, but the deadline value itself wasn't independently confirmed as intentional by a human. Needs a sanity check, not a code fix.

## Known limitations of this entire pass

- No interactive, human-driven browser is available in this environment — all "browser" testing was Playwright-script-driven (API-level requests plus a handful of real page loads/clicks), not manual clicking.
- Several forks ran concurrently against the same live dev server and database; stray `QA_TEST_` rows from sibling forks and from other, entirely separate concurrent sessions were observed mid-run. Each fork was instructed to only clean up its own rows — confirmed done, with a couple of explicit leave-it-alone notes where a stray row clearly belonged to another session.
- Two notification-generating actions unavoidably routed to real staff accounts (`naresh.pawar`, `manoj`) because they require a real department's real manager to exist. The UI/UX fork identified each resulting notification row by exact id, verified its content, and deleted it immediately — no residual effect on either real account, but this is noted here for transparency rather than silently omitted.
- This pass did not attempt all 20 modules named in the original master prompt (e.g. Dealer management was not exercised at all this pass — no fork was assigned to it). See `FINAL_OPERATIONAL_COVERAGE_REPORT.md` for the full coverage accounting.
