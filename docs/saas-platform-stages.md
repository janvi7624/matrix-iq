# MatrixIQ as a multi-organization SaaS — staged build prompts

Goal: offer MatrixIQ to other organizations the same way NANTA TECH uses it today.
Each organization gets an isolated workspace; a **platform admin** (us) manages all
organizations, their plans, invoices and payments. **There is no online payment** — we
invoice, the organization pays offline (bank transfer / UPI / cheque), and the platform
admin records the payment and updates the organization's status, which unlocks access.

Already done (before Stage 0):
- `lib/plans.ts` — plan catalog (Starter / Growth / Business / Enterprise): prices, user
  and storage limits, departments, modules per plan. **The single source of truth for plans.**
- `/` shows the public landing page to anonymous visitors (signed-in users still get the
  dashboard); `/pricing` and `/request-demo` are public. All live in `components/landing/`
  and are listed in `proxy.ts` `LOGGED_OUT_PUBLIC_PATHS`.

Run the stages **in order, one per session/PR**. Each prompt is self-contained — paste it
as-is. Every stage must leave NANTA TECH's live usage working exactly as before.

---

## Key decisions (read once, they apply to every stage)

| Topic | Decision |
|---|---|
| Tenancy model | **One database, shared schema, `organization_id` on every tenant-owned table.** 99 models + 70 migrations make database-per-tenant expensive to run; an `Enterprise` plan can later get a dedicated deployment instead. |
| NANTA TECH | Becomes organization #1 by backfill. No data moves. |
| Naming | Existing `superadmin` role = **organization** super admin (unchanged). New **platform admin** = us, managing all orgs. Never reuse `superadmin` for the platform. |
| Name clash | `/billing` already means "won deals". SaaS billing uses **subscription / invoice / platform** naming: `/platform/*`, `/admin/subscription`. |
| Where checks live | `proxy.ts` must never touch the DB (see its header comment). Org id goes into the signed session token as a claim; org **status** and plan are checked in `lib/viewerContext.ts` `getViewerContext()` and server pages. |
| Login | `users.username` is globally unique today — keep it globally unique (no org code on the login screen). Revisit only if it becomes a problem. |
| Org lifecycle | `pending` → `trial` → `active` → `past_due` (grace, full access + banner) → `suspended` (read-only) → `cancelled`. Only a platform admin changes status, except automatic `trial/active → past_due → suspended` transitions by a daily cron. |
| Payment | Manual. Org admin may submit a payment reference + proof file; a platform admin verifies and marks the invoice paid, which extends the paid-through date and sets status `active`. |
| Data on non-payment | Never deleted. Suspended = read-only + billing page reachable. |

---

## Stage 0 — Tenancy audit (read-only, no code changes)

```
Read AGENTS.md first. This repo is a single-organization Next.js 16 + Sequelize/Postgres app
(MatrixIQ, used by NANTA TECH). We are going to make it multi-organization (shared schema,
organization_id on every tenant-owned table). Before any code changes, produce an audit at
docs/saas-tenancy-audit.md. Do NOT modify any code.

Cover, with file:line references:
1. Every model in db/models/: tenant-owned (needs organization_id) vs global (e.g. countries,
   migrations metadata). Flag join/child tables that can inherit org via their parent and
   say whether they should still get their own column (recommend: yes, for direct filtering).
2. Every UNIQUE constraint/index that must become unique per organization (e.g. department
   names, quotation sequences, product codes, role names). users.username stays global.
3. Every singleton/global row: AppConfig, DailyReportConfig, MetaIntegrationConfig,
   supportSlaPolicy, moduleConfig, quotation sequences, etc. — these become one row per org.
4. Every raw query (sequelize.query, literal SQL) — these won't get automatic scoping.
5. Every cron route under app/api/cron/ and the instrumentation.ts schedulers — they must loop
   per organization.
6. File storage (lib/fileStorage.ts): how keys are built; propose an org prefix.
7. Every hard-coded company identity: lib/branding.ts (companyName / companyLegalName used on
   PDFs, DCs, quotations, emails), SES sender, logos — what must become per-org.
8. Session/auth: lib/auth.ts SessionPayload, login and token reissue paths, where an
   organizationId claim must be added.
9. Partner portal isolation (lib/partnerContext.ts etc.) — how it composes with org isolation.
10. Risk list and a recommended migration order for Stages 1–3.
```

