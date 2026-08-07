import { Model, Op } from 'sequelize';
import { ProductRecord, ProductStatus } from './types';
import { toCsv, csvRowsToObjects, parseCsv } from './csv';
import { db, isUuid } from './db';

const FIELDS = ['name', 'sku', 'category', 'brand', 'description', 'unit', 'hsnSac', 'imageUrl', 'status'] as const;
const NUMBER_FIELDS = ['defaultQty', 'basePrice', 'sellingPrice', 'taxPercent', 'discountPercent'] as const;

function isoOrEmpty(value: unknown): string {
  if (!value) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

const creatorInclude = { model: db.User, as: 'creator', attributes: ['id', 'username'] };

function toRecord(row: Model): ProductRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    id: plain.id,
    created_at: isoOrEmpty(plain.createdAt),
    created_by: (plain.creator as { username?: string } | null)?.username ?? '',
    updated_at: isoOrEmpty(plain.updatedAt)
  };
  for (const f of FIELDS) record[f] = plain[f] ?? '';
  for (const f of NUMBER_FIELDS) record[f] = Number(plain[f] ?? 0);
  return record as unknown as ProductRecord;
}

export interface ProductFilters {
  q?: string;
  category?: string;
  brand?: string;
  status?: ProductStatus;
}

export async function listProducts(filters: ProductFilters = {}): Promise<ProductRecord[]> {
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.category) where.category = filters.category;
  if (filters.brand) where.brand = filters.brand;
  if (filters.q?.trim()) {
    const q = `%${filters.q.trim()}%`;
    where[Op.or as never] = [{ name: { [Op.iLike]: q } }, { sku: { [Op.iLike]: q } }, { category: { [Op.iLike]: q } }, { brand: { [Op.iLike]: q } }, { description: { [Op.iLike]: q } }];
  }
  const rows = await db.Product.findAll({ where: where as never, include: [creatorInclude], order: [['name', 'ASC']] });
  return rows.map(toRecord);
}

// Used by the Quotation module's catalog picker — active products only, no
// admin-only fields required by the caller.
export async function listActiveProducts(): Promise<ProductRecord[]> {
  return listProducts({ status: 'active' });
}

export async function findProductById(id: string): Promise<ProductRecord | undefined> {
  if (!isUuid(id)) return undefined;
  const row = await db.Product.findByPk(id, { include: [creatorInclude] });
  return row ? toRecord(row) : undefined;
}

export interface ProductInput {
  name: string;
  sku: string;
  category: string;
  brand: string;
  description: string;
  unit: string;
  defaultQty: number;
  basePrice: number;
  sellingPrice: number;
  taxPercent: number;
  hsnSac: string;
  discountPercent: number;
  imageUrl: string;
  status: ProductStatus;
}

export async function createProduct(input: ProductInput, createdBy: string): Promise<ProductRecord> {
  const creator = await db.User.findOne({ where: { username: createdBy } as never });
  const row = await db.Product.create({ ...input, createdBy: creator ? creator.get('id') : null } as never);
  return (await findProductById(row.get('id') as string)) as ProductRecord;
}

export async function updateProduct(id: string, patch: Partial<ProductInput>): Promise<ProductRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.Product.findByPk(id);
  if (!row) return null;
  await row.update(patch as never);
  return (await findProductById(id)) ?? null;
}

