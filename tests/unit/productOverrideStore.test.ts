import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Model, ModelStatic } from 'sequelize';

vi.mock('../../lib/db', () => ({
  db: {
    User: { findOne: vi.fn() },
    ProductCatalogOverride: { findOne: vi.fn(), create: vi.fn(), findByPk: vi.fn(), findAll: vi.fn() }
  },
  isUuid: (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}));

import { db } from '../../lib/db';
import { upsertOverride } from '../../lib/productOverrideStore';
import { fakeRow, fakeUser } from '../helpers/fakeSequelize';

const model = db.ProductCatalogOverride as ModelStatic<Model> & {
  findOne: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  findByPk: ReturnType<typeof vi.fn>;
};
const userFindOne = vi.mocked(db.User.findOne);

// The bug this file exists for: upsertOverride used Model.findOrCreate, and
// Sequelize implements findOrCreate's insert by creating a plpgsql function in
// pg_temp so it can trap the unique violation inside the database. That needs
// the TEMPORARY privilege on the database, which the deployed app role is not
// granted, so every price/name override save failed with "permission denied to
// create temporary tables in database". Nothing in tsc, eslint or the rest of
// the suite can see a missing DB privilege, so the guard is here: findOrCreate
// is not even defined on the mocked model, which means reintroducing it fails
// these tests loudly instead of only failing in production.
function existingRow(id: string, plain: Record<string, unknown> = {}) {
  return fakeRow({ id, catalog: 'led', productKey: 'p1', name: null, fields: null, updatedAt: new Date(0), ...plain });
}

function uniqueViolation() {
  const error = new Error('duplicate key value violates unique constraint');
  error.name = 'SequelizeUniqueConstraintError';
  return error;
}

describe('upsertOverride', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    userFindOne.mockResolvedValue(fakeUser('user-1', 'alice') as never);
  });

  it('creates the override when none exists, without findOrCreate', async () => {
    model.findOne.mockResolvedValue(null);
    model.create.mockResolvedValue(existingRow('new-id'));
    model.findByPk.mockResolvedValue(existingRow('new-id', { name: 'Panel', fields: { sellingPrice: 150 } }));

    const result = await upsertOverride(
      { catalog: 'led', productKey: 'p1', name: 'Panel', fields: { sellingPrice: 150 } },
      'alice'
    );

    expect(model.create).toHaveBeenCalledTimes(1);
    expect(model.create.mock.calls[0][0]).toMatchObject({
      catalog: 'led',
      productKey: 'p1',
      name: 'Panel',
      fields: { sellingPrice: 150 },
      updatedBy: 'user-1'
    });
    expect(result.fields).toEqual({ sellingPrice: 150 });
    expect((model as unknown as { findOrCreate?: unknown }).findOrCreate).toBeUndefined();
  });

  it('updates in place when the override already exists', async () => {
    const row = existingRow('row-1');
    model.findOne.mockResolvedValue(row);
    model.findByPk.mockResolvedValue(existingRow('row-1', { fields: { sellingPrice: 275 } }));

    const result = await upsertOverride({ catalog: 'led', productKey: 'p1', fields: { sellingPrice: 275 } }, 'alice');

    expect(model.create).not.toHaveBeenCalled();
    expect(row.update).toHaveBeenCalledWith({ name: null, fields: { sellingPrice: 275 }, updatedBy: 'user-1' });
    expect(result.fields).toEqual({ sellingPrice: 275 });
  });

  it('adopts the winner row when a concurrent save wins the insert race', async () => {
    const raced = existingRow('row-winner');
    model.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(raced);
    model.create.mockRejectedValue(uniqueViolation());
    model.findByPk.mockResolvedValue(existingRow('row-winner', { fields: { sellingPrice: 300 } }));

    const result = await upsertOverride({ catalog: 'led', productKey: 'p1', fields: { sellingPrice: 300 } }, 'alice');

    expect(raced.update).toHaveBeenCalledWith({ name: null, fields: { sellingPrice: 300 }, updatedBy: 'user-1' });
    expect(result.id).toBe('row-winner');
  });

  it('rethrows an insert failure that is not a unique violation', async () => {
    model.findOne.mockResolvedValue(null);
    model.create.mockRejectedValue(new Error('connection terminated'));

    await expect(upsertOverride({ catalog: 'led', productKey: 'p1' }, 'alice')).rejects.toThrow('connection terminated');
  });

  it('rethrows the unique violation when the winner row cannot be found', async () => {
    model.findOne.mockResolvedValue(null);
    model.create.mockRejectedValue(uniqueViolation());

    await expect(upsertOverride({ catalog: 'led', productKey: 'p1' }, 'alice')).rejects.toThrow(
      'duplicate key value violates unique constraint'
    );
  });

  it('records a null updater when the username does not resolve', async () => {
    userFindOne.mockResolvedValue(null as never);
    model.findOne.mockResolvedValue(null);
    model.create.mockResolvedValue(existingRow('new-id'));
    model.findByPk.mockResolvedValue(existingRow('new-id'));

    await upsertOverride({ catalog: 'led', productKey: 'p1' }, 'ghost');

    expect(model.create.mock.calls[0][0]).toMatchObject({ updatedBy: null });
  });
});
