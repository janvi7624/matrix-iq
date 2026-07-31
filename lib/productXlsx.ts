import ExcelJS from 'exceljs';
import { ProductRecord } from './types';
import { BRAND } from './branding';

const COLUMNS: { header: string; key: keyof ProductRecord; width: number }[] = [
  { header: 'SKU', key: 'sku', width: 16 },
  { header: 'Product Name', key: 'name', width: 28 },
  { header: 'Category', key: 'category', width: 16 },
  { header: 'Brand', key: 'brand', width: 16 },
  { header: 'Description', key: 'description', width: 32 },
  { header: 'Unit', key: 'unit', width: 10 },
  { header: 'Default Qty', key: 'defaultQty', width: 12 },
  { header: 'Base Price', key: 'basePrice', width: 14 },
  { header: 'Selling Price', key: 'sellingPrice', width: 14 },
  { header: 'Tax %', key: 'taxPercent', width: 10 },
  { header: 'HSN/SAC', key: 'hsnSac', width: 12 },
  { header: 'Discount %', key: 'discountPercent', width: 12 },
  { header: 'Status', key: 'status', width: 10 }
];

export async function buildProductsXlsxBuffer(records: ProductRecord[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${BRAND.companyName} ${BRAND.appName}`;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Products');
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  records.forEach((record) => {
    const row: Record<string, unknown> = {};
    COLUMNS.forEach((c) => {
      row[c.key] = record[c.key];
    });
    sheet.addRow(row);
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
