import type { Model, ModelStatic, Sequelize } from 'sequelize';

// db/models/*.js build up their exports object with dynamic `db[model.name] =
// model` assignments (sequelize-cli's standard layout), so TypeScript can't
// infer named properties from the plain .js module. Every model is typed
// generically as ModelStatic<Model> here — callers use `.get({ plain: true })`
// and map fields explicitly anyway (see lib/recordStore.ts), so per-model
// attribute typing isn't needed.
interface NantaDb {
  sequelize: Sequelize;
  Sequelize: typeof Sequelize;
  [modelName: string]: ModelStatic<Model> | Sequelize | typeof Sequelize;
}

declare global {
  // eslint-disable-next-line no-var
  var __nantaDb: NantaDb | undefined;
}

function loadDb(): NantaDb {
  if (!global.__nantaDb) {
    global.__nantaDb = require('../db/models');
  }
  return global.__nantaDb as NantaDb;
}

const rawDb = loadDb();

// Re-typed so `db.User`, `db.Role`, etc. resolve to ModelStatic<Model> without
// a cast at every call site.
export const db = rawDb as unknown as Record<string, ModelStatic<Model>> & {
  sequelize: Sequelize;
  Sequelize: typeof Sequelize;
};
export const sequelize = rawDb.sequelize;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every id used to be a Date.now()-based string (pre-Supabase-migration
// blob storage) — a session cookie, bookmarked URL, or stale client cache
// issued before the migration can still hand a route an old-format id.
// Postgres throws a hard "invalid input syntax for type uuid" error for
// those rather than just finding no row, which would otherwise crash a
// page instead of letting its normal not-found handling take over (e.g.
// app/page.tsx's `if (!user) redirect('/login')`). Guard any findByPk-style
// lookup that takes an externally-supplied id with this first.
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
