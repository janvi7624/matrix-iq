// Sequelize instance + models are defined as CommonJS in db/models (sequelize-cli's
// standard layout) — this just caches the require() across Next.js dev hot-reloads
// and serverless invocations, same pattern used for any singleton DB client here.
type NantaDb = typeof import('../db/models');

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

export const db = loadDb();
export const sequelize = db.sequelize;
