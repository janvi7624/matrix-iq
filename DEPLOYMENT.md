# Deployment — MatrixIQ

This covers release/deploy procedure. For local dev setup, see [`README.md`](./README.md).

## Build

```bash
npm ci
npm run db:migrate   # against the TARGET environment's DATABASE_URL
npm run build        # runs next build, then scripts/postbuild.js
npm start             # node .next/standalone/server.js
```

`output: 'standalone'` (see `next.config.ts`) produces a trimmed, self-contained server at `.next/standalone/server.js`. `scripts/postbuild.js` copies `public/` and `.next/static` into that output — Next does not do this itself, and skipping it ships a server that boots but serves pages whose scripts/assets 404.

### Known production build issues (already fixed, don't reintroduce)

- **Build OOM on a constrained host**: `npm run build` runs with `NODE_OPTIONS=--max-old-space-size=2048` (see the `build` script in `package.json`) specifically because the default heap limit OOM'd on this app's production host. `next.config.ts` also sizes its worker pool from CPU count, overridable via `NEXT_BUILD_CPUS` for a host where auto-detection is wrong (e.g. a constrained container).
- **Missing `pg` module at runtime**: the standalone build's dependency tracing has previously dropped the `pg` driver Sequelize needs at runtime. If the deployed app fails to connect to Postgres with a "Cannot find module 'pg'"-shaped error, check `next.config.ts`'s `serverExternalPackages`/webpack externals configuration first — this is a recurrence of a previously-diagnosed issue, not a new one.

## Database migrations

Migrations run via `sequelize-cli` (`npm run db:migrate`), reading `DATABASE_URL` from the environment (see `db/config/config.js`). Every migration in this repo has a working `down()` — verified as part of this engagement's QA passes (see `QA_REPORTS/FINAL_RELEASE_CERTIFICATION/DATABASE_RELEASE_AUDIT.md`).

**Run migrations BEFORE restarting the app process on a schema-adding deploy.** See the restart-strategy note below for why this matters more than it would on a stateless app.

## Restart strategy — read this before changing the deploy process

This app's Node process **caches Sequelize model definitions for its entire lifetime**. A real incident during this engagement (the session-epoch migration) required a manual process restart (`taskkill` + relaunch) before a newly-added database column was recognized — the running process kept using its stale, pre-migration model definition until restarted.

**Practical implication**: if the production deploy process does a *rolling* restart (old instances keep serving requests while new ones spin up) rather than a *hard* restart (stop-then-start, briefly unavailable), a schema-adding migration could have in-flight old-process instances serving requests against the new schema with stale model definitions, for however long the rollover takes. This was flagged as `REL-DEPLOY-005` — **confirm with whoever manages the actual production deploy (Hostinger) which restart strategy is in use**, and if it's rolling, either switch to a brief hard restart for schema-adding deploys specifically, or accept the staleness window consciously rather than by accident.

## Environment variables

See `.env.example` for the full, documented list — every variable actually read by the app (`process.env.X`) is listed there, each with a comment on what it's for and whether it's optional. Keep that file in sync whenever a new `process.env.X` reference is added to the code (see `REL-DEPLOY-002` — 4 were previously undocumented; now fixed).

## Health check

`GET /api/health` (unauthenticated) returns `{ status: 'ok', db: 'ok', time }` with HTTP 200 if the process is up and can reach Postgres, or HTTP 503 otherwise. Point an uptime monitor or load balancer health check at this — it was added specifically because no infra-level liveness probe existed before (`REL-DEPLOY-004`; do not confuse it with `/api/dashboard/health`, which is an authenticated business feature, not a health check).

## Rollback

See [`ROLLBACK.md`](./ROLLBACK.md).

## CI

`.github/workflows/ci.yml` runs typecheck, Vitest, Playwright, and a production build against a real Postgres service container on every push/PR to `dev`/`main`. Lint runs informationally (not a hard gate) — see the workflow file's own comment for why.
