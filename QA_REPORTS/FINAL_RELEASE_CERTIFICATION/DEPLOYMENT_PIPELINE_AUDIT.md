# Deployment, Pipeline & Infrastructure Audit — MatrixIQ

Scope: build/release process, CI/CD, environment configuration, migration procedure, health/monitoring, local-vs-production config drift, rollback strategy. This area had no prior QA pass this engagement — everything here is new.

Status values: PASS / FAIL / PARTIAL / NOT TESTED / BLOCKED / DECISION REQUIRED.

## 1. Build/release process — PASS (understood and verified)

Confirmed by reading `package.json`, `next.config.ts`, `scripts/postbuild.js`:

- `npm run build` → `next build --webpack` (deliberately webpack, not Turbopack — `next.config.ts`'s own comment explains this was chosen specifically to survive a memory-limited build container, since Turbopack's native-Rust allocation isn't bounded by `--max-old-space-size` the way webpack's V8-heap compilation is) → `output: 'standalone'` emits `.next/standalone/server.js` + a trimmed `node_modules`.
- `postbuild` (`scripts/postbuild.js`) then copies `public/` and `.next/static` into the standalone output — both required at runtime but not copied by `next build` itself. The script fails loudly (non-zero exit, clear message) if either copy fails or if `server.js` ends up missing, rather than producing a build that looks complete but 404s on every asset.
- `npm start` → `node .next/standalone/server.js` — the actual production entrypoint.
- `serverExternalPackages: ['sequelize', 'pg', 'pg-hstore']` + `outputFileTracingIncludes` in `next.config.ts` exist specifically to work around a documented real incident (per the config's own comment): Sequelize's dynamic `require(dialectModule)` isn't visible to static trace analysis, so without this the deployed bundle silently ships without `pg`'s files and every request 500s with "Please install pg package manually" — confirmed this was previously diagnosed against the actual Hostinger deploy.

**This is a well-engineered, battle-tested build pipeline** — the comments throughout reference specific prior production incidents (Hostinger build OOM, missing `pg` module) that were diagnosed and fixed, not theoretical hardening.

## 2. CI/CD — FAIL (REL-DEPLOY-001)

**No CI/CD pipeline exists.** Checked for `.github/workflows/`, any `.gitlab-ci.yml`, `Dockerfile`, Jenkinsfile, or other CI config at the repository root — none found.

- **Finding ID**: REL-DEPLOY-001
- **Severity**: Medium
- **Affected**: Entire release process
- **Evidence**: `ls .github` → "No such file or directory"; no CI config files anywhere in the repo root
- **Impact**: Every `npm test` / `npm run build` / `npm run lint` run this QA engagement has performed was run manually, by an agent, on a developer machine. There is no automated gate preventing a broken build, a failing test, or a lint regression from reaching `dev`/production — it relies entirely on a human (or an AI session) remembering to run these checks before every push. Given this session alone found that another concurrent session's commit bundled 6 unrelated files into a mis-described commit message purely by timing accident, the absence of any automated check is a real, demonstrated risk, not a hypothetical one.
- **Recommended correction**: A GitHub Actions workflow running `npm run typecheck && npm test && npm run build && npm run lint` on every push/PR to `dev`/`main` would catch exactly this class of problem automatically. Scope/complexity: Low-Medium — the commands already exist and are known-working; the workflow YAML itself is maybe 20-30 lines.
- **Estimated complexity**: Low
- **Regression test needed**: N/A (infrastructure, not application code)

## 3. Environment variables — PARTIAL (REL-DEPLOY-002)

Cross-referenced every `process.env.X` reference in `app/`, `lib/`, `db/`, `scripts/`, `components/`, `proxy.ts` against the keys documented in `.env.example` (33 variables used in app code vs. 25 documented — key names compared only, no values read or printed, per instruction).

**8 variables used in code but not listed in `.env.example`:**

| Variable | Used in | Has a safe fallback? |
|---|---|---|
| `DAILY_REPORT_AUTO_SWEEP` | `lib/dailyReportAutoSweep.ts` | Yes — defaults to off (`''`) |
| `SES_CONFIG_SET` | `lib/email/emailService.ts` | Yes — `|| undefined`, AWS SES just omits the configuration set |
| `SOP_ORGANISATION` | `scripts/generate-sop-library.ts` | Yes — falls back to the brand's legal name |
| `SOP_ACTOR` | `scripts/generate-sop-library.ts` | Yes — falls back to `'main'` |
| `NODE_ENV`, `NODE_OPTIONS`, `NEXT_RUNTIME` | build tooling / Node/Next internals | Standard platform variables, not app-specific — not a real documentation gap |
| `NEXT_BUILD_HEAP_MB` | not actually found referenced in app source on closer check | Likely a false-positive pickup from the broader initial scan; not a real finding |

- **Finding ID**: REL-DEPLOY-002
- **Severity**: Low
- **Affected**: `.env.example`, onboarding/deploy documentation
- **Evidence**: `comm -23` diff of grepped `process.env.*` usage vs. `.env.example` keys (command and output above; no values printed)
- **Impact**: Low — all 4 real gaps (`DAILY_REPORT_AUTO_SWEEP`, `SES_CONFIG_SET`, `SOP_ORGANISATION`, `SOP_ACTOR`) have safe, functional fallback defaults in code, so a deploy missing them does NOT break — it just means a new developer/deployer has no documented way to discover these optional overrides exist without reading the source.
- **Recommended correction**: Add the 4 real variables to `.env.example` with a one-line comment each (already have fallback behavior documented in their own source comments — just needs porting to `.env.example`).
- **Estimated complexity**: Trivial (4 lines)
- **Regression test needed**: No

The 17 documented-and-used + README's own explicit list (`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `DATABASE_URL`) are consistent — **PASS** for the core required set.

## 4. Database migration procedure — PARTIAL (REL-DEPLOY-003)

`npm run db:migrate` / `npm run db:migrate:undo` / `npm run db:seed:all` all exist and work (confirmed functional multiple times this engagement — both pending migrations from earlier in this session were successfully applied by the user via this exact command).

**No documented production migration runbook exists.** README's "Getting Started" mentions `npm run db:migrate` only in the context of local first-time setup, not as part of any described production deploy sequence (e.g., "run migrations before swapping traffic to the new build" vs. "after" — order matters and isn't specified anywhere).

