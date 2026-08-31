import type { Alignment, Fill, Font, Row, Worksheet } from 'exceljs';
import { OfficeOperationExpenseRecord } from './types';
import { OFFICE_EXPENSE_USECASES } from './officeOperationExpenseOptions';

// Styled Office Operation Expense voucher, built to the same conventions as
// lib/expenseVoucherXlsx.ts (the Reimbursement voucher): NANTA logo + yellow
// title band, label/value header block, section bands with per-section
// subtotals, zebra-striped rows, Indian digit grouping, amount in words, and a
// signature block — all inside a medium outer border on landscape A4.
//
// Where it differs: this is a monthly REGISTER rather than one employee's
// claim, so the sections are grouped by Usecase (Office / Electricity / Guest
// / Director / Salary / Other) instead of by expense type, and a "Summary by
// Usecase" recap is appended — for a register the first question asked of it
// is "where did the month's money go by category".
//
// exceljs is imported dynamically (runtime) so its bulk stays out of the
// page's initial bundle; the `import type` above is erased at compile time and
// costs nothing.

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Column layout. Widths are in "characters" at 10pt Calibri, matching the
// reference voucher. fitToPage scales the whole sheet onto one landscape page,
// so the 9 columns stay legible rather than spilling onto a second sheet.
const COLUMN_WIDTHS = [9, 13, 20, 26, 24, 22, 9, 16, 20];
const AMOUNT_COL = 8;
const LAST_COL = 9;

const INDIAN_NUM_FMT = '#,##,##0.00';

const YELLOW: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD600' } };
const LIGHT_YELLOW: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
const WHITE: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
const LIGHT_GRAY: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
const SUBTOTAL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
const SECTION: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
const SUMMARY: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
const SUMMARY_ROW: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };

const NORMAL: Partial<Font> = { size: 10, name: 'Calibri' };
const BOLD: Partial<Font> = { bold: true, size: 10, name: 'Calibri' };
const TITLE: Partial<Font> = { bold: true, size: 18, name: 'Calibri', underline: true };
const SMALL_ITALIC: Partial<Font> = { size: 9, name: 'Calibri', italic: true, color: { argb: 'FF6B7280' } };
const SECTION_FONT: Partial<Font> = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF374151' } };
const HEADER_FONT: Partial<Font> = { bold: true, size: 10, name: 'Calibri', color: { argb: 'FF111827' } };

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

