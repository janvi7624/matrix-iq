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

const base = {
  url,
  dialect: 'postgres',
  dialectOptions: {
    ssl: { require: true, rejectUnauthorized: false }
  },
  define: {
    schema
  }
};

module.exports = {
  development: base,
  test: base,
  production: base
};