- **Finding ID**: REL-DEPLOY-003
- **Severity**: Low
- **Affected**: Deploy/release documentation
- **Evidence**: README.md (49 lines, full file read) contains no deployment section at all, only local dev setup
- **Impact**: Low-Medium — the migrations in this codebase are all additive (confirmed via this session's own QA — new nullable-defaulted columns), so ordering risk is currently low. But this is a convention that holds only because migrations have been written carefully so far, not because a process enforces it. A future non-additive migration (e.g. a column rename or NOT NULL tightening) run at the wrong point in a deploy could cause a real outage.
- **Recommended correction**: A short `DEPLOY.md` or README section: when to run migrations relative to swapping traffic, and the expectation that migrations should be additive/backward-compatible with the previous code version (the pattern already followed, just not written down).
- **Estimated complexity**: Low (documentation only)
- **Regression test needed**: No

## 5. Health checks / error monitoring — FAIL (REL-DEPLOY-004)

**No infrastructure health-check endpoint exists.** `app/api/dashboard/health` was found and initially looked promising by name, but on inspection it's a business feature (per-department performance scoring for the Dashboard UI) — it requires full authentication/viewer context and has nothing to do with liveness/readiness probing. There is no unauthenticated `/api/health` or `/healthz`-style endpoint a load balancer or uptime monitor could poll.

**No error-tracking/monitoring SDK is integrated.** Checked `package.json` for Sentry, Rollbar, Bugsnag, or any APM package — none found. No structured logging library (Winston, Pino) either — this session's own observation of the dev server's console output confirms logging is plain `console.log`/Sequelize's own query-echo logging, not a structured, aggregatable log format.

- **Finding ID**: REL-DEPLOY-004
- **Severity**: Medium
- **Affected**: Production observability
- **Evidence**: `app/api/dashboard/health/route.ts` requires `getViewerContext` (authenticated); `package.json` dependency list has no error-tracking package
- **Impact**: Medium — if the production process crashes, hangs, or an endpoint starts throwing, there is no automated signal beyond a user noticing something's broken and reporting it. No way to be alerted to an elevated error rate before a user complains.
- **Recommended correction**: (a) A trivial unauthenticated `/api/health` route that confirms the process is up and can reach the DB (a `SELECT 1`) — cheap, fast to add. (b) A dedicated error-tracking SDK (e.g. Sentry's Next.js integration) is a larger, separate decision — flagging as DECISION REQUIRED given cost/vendor implications, not something to add unilaterally.
- **Estimated complexity**: Low for (a), Medium for (b) (new dependency + account setup)
- **Regression test needed**: Yes, for (a) — confirm the endpoint returns 200 when DB is reachable

**DECISION REQUIRED**: Do you want an error-tracking/APM service added (Sentry or similar)? This has cost and data-residency implications I can't decide unilaterally.

## 6. Local vs. production config differences — DECISION REQUIRED (REL-DEPLOY-005)

Confirmed one real, already-encountered-this-session behavioral difference worth flagging explicitly for production risk, beyond just being a dev annoyance:

- **Sequelize model-definition caching across a long-running process.** This session discovered directly: `next dev`'s long-running process caches `db/models/*.js` definitions at process start; a new column added to a model only takes effect after a full process restart, not just a file save. The question this raises for production: **does your production deploy process fully terminate the OLD running `server.js` process before starting the new one, or does it do any kind of rolling/overlapping restart?** If old process instances linger even briefly after a schema-changing deploy (migration + new model field), requests served by the stale instance would silently fail to read/write the new column, exactly as was observed in dev this session — the model-caching behavior is a property of the long-running Node process itself (standard `require()` caching), not specific to `next dev`, so it is NOT purely a dev-mode artifact.
- **Finding ID**: REL-DEPLOY-005
- **Severity**: Medium (contingent on actual deploy mechanism, which is BLOCKED/unknown from here)
- **Affected**: Any future schema-adding migration + the production process restart sequence
- **Evidence**: Directly reproduced this session (session-epoch column, required a manual `taskkill` + restart of the dev `next` process to take effect; confirmed the old process continued silently misbehaving until killed)
- **Impact**: Depends entirely on the actual Hostinger deploy mechanism, which this session has no visibility into (BLOCKED — see below).
- **Recommended correction**: Confirm the production deploy process does a hard stop-then-start (not a rolling restart) of `server.js`, OR confirm Hostinger's own process manager guarantees this. If it's a rolling/zero-downtime restart, a schema-adding deploy needs the migration to run and ALL old instances to be gone before any request is likely to touch the new column — the existing migration pattern (additive, nullable-defaulted columns) is forgiving here since old code just won't query the new column, but it's still worth confirming explicitly rather than assuming.
- **Estimated complexity**: N/A — this is a question about infrastructure behavior, not a code change
- **Regression test needed**: No

**DECISION REQUIRED**: What is the actual Hostinger deploy/restart mechanism? (hard restart vs rolling) — this session cannot determine this without infrastructure access.

## 7. Rollback strategy — PARTIAL (REL-DEPLOY-006)

No documented rollback procedure beyond the implicit "git revert and redeploy" available from any git-based deploy. Confirmed in this session's own `RELEASE_READINESS.md` (prior QA pass) that every migration this session touched has a working `down()` — that's a real, positive finding for migration-level rollback safety — but there's no written procedure describing: how to revert a bad production deploy end-to-end (code + any already-applied migration), who's authorized to do it, or how fast it can happen.

- **Finding ID**: REL-DEPLOY-006
- **Severity**: Low
- **Affected**: Incident response / deploy documentation
- **Evidence**: No `DEPLOY.md`/runbook found; README has no rollback section
- **Impact**: Low-Medium — the technical capability exists (git revert, `db:migrate:undo`), but isn't written down as a procedure, which matters most exactly when it's needed under pressure.
- **Recommended correction**: A short written rollback runbook (even 10 lines) covering: revert the commit, redeploy, and when/whether to run `db:migrate:undo` (only safe if the reverted commit's migration truly has no destructive/irreversible step — worth a one-line reminder to check that each time).
- **Estimated complexity**: Low (documentation only)
- **Regression test needed**: No

## BLOCKED items (genuinely cannot verify without infrastructure access)

| Item | Why blocked |
|---|---|
| Actual Hostinger deploy process/restart behavior | No access to Hostinger's own deployment configuration or process manager from this environment |
| HTTPS/TLS termination, reverse proxy configuration | Not visible from the repository — likely handled at Hostinger's platform level, not in-repo |
| Actual production environment variable values/correctness | Deliberately not inspected (instruction: never print secret values) and not accessible from this environment regardless |
| Real backup/restore procedure for the Supabase-hosted Postgres database | No access to Supabase's own backup configuration/retention settings from this environment — README confirms the DB is "Supabase-hosted" but nothing in-repo describes backup/restore policy |
| Production log aggregation / monitoring dashboards, if any exist outside this repo | Not visible from the repository |

## Summary

| Area | Status |
|---|---|
| Build/release process | **PASS** — well-engineered, battle-tested, documented via code comments referencing real prior incidents |
| CI/CD | **FAIL** — none exists |
| Environment variable documentation | **PARTIAL** — 4 real, low-severity gaps, all with safe fallbacks |
| Migration procedure | **PARTIAL** — scripts work, no written production runbook |
| Health checks | **FAIL** — no infra-level liveness endpoint |
| Error monitoring | **FAIL** — none integrated |
| Local vs. production config drift | **DECISION REQUIRED** — real risk identified, severity depends on infra behavior this session can't see |
| Rollback strategy | **PARTIAL** — technically capable, not documented |
| Backup/restore | **BLOCKED** — no visibility into Supabase's configuration |

No critical defects found in this area. The gaps found are real but are release-readiness/operational-maturity gaps (missing CI, missing health checks, missing runbooks) rather than application defects — none of them would prevent a release from functioning correctly on day one, but several would make it harder to detect or recover from a problem after release.