// Rows don't auto-size to wrapped text, so a long Expense Head or Item name
// would silently crop. Same estimate-and-set-height approach as the reference.
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
  department?: string;
}): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NANTA MatrixIQ';
  workbook.created = new Date();

  const ws: Worksheet = workbook.addWorksheet('Office Operation Expenses', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true }
  });
  ws.columns = COLUMN_WIDTHS.map((width) => ({ width }));

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

  function spacer(height = 6) {
    const row = ws.getRow(r);
    row.height = height;
    ws.mergeCells(r, 1, r, LAST_COL);
    r++;
  }

  // A total row: right-aligned label spanning up to the Amount column, the
  // figure in the Amount column, remaining columns filled to match.
  function totalBand(label: string, amount: number, fill: Fill, labelFont: Partial<Font>, amountSize: number, height: number) {
    const row = ws.getRow(r);
    row.height = height;
    ws.mergeCells(r, 1, r, AMOUNT_COL - 1);
    setCell(row, 1, label, { font: labelFont, fill, alignment: { horizontal: 'right', vertical: 'middle' } });
    setCell(row, AMOUNT_COL, amount, { font: { ...BOLD, size: amountSize }, fill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: INDIAN_NUM_FMT });
    // Only merge the filler when it actually spans more than one column —
    // ws.mergeCells on a 1x1 range throws.
    if (LAST_COL > AMOUNT_COL + 1) ws.mergeCells(r, AMOUNT_COL + 1, r, LAST_COL);
    setCell(row, AMOUNT_COL + 1, '', { fill });
    applyBorders(row);
    r++;
  }

  let logoId: number | null = null;
  try {
    const resp = await fetch('/NANTA.png');
    const buf = await resp.arrayBuffer();
    logoId = workbook.addImage({ buffer: buf, extension: 'png' });
  } catch {
    // A missing/unreachable logo must never block the export — the voucher is
    // still perfectly valid without it.
    logoId = null;
  }

  let r = 1;

  // ── TITLE BAND ──
  const titleRow = ws.getRow(r);
  titleRow.height = 36;
  ws.mergeCells(r, 1, r, 2);
  if (logoId !== null) {
    const colAWidth = COLUMN_WIDTHS[0] * 7.5;
    const colBWidth = COLUMN_WIDTHS[1] * 7.5;
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
  ws.mergeCells(r, 3, r, LAST_COL);
  setCell(titleRow, 3, 'Office Operation Expense Voucher', { font: TITLE, alignment: { horizontal: 'center', vertical: 'middle' } });
  fillRow(titleRow, YELLOW);
  applyBorders(titleRow);
  r++;

  // ── HEADER INFO ──
  const period = `${MONTH_NAMES[data.month]} - ${data.year}`;
  const headerRows: [string, string, string, string][] = [
    ['Voucher No.', `OOE/${data.year}/${String(data.month).padStart(2, '0')}`, 'Expense Period', period],
    // No fabricated fallback for Department — an empty cell is honest, a
    // guessed "HR & Admin" would read as recorded fact.
    ['Department', data.department || '', 'Total Entries', String(data.records.length)],
    ['Prepared By', data.preparedBy || '', 'Printed On', fmtDate(new Date().toISOString())]
  ];
  for (const [leftLabel, leftVal, rightLabel, rightVal] of headerRows) {
    const row = ws.getRow(r);
    row.height = 20;
    setCell(row, 1, leftLabel, { font: BOLD, fill: YELLOW });
    ws.mergeCells(r, 2, r, 4);
    setCell(row, 2, leftVal, { fill: WHITE });
    ws.mergeCells(r, 5, r, 6);
    setCell(row, 5, rightLabel, { font: BOLD, fill: YELLOW, alignment: { horizontal: 'right', vertical: 'middle' } });
    ws.mergeCells(r, 7, r, LAST_COL);
    setCell(row, 7, rightVal, { fill: WHITE });
    applyBorders(row);
    r++;
  }

  spacer();

  // ── ONE SECTION PER USECASE ──
  const TABLE_HEADERS = ['Sr No.', 'Date', 'Detail', 'Expense Head', 'Item', 'Sub-Item', 'Qty', 'Amount', 'Entered By'];

  // Canonical order first, then any usecase present in the data but no longer
  // in the option list (a historical value that has since been retired — e.g.
  // the old 'Pantry' usecase) so no row can silently vanish from the export.
  const presentUsecases = [...new Set(data.records.map((rec) => rec.usecase))];
  const orderedUsecases = [
    ...OFFICE_EXPENSE_USECASES.filter((u) => presentUsecases.includes(u)),
    ...presentUsecases.filter((u) => !(OFFICE_EXPENSE_USECASES as readonly string[]).includes(u)).sort()
  ];

  const usecaseTotals: { usecase: string; count: number; amount: number }[] = [];

  for (const usecase of orderedUsecases) {
    const rows = data.records.filter((rec) => rec.usecase === usecase);
    if (!rows.length) continue;

    const sectionRow = ws.getRow(r);
    sectionRow.height = 24;
    ws.mergeCells(r, 1, r, LAST_COL);
    setCell(sectionRow, 1, usecase.toUpperCase(), { font: SECTION_FONT, fill: SECTION, alignment: { vertical: 'middle' } });
    applyBorders(sectionRow);
    r++;

    const headerRow = ws.getRow(r);
    headerRow.height = 26;
    TABLE_HEADERS.forEach((header, i) => {
      setCell(headerRow, i + 1, header, {
        font: HEADER_FONT,
        fill: YELLOW,
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }
      });
    });
    applyBorders(headerRow);
    r++;

    let sectionTotal = 0;
    rows.forEach((rec, i) => {
      const row = ws.getRow(r);
      const lines = Math.max(
        estimateLines(rec.expense_head, COLUMN_WIDTHS[3]),
        estimateLines(rec.item_name, COLUMN_WIDTHS[4]),
        estimateLines(rec.item_sub_name, COLUMN_WIDTHS[5])
      );
      row.height = Math.max(22, lines * 15);
      const fill = i % 2 === 0 ? WHITE : LIGHT_GRAY;

      setCell(row, 1, String(rec.sr_no).padStart(4, '0'), { fill, alignment: { horizontal: 'center' } });
      setCell(row, 2, fmtDate(rec.date), { fill, alignment: { horizontal: 'center' } });
      setCell(row, 3, rec.usecase_detail, { fill, alignment: { wrapText: true } });
      setCell(row, 4, rec.expense_head, { fill, alignment: { wrapText: true } });
      setCell(row, 5, rec.item_name, { fill, alignment: { wrapText: true } });
      setCell(row, 6, rec.item_sub_name, { fill, alignment: { wrapText: true } });
      // Blank rather than 0 when no quantity was recorded — see the item_qty
      // comment in lib/types.ts.
      setCell(row, 7, rec.item_qty ?? '', { fill, alignment: { horizontal: 'center' }, numFmt: '0.##' });
      setCell(row, AMOUNT_COL, rec.amount, { fill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: INDIAN_NUM_FMT });
      setCell(row, LAST_COL, rec.creator_name, { fill, alignment: { horizontal: 'center', vertical: 'middle' } });
      applyBorders(row);
      sectionTotal += rec.amount;
      r++;
    });

    totalBand(`Total ${usecase}`, sectionTotal, SUBTOTAL, BOLD, 12, 20);
    usecaseTotals.push({ usecase, count: rows.length, amount: sectionTotal });
    spacer(8);
  }

  // ── GRAND TOTAL ──
  // numberToIndianWords already yields "Rupees ... Only", so the label is
  // "Amount in Words" and nothing is appended — the reference voucher's
  // "Rupees in Words: {words} Only/-" renders as "...Only Only/-" with a
  // duplicated "Rupees", which is not worth copying.
  totalBand(`Amount in Words: ${data.totalInWords}`, data.total, LIGHT_YELLOW, BOLD, 13, 24);

  // ── SUMMARY BY USECASE ──
  if (usecaseTotals.length > 1) {
    spacer(8);

    const secRow = ws.getRow(r);
    secRow.height = 24;
    ws.mergeCells(r, 1, r, LAST_COL);
    setCell(secRow, 1, 'SUMMARY BY USECASE', { font: { ...SECTION_FONT, color: { argb: 'FF1E40AF' } }, fill: SUMMARY, alignment: { vertical: 'middle' } });
    applyBorders(secRow);
    r++;

    const sumHeader = ws.getRow(r);
    sumHeader.height = 22;
    ws.mergeCells(r, 1, r, 5);
    setCell(sumHeader, 1, 'Usecase', { font: HEADER_FONT, fill: SUMMARY, alignment: { horizontal: 'left', vertical: 'middle' } });
    ws.mergeCells(r, 6, r, AMOUNT_COL - 1);
    setCell(sumHeader, 6, 'Entries', { font: HEADER_FONT, fill: SUMMARY, alignment: { horizontal: 'center', vertical: 'middle' } });
    setCell(sumHeader, AMOUNT_COL, 'Amount', { font: HEADER_FONT, fill: SUMMARY, alignment: { horizontal: 'center', vertical: 'middle' } });
    setCell(sumHeader, LAST_COL, '% of Total', { font: HEADER_FONT, fill: SUMMARY, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
    applyBorders(sumHeader);
    r++;

    usecaseTotals
      .slice()
      .sort((a, b) => b.amount - a.amount)
      .forEach((entry, i) => {
        const row = ws.getRow(r);
        row.height = 20;
        const fill = i % 2 === 0 ? SUMMARY_ROW : WHITE;
        // Guard the division: a month whose entries somehow sum to 0 would
        // otherwise render NaN% here.
        const share = data.total > 0 ? (entry.amount / data.total) * 100 : 0;
        ws.mergeCells(r, 1, r, 5);
        setCell(row, 1, entry.usecase, { font: BOLD, fill });
        ws.mergeCells(r, 6, r, AMOUNT_COL - 1);
        setCell(row, 6, entry.count, { fill, alignment: { horizontal: 'center' } });
        setCell(row, AMOUNT_COL, entry.amount, { fill, alignment: { horizontal: 'center' }, numFmt: INDIAN_NUM_FMT });
        setCell(row, LAST_COL, `${share.toFixed(1)}%`, { fill, alignment: { horizontal: 'center' } });
        applyBorders(row);
        r++;
      });

    totalBand('Grand Total', data.total, YELLOW, { ...BOLD, size: 11 }, 13, 24);
  }

  spacer();

  // ── SIGNATURES ──
  const sigHeader = ws.getRow(r);
  sigHeader.height = 22;
  ws.mergeCells(r, 1, r, 2);
  setCell(sigHeader, 1, '', { font: BOLD, fill: YELLOW });
  ws.mergeCells(r, 3, r, 5);
  setCell(sigHeader, 3, 'Name', { font: BOLD, fill: YELLOW, alignment: { horizontal: 'center', vertical: 'middle' } });
  ws.mergeCells(r, 6, r, 7);
  setCell(sigHeader, 6, 'Date', { font: BOLD, fill: YELLOW, alignment: { horizontal: 'center', vertical: 'middle' } });
  ws.mergeCells(r, AMOUNT_COL, r, LAST_COL);
  setCell(sigHeader, AMOUNT_COL, 'Signature', { font: BOLD, fill: YELLOW, alignment: { horizontal: 'center', vertical: 'middle' } });
  applyBorders(sigHeader);
  r++;

  // This module has no approval workflow (unlike the Reimbursement sheet), so
  // Verified/Approved are left blank for a wet signature rather than being
  // filled with a status this app can't actually vouch for.
  const signatories: [string, string, string][] = [
    ['Prepared by', data.preparedBy || '', fmtDate(new Date().toISOString())],
    ['Verified by', '', ''],
    ['Approved by', '', '']
  ];
  for (const [label, name, date] of signatories) {
    const row = ws.getRow(r);
    row.height = 30;
    ws.mergeCells(r, 1, r, 2);
    setCell(row, 1, label, { font: BOLD, fill: YELLOW, alignment: { vertical: 'middle', wrapText: true } });
    ws.mergeCells(r, 3, r, 5);
    setCell(row, 3, name, { fill: WHITE });
    ws.mergeCells(r, 6, r, 7);
    setCell(row, 6, date, { fill: WHITE, alignment: { horizontal: 'center', vertical: 'middle' } });
    ws.mergeCells(r, AMOUNT_COL, r, LAST_COL);
    setCell(row, AMOUNT_COL, '', { fill: WHITE });
    applyBorders(row);
    r++;
  }

  // ── NOTE ──
  spacer();
  const noteRow = ws.getRow(r);
  noteRow.height = 18;
  ws.mergeCells(r, 1, r, LAST_COL);
  setCell(noteRow, 1, 'Note:- Generated from MatrixIQ. Sr No. is system-assigned and unique; a blank Qty means no quantity was recorded for that line.', { font: SMALL_ITALIC });

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

  const fileName = `Office_Operation_Expenses_${MONTH_NAMES[data.month]}_${data.year}.xlsx`;
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