## Stage 1 — Organizations table + `organization_id` everywhere (no behavior change)

```
Read AGENTS.md and docs/saas-tenancy-audit.md. Implement Stage 1 of docs/saas-platform-stages.md.

1. Migration + model `Organization` (organizations table): id uuid, name, slug (unique),
   legal_name, gstin, billing_email, billing_address, phone, logo_path, status enum
   ('pending','trial','active','past_due','suspended','cancelled'), plan_id (string matching
   lib/plans.ts PlanId), trial_ends_at, paid_through, notes, created_at, updated_at.
2. Seed organization #1 = NANTA TECH LIMITED, status 'active', plan 'enterprise',
   paid_through far in the future. Store its id in a well-known constant/env
   (DEFAULT_ORGANIZATION_ID) for the backfill only.
3. One migration per logical group (follow existing migration style in db/migrations/) that:
   adds organization_id uuid NULL to every tenant-owned table from the audit, backfills it to
   org #1, then sets NOT NULL + FK + index. Make each migration reversible.
4. Convert the per-org unique constraints from the audit to composite (organization_id, …).
5. Add organizationId to every Sequelize model definition.
6. Nothing reads organization_id yet. App behavior must be identical. Run npm run typecheck,
   npm test, and run migrations up/down/up against a local DB. Report results.
```

## Stage 2 — Tenant context and automatic query scoping

```
Read AGENTS.md, docs/saas-tenancy-audit.md, lib/auth.ts, lib/viewerContext.ts, proxy.ts.
Implement Stage 2 of docs/saas-platform-stages.md.

1. Add `organizationId` to SessionPayload; set it at login, change-password and every token
   reissue path. Tokens without the claim (issued before this deploy) must be treated as
   logged out (force re-login) — never default them to an org.
2. lib/tenantContext.ts: AsyncLocalStorage holding { organizationId }. getViewerContext() and
   every server page's session lookup enter it. Provide runAsOrganization(orgId, fn) for crons
   and scripts, and runAsPlatform(fn) that explicitly bypasses scoping (platform admin only).
3. Sequelize global hooks (beforeFind/beforeCount/beforeCreate/beforeBulkCreate/
   beforeUpdate/beforeBulkUpdate/beforeDestroy/beforeBulkDestroy) on every tenant model:
   inject organization_id from the context; THROW if a tenant model is queried with no
   context and no explicit platform bypass. Fail closed.
4. Rewrite each raw query from the audit to filter by organization_id explicitly.
5. Crons: loop over organizations with status in (trial, active, past_due) and run each
   inside runAsOrganization.
6. File storage: prefix every new key with org/<organizationId>/; reads must verify the
   prefix matches the current org. Existing NANTA keys stay readable (treat unprefixed keys
   as org #1 only).
7. Tests (vitest): create two orgs with overlapping data and prove for every store in lib/
   that org B cannot read, update, count or delete org A's rows, including by direct id.
   Add an e2e test that a user of org B gets 404 on an org A record URL.
```

## Stage 3 — Per-organization settings and identity

```
Read AGENTS.md and docs/saas-tenancy-audit.md. Implement Stage 3 of docs/saas-platform-stages.md.

1. Singleton configs (AppConfig, DailyReportConfig, MetaIntegrationConfig, SLA policy,
   module config, quotation sequences, office expense option sets, …) become one row per
   organization, created with defaults when an organization is created
   (lib/organizationProvisioning.ts: createOrganizationDefaults(orgId)).
2. Company identity: keep lib/branding.ts for the PLATFORM (MatrixIQ name, favicon). Add an
   org company profile (legal name, short name, logo, address, GSTIN, bank details, email
   sender) used by quotations, DCs, expense vouchers, XLSX/PDF exports and emails instead of
   BRAND.companyName/companyLegalName/logo. NANTA's profile = today's values, so its
   documents are byte-for-byte unchanged.
3. /admin/settings gets a "Company profile" section editable by the org superadmin.
4. Sidebar/header shows the org's logo and name.
5. Meta webhook: resolve the organization from the page/form id stored in that org's
   MetaIntegrationConfig.
6. Verify NANTA's PDFs/quotations look identical before vs after.
```

