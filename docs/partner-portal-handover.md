# Partner Management Portal — Handover

Covers phases P0–P6 as built. The design rationale lives in
[partner-portal-plan.md](partner-portal-plan.md); this document is what
exists, how it is enforced, and what is not finished.

---

## 1. What was built

| Phase | Scope | State |
|---|---|---|
| P0 | Partner identity, three-layer isolation, roles, portal shell | Done |
| P1 | Partner CRUD, sub-user logins, status lifecycle | Done |
| P2 | Lead/project submission, Sales review, partner-visible timeline | Done |
| P3 | Quotation sharing, demo requests, attachment scoping | Done, 2 UI gaps |
| P4 | Partner + consolidated analytics, marketing material publication | Done, 1 UI gap |
| P5 | Support tickets, SLA engine, triage/engineer workflow | Done |
| P6 | Partner-aware notifications, isolation suite, this document | Done |

---

## 2. The isolation model

Three independent layers. Each is sufficient on its own for its own concern;
together they mean no single mistake opens a tenant boundary.

**Layer 1 — route area (`proxy.ts`).** `SessionPayload.partnerId` is a signed
token claim, so the Proxy can gate without a database (which it must never
touch — see its own comment). A partner session cannot leave `/partner/**`;
an internal session cannot enter it. This is a *route* gate only, never a
data gate, because a token claim goes stale.

**Layer 2 — viewer resolution (`lib/viewerContext.ts`).** `getViewerContext()`
**refuses partner accounts by default**. Internal APIs are therefore hardened
without each one remembering a check. Four routes opt in deliberately:
`/api/sidebar`, `/api/notifications`, `/api/uploads`, `/api/uploads/file/*` —
each because it genuinely serves both audiences. `getPartnerViewer()` is the
mirror image and refuses *internal* accounts; it also re-reads the partner's
live status, which is what makes suspension immediate.

**Layer 3 — query tenancy.** Every partner-facing store function takes
`partnerId` and puts it in the `WHERE`. Never a post-filter: a post-filter is
one early return away from leaking and leaves no trace when it does.

### Deny-by-default rules worth knowing

| Thing | Default | Opening it is… |
|---|---|---|
| `project_notes.partner_visible` | false | a deliberate per-note act |
| `project_timeline_events.partner_visible` | false | ditto |
| `support_ticket_comments.is_internal` | **true** | unticking a box |
| `materials.partner_visible` | false | Marketing publishing it |
| `material_folders.partner_visible` | false | ditto |
| Quotation visibility | no row = invisible | an explicit share row |

---

## 3. Permissions as implemented

| Capability | Rule | Source |
|---|---|---|
| Create/manage partners | `canManagePartners` — org-wide capability, or a Sales/GEM-Sales department manager, or privileged | `lib/partnerAccess.ts` |
| Review a submission | `canManagePartners` — deliberately **not** the project's own edit permission, or the relationship manager could accept their own incoming work unreviewed | `app/api/projects/[id]/partner-review` |
| Share a quotation | `canManageQuotation` — the same rule that governs changing its status. A Sales manager who does not own the deal has no business publishing its pricing | `lib/quotationAccess.ts` |
| Publish collateral | `canManageMaterials` — publishing is curation | `lib/permissions.ts` |
| Work the support queue | `manager` = superadmin/admin/technical-manager; `engineer` = engineer/technician/team-lead. The generic `manager` role is excluded — it is held by every department's manager | `lib/supportTicketAccess.ts` |
| Configure SLA | `manageSettings` capability | `app/api/admin/support/sla` |

Partner roles (`partner-admin`, `partner-user`) carry `isPrivileged: false`
and an **empty module matrix**. Neither flag is what isolates them —
`users.partnerId` is. Portal tiles are granted by key
(`PARTNER_PORTAL_MODULE_KEYS`), so an admin editing a partner role in Role
Management cannot hand a partner an internal module by ticking a box.

---

## 4. Schema added

Tables: `partners`, `partner_quotation_shares`, `material_access_logs`,
`support_tickets`, `support_ticket_comments`,
`support_ticket_status_history`, `support_sla_policies`.

Columns added: `users.partnerId`; `projects.partner_id` + 6 submission-overlay
columns; `project_notes.partner_visible`;
`project_timeline_events.partner_visible`; `demo_schedule` + 5 partner
columns; `materials.partner_visible` / `partner_audience`;
`material_folders.partner_visible`.

Ten migrations, `20261020090000` → `20261020102000`, all applied. Every one
is additive with a working `down()`; nothing was backfilled.

**`ON DELETE RESTRICT` toward `partners` everywhere** — a partner holding
live records cannot be deleted out from under them. Ending a relationship is
a status change. The exception is `partner_quotation_shares.quotation_id`,
which cascades: a share is meaningless once the quotation is gone.

---

## 5. Derived state (no new enums)

Three places present internal state to partners through a pure mapping rather
than new database values. Postgres cannot drop an enum value, so a wrong
guess would be permanent; and one source of truth beats two that drift.

- `lib/partnerProjectStages.ts` — 8-stage pipeline + status → 12 partner
  stages. **The submission gate comes first**: a project sitting at
  `cold_call` because that is the DB default must read as "awaiting sales
  review", not as work in progress.
