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
