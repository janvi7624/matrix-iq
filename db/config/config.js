// Next.js auto-loads .env.local into process.env for the app itself, but
// sequelize-cli (and any other plain `node` invocation of this file) is a
// separate process that doesn't know that convention — so we load it here
// explicitly. dotenv never overwrites a variable that's already set, so this
// is a no-op when Next.js has already populated process.env.
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env.local') });

// DATABASE_URL is currently an empty placeholder (Supabase project not yet
// provisioned — see .env.example). We fall back to a syntactically-valid
// dummy connection string so `new Sequelize(...)` never throws synchronously
// at construction/import time (db/models/index.js runs this at module load,
// which happens on every Next.js route import) — Sequelize only fails once
// something actually tries to connect, not just because the module loaded.
const DUMMY_DATABASE_URL = 'postgres://user:pass@localhost:5432/placeholder';

const url = process.env.DATABASE_URL || DUMMY_DATABASE_URL;
const schema = process.env.DATABASE_SCHEMA || 'public';

// Sequelize's own ConnectionManager._loadDialectModule() does a computed
// require(dialectModule) internally (node_modules/sequelize/lib/dialects/
// abstract/connection-manager.js) — no bundler's static tracer (Turbopack,
// webpack, @vercel/nft) can see that call coming, since the module name is
// resolved at runtime from the `dialect` option, not a literal string in
// source. That's the actual mechanism behind "Please install pg package
// manually" surviving multiple deploy-tracing fixes: pg was never missing,
// Sequelize's own internal require of it was the one call no trace step
// could follow. Passing dialectModule directly here makes
// _loadDialectModule return this object and skip that internal require
// entirely (it checks config.dialectModule before ever calling require) —
// so pg only needs to be reachable via the plain, static `require('pg')`
// two lines up, which every bundler traces exactly like any other import.
const pg = require('pg');

const base = {
  url,
  dialect: 'postgres',
  dialectModule: pg,
  dialectOptions: {
    ssl: { require: true, rejectUnauthorized: false }
  },
  define: {
    schema
  },
  // No pool config previously — Sequelize's own default (max: 5) then
  // applied, which is tight for a single Node process serving pages that
  // fire many concurrent API calls each needing a connection (e.g. the
  // Dashboard's parallel fetches). DATABASE_URL points at Supabase's PgBouncer
  // pooler (port 6543, transaction mode — see .env.local), not a direct
  // Postgres connection, so it's already designed to hold far more concurrent
  // client connections than a direct connection's own cap would allow;
  // raising Sequelize's own pool modestly here just lets more of the app's
  // own concurrent requests get a connection immediately instead of queuing
  // behind a pool of 5. Kept moderate rather than large since the actual
  // Supabase plan's connection ceiling isn't known from this codebase alone —
  // this is a safe, justified increase, not an arbitrary one.
  pool: {
    max: 10,
    min: 0,
    idle: 10000,
    acquire: 30000
  }
};

module.exports = {
  development: base,
  test: base,
  production: base
};