- `lib/partnerDemoStatus.ts` — 11 internal demo statuses → 6. Back-office
  delivery-challan states are our warehouse paperwork and never surface.
- `supportTicketWorkflow.partnerFacingStatus` — internal queue mechanics
  (`new`/`under_triage`/`assigned`) collapse to `open`.

---

## 6. The SLA engine

`lib/supportSla.ts`. Two rules drive the design:

**Breach is computed, never stored.** A stored flag would need recomputing
whenever a policy changes, a ticket moves, or the clock simply passes a
threshold with nobody touching the row — and there is no background job. It
would be wrong in the silent direction: breached tickets still showing green.

**Due timestamps are stored, measured from ticket creation.** They are a
commitment made at a point in time; re-deriving them from a since-edited
policy would retroactively change what we promised. Measuring from triage
instead would let a slow triage erase its own delay.

The pause rule is documented business logic: while a ticket is
`awaiting_partner`, the clock stops (per-policy, default on), so the metric
measures our responsiveness rather than the customer's. Paused time is walked
from `support_ticket_status_history` rather than accumulated in a column — an
append-only log cannot disagree with itself.

A missed **response** target counts as a breach even when resolution was met.
A ticket fixed on time but never replied to is still a failure.

---

## 7. Notifications

`lib/notificationResolver.ts` now resolves per audience. Partner and internal
sessions get **entirely different destinations for the same record** — a
partner project is `/projects/<id>` internally and `/partner/projects/<id>` in
the portal, and each side may only reach its own.

`PARTNER_RESOLVERS` is an **allow-list**: an entity type absent from it
resolves to nothing for a partner and is dropped as non-actionable. So a
mis-targeted `notifyUsers` call is silently hidden rather than advertising an
internal record's existence.

---

## 8. Testing

1166 tests across 60 files; 193 are new for this feature.

| File | Covers |
|---|---|
| `partnerRoles.test.ts` | route-prefix gate, segment matching, no loose prefixes |
| `partnerViewerIsolation.test.ts` | deny-by-default, live-status suspension, fail-closed |
| `partnerModuleAccess.test.ts` | module gate in both directions |
| `partnerStatusTransitions.test.ts` | partner lifecycle |
| `partnerProjectStages.test.ts` | submission gate precedence |
| `partnerVisibility.test.ts` | field-by-field redaction |
| `partnerUploads.test.ts` | attachment ownership, traversal, near-miss prefixes |
| `partnerDemoStatus.test.ts` | logistics never surface |
| `materialPublication.test.ts` | two-gate folder chain, cycles, dangling parents |
| `partnerAnalyticsCompute.test.ts` | the money rule, null rates |
| `supportTicketWorkflow.test.ts` | full role × transition matrix |
| `supportSla.test.ts` | due dates, pause, breach |
| `partnerIsolation.test.ts` | the cross-tenant guarantees as one set |

**Not covered by tests:** query-level tenancy needs a live database. The
stores are written so no partner-facing query exists without `partner_id` in
the `WHERE`, and routes pass `partnerId` from the session rather than the
request — but that is a code-review guarantee, not an asserted one.

---

## 9. Known gaps

Three are UI-only; the APIs behind them are live, audited and tested.

1. **No "share with partner" button.** `POST /api/quotations/[id]/share-partner`
   works, but nothing in `QuotationsView` calls it — so a salesperson cannot
   actually share a quotation from the UI.
2. **No publication toggles in `MaterialsView`.** `PATCH /api/admin/materials/publication`
   works; Marketing has no control to call it.
3. **No partner quotation PDF.** The portal shows line items and totals on
   screen. `quotationPdfFromRecord` also handles proposal attachments that
   resolve to internal blob paths outside the partner prefix, so wiring it
   naively would either 404 confusingly or breach the upload rule.

Also outstanding:

4. **No auto-escalation runner.** `shouldAutoEscalate()` is implemented and
   tested but nothing calls it on a schedule. There is a cron precedent
   (`/api/cron/daily-report-sweep`, shared-secret authenticated) to copy.
5. **No analytics date/department filters or export.**
6. **`business_hours_only`** is a column read by `supportSla` but not
   implemented — honouring it needs a working calendar (holidays, shifts)
   this app does not have. It ships `false` and is treated as
   "not implemented" rather than silently computing the wrong thing.
7. **Partner rebinding requires a forced logout.** `partnerId` in the token
   does not change until reissue. Suspension is handled live; moving a user
   between partners is not a supported operation.
8. **`/api/users/lite` was leaking partner accounts** into internal people
   pickers and is now filtered. `/admin/users` still lists partner accounts —
   defensible for superadmins, but worth a decision.

---

## 10. Operating notes

- **Partners cannot self-register.** There is no public signup route; accounts
  are created only through `/admin/partners`.
- **Activation reuses `mustChangePassword`** — no invite-token table. The
  account is created, a temporary password is emailed by the existing SES
  path, and `proxy.ts` pins the account to `/change-password` until it is
  changed. The temp password is also shown once on screen, because SES may be
  unconfigured and an account nobody can get into is worse.
- **A partner with no relationship manager** produces submissions with
  `created_by = NULL`, visible only to org-wide viewers. Assign an RM.
- **Model changes need a dev restart** — `lib/db.ts` caches Sequelize on
  `global`.
