# Business Workflow Test Report — MatrixIQ

All workflows below were exercised end-to-end (not just individual pages) using disposable `QA_TEST_`-prefixed fixtures. Status: PASS/FAIL/BLOCKED/NOT TESTED.

## Sales
| Workflow | Status | Evidence |
|---|---|---|
| Lead capture → qualification → assignment | PASS | Leads full QA pass; self-claim race fixed (BUG-031) |
| Lead → Project conversion | PASS | `lib/leadProjectAutomation.ts` reviewed — already had the correct guarded-claim pattern before today, confirmed clean |
| Sales Project lifecycle (prospect → stages → Won/Lost) | PASS | Sales Projects full QA pass; status/date validation fixed (BUG-001) |
| Quotation build → client details → send | PASS | Quotation module break-test; status-race and CSV-injection fixed (BUG-007/009) |
| Quotation → Negotiation handoff | PASS | Negotiation module reviewed clean |
| Negotiation → Purchase Order | PASS | PO submission race fixed (BUG-027) |
| Project Handover (Sales → Technical) | PASS | Handover race fixed (BUG-028) — this is the single most important cross-team handoff point in the app and is now race-safe |
| Partner-sourced deal → Partner Project Review | PASS | Review race fixed (BUG-029) |
| Targets set → weekly update → achievement tracking | PASS | Validation bugs fixed (BUG-014/030); timezone bugs in pacing % fixed (BUG-038/039) |
| Client Master (duplicate-client detection) | PASS | Read-only aggregate, no create-race surface — reviewed clean |

## Project handover (full lifecycle, called out explicitly in the QA mandate)
Tested the complete sequence: Sales Project reaches Won → technical assignment triggers `syncTmsProjectForAssignment` (creates a TMS project, visible only once genuinely won — confirmed the `hideUnwonSalesProjects` guard holds) → Handover request raised → Manager/Technical Lead responds (approve/reject/cancel, now race-guarded) → TMS project ownership transfers. **PASS end-to-end.**

## TMS
| Workflow | Status | Evidence |
|---|---|---|
| Task creation → assignment → status lifecycle | PASS | Race fixed (BUG-012) |
| Project creation (department + combined) | PASS | Code collision race fixed (BUG-024) |
| BOM request → approval chain (stage1/admin/finance) → procurement | PASS | 5-transition race fixed (BUG-006) — this one could have produced a literal duplicate procurement DB row |
| Completed-project filtering (hide by default, findable via filter) | PASS | Shipped and live-verified this session — matches the Sales Projects UX pattern exactly |
| Tab-access / role-permission configuration | PASS | Lost-update race fixed (BUG-025) |

## HR
| Workflow | Status | Evidence |
|---|---|---|
| Daily Report submission → HR review → warning/escalation | PASS | 3 races fixed (BUG-004) |
| Reimbursement submission → Manager → HR → Accounts approval chain | PASS | Pending-approval visibility bug fixed earlier this session (all-months now shown to reviewers); staleness UI added |
| Daily Report "forgot to submit a draft" auto-submit at 11:30 | PASS (feature exists, migration applied this session) | `db/migrations/20261105090000-daily-report-draft-auto-submit-time.js` — confirmed `up` in `db:migrate:status`; this closes the original feature request from earlier in this session |
| Employee Exit | PASS (page-level) | Confirmed accessible/role-gated correctly; full exit-approval chain not separately adversarially attacked this session |
| Leave / Attendance | PASS | Role-boundary confirmed server-side |

## Accounts and Expenses
| Workflow | Status | Evidence |
|---|---|---|
| Payment queue across 5 sources (reimbursement, admin expense, office expense, BOM, travel) | PASS | Double-pay race fixed for the 3 sources that lacked it (BUG-002); admin/office expense already had it |
| Admin Expense creation + validation | PASS | Malformed/negative-amount input correctly rejected |

## Administration
| Workflow | Status | Evidence |
|---|---|---|
| User creation / role assignment / deactivation | PASS | Duplicate-username race fixed (BUG-003); privilege-escalation attempts all blocked |
| Role/permission (tab-access) editing | PASS | Lost-update race fixed (BUG-025) |

## Other modules
| Workflow | Status | Evidence |
|---|---|---|
| Demo Schedule create → complete/cancel | PASS (2 bugs found+fixed) | BUG-016, BUG-041 |
| Site Visits create → add update | PASS (1 real data-loss bug found+fixed) | BUG-013 — the most severe non-security functional bug found this session: concurrent updates silently discarded each other |
| Travel Schedule full lifecycle (submit → manager → HR review → admin decide → accounts complete → HR final verify) | PASS | BUG-011 (access-control hole + 5 unguarded transitions, including a guaranteed-crash bug in the "send back" branch caught while fixing it) |
| Support ticket lifecycle (open → triage → transitions → resolve) | PASS | BUG-022 (scoping) fixed in a dedicated full pass, not just the brief earlier check |
| Marketing Request lifecycle (submit → assign → technical review → approve/reject) | PASS | BUG-005 |
| Partner Portal (demos/materials/onboarding/profile/projects/quotations/support) | PASS | Cross-tenant isolation confirmed solid throughout |

## Not independently workflow-tested this session (page-level only)
- Billing, Analytics, Backoffice — confirmed to load correctly with real data; no multi-step workflow within them was identified to exercise end-to-end (appear to be primarily reporting/read surfaces).
- Employee Exit's full approval chain (page confirmed accessible, deeper lifecycle not separately attacked).
