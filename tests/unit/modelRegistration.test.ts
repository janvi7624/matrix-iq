import { describe, it, expect } from 'vitest';

// Every Sequelize model file must be listed in db/models/index.js.
//
// This exists because of a bug that reached "verified" without anything
// noticing. db/models/index.js uses STATIC requires rather than a directory
// scan — deliberately, so Turbopack can follow them — which means a new
// model file that nobody adds to that list simply does not exist at runtime:
// db.TheModel is undefined and every call through it throws
// "Cannot read properties of undefined".
//
// Typecheck passed, the production build passed, and the pure unit tests
// passed, because none of them touch db. Only running the real query found
// it. This test is the cheap, permanent version of that discovery: it
// compares the model files on disk with what the index actually registers.
//
// Requiring db/models constructs a Sequelize instance but does not connect —
// no query is issued here, so this runs without a database.

describe('db/models/index.js', () => {
  it('registers every model file on disk', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const modelsDir = path.resolve(process.cwd(), 'db/models');

    const onDisk = fs
      .readdirSync(modelsDir)
      .filter((f) => f.endsWith('.js') && f !== 'index.js')
      .sort();

    const indexSource = fs.readFileSync(path.join(modelsDir, 'index.js'), 'utf8');
    const unregistered = onDisk.filter((file) => !indexSource.includes(`./${file}`));

    expect(
      unregistered,
      `These model files exist but are not required in db/models/index.js, so db.<Model> will be undefined at runtime: ${unregistered.join(', ')}`
    ).toEqual([]);
  });

  it('exposes the partner onboarding model it was written for', async () => {
    const db = (await import('../../db/models')) as unknown as Record<string, unknown>;
    expect(db.PartnerDocument, 'db.PartnerDocument is undefined — partnerDocument.js is not registered').toBeDefined();
    expect(db.Partner).toBeDefined();
  });
});

// The same mistake one level down.
//
// A column can exist in the database and in the TypeScript record and STILL
// be invisible, because Sequelize silently ignores an attribute its model
// does not declare: writes drop the value and reads come back undefined. It
// has now happened three times on this feature — partners.onboarded_at, the
// partnerDocument model file, and app_config.partnerCreatorIds, whose
// settings checkboxes appeared to untick themselves on save.
//
// Nothing else catches it. The migration is right, the store is right, the
// types are right, typecheck passes and the build passes.
//
// Scoped to the tables this feature touches rather than every model: a few
// older tables legitimately carry columns no model declares, and a blanket
// assertion would fail for reasons that are not bugs.
describe('model attributes match the database columns', () => {
  const TABLES: { model: string; table: string }[] = [
    { model: 'AppConfig', table: 'app_config' },
    { model: 'Partner', table: 'partners' },
    { model: 'PartnerDocument', table: 'partner_documents' }
  ];

  for (const { model, table } of TABLES) {
    it(`${model} declares every column of ${table}`, async () => {
      const mod = (await import('../../db/models')) as unknown as Record<string, { rawAttributes?: Record<string, unknown> }>;
      const sequelize = (mod as unknown as { sequelize: { query: (sql: string, o: unknown) => Promise<unknown[]> } }).sequelize;

      const rows = (await sequelize.query(
        `select column_name from information_schema.columns where table_name = '${table}'`,
        { logging: false }
      ))[0] as { column_name: string }[];

      // Sequelize maps camelCase attributes onto snake_case columns on an
      // underscored model, so compare both spellings.
      const declared = new Set<string>();
      for (const attr of Object.keys(mod[model]?.rawAttributes ?? {})) {
        declared.add(attr);
        declared.add(attr.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
      }

      const undeclared = rows.map((r) => r.column_name).filter((col) => !declared.has(col));
      expect(
        undeclared,
        `${table} has columns that ${model} does not declare, so Sequelize will drop them on write and read them as undefined: ${undeclared.join(', ')}`
      ).toEqual([]);
    });
  }
});
