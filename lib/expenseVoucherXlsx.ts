import { ReimbursementRecord } from './types';

interface VoucherData {
  employee: { name: string; employeeId: string; department: string; designation: string };
  sheet: {
    code: string; month: number; year: number; status: string; expensePeriod: string; paidTo: string;
    managerName: string; managerActionAt: string;
    hrReviewerName: string; hrReviewedAt: string;
    accountsHandlerName: string; accountsCompletedAt: string;
    paymentReference: string;
  };
  records: ReimbursementRecord[];
  total: number;
  totalInWords: string;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return iso; }
}

function fmtDateShort(iso: string): string {
  if (!iso) return '';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return iso; }
}

function parseDescription(desc: string): { description: string; vehicleType: string } {
  const m = desc.match(/^Conveyance \((2 Wheeler|4 Wheeler|Cab)\)$/);
  if (m) return { description: 'Conveyance', vehicleType: m[1] };
  return { description: desc, vehicleType: '' };
}

const TRAVEL_TYPES = new Set(['Conveyance', 'Bus Ticket', 'Train Ticket', 'Flight Ticket']);

function isTravel(desc: string): boolean {
  const { description } = parseDescription(desc);
  return TRAVEL_TYPES.has(description);
}

export async function generateExpenseVoucherXlsx(data: VoucherData): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'NANTA MatrixIQ';
  workbook.created = new Date();

  const ws = workbook.addWorksheet('Expense Voucher', {
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true },
  });

  ws.columns = [
    { width: 13 },  // A
    { width: 22 },  // B
    { width: 14 },  // C
    { width: 16 },  // D
    { width: 17 },  // E
    { width: 17 },  // F
    { width: 9 },   // G
    { width: 13 },  // H
    { width: 13 },  // I
  ];

  const yellowFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD600' } };
  const lightYellowFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
  const whiteFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
  const lightGrayFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
  const greenFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
  const subtotalFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
  const sectionFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

  const thinBorder: any = {
    top: { style: 'thin' }, bottom: { style: 'thin' },
    left: { style: 'thin' }, right: { style: 'thin' },
  };

  const boldFont: any = { bold: true, size: 10, name: 'Calibri' };
  const normalFont: any = { size: 10, name: 'Calibri' };
  const titleFont: any = { bold: true, size: 18, name: 'Calibri', underline: true };
  const smallFont: any = { size: 9, name: 'Calibri' };
  const sectionFont: any = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF374151' } };

  function applyBorders(row: any, from: number, to: number) {
    for (let c = from; c <= to; c++) row.getCell(c).border = thinBorder;
  }

  const indianNumFmt = '#,##,##0.00';

  function setCell(row: any, col: number, value: string | number, opts?: { font?: any; fill?: any; alignment?: any; numFmt?: string }) {
    const cell = row.getCell(col);
    cell.value = value;
    cell.font = opts?.font || normalFont;
    if (opts?.fill) cell.fill = opts.fill;
    cell.alignment = { vertical: 'middle', ...(opts?.alignment || {}) };
    cell.border = thinBorder;
    if (opts?.numFmt) cell.numFmt = opts.numFmt;
  }

  // Load logo
  let logoId: number | null = null;
  try {
    const resp = await fetch('/NANTA.png');
    const buf = await resp.arrayBuffer();
    logoId = workbook.addImage({ buffer: buf, extension: 'png' });
  } catch { logoId = null; }

  let r = 1;

  // ── TITLE ROW ──
  const titleRow = ws.getRow(r);
  titleRow.height = 36;
  ws.mergeCells(r, 1, r, 2);
  if (logoId !== null) {
    const colAWidth = 13 * 7.5;
    const colBWidth = 22 * 7.5;
    const mergedWidth = colAWidth + colBWidth;
    const logoWidth = 120;
    const logoHeight = 34;
    const rowHeight = 36;
    const xPx = (mergedWidth - logoWidth) / 2;
    const yPx = (rowHeight - logoHeight) / 2;
    const colFraction = xPx < colAWidth ? xPx / colAWidth : 1 + (xPx - colAWidth) / colBWidth;
    ws.addImage(logoId, {
      tl: { col: colFraction, row: yPx / rowHeight },
      ext: { width: logoWidth, height: logoHeight },
    });
  }
  ws.mergeCells(r, 3, r, 9);
  setCell(titleRow, 3, 'Employee Expense Claim Form', { font: titleFont, alignment: { horizontal: 'center', vertical: 'middle' } });
  for (let c = 1; c <= 9; c++) titleRow.getCell(c).fill = yellowFill;
  applyBorders(titleRow, 1, 9);
  r++;

  // ── HEADER INFO ──
  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const headerRows: [string, string, string, string][] = [
    ['Emp. ID', data.employee.employeeId, 'Date', fmtDate(new Date().toISOString())],
    ['Emp. Name', data.employee.name, 'Department', data.employee.department],
    ['Designation', data.employee.designation, 'Expense Period', `${monthNames[data.sheet.month]} - ${data.sheet.year}`],
  ];

  for (const [lLabel, lVal, rLabel, rVal] of headerRows) {
    const row = ws.getRow(r);
    row.height = 20;
    setCell(row, 1, lLabel, { font: boldFont, fill: yellowFill });
    ws.mergeCells(r, 2, r, 5);
    setCell(row, 2, lVal, { font: normalFont, fill: whiteFill });
    setCell(row, 6, rLabel, { font: boldFont, fill: yellowFill, alignment: { horizontal: 'right', vertical: 'middle' } });
    ws.mergeCells(r, 7, r, 9);
    setCell(row, 7, rVal, { font: normalFont, fill: whiteFill });
    applyBorders(row, 1, 9);
    r++;
  }

  const infoRows: [string, string][] = [
    ['Paid to', data.sheet.paidTo],
  ];
  for (const [label, val] of infoRows) {
    const row = ws.getRow(r);
    row.height = 20;
    setCell(row, 1, label, { font: boldFont, fill: yellowFill });
    ws.mergeCells(r, 2, r, 9);
    setCell(row, 2, val, { font: normalFont, fill: whiteFill });
    applyBorders(row, 1, 9);
    r++;
  }

  const spacerRow1 = ws.getRow(r);
  spacerRow1.height = 6;
  ws.mergeCells(r, 1, r, 9);
  r++;

  // Split records: admin entries go into their own section
  const adminRecords = data.records.filter((rec) => rec.is_admin_entry);
  const regularRecords = data.records.filter((rec) => !rec.is_admin_entry);
  const travelRecords = regularRecords.filter((rec) => isTravel(rec.description || ''));
  const otherRecords = regularRecords.filter((rec) => !isTravel(rec.description || ''));

  // ═══════════════════════════════════════════════════════════
  // TABLE 1: TRAVEL & CONVEYANCE
  // ═══════════════════════════════════════════════════════════
  if (travelRecords.length > 0) {
    // Section title
    const secRow = ws.getRow(r);
    secRow.height = 24;
    ws.mergeCells(r, 1, r, 9);
    setCell(secRow, 1, 'CONVEYANCE', { font: sectionFont, fill: sectionFill, alignment: { vertical: 'middle' } });
    applyBorders(secRow, 1, 9);
    r++;

    // Table header
    const travelHeaders = ['Date', 'Description', 'Vehicle Type', 'Employee', 'From', 'To', 'KM', 'Amount', 'Payment Method'];
    const thRow = ws.getRow(r);
    thRow.height = 26;
    for (let c = 0; c < travelHeaders.length; c++) {
      setCell(thRow, c + 1, travelHeaders[c], {
        font: { ...boldFont, color: { argb: 'FF111827' } },
        fill: yellowFill,
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
      });
    }
    applyBorders(thRow, 1, 9);
    r++;

    // Data rows
    let travelTotal = 0;
    for (let i = 0; i < travelRecords.length; i++) {
      const rec = travelRecords[i];
      const { description, vehicleType } = parseDescription(rec.description || '');
      const row = ws.getRow(r);
      row.height = 22;
      const rowFill = i % 2 === 0 ? whiteFill : lightGrayFill;

      setCell(row, 1, fmtDateShort(rec.date), { fill: rowFill, alignment: { horizontal: 'center' } });
      setCell(row, 2, description, { fill: rowFill });
      setCell(row, 3, vehicleType, { fill: rowFill, alignment: { horizontal: 'center' } });
      setCell(row, 4, rec.employee_names.join(', '), { fill: rowFill });
      setCell(row, 5, rec.from_location || '', { fill: rowFill });
      setCell(row, 6, rec.to_location || '', { fill: rowFill });
      setCell(row, 7, rec.kilometers ? String(rec.kilometers) : '', { fill: rowFill, alignment: { horizontal: 'center' } });
      setCell(row, 8, Number(rec.amount), { fill: rowFill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: indianNumFmt });
      setCell(row, 9, rec.mode_of_payment || '', { fill: rowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
      applyBorders(row, 1, 9);
      travelTotal += Number(rec.amount);
      r++;
    }

    // Subtotal
    const subRow = ws.getRow(r);
    subRow.height = 20;
    ws.mergeCells(r, 1, r, 7);
    setCell(subRow, 1, 'Total Conveyance', {
      font: boldFont,
      fill: subtotalFill,
      alignment: { horizontal: 'right', vertical: 'middle' },
    });
    setCell(subRow, 8, travelTotal, { font: { ...boldFont, size: 12 }, fill: subtotalFill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: indianNumFmt });
    setCell(subRow, 9, '', { fill: subtotalFill });
    applyBorders(subRow, 1, 9);
    r++;

    const spacerT1 = ws.getRow(r);
    spacerT1.height = 8;
    ws.mergeCells(r, 1, r, 9);
    r++;
  }

  // ═══════════════════════════════════════════════════════════
  // TABLE 2: FOOD, HOTEL & OTHER EXPENSES
  // ═══════════════════════════════════════════════════════════
  if (otherRecords.length > 0) {
    // Section title
    const secRow = ws.getRow(r);
    secRow.height = 24;
    ws.mergeCells(r, 1, r, 9);
    setCell(secRow, 1, 'FOOD, HOTEL & OTHER EXPENSES', { font: sectionFont, fill: sectionFill, alignment: { vertical: 'middle' } });
    applyBorders(secRow, 1, 9);
    r++;

    // Table header — no From/To/KM/Vehicle Type, wider Description + Employee
    const otherHeaders = ['Date', 'Description', 'Employee', 'Amount', 'Payment Method'];
    const ohRow = ws.getRow(r);
    ohRow.height = 26;
    // Map to columns: A=Date, B+C=Description(merged), D+E+F=Employee(merged), G=skip, H=Amount, I=Payment
    setCell(ohRow, 1, otherHeaders[0], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: yellowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    ws.mergeCells(r, 2, r, 4);
    setCell(ohRow, 2, otherHeaders[1], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: yellowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    ws.mergeCells(r, 5, r, 7);
    setCell(ohRow, 5, otherHeaders[2], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: yellowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    setCell(ohRow, 8, otherHeaders[3], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: yellowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    setCell(ohRow, 9, otherHeaders[4], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: yellowFill, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
    applyBorders(ohRow, 1, 9);
    r++;

    // Data rows
    let otherTotal = 0;
    for (let i = 0; i < otherRecords.length; i++) {
      const rec = otherRecords[i];
      const row = ws.getRow(r);
      row.height = 22;
      const rowFill = i % 2 === 0 ? whiteFill : lightGrayFill;

      setCell(row, 1, fmtDateShort(rec.date), { fill: rowFill, alignment: { horizontal: 'center' } });
      ws.mergeCells(r, 2, r, 4);
      setCell(row, 2, rec.description || '', { fill: rowFill });
      ws.mergeCells(r, 5, r, 7);
      setCell(row, 5, rec.employee_names.join(', '), { fill: rowFill });
      setCell(row, 8, Number(rec.amount), { fill: rowFill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: indianNumFmt });
      setCell(row, 9, rec.mode_of_payment || '', { fill: rowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
      applyBorders(row, 1, 9);
      otherTotal += Number(rec.amount);
      r++;
    }

    // Subtotal
    const subRow = ws.getRow(r);
    subRow.height = 20;
    ws.mergeCells(r, 1, r, 7);
    setCell(subRow, 1, 'Food, Hotel & Other Expenses Total', {
      font: boldFont,
      fill: subtotalFill,
      alignment: { horizontal: 'right', vertical: 'middle' },
    });
    setCell(subRow, 8, otherTotal, { font: { ...boldFont, size: 12 }, fill: subtotalFill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: indianNumFmt });
    setCell(subRow, 9, '', { fill: subtotalFill });
    applyBorders(subRow, 1, 9);
    r++;
  }

  // Spacer
  const spacerGT = ws.getRow(r);
  spacerGT.height = 6;
  ws.mergeCells(r, 1, r, 9);
  r++;

  // ── GRAND TOTAL (Reimbursement only — before admin section) ──
  const totalRow = ws.getRow(r);
  totalRow.height = 22;
  ws.mergeCells(r, 1, r, 7);
  setCell(totalRow, 1, `Rupees in Words: ${data.totalInWords} Only/-`, { font: boldFont, fill: lightYellowFill });
  setCell(totalRow, 8, data.total, { font: { ...boldFont, size: 12 }, fill: lightYellowFill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: indianNumFmt });
  setCell(totalRow, 9, '', { fill: lightYellowFill });
  applyBorders(totalRow, 1, 9);
  r++;

  // ═══════════════════════════════════════════════════════════
  // TABLE 3: COMPANY PAID EXPENSES (Admin Entries)
  // ═══════════════════════════════════════════════════════════
  if (adminRecords.length > 0) {
    const spacerAdmin = ws.getRow(r);
    spacerAdmin.height = 8;
    ws.mergeCells(r, 1, r, 9);
    r++;

    const adminSecFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };

    const secRow = ws.getRow(r);
    secRow.height = 24;
    ws.mergeCells(r, 1, r, 9);
    setCell(secRow, 1, 'COMPANY PAID EXPENSES (Added by Admin)', { font: { ...sectionFont, color: { argb: 'FF1E40AF' } }, fill: adminSecFill, alignment: { vertical: 'middle' } });
    applyBorders(secRow, 1, 9);
    r++;

    const adminHeaders = ['Date', 'Description', 'Route / Location', 'Total', 'Split', 'Per Person', 'Payment'];
    const ahRow = ws.getRow(r);
    ahRow.height = 26;
    setCell(ahRow, 1, adminHeaders[0], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: adminSecFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    ws.mergeCells(r, 2, r, 3);
    setCell(ahRow, 2, adminHeaders[1], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: adminSecFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    ws.mergeCells(r, 4, r, 5);
    setCell(ahRow, 4, adminHeaders[2], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: adminSecFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    setCell(ahRow, 6, adminHeaders[3], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: adminSecFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    setCell(ahRow, 7, adminHeaders[4], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: adminSecFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    setCell(ahRow, 8, adminHeaders[5], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: adminSecFill, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } });
    setCell(ahRow, 9, adminHeaders[6], { font: { ...boldFont, color: { argb: 'FF111827' } }, fill: adminSecFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    applyBorders(ahRow, 1, 9);
    r++;

    const adminBgFill: any = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF6FF' } };
    let adminTotal = 0;
    for (let i = 0; i < adminRecords.length; i++) {
      const rec = adminRecords[i];
      const row = ws.getRow(r);
      row.height = 22;
      const rowFill = i % 2 === 0 ? adminBgFill : whiteFill;
      const route = rec.description === 'Hotel'
        ? (rec.from_location || '')
        : `${rec.from_location || ''} → ${rec.to_location || ''}`;

      setCell(row, 1, fmtDateShort(rec.date), { fill: rowFill, alignment: { horizontal: 'center' } });
      ws.mergeCells(r, 2, r, 3);
      setCell(row, 2, rec.description || '', { fill: rowFill });
      ws.mergeCells(r, 4, r, 5);
      setCell(row, 4, route, { fill: rowFill });
      setCell(row, 6, rec.admin_total_amount || Number(rec.amount), { fill: rowFill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: indianNumFmt });
      setCell(row, 7, rec.admin_split_count ? `÷ ${rec.admin_split_count}` : '', { fill: rowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
      setCell(row, 8, Number(rec.amount), { fill: rowFill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: indianNumFmt });
      setCell(row, 9, rec.mode_of_payment || 'Company Paid', { fill: rowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
      applyBorders(row, 1, 9);
      adminTotal += Number(rec.amount);
      r++;
    }

    const subRow = ws.getRow(r);
    subRow.height = 20;
    ws.mergeCells(r, 1, r, 7);
    setCell(subRow, 1, 'Total', {
      font: boldFont,
      fill: subtotalFill,
      alignment: { horizontal: 'right', vertical: 'middle' },
    });
    setCell(subRow, 8, adminTotal, { font: { ...boldFont, size: 12 }, fill: subtotalFill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: indianNumFmt });
    setCell(subRow, 9, '', { fill: subtotalFill });
    applyBorders(subRow, 1, 9);
    r++;
  }

  // ── FINAL TOTAL (Reimbursement + Admin) ──
  if (adminRecords.length > 0) {
    const spacerFinal = ws.getRow(r);
    spacerFinal.height = 6;
    ws.mergeCells(r, 1, r, 9);
    r++;

    const finalTotal = data.total + adminRecords.reduce((sum, rec) => sum + Number(rec.amount), 0);
    const finalTotalRow = ws.getRow(r);
    finalTotalRow.height = 24;
    ws.mergeCells(r, 1, r, 7);
    setCell(finalTotalRow, 1, 'Grand Total (Reimbursement + Company Paid)', {
      font: { ...boldFont, size: 11 },
      fill: yellowFill,
      alignment: { horizontal: 'right', vertical: 'middle' },
    });
    setCell(finalTotalRow, 8, finalTotal, { font: { ...boldFont, size: 13 }, fill: yellowFill, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: indianNumFmt });
    setCell(finalTotalRow, 9, '', { fill: yellowFill });
    applyBorders(finalTotalRow, 1, 9);
    r++;
  }

  const spacerSig = ws.getRow(r);
  spacerSig.height = 6;
  ws.mergeCells(r, 1, r, 9);
  r++;

  // ── SIGNATURE SECTION ──
  const sigHdrRow = ws.getRow(r);
  sigHdrRow.height = 22;
  ws.mergeCells(r, 1, r, 3);
  setCell(sigHdrRow, 1, '', { font: boldFont, fill: yellowFill });
  ws.mergeCells(r, 4, r, 5);
  setCell(sigHdrRow, 4, 'Name', { font: boldFont, fill: yellowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
  ws.mergeCells(r, 6, r, 7);
  setCell(sigHdrRow, 6, 'Date', { font: boldFont, fill: yellowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
  ws.mergeCells(r, 8, r, 9);
  setCell(sigHdrRow, 8, 'Status', { font: boldFont, fill: yellowFill, alignment: { horizontal: 'center', vertical: 'middle' } });
  applyBorders(sigHdrRow, 1, 9);
  r++;

  const sigData: { label: string; name: string; date: string; status: string }[] = [
    {
      label: 'Digitally Prepared by',
      name: data.employee.name,
      date: data.sheet.managerActionAt ? fmtDate(data.sheet.managerActionAt) : '',
      status: data.sheet.status !== 'draft' ? 'Submitted' : '',
    },
    {
      label: 'Digitally Approved by',
      name: data.sheet.managerName || '',
      date: data.sheet.managerActionAt ? fmtDate(data.sheet.managerActionAt) : '',
      status: data.sheet.managerName
        ? (data.sheet.status === 'manager_change_requested' ? 'Changes Requested' : 'Approved')
        : 'Pending',
    },
    {
      label: 'Digitally Sanctioned by',
      name: data.sheet.hrReviewerName || '',
      date: data.sheet.hrReviewedAt ? fmtDate(data.sheet.hrReviewedAt) : '',
      status: data.sheet.hrReviewerName
        ? (data.sheet.status === 'hr_change_requested' ? 'Changes Requested' : 'Approved')
        : 'Pending',
    },
    {
      label: 'Accounts / Payment',
      name: data.sheet.accountsHandlerName || '',
      date: data.sheet.accountsCompletedAt ? fmtDate(data.sheet.accountsCompletedAt) : '',
      status: data.sheet.accountsHandlerName ? 'Completed' : 'Pending',
    },
  ];

  const approvedFont: any = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FF16A34A' } };
  const pendingFont: any = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FF9CA3AF' } };
  const rejectedFont: any = { bold: true, size: 9, name: 'Calibri', color: { argb: 'FFDC2626' } };

  for (const sig of sigData) {
    const row = ws.getRow(r);
    row.height = 30;
    ws.mergeCells(r, 1, r, 3);
    setCell(row, 1, sig.label, { font: boldFont, fill: yellowFill, alignment: { vertical: 'middle', wrapText: true } });
    ws.mergeCells(r, 4, r, 5);
    setCell(row, 4, sig.name, { font: normalFont, fill: whiteFill, alignment: { vertical: 'middle' } });
    ws.mergeCells(r, 6, r, 7);
    setCell(row, 6, sig.date, { font: normalFont, fill: whiteFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    ws.mergeCells(r, 8, r, 9);
    const statusFont = sig.status === 'Pending' ? pendingFont
      : sig.status === 'Changes Requested' ? rejectedFont
      : approvedFont;
    setCell(row, 8, sig.status, { font: statusFont, fill: whiteFill, alignment: { horizontal: 'center', vertical: 'middle' } });
    applyBorders(row, 1, 9);
    r++;
  }

  // ── PAYMENT ROW ──
  if (data.sheet.status === 'payment_done' && data.sheet.paymentReference) {
    const spacerPay = ws.getRow(r);
    spacerPay.height = 6;
    ws.mergeCells(r, 1, r, 9);
    r++;
    const payRow = ws.getRow(r);
    payRow.height = 22;
    ws.mergeCells(r, 1, r, 9);
    setCell(payRow, 1, `Payment Completed — Ref: ${data.sheet.paymentReference} | by ${data.sheet.accountsHandlerName || ''}${data.sheet.accountsCompletedAt ? ' on ' + fmtDate(data.sheet.accountsCompletedAt) : ''}`, {
      font: { ...boldFont, color: { argb: 'FF16A34A' } },
      fill: greenFill,
      alignment: { horizontal: 'left', vertical: 'middle' },
    });
    applyBorders(payRow, 1, 9);
    r++;
  }

  // ── NOTES ──
  const spacerNotes = ws.getRow(r);
  spacerNotes.height = 6;
  ws.mergeCells(r, 1, r, 9);
  r++;
  const note1Row = ws.getRow(r);
  ws.mergeCells(r, 1, r, 9);
  setCell(note1Row, 1, 'Note:- Bills / supporting proofs are digitally attached in the internal software, MatrixIQ.', { font: { ...smallFont, italic: true, color: { argb: 'FF6B7280' } } });

  // ── OUTER BORDER (medium) on the entire used range ──
  const lastRow = r;
  const lastCol = 9;
  for (let row = 1; row <= lastRow; row++) {
    const wsRow = ws.getRow(row);
    for (let col = 1; col <= lastCol; col++) {
      const cell = wsRow.getCell(col);
      const existing = cell.border || {};
      cell.border = {
        top: row === 1 ? { style: 'medium' } : (existing.top || {}),
        bottom: row === lastRow ? { style: 'medium' } : (existing.bottom || {}),
        left: col === 1 ? { style: 'medium' } : (existing.left || {}),
        right: col === lastCol ? { style: 'medium' } : (existing.right || {}),
      };
    }
  }

  // ── DOWNLOAD ──
  const fileName = `Expense_Voucher_${data.employee.employeeId}_${monthNames[data.sheet.month]}_${data.sheet.year}.xlsx`;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
