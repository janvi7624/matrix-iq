import ExcelJS from 'exceljs';
import { QuotationRecord } from './types';

const COLUMNS: { header: string; key: keyof QuotationRecord; width: number }[] = [
  { header: 'Quotation Number', key: 'quotation_number', width: 24 },
  { header: 'Date', key: 'created_at', width: 22 },
  { header: 'Prepared By', key: 'prepared_by', width: 20 },
  { header: 'Prepared By Phone', key: 'prepared_by_phone', width: 18 },
  { header: 'Prepared By Email', key: 'prepared_by_email', width: 24 },
  { header: 'Client Name', key: 'client_name', width: 20 },
  { header: 'Client Company', key: 'client_company', width: 22 },
  { header: 'Client Email', key: 'client_email', width: 24 },
  { header: 'Client Phone', key: 'client_phone', width: 16 },
  { header: 'Client Address', key: 'client_address', width: 30 },
  { header: 'Project Vertical', key: 'project_vertical', width: 16 },
  { header: 'Domain', key: 'domain_summary', width: 16 },
  { header: 'Products', key: 'products_summary', width: 40 },
  { header: 'Subtotal', key: 'subtotal', width: 14 },
  { header: 'Markup %', key: 'markup_percent', width: 10 },
  { header: 'Discount', key: 'discount_total', width: 12 },
  { header: 'GST', key: 'gst_amount', width: 12 },
  { header: 'Total', key: 'total', width: 14 },
  { header: 'Validity (days)', key: 'validity_days', width: 12 }
];

export async function buildQuotationsXlsxBuffer(records: QuotationRecord[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NANTA Sales Quotation Estimator';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Quotations');
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
