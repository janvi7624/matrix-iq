import type { Alignment, Fill, Font, Row, Worksheet } from 'exceljs';
import { OfficeOperationExpenseRecord } from './types';

// Office Operation Expense sheet — styling conventions borrowed from
// lib/expenseVoucherXlsx.ts (the Reimbursement voucher): NANTA logo + yellow
// title band, label/value header block, yellow table header, zebra-striped
// rows, Indian digit grouping, amount in words, medium outer border, landscape
// A4 fitToPage.
//
// Unlike that voucher this is a flat monthly register: entries are listed in
// date order in ONE table with Category as a column, rather than split into a
// section per category. A "Summary by Category" recap follows the table (the
// per-category breakdown is still the first question asked of a register), and
// the grand total is the final row. There is no signature block.
//
// exceljs is imported dynamically (runtime) so its bulk stays out of the
// page's initial bundle; the `import type` above is erased at compile time.

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SHEET_TITLE = 'Office Operation Expense';
const DEPARTMENT = 'HR';
const APPROVED_BY = 'Hardik Acharya';

const INDIAN_NUM_FMT = '#,##,##0.00';

const YELLOW: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD600' } };
const LIGHT_YELLOW: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
const WHITE: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
const LIGHT_GRAY: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
const SUMMARY: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
const SUMMARY_ROW: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };

const NORMAL: Partial<Font> = { size: 10, name: 'Calibri' };
const BOLD: Partial<Font> = { bold: true, size: 10, name: 'Calibri' };
const TITLE: Partial<Font> = { bold: true, size: 18, name: 'Calibri', underline: true };
const HEADER_FONT: Partial<Font> = { bold: true, size: 10, name: 'Calibri', color: { argb: 'FF111827' } };
const SECTION_FONT: Partial<Font> = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF1E40AF' } };

interface ColumnDef {
  header: string;
  width: number;
  center?: boolean;
  wrap?: boolean;
  numFmt?: string;
  value: (rec: OfficeOperationExpenseRecord) => string | number;
}

// Every downstream position (the Amount column, the last column, and the
// merged spans in the header block and total band) is DERIVED from this list,
// so adding or removing a column needs no other edit.
const COLUMNS: ColumnDef[] = [
  { header: 'Sr No.', width: 9, center: true, value: (r) => String(r.sr_no).padStart(4, '0') },
  { header: 'Date', width: 13, center: true, value: (r) => fmtDate(r.date) },
  // Usecase sits beside Date now that entries are no longer grouped by it. Any
  // legacy usecase_detail is appended so nothing recorded is dropped, even
  // though no current usecase can produce one.
  { header: 'Category', width: 16, wrap: true, value: (r) => (r.usecase_detail ? `${r.usecase} — ${r.usecase_detail}` : r.usecase) },
  { header: 'Expense Head', width: 26, wrap: true, value: (r) => r.item_name },
  { header: 'Item Name', width: 22, wrap: true, value: (r) => r.item_sub_name },
  // No numFmt: a '0.##' mask makes Excel render a whole number as "300." with
  // a trailing decimal point. General formatting shows 300 and 2.5 correctly.
  { header: 'Qty', width: 8, center: true, value: (r) => r.item_qty ?? '' },
  { header: 'Amount', width: 16, center: true, numFmt: INDIAN_NUM_FMT, value: (r) => r.amount },
  { header: 'Description', width: 26, wrap: true, value: (r) => r.description },
  { header: 'Remarks', width: 22, wrap: true, value: (r) => r.remarks }
];

const LAST_COL = COLUMNS.length;
const AMOUNT_COL = COLUMNS.findIndex((c) => c.header === 'Amount') + 1;

function fmtDate(value: string): string {
  if (!value) return '';
  // Date-only strings are anchored to local midnight so a UTC-negative
  // timezone can't shift them back a day.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return value;
  }
}

// Rows don't auto-size to wrapped text, so a long value would silently crop.
function estimateLines(text: string, colWidthChars: number): number {
  if (!text) return 1;
  const effective = Math.max(colWidthChars - 2, 4);
  return Math.max(1, Math.ceil((text.length * 1.15) / effective));
}

interface CellOpts {
  font?: Partial<Font>;
  fill?: Fill;
  alignment?: Partial<Alignment>;
  numFmt?: string;
}

