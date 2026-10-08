import { Model } from 'sequelize';
import { db, isUuid } from './db';

export interface ProductCatalogOverrideRecord {
  id: string;
  catalog: string;
  productKey: string;
  name: string | null;
  fields: Record<string, unknown> | null;
  updatedBy: string; // username
  updatedAt: string;
}

function toRecord(row: Model): ProductCatalogOverrideRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    catalog: plain.catalog as string,
    productKey: plain.productKey as string,
    name: (plain.name as string) ?? null,
    fields: (plain.fields as Record<string, unknown>) ?? null,
    updatedBy: (plain.updater as { username?: string } | null)?.username ?? '',
    updatedAt: plain.updatedAt instanceof Date ? (plain.updatedAt as Date).toISOString() : String(plain.updatedAt ?? '')
  };
}

const updaterInclude = { model: db.User, as: 'updater', attributes: ['id', 'username'] };

export async function listOverrides(catalog?: string): Promise<ProductCatalogOverrideRecord[]> {
  const where = catalog ? ({ catalog } as never) : undefined;
  const rows = await db.ProductCatalogOverride.findAll({ where, include: [updaterInclude] });
  return rows.map(toRecord);
}

export interface UpsertOverrideInput {
  catalog: string;
  productKey: string;
  name?: string | null;
  fields?: Record<string, unknown> | null;
}

// Identified by name rather than with "instanceof UniqueConstraintError":
// that class is not exposed on the Sequelize class's public types, and
// importing it from 'sequelize' directly would reintroduce exactly the
// two-copies-of-the-module hazard that makes this repo take its query helpers
// off db.Sequelize instead. The name is stable across both.
function isUniqueViolation(error: unknown): boolean {
  return !!error && (error as { name?: string }).name === 'SequelizeUniqueConstraintError';
}

async function reload(id: string): Promise<ProductCatalogOverrideRecord> {
  return toRecord((await db.ProductCatalogOverride.findByPk(id, { include: [updaterInclude] })) as Model);
}

export async function upsertOverride(input: UpsertOverrideInput, updatedByUsername: string): Promise<ProductCatalogOverrideRecord> {
  const updater = await db.User.findOne({ where: { username: updatedByUsername } as never });
  const values = {
    name: input.name ?? null,
    fields: input.fields ?? null,
    updatedBy: updater ? updater.get('id') : null
  };

  // Deliberately NOT findOrCreate. Sequelize implements findOrCreate's insert
  // by setting options.exception, which makes the Postgres query generator
  // wrap the INSERT in "CREATE OR REPLACE FUNCTION pg_temp.testfunc(...)"
  // (node_modules/sequelize/lib/dialects/abstract/query-generator.js) so the
  // unique violation can be caught inside the database. Creating anything in
  // pg_temp needs the TEMPORARY privilege on the database, and the app role
  // here is granted CONNECT only — so every single price/name override save
  // failed with "permission denied to create temporary tables in database".
  // findOne + create asks for no such privilege and is the same shape
  // reimbursementSheetStore.findOrCreate already uses for its own upsert.
  const where = { catalog: input.catalog, productKey: input.productKey } as never;

  const existing = await db.ProductCatalogOverride.findOne({ where });
  if (existing) {
    await existing.update(values as never);
    return reload(existing.get('id') as string);
  }

  try {
    const created = await db.ProductCatalogOverride.create({ catalog: input.catalog, productKey: input.productKey, ...values } as never);
    return reload(created.get('id') as string);
  } catch (error) {
    // (catalog, productKey) is uniquely indexed, so two people saving the same
    // product at once means one insert loses. The loser adopts the winner's row
    // and applies its own values to it, which is what findOrCreate did for us.
    if (!isUniqueViolation(error)) throw error;
    const raced = await db.ProductCatalogOverride.findOne({ where });
    if (!raced) throw error;
    await raced.update(values as never);
    return reload(raced.get('id') as string);
  }
}

export async function deleteOverride(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.ProductCatalogOverride.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}
