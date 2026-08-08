import ExcelJS from 'exceljs';
import { BRAND } from './branding';

export interface CredentialsRow {
  name: string;
  employeeId: string;
  username: string;
  tempPassword: string;
  role: string;
  department: string;
  status: string;
}

const COLUMNS: { header: string; key: keyof CredentialsRow; width: number }[] = [
  { header: 'Employee Name', key: 'name', width: 26 },
  { header: 'Employee ID', key: 'employeeId', width: 16 },
  { header: 'Username', key: 'username', width: 22 },
  { header: 'Temporary Password', key: 'tempPassword', width: 20 },
  { header: 'Role', key: 'role', width: 14 },
  { header: 'Department', key: 'department', width: 18 },
  { header: 'Account Status', key: 'status', width: 16 }
];

// Built exclusively from data the caller already holds in memory (the
// bulk-import commit response) — never re-reads passwords from the database,
// since only the hash is ever stored there. See lib/userImportStore.ts.
export async function buildUserCredentialsXlsxBuffer(rows: CredentialsRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${BRAND.companyName} ${BRAND.appName}`;
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('User Credentials');
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  rows.forEach((record) => {
    const row: Record<string, unknown> = {};
    COLUMNS.forEach((c) => {
      row[c.key] = record[c.key];
    });
    sheet.addRow(row);
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