export async function exportOfficeOperationExpensesXlsx(data: {
  records: OfficeOperationExpenseRecord[];
  total: number;
  totalInWords: string;
  year: number;
  month: number;
  preparedBy?: string;
}): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NANTA MatrixIQ';
  workbook.created = new Date();

  const ws: Worksheet = workbook.addWorksheet('Office Operation Expense', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true }
  });
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  const thin = { style: 'thin' as const };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  function setCell(row: Row, col: number, value: string | number, opts?: CellOpts) {
    const cell = row.getCell(col);
    cell.value = value;
    cell.font = opts?.font || NORMAL;
    if (opts?.fill) cell.fill = opts.fill;
    cell.alignment = { vertical: 'middle', ...(opts?.alignment || {}) };
    cell.border = border;
    if (opts?.numFmt) cell.numFmt = opts.numFmt;
  }

  function applyBorders(row: Row, from = 1, to = LAST_COL) {
    for (let c = from; c <= to; c++) row.getCell(c).border = border;
  }

  function fillRow(row: Row, fill: Fill, from = 1, to = LAST_COL) {
    for (let c = from; c <= to; c++) row.getCell(c).fill = fill;
  }

  // ws.mergeCells throws on a 1x1 range, which a derived span can collapse to.
  function merge(rowIndex: number, c1: number, c2: number) {
    if (c2 > c1) ws.mergeCells(rowIndex, c1, rowIndex, c2);
  }

  let logoId: number | null = null;
  try {
    const resp = await fetch('/NANTA.png');
    const buf = await resp.arrayBuffer();
    logoId = workbook.addImage({ buffer: buf, extension: 'png' });
  } catch {
    // A missing/unreachable logo must never block the export.
    logoId = null;
  }

  let r = 1;

  // ── TITLE BAND ──
  const titleRow = ws.getRow(r);
  titleRow.height = 36;
  merge(r, 1, 2);
  if (logoId !== null) {
    const colAWidth = COLUMNS[0].width * 7.5;
    const colBWidth = COLUMNS[1].width * 7.5;
    const logoWidth = 120;
    const logoHeight = 34;
    const rowHeight = 36;
    const xPx = (colAWidth + colBWidth - logoWidth) / 2;
    const colFraction = xPx < colAWidth ? xPx / colAWidth : 1 + (xPx - colAWidth) / colBWidth;
    ws.addImage(logoId, {
      tl: { col: Math.max(colFraction, 0), row: (rowHeight - logoHeight) / 2 / rowHeight },
      ext: { width: logoWidth, height: logoHeight }
    });
  }
  merge(r, 3, LAST_COL);
  setCell(titleRow, 3, SHEET_TITLE, { font: TITLE, alignment: { horizontal: 'center', vertical: 'middle' } });
  fillRow(titleRow, YELLOW);
  applyBorders(titleRow);
  r++;

  // ── HEADER INFO ── spans derived so the block re-flows with the column count.
  const MID = Math.max(2, Math.floor(LAST_COL / 2));
  const headerRows: [string, string, string, string][] = [
    ['Voucher No.', `OOE/${data.year}/${String(data.month).padStart(2, '0')}`, 'Expense Period', `${MONTH_NAMES[data.month]} - ${data.year}`],
    ['Department', DEPARTMENT, 'Total Entries', String(data.records.length)],
    ['Prepared By', data.preparedBy || '', 'Approved By', APPROVED_BY]
  ];
  for (const [leftLabel, leftVal, rightLabel, rightVal] of headerRows) {
    const row = ws.getRow(r);
    row.height = 20;
    setCell(row, 1, leftLabel, { font: BOLD, fill: YELLOW });
    merge(r, 2, MID);
    setCell(row, 2, leftVal, { fill: WHITE });
    setCell(row, MID + 1, rightLabel, { font: BOLD, fill: YELLOW, alignment: { horizontal: 'right', vertical: 'middle' } });
    merge(r, MID + 2, LAST_COL);
    setCell(row, MID + 2, rightVal, { fill: WHITE });
    applyBorders(row);
    r++;
  }

  // Spacer
  const spacerRow = ws.getRow(r);
  spacerRow.height = 6;
  merge(r, 1, LAST_COL);
  r++;

  // ── ONE FLAT TABLE, IN DATE ORDER ──
  const headerRow = ws.getRow(r);
  headerRow.height = 26;
  COLUMNS.forEach((c, i) => {
    setCell(headerRow, i + 1, c.header, {
      font: HEADER_FONT,
      fill: YELLOW,
      alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }
    });
  });
  applyBorders(headerRow);
  r++;

  data.records.forEach((rec, i) => {
    const row = ws.getRow(r);
    const lines = Math.max(
      ...COLUMNS.filter((c) => c.wrap).map((c) => estimateLines(String(c.value(rec) ?? ''), c.width)),
      1
    );
    row.height = Math.max(22, lines * 15);
    const fill = i % 2 === 0 ? WHITE : LIGHT_GRAY;

    COLUMNS.forEach((c, idx) => {
      setCell(row, idx + 1, c.value(rec), {
        fill,
        alignment: c.center ? { horizontal: 'center', vertical: 'middle' } : { wrapText: !!c.wrap, vertical: 'middle' },
        numFmt: c.numFmt
      });
    });
    applyBorders(row);
    r++;
  });

  // ── SUMMARY BY CATEGORY ──
  // The table itself is no longer grouped, so this recap is the only place the
  // month's spend is broken down by category. Skipped when a single usecase
  // accounts for everything, where it would just restate the grand total.
  const usecaseTotals = new Map<string, { count: number; amount: number }>();
  for (const rec of data.records) {
    const entry = usecaseTotals.get(rec.usecase) || { count: 0, amount: 0 };
    entry.count += 1;
    entry.amount += rec.amount;
    usecaseTotals.set(rec.usecase, entry);
  }

  if (usecaseTotals.size > 1) {
    const gap = ws.getRow(r);
    gap.height = 8;
    merge(r, 1, LAST_COL);
    r++;

    const NAME_END = Math.max(1, AMOUNT_COL - 3);
    const COUNT_START = NAME_END + 1;

    const secRow = ws.getRow(r);
    secRow.height = 24;
    merge(r, 1, LAST_COL);
    setCell(secRow, 1, 'SUMMARY BY CATEGORY', { font: SECTION_FONT, fill: SUMMARY, alignment: { vertical: 'middle' } });
    applyBorders(secRow);
    r++;

    const sumHeader = ws.getRow(r);
    sumHeader.height = 22;
    merge(r, 1, NAME_END);
    setCell(sumHeader, 1, 'Category', { font: HEADER_FONT, fill: SUMMARY, alignment: { horizontal: 'left', vertical: 'middle' } });
    merge(r, COUNT_START, AMOUNT_COL - 1);
    setCell(sumHeader, COUNT_START, 'Entries', { font: HEADER_FONT, fill: SUMMARY, alignment: { horizontal: 'center', vertical: 'middle' } });
    setCell(sumHeader, AMOUNT_COL, 'Amount', { font: HEADER_FONT, fill: SUMMARY, alignment: { horizontal: 'center', vertical: 'middle' } });
    merge(r, AMOUNT_COL + 1, LAST_COL);
    if (AMOUNT_COL < LAST_COL) setCell(sumHeader, AMOUNT_COL + 1, '% of Total', { font: HEADER_FONT, fill: SUMMARY, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
    applyBorders(sumHeader);
    r++;

    [...usecaseTotals.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .forEach(([usecase, entry], i) => {
        const row = ws.getRow(r);
        row.height = 20;
        const fill = i % 2 === 0 ? SUMMARY_ROW : WHITE;
        // Guard the division: a month summing to 0 would render NaN%.
        const share = data.total > 0 ? (entry.amount / data.total) * 100 : 0;
        merge(r, 1, NAME_END);
        setCell(row, 1, usecase, { font: BOLD, fill });
        merge(r, COUNT_START, AMOUNT_COL - 1);
        setCell(row, COUNT_START, entry.count, { fill, alignment: { horizontal: 'center' } });
        setCell(row, AMOUNT_COL, entry.amount, { fill, alignment: { horizontal: 'center' }, numFmt: INDIAN_NUM_FMT });
        merge(r, AMOUNT_COL + 1, LAST_COL);
        if (AMOUNT_COL < LAST_COL) setCell(row, AMOUNT_COL + 1, `${share.toFixed(1)}%`, { fill, alignment: { horizontal: 'center' } });
        applyBorders(row);
        r++;
      });
  }

  // ── GRAND TOTAL — the final row ──
  // numberToIndianWords already yields "Rupees ... Only", so nothing is
  // appended: the reference voucher's "{words} Only/-" reads as "Only Only/-".
  const totalRow = ws.getRow(r);
  totalRow.height = 26;
  merge(r, 1, AMOUNT_COL - 1);
  setCell(totalRow, 1, `Grand Total — Amount in Words: ${data.totalInWords}`, {
    font: { ...BOLD, size: 11 },
    fill: LIGHT_YELLOW,
    alignment: { horizontal: 'right', vertical: 'middle' }
  });
  setCell(totalRow, AMOUNT_COL, data.total, {
    font: { ...BOLD, size: 13 },
    fill: LIGHT_YELLOW,
    alignment: { horizontal: 'center', vertical: 'middle' },
    numFmt: INDIAN_NUM_FMT
  });
  merge(r, AMOUNT_COL + 1, LAST_COL);
  if (AMOUNT_COL < LAST_COL) setCell(totalRow, AMOUNT_COL + 1, '', { fill: LIGHT_YELLOW });
  applyBorders(totalRow);

  // ── MEDIUM OUTER BORDER ON THE USED RANGE ──
  const lastRow = r;
  const medium = { style: 'medium' as const };
  for (let row = 1; row <= lastRow; row++) {
    const wsRow = ws.getRow(row);
    for (let col = 1; col <= LAST_COL; col++) {
      const cell = wsRow.getCell(col);
      const existing = cell.border || {};
      cell.border = {
        top: row === 1 ? medium : existing.top,
        bottom: row === lastRow ? medium : existing.bottom,
        left: col === 1 ? medium : existing.left,
        right: col === LAST_COL ? medium : existing.right
      };
    }
  }

  const fileName = `Office_Operation_Expense_${MONTH_NAMES[data.month]}_${data.year}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
