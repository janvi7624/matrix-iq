import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { importProductRows, importProductsFromCsv } from '@/lib/productStore';
import { apiErrorResponse } from '@/lib/apiError';

async function parseXlsxRows(buffer: ArrayBuffer): Promise<Record<string, string>[]> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1).values as (string | undefined)[];
  const headers = headerRow.slice(1).map((h) => String(h ?? '').trim());

  const rows: Record<string, string>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = (row.values as unknown[]).slice(1);
    const obj: Record<string, string> = {};
    headers.forEach((header, i) => {
      obj[header] = String(values[i] ?? '').trim();
    });
    rows.push(obj);
  });
  return rows;
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
    const result = isXlsx
      ? await importProductRows(await parseXlsxRows(await file.arrayBuffer()), session.username)
      : await importProductsFromCsv(await file.text(), session.username);

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
