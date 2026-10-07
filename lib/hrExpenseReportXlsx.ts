import type { Fill, Font } from 'exceljs';
import { EXPENSE_SOURCE_LABEL, ExpenseSourceKey, HrExpenseReport } from './hrExpenseReportStore';

// Server-side twin of the on-screen HR Expense Report: the same filters
// produce the same matrix, so the spreadsheet is the table plus a filter
// header block and a totals row — not a differently-shaped export anyone
// would have to reconcile against the screen.
//
// exceljs is imported dynamically so its bulk stays out of the route's
// module graph until an export is actually requested; the `import type`
// above is erased at compile time.

const INDIAN_NUM_FMT = '#,##,##0.00';

const YELLOW: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD600' } };
const HEADER_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
const TOTAL_FILL: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
const ZEBRA: Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };

const NORMAL: Partial<Font> = { size: 10, name: 'Calibri' };
const BOLD: Partial<Font> = { bold: true, size: 10, name: 'Calibri' };
const TITLE: Partial<Font> = { bold: true, size: 16, name: 'Calibri' };

const GRANULARITY_LABEL = { month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' } as const;
const GROUP_BY_LABEL = { employee: 'Employee', department: 'Department', source: 'Expense Type' } as const;

function fmtDate(value: string): string {
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

export async function buildHrExpenseReportXlsx(
  report: HrExpenseReport,
  context: { department?: string; employeeName?: string }
): Promise<ArrayBuffer> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NANTA MatrixIQ';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('HR Expense Report', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true }
  });

  // Columns are derived from the report itself — group, one per period
  // bucket, one per selected expense type, then Entries + Total — so a
  // different granularity or source selection needs no change here.
  const periodKeys = report.buckets.map((b) => b.key);
  // Per-source total columns are dropped when they'd only restate something
  // already on the row — a single selected register (its total IS the row
  // total) or a report already grouped BY expense type. Mirrors the on-screen
  // table exactly.
  const sourceKeys = report.sources.length > 1 && report.groupBy !== 'source' ? report.sources : [];
  const headers = [
    GROUP_BY_LABEL[report.groupBy],
    ...(report.groupBy === 'source' ? [] : ['Details']),
    ...report.buckets.map((b) => b.label),
    ...sourceKeys.map((s) => `${EXPENSE_SOURCE_LABEL[s]} (Total)`),
    'Entries',
    'Total (₹)'
  ];
  const firstPeriodCol = report.groupBy === 'source' ? 2 : 3;
  const lastCol = headers.length;

  ws.columns = headers.map((_, i) => ({ width: i === 0 ? 28 : i === 1 && report.groupBy !== 'source' ? 24 : 16 }));

  const thin = { style: 'thin' as const };
  const border = { top: thin, bottom: thin, left: thin, right: thin };

  let r = 0;

  function titleRow(text: string, font: Partial<Font>, fill?: Fill) {
    r += 1;
    const row = ws.getRow(r);
    row.getCell(1).value = text;
    row.getCell(1).font = font;
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    for (let c = 1; c <= lastCol; c++) if (fill) row.getCell(c).fill = fill;
    if (lastCol > 1) ws.mergeCells(r, 1, r, lastCol);
    row.height = 22;
  }

  titleRow('NANTA — HR Expense Report', TITLE, YELLOW);

  const filters = [
    `Period: ${fmtDate(report.from)} to ${fmtDate(report.to)}`,
    `Breakdown: ${GRANULARITY_LABEL[report.granularity]}`,
    `Grouped by: ${GROUP_BY_LABEL[report.groupBy]}`,
    `Expense types: ${sourceKeys.map((s) => EXPENSE_SOURCE_LABEL[s]).join(', ')}`,
    `Department: ${context.department || 'All'}`,
    `Employee: ${context.employeeName || 'All'}`,
    report.approvedOnly ? 'Scope: approved entries only' : 'Scope: all entries, approved or not'
  ].join('   |   ');
  titleRow(filters, NORMAL);
  r += 1; // spacer

  // ── HEADER ROW ──
  r += 1;
  const headRow = ws.getRow(r);
  headers.forEach((h, i) => {
    const cell = headRow.getCell(i + 1);
    cell.value = h;
    cell.font = BOLD;
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', wrapText: true };
    cell.border = border;
  });
  headRow.height = 30;

  // ── DATA ROWS ──
  report.rows.forEach((row, index) => {
    r += 1;
    const wsRow = ws.getRow(r);
    const values: (string | number)[] = [
      row.label,
      ...(report.groupBy === 'source' ? [] : [row.sublabel]),
      ...periodKeys.map((k) => row.periods[k] ?? 0),
      ...sourceKeys.map((s) => row.sources[s] ?? 0),
      row.entries,
      row.total
    ];
    values.forEach((value, i) => {
      const cell = wsRow.getCell(i + 1);
      cell.value = value;
      cell.font = i === values.length - 1 ? BOLD : NORMAL;
      cell.alignment = { vertical: 'middle', horizontal: typeof value === 'number' ? 'right' : 'left' };
      cell.border = border;
      if (index % 2 === 1) cell.fill = ZEBRA;
      // Entries is a plain count — only money gets the Indian digit grouping.
      if (typeof value === 'number' && i + 1 >= firstPeriodCol && i + 1 !== lastCol - 1) cell.numFmt = INDIAN_NUM_FMT;
    });
  });

  // ── TOTALS ──
  r += 1;
  const totalRow = ws.getRow(r);
  const totalValues: (string | number)[] = [
    'TOTAL',
    ...(report.groupBy === 'source' ? [] : ['']),
    ...periodKeys.map((k) => report.periodTotals[k] ?? 0),
    ...sourceKeys.map((s) => report.sourceTotals[s] ?? 0),
    report.entryCount,
    report.grandTotal
  ];
  totalValues.forEach((value, i) => {
    const cell = totalRow.getCell(i + 1);
    cell.value = value;
    cell.font = BOLD;
    cell.fill = TOTAL_FILL;
    cell.alignment = { vertical: 'middle', horizontal: typeof value === 'number' ? 'right' : 'left' };
    cell.border = border;
    if (typeof value === 'number' && i + 1 >= firstPeriodCol && i + 1 !== lastCol - 1) cell.numFmt = INDIAN_NUM_FMT;
  });
  totalRow.height = 20;

  // Freeze the header block and the label column so a wide matrix stays
  // readable while scrolling in either direction.
  ws.views = [{ state: 'frozen', xSplit: report.groupBy === 'source' ? 1 : 2, ySplit: r - report.rows.length - 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as ArrayBuffer;
}

export function hrExpenseReportFileName(report: HrExpenseReport): string {
  const parts = ['HR_Expense_Report', report.from, 'to', report.to, GRANULARITY_LABEL[report.granularity]];
  return `${parts.join('_')}.xlsx`;
}

export type { ExpenseSourceKey };