## Stage 4 — Platform admin area (manage all organizations)

```
Read AGENTS.md, proxy.ts, lib/adminAreaAccess.ts, lib/tenantContext.ts. Implement Stage 4 of
docs/saas-platform-stages.md.

1. platform_admins table (separate from users): id, email, name, password_hash, active,
   last_login_at. Separate login at /platform/login with its own cookie (PLATFORM_SESSION)
   and token type; an org session can never reach /platform and vice versa. Seed the first
   platform admin from env vars via a script, not a migration with a password in it.
2. proxy.ts: /platform/* and /api/platform/* require the platform cookie (token claim only,
   no DB). All /api/platform routes run inside runAsPlatform().
3. Screens under /platform (reuse AppShell styles and --mx-* tokens):
   - Organizations list: name, plan, status, users used / limit, paid through, outstanding
     amount; filters by status and plan; search.
   - Create organization: org details + plan + first org superadmin (name, email, username,
     temp password with mustChangePassword) → calls createOrganizationDefaults.
   - Organization detail: profile, plan, status history, users count, storage used,
     invoices, payments, notes; actions: change plan, change status (with required reason),
     extend trial, impersonation is NOT included.
4. Every platform action writes a platform_audit_log row (who, org, action, before/after,
   reason).
```

## Stage 5 — Plans, module gating and usage limits

```
Read AGENTS.md, lib/plans.ts, lib/moduleConfigStore.ts, lib/useModuleSections.ts.
Implement Stage 5 of docs/saas-platform-stages.md.

1. lib/plans.ts stays the source of truth for the catalog. Add per-org overrides on
   organizations (custom_user_limit, custom_storage_gb, extra_modules jsonb,
   custom_monthly_price) for Enterprise / negotiated deals. lib/entitlements.ts:
   getEntitlements(org) → { modules, userLimit, storageGb, departmentLimit } merging plan +
   overrides.
2. Map every ModuleKey in lib/plans.ts to the existing module keys used by moduleConfig /
   isModuleAccessAllowed / the sidebar. A module not in the org's entitlements is hidden in
   the sidebar, its pages redirect to /admin/subscription with an "upgrade" notice, and its
   APIs return 403 { error: 'Not in your plan', code: 'PLAN_MODULE' }. Org admins can still
   disable entitled modules as today, but can't enable non-entitled ones.
3. Limits: creating/importing/reactivating users beyond userLimit is allowed only if the
   plan has extraUserPrice (record it as billable overage), otherwise blocked with a clear
   message. Uploads beyond storage limit are blocked. Department creation beyond limit blocked.
4. Usage snapshot table (organization_usage_daily: active users, storage bytes, records per
   module) filled by a daily cron — used for invoices and the platform dashboard.
5. Tests for gating (UI, page, API) and each limit.
```

## Stage 6 — Manual invoicing, payments and status control

