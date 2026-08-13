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

export async function upsertOverride(input: UpsertOverrideInput, updatedByUsername: string): Promise<ProductCatalogOverrideRecord> {
  const updater = await db.User.findOne({ where: { username: updatedByUsername } as never });
  const [row] = await db.ProductCatalogOverride.findOrCreate({
    where: { catalog: input.catalog, productKey: input.productKey } as never,
    defaults: { catalog: input.catalog, productKey: input.productKey } as never
  });
  await row.update({
    name: input.name ?? null,
    fields: input.fields ?? null,
    updatedBy: updater ? updater.get('id') : null
  } as never);
  return toRecord((await db.ProductCatalogOverride.findByPk(row.get('id') as string, { include: [updaterInclude] })) as Model);
}

export async function deleteOverride(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.ProductCatalogOverride.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}
