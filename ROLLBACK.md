# Rollback — MatrixIQ

Procedure for rolling back a bad release. See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the normal deploy process this reverses.

## Code rollback

```bash
git revert <bad-commit>        # preferred — keeps history, doesn't rewrite shared branches
# or, for a just-pushed bad deploy nobody else has based work on:
git reset --hard <last-good-commit>   # only with the team's explicit agreement — rewrites history

npm ci
npm run build
npm start   # or however the production process is restarted — see DEPLOYMENT.md's restart-strategy note
```

Never force-push over `main`/`dev` without explicit agreement — this is the same standing rule this engagement's own git-safety practice has followed throughout (see `AGENTS.md`/session conventions).

## Database rollback (schema changes)

Every migration in this repo has a working `down()` (verified in `QA_REPORTS/FINAL_RELEASE_CERTIFICATION/DATABASE_RELEASE_AUDIT.md` — 133/133 at the time of that audit). To revert the most recent migration:

```bash
npm run db:migrate:undo
```

To revert more than one, run it repeatedly (once per migration), or use `sequelize-cli`'s `db:migrate:undo:all --to <migration-name>` to roll back to a specific point.

**Before rolling back a schema migration in production**: confirm no code already deployed depends on the column/table being reverted — a `down()` running cleanly does not by itself guarantee the currently-running application code doesn't still expect the column to exist. Roll back code first, or simultaneously, not schema-only.

## What's NOT yet covered here

- **Data loss from a bad migration that already ran against production data** (as opposed to a pure schema change) is not something `down()` alone fixes — that requires an actual data restore. See `QA_REPORTS/FINAL_RELEASE_CERTIFICATION/OPEN_FINDINGS.csv`'s `REL-DB-003` finding: no backup/restore tooling or documentation exists in this repo for the core database, and what exists at the infrastructure level (if anything) has not been confirmed. **Do not assume a backup exists** — confirm with whoever manages the Supabase/Postgres instance before relying on one.
- **Rolling back a change already live for a while**, where other data has since been created that depends on it, needs case-by-case judgment — this runbook covers the mechanical "how", not every business judgment call.

## Verifying a rollback worked

After rolling back, re-run the smoke checks:

```bash
curl -s https://<host>/api/health   # expect {"status":"ok","db":"ok",...}
npm test                             # if rolling back in a place you can still run the suite
```
