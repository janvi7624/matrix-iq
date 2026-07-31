import { readJsonBlob, writeJsonBlob } from './blobStore';
import { ProductRecord, ProductStatus } from './types';
import { toCsv, csvRowsToObjects, parseCsv } from './csv';

const DATA_PATHNAME = 'data/products.json';

async function readAll(): Promise<ProductRecord[]> {
  return readJsonBlob<ProductRecord[]>(DATA_PATHNAME, []);
}

async function writeAll(records: ProductRecord[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
}

export interface ProductFilters {
  q?: string;
  category?: string;
  brand?: string;
  status?: ProductStatus;
}

export async function listProducts(filters: ProductFilters = {}): Promise<ProductRecord[]> {
  const records = await readAll();
  const q = filters.q?.trim().toLowerCase();
  const filtered = records.filter((p) => {
    if (filters.status && p.status !== filters.status) return false;
    if (filters.category && p.category !== filters.category) return false;
    if (filters.brand && p.brand !== filters.brand) return false;
    if (q && !`${p.name} ${p.sku} ${p.category} ${p.brand} ${p.description}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return [...filtered].sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
}

// Used by the Quotation module's catalog picker — active products only, no
// admin-only fields required by the caller.
export async function listActiveProducts(): Promise<ProductRecord[]> {
  return listProducts({ status: 'active' });
}

export async function findProductById(id: string): Promise<ProductRecord | undefined> {
  const records = await readAll();
  return records.find((p) => p.id === id);
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

function newId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

export async function createProduct(input: ProductInput, createdBy: string): Promise<ProductRecord> {
  const records = await readAll();
  const now = new Date().toISOString();
  const record: ProductRecord = { id: newId(), created_at: now, created_by: createdBy, updated_at: now, ...input };
  records.push(record);
  await writeAll(records);
  return record;
}

export async function updateProduct(id: string, patch: Partial<ProductInput>): Promise<ProductRecord | null> {
  const records = await readAll();
  const index = records.findIndex((p) => p.id === id);
  if (index === -1) return null;
  const updated: ProductRecord = { ...records[index], ...patch, updated_at: new Date().toISOString() };
  records[index] = updated;
  await writeAll(records);
  return updated;
}

export async function deleteProduct(id: string): Promise<boolean> {
  const records = await readAll();
  const next = records.filter((p) => p.id !== id);
  if (next.length === records.length) return false;
  await writeAll(next);
  return true;
}

export async function duplicateProduct(id: string, createdBy: string): Promise<ProductRecord | null> {
  const original = await findProductById(id);
  if (!original) return null;
  const records = await readAll();
  const now = new Date().toISOString();
  const copy: ProductRecord = {
    ...original,
    id: newId(),
    name: `${original.name} (Copy)`,
    sku: original.sku ? `${original.sku}-COPY` : '',
    created_at: now,
    created_by: createdBy,
    updated_at: now,
    status: 'inactive'
  };
  records.push(copy);
  await writeAll(records);
  return copy;
}

export interface BulkPriceUpdateInput {
  ids: string[];
  field: 'basePrice' | 'sellingPrice';
  mode: 'percent' | 'flat';
  value: number; // percent: +/-N% adjustment; flat: new absolute price
}

export async function bulkUpdatePrices(input: BulkPriceUpdateInput): Promise<number> {
  const records = await readAll();
  const idSet = new Set(input.ids);
  let count = 0;
  const now = new Date().toISOString();
  const next = records.map((p) => {
    if (!idSet.has(p.id)) return p;
    count++;
    const current = p[input.field];
    const nextValue = input.mode === 'flat' ? Math.max(0, input.value) : Math.max(0, current + (current * input.value) / 100);
    return { ...p, [input.field]: Math.round(nextValue * 100) / 100, updated_at: now };
  });
  await writeAll(next);
  return count;
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
  const records = await readAll();
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const now = new Date().toISOString();

  for (const row of rows) {
    const name = row['Product Name'] || row['name'] || '';
    if (!name.trim()) {
      result.skipped++;
      continue;
    }
    const sku = row['SKU'] || row['sku'] || '';
    const input: ProductInput = {
      name: name.trim(),
      sku: sku.trim(),
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

    const existingIndex = sku ? records.findIndex((p) => p.sku && p.sku.toLowerCase() === sku.toLowerCase()) : -1;
    if (existingIndex >= 0) {
      records[existingIndex] = { ...records[existingIndex], ...input, updated_at: now };
      result.updated++;
    } else {
      records.push({ id: `${Date.now()}-${Math.floor(Math.random() * 100000)}-${result.created}`, created_at: now, created_by: createdBy, updated_at: now, ...input });
      result.created++;
    }
  }

  await writeAll(records);
  return result;
}
