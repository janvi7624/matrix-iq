import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getViewerContext } from '@/lib/viewerContext';

// Reads an uploaded spreadsheet and returns it in the exact same
// { headers, rows } shape lib/csv.ts's parseCsv() produces from a real CSV,
// so LeadBulkImportWizard.tsx's column-mapping/preview/commit flow downstream
// doesn't need to know which format the user actually uploaded — see that
// component's handleCsvSelected for why this exists: the "Import CSV" file
// picker was silently accepting real Excel workbooks (renamed or exported
// with a .csv extension) and feeding their raw binary bytes to the CSV text
// parser, producing garbage "PK...[Content_Types].xml" column headers.
//
// Uses the `xlsx` (SheetJS) package rather than exceljs (already a
// dependency, but write-only in this codebase — see lib/userImportXlsx.ts):
// exceljs's reader only understands the modern OOXML .xlsx container and
// hard-fails on a legacy "Excel 97-2003" .xls (a completely different binary
// BIFF format) with an opaque "Could not read that Excel file" — a real
// failure mode for exports out of older systems. SheetJS reads both formats
// (plus .xlsm/.ods/genuine .csv) uniformly and is far more forgiving of the
// quirks real-world spreadsheets tend to have.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) return NextResponse.json({ error: 'That workbook has no sheets' }, { status: 400 });

    // header: 1 -> array-of-arrays instead of header-keyed objects (we do our
    // own header handling downstream). raw: false -> cells come through as
    // their DISPLAYED text (e.g. a phone number column stays "9876543210",
    // not the number 9876543210 mangled into scientific notation; a date
    // stays whatever format the sheet shows). defval: '' -> a blank/missing
    // cell in the middle of a row is an empty string, not `undefined`, so it
    // doesn't shift every following cell left by one index. blankrows: false
    // drops fully-empty rows (common trailing rows in real exports).
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false }).map((row) =>
      row.map((cell) => (cell ?? '').toString().trim())
    );

    if (rows.length < 2) return NextResponse.json({ error: 'That workbook has no data rows' }, { status: 400 });

    return NextResponse.json({ headers: rows[0], rows: rows.slice(1) });
  } catch (error) {
    // A malformed/corrupt/password-protected upload, not a server fault —
    // 400, not 500, and log server-side for diagnostics without leaking
    // parser internals to the client.
    console.error(error);
    return NextResponse.json({ error: 'Could not read that file as a spreadsheet. If it is password-protected, remove the password and try again.' }, { status: 400 });
  }
}
