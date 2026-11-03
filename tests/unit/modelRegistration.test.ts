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