export async function deleteProduct(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const row = await db.Product.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

export async function duplicateProduct(id: string, createdBy: string): Promise<ProductRecord | null> {
  if (!isUuid(id)) return null;
  const original = await db.Product.findByPk(id);
  if (!original) return null;
  const originalPlain = original.get({ plain: true }) as Record<string, unknown>;
  const creator = await db.User.findOne({ where: { username: createdBy } as never });

  const row = await db.Product.create({
    name: `${originalPlain.name} (Copy)`,
    sku: originalPlain.sku ? `${originalPlain.sku}-COPY` : '',
    category: originalPlain.category,
    brand: originalPlain.brand,
    description: originalPlain.description,
    unit: originalPlain.unit,
    defaultQty: originalPlain.defaultQty,
    basePrice: originalPlain.basePrice,
    sellingPrice: originalPlain.sellingPrice,
    taxPercent: originalPlain.taxPercent,
    hsnSac: originalPlain.hsnSac,
    discountPercent: originalPlain.discountPercent,
    imageUrl: originalPlain.imageUrl,
    status: 'inactive',
    createdBy: creator ? creator.get('id') : null
  } as never);
  return (await findProductById(row.get('id') as string)) ?? null;
}

export interface BulkPriceUpdateInput {
  ids: string[];
  field: 'basePrice' | 'sellingPrice';
  mode: 'percent' | 'flat';
  value: number; // percent: +/-N% adjustment; flat: new absolute price
}

export async function bulkUpdatePrices(input: BulkPriceUpdateInput): Promise<number> {
  const rows = await db.Product.findAll({ where: { id: { [Op.in]: input.ids } } as never });
  for (const row of rows) {
    const current = Number(row.get(input.field) ?? 0);
    const nextValue = input.mode === 'flat' ? Math.max(0, input.value) : Math.max(0, current + (current * input.value) / 100);
    await row.update({ [input.field]: Math.round(nextValue * 100) / 100 } as never);
  }
  return rows.length;
}

const CSV_COLUMNS: { key: keyof ProductRecord; header: string }[] = [
  { key: 'sku', header: 'SKU' },
  { key: 'name', header: 'Product Name' },
  { key: 'category', header: 'Category' },
  { key: 'brand', header: 'Brand' },
  { key: 'description', header: 'Description' },
  { key: 'unit', header: 'Unit' },
  { key: 'defaultQty', header: 'Default Qty' },
  { key: 'basePrice', header: 'Base Price' },
  { key: 'sellingPrice', header: 'Selling Price' },
  { key: 'taxPercent', header: 'Tax %' },
  { key: 'hsnSac', header: 'HSN/SAC' },
  { key: 'discountPercent', header: 'Discount %' },
  { key: 'status', header: 'Status' }
];

export async function buildProductsCsv(): Promise<string> {
  const records = await listProducts();
  return toCsv(
    CSV_COLUMNS.map((c) => c.header),
    records.map((r) => CSV_COLUMNS.map((c) => r[c.key] as string | number))
  );
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// Upserts by SKU when the SKU matches an existing product; otherwise
// creates a new one. Rows without a Product Name are skipped.
export async function importProductsFromCsv(text: string, createdBy: string): Promise<ImportResult> {
  const objects = csvRowsToObjects(parseCsv(text));
  return importProductRows(objects, createdBy);
}

export async function importProductRows(rows: Record<string, string>[], createdBy: string): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const creator = await db.User.findOne({ where: { username: createdBy } as never });

  for (const row of rows) {
    const name = row['Product Name'] || row['name'] || '';
    if (!name.trim()) {
      result.skipped++;
      continue;
    }
    const sku = (row['SKU'] || row['sku'] || '').trim();
    const input: ProductInput = {
      name: name.trim(),
      sku,
      category: row['Category'] || row['category'] || '',
      brand: row['Brand'] || row['brand'] || '',
      description: row['Description'] || row['description'] || '',
      unit: row['Unit'] || row['unit'] || 'Nos',
      defaultQty: Number(row['Default Qty'] || row['defaultQty']) || 1,
      basePrice: Number(row['Base Price'] || row['basePrice']) || 0,
      sellingPrice: Number(row['Selling Price'] || row['sellingPrice']) || 0,
      taxPercent: Number(row['Tax %'] || row['taxPercent']) || 0,
      hsnSac: row['HSN/SAC'] || row['hsnSac'] || '',
      discountPercent: Number(row['Discount %'] || row['discountPercent']) || 0,
      imageUrl: row['Image URL'] || row['imageUrl'] || '',
      status: (row['Status'] || row['status'] || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active'
    };

    const existing = sku ? await db.Product.findOne({ where: { sku: { [Op.iLike]: sku } } as never }) : null;
    if (existing) {
      await existing.update(input as never);
      result.updated++;
    } else {
      await db.Product.create({ ...input, createdBy: creator ? creator.get('id') : null } as never);
      result.created++;
    }
  }

  return result;
}