```
Read AGENTS.md, lib/plans.ts, lib/entitlements.ts and Stage 4 code. Implement Stage 6 of
docs/saas-platform-stages.md. There is NO payment gateway — do not add one.

1. Tables:
   - subscriptions: org, plan_id, billing_cycle ('monthly'|'yearly'), price, starts_at,
     current_period_start/end, status.
   - invoices: org, number (sequential per platform, e.g. MIQ-2026-0001), period, line items
     jsonb (plan, extra users × rate, add-ons, discounts), subtotal, gst (lib/plans GST_RATE,
     CGST+SGST vs IGST by state), total, due_date, status ('draft','issued','paid',
     'partially_paid','void'), pdf path.
   - payments: invoice, org, amount, method ('bank_transfer','upi','cheque','cash','other'),
     reference, paid_on, proof file path, submitted_by (org user or platform admin),
     status ('submitted','verified','rejected'), verified_by, verified_at, rejection_reason.
   - organization_status_history: org, from, to, reason, changed_by, at.
2. Platform admin:
   - Generate invoice for an org/period (prefilled from subscription + usage overage),
     edit while draft, issue (PDF with our company details + bank/UPI details, emailed via
     SES to org billing_email).
   - Record a payment directly, or verify / reject an org-submitted payment.
   - Verifying a payment that fully pays the invoice: mark paid, advance paid_through to the
     period end, set org status 'active' (from trial/past_due/suspended), log history.
   - Manual status override with mandatory reason.
   - Dashboard: MRR, outstanding, overdue list, trials ending in 7 days, payments awaiting
     verification.
3. Daily cron /api/cron/subscription-status (shared-secret auth like the other cron routes,
   added to PUBLIC_PATHS): trial ended or invoice past due → 'past_due' (7-day grace,
   reminder emails at due, +3, +6 days); grace over → 'suspended'. Never auto-activate.
4. Enforcement in getViewerContext() + server pages:
   - pending / cancelled → cannot log in (message on login screen).
   - suspended → read-only: every non-GET API returns 402 { code: 'ORG_SUSPENDED' } except
     /api/subscription/* and auth routes; a full-width banner explains and links to billing.
   - past_due → full access + warning banner with days left.
   Org status must be read live (cached ≤60s), not from the token.
5. Tests for every status transition and for read-only enforcement.
```

## Stage 7 — Organization-side subscription page

```
Read AGENTS.md and Stage 6 code. Implement Stage 7 of docs/saas-platform-stages.md.

/admin/subscription (org superadmin and admin only):
- Current plan, status, trial end / paid through, usage vs limits (users, storage,
  departments) with progress bars.
- Invoices list with PDF download and status.
- "I have paid" form per issued invoice: amount, method, reference, date, proof upload
  (image/PDF, max 5 MB) → payment status 'submitted'; notify platform admins by email.
- "Request plan change" → creates a request the platform admin sees; no self-service switch.
- Our bank / UPI details for payment (from platform settings).
This page stays reachable when the org is suspended.
```

## Stage 8 — Public signup request and onboarding

```
Read AGENTS.md, components/landing/*, lib/demoRequestIntake.ts, lib/plans.ts, proxy.ts.
Implement Stage 8 of docs/saas-platform-stages.md.

1. Public /signup page in the same style as /request-demo (components/landing): company
   name, contact name, email, phone, team size, chosen plan (preselected via ?plan=growth
   — make the /pricing plan buttons link to /signup?plan=<id>), GSTIN optional, message.
   Add to LOGGED_OUT_PUBLIC_PATHS in proxy.ts, API under /api/public/; reuse the
   rate-limit and honeypot approach from the demo-request route.
2. Creates an organization_signup_requests row (not an organization). Platform admin sees
   it under /platform/requests and can Approve (creates the org via the Stage 4 flow with
   status 'trial', trial_ends_at = now + TRIAL_DAYS, emails the org superadmin's login) or
   Reject (with reason, emailed).
3. First-login onboarding checklist for the new org superadmin: company profile, departments,
   roles, invite users, choose modules.
```

## Stage 9 — Hardening and release

```
Read AGENTS.md and docs/saas-platform-stages.md. Final hardening for multi-organization launch:
1. Cross-tenant security review of every route in app/api (script that lists routes not
   going through getViewerContext/runAsOrganization/runAsPlatform). Fix any gaps.
2. Optional defense-in-depth: Postgres row-level security on the largest tenant tables using
   SET LOCAL app.organization_id per transaction.
3. Per-org data export (ZIP of CSVs + files) for the platform admin, for cancellations.
4. Backups/restore doc per org; update DEPLOYMENT.md and ROLLBACK.md.
5. Load test with 20 orgs × realistic data; check indexes on (organization_id, …) used by
   the hot list queries.
6. Update QA_REPORTS with an isolation test report.
```
