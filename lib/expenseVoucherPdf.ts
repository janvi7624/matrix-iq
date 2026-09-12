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

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fmtDate(iso: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return iso; }
}

function fmtDateShort(iso: string): string {
  if (!iso) return '';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return iso; }
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseDescription(desc: string): { description: string; vehicleType: string } {
  const m = desc.match(/^Conveyance \((2 Wheeler|4 Wheeler|Cab)\)$/);
  if (m) return { description: 'Conveyance', vehicleType: m[1] };
  return { description: desc, vehicleType: '' };
}

const TRAVEL_TYPES = new Set(['Conveyance', 'Bus Ticket', 'Train Ticket', 'Flight Ticket']);
function isTravel(desc: string): boolean {
  return TRAVEL_TYPES.has(parseDescription(desc).description);
}

function loadImageAsDataURL(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas 2d context unavailable');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Same jsPDF + jspdf-autotable stack as lib/deliveryChallanPdf.ts and
// lib/pdf.ts — already a dependency, no new library needed. Mirrors the
// exact section structure of the ExcelJS version this replaces (Conveyance
// / Food-Hotel-Other / Company Paid, each with its own subtotal, then a
// combined grand total and a 4-row approval signature block) but lets
// autoTable handle spacing/borders/pagination declaratively instead of
// hand-placed cells, which is what actually gets the "proper spacing"
// ExcelJS's manual row-height estimation kept getting subtly wrong.
export async function generateExpenseVoucherPdf(data: VoucherData): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { applyPlugin } = await import('jspdf-autotable');
  applyPlugin(jsPDF);

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 12;
  const rightX = pageWidth - marginX;

  let logoDataUrl: string | null = null;
  try {
    logoDataUrl = await loadImageAsDataURL('/NANTA.png');
  } catch {
    logoDataUrl = null;
  }

  const logoW = 18;
  const logoH = 13;
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', marginX, 8, logoW, logoH, undefined, 'FAST');
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text('Employee Expense Claim Form', pageWidth / 2, 15, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(`Sheet: ${data.sheet.code}`, rightX, 11, { align: 'right' });
  doc.text(`Date: ${fmtDate(new Date().toISOString())}`, rightX, 16, { align: 'right' });

  let y = 24;
  doc.setDrawColor(220, 38, 38);
  doc.setLineWidth(0.6);
  doc.line(marginX, y, rightX, y);
  y += 6;

  // Employee/period info — two columns of label:value pairs, same fields
  // the Excel header block had.
  const infoLeft: [string, string][] = [
    ['Emp. ID', data.employee.employeeId],
    ['Emp. Name', data.employee.name],
    ['Designation', data.employee.designation],
    ['Paid to', data.sheet.paidTo || '-']
  ];
  const infoRight: [string, string][] = [
    ['Department', data.employee.department],
    ['Expense Period', `${MONTH_NAMES[data.sheet.month]} - ${data.sheet.year}`]
  ];
  const rightColX = marginX + (pageWidth - marginX * 2) / 2 + 6;
  doc.setFontSize(9.5);
  infoLeft.forEach(([label, val], i) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(55, 65, 81);
    doc.text(`${label}:`, marginX, y + i * 6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(17, 24, 39);
    doc.text(val || '-', marginX + 30, y + i * 6);
  });
  infoRight.forEach(([label, val], i) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(55, 65, 81);
    doc.text(`${label}:`, rightColX, y + i * 6);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(17, 24, 39);
    doc.text(val || '-', rightColX + 38, y + i * 6);
  });
  y += Math.max(infoLeft.length, infoRight.length) * 6 + 6;

  const adminRecords = data.records.filter((rec) => rec.is_admin_entry);
  const regularRecords = data.records.filter((rec) => !rec.is_admin_entry);
  const travelRecords = regularRecords.filter((rec) => isTravel(rec.description || ''));
  const otherRecords = regularRecords.filter((rec) => !isTravel(rec.description || ''));

  function ensureRoom(needed: number) {
    if (y + needed > pageHeight - 20) {
      doc.addPage();
      y = 16;
    }
  }

  function sectionTitle(title: string, color: [number, number, number] = [17, 24, 39], fill: [number, number, number] = [229, 231, 235]) {
    ensureRoom(12);
    doc.setFillColor(...fill);
    doc.rect(marginX, y, rightX - marginX, 7, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...color);
    doc.text(title, marginX + 3, y + 5);
    y += 10;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function runTable(opts: any) {
    ensureRoom(20);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (doc as any).autoTable({ startY: y, margin: { left: marginX, right: marginX }, ...opts });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    y = (doc as any).lastAutoTable.finalY + 4;
  }

  const baseTableStyle = { font: 'helvetica', fontSize: 8.5, cellPadding: 2.4, textColor: [17, 24, 39] as [number, number, number], lineColor: [200, 200, 200] as [number, number, number], lineWidth: 0.15 };
  const headStyle = { fillColor: [255, 214, 0] as [number, number, number], textColor: [17, 24, 39] as [number, number, number], fontStyle: 'bold' as const, halign: 'center' as const };

  let travelTotal = 0;
  if (travelRecords.length > 0) {
    sectionTitle('CONVEYANCE');
    travelTotal = travelRecords.reduce((sum, r) => sum + Number(r.amount), 0);
    runTable({
      head: [['Date', 'Description', 'Vehicle', 'Employee', 'From', 'To', 'KM', 'Amount', 'Payment']],
      body: travelRecords.map((rec) => {
        const { description, vehicleType } = parseDescription(rec.description || '');
        return [
          fmtDateShort(rec.date), description, vehicleType, rec.employee_names.join(', '),
          rec.from_location || '', rec.to_location || '', rec.kilometers ? String(rec.kilometers) : '',
          fmtAmount(Number(rec.amount)), rec.mode_of_payment || ''
        ];
      }),
      foot: [['', '', '', '', '', '', 'Total', fmtAmount(travelTotal), '']],
      theme: 'grid',
      styles: baseTableStyle,
      headStyles: headStyle,
      footStyles: { fillColor: [255, 243, 224], textColor: [17, 24, 39], fontStyle: 'bold', halign: 'right' },
      columnStyles: { 6: { halign: 'center' }, 7: { halign: 'right', font: 'courier' } }
    });
  }

  let otherTotal = 0;
  if (otherRecords.length > 0) {
    sectionTitle('FOOD, HOTEL & OTHER EXPENSES');
    otherTotal = otherRecords.reduce((sum, r) => sum + Number(r.amount), 0);
    runTable({
      head: [['Date', 'Description', 'Employee', 'Amount', 'Payment']],
      body: otherRecords.map((rec) => [
        fmtDateShort(rec.date), rec.description || '', rec.employee_names.join(', '),
        fmtAmount(Number(rec.amount)), rec.mode_of_payment || ''
      ]),
      foot: [['', '', 'Total', fmtAmount(otherTotal), '']],
      theme: 'grid',
      styles: baseTableStyle,
      headStyles: headStyle,
      footStyles: { fillColor: [255, 243, 224], textColor: [17, 24, 39], fontStyle: 'bold', halign: 'right' },
      columnStyles: { 3: { halign: 'right', font: 'courier' } }
    });
  }

  // Reimbursement-only grand total, before the admin section — matches the
  // Excel version's placement exactly.
  ensureRoom(12);
  doc.setFillColor(255, 249, 196);
  doc.rect(marginX, y, rightX - marginX, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(17, 24, 39);
  doc.text(`Rupees in Words: ${data.totalInWords} Only/-`, marginX + 3, y + 5.5);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10.5);
  doc.text(fmtAmount(data.total), rightX - 3, y + 5.5, { align: 'right' });
  y += 12;

  if (adminRecords.length > 0) {
    sectionTitle('COMPANY PAID EXPENSES (Added by Admin)', [30, 64, 175], [219, 234, 254]);
    const adminTotal = adminRecords.reduce((sum, r) => sum + Number(r.amount), 0);
    runTable({
      head: [['Date', 'Description', 'Route / Location', 'Total', 'Split', 'Per Person', 'Payment']],
      body: adminRecords.map((rec) => {
        const route = rec.description === 'Hotel' ? (rec.from_location || '') : `${rec.from_location || ''} → ${rec.to_location || ''}`;
        return [
          fmtDateShort(rec.date), rec.description || '', route,
          fmtAmount(rec.admin_total_amount || Number(rec.amount)),
          rec.admin_split_count ? `÷ ${rec.admin_split_count}` : '',
          fmtAmount(Number(rec.amount)), rec.mode_of_payment || 'Company Paid'
        ];
      }),
      foot: [['', '', '', '', '', 'Total', fmtAmount(adminTotal)]],
      theme: 'grid',
      styles: baseTableStyle,
      headStyles: { ...headStyle, fillColor: [219, 234, 254] },
      footStyles: { fillColor: [255, 243, 224], textColor: [17, 24, 39], fontStyle: 'bold', halign: 'right' },
      columnStyles: { 3: { halign: 'right', font: 'courier' }, 5: { halign: 'right', font: 'courier' } }
    });

    const finalTotal = data.total + adminTotal;
    ensureRoom(12);
    doc.setFillColor(255, 214, 0);
    doc.rect(marginX, y, rightX - marginX, 9, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    doc.text('Grand Total (Reimbursement + Company Paid)', marginX + 3, y + 6);
    doc.setFont('courier', 'bold');
    doc.setFontSize(11.5);
    doc.text(fmtAmount(finalTotal), rightX - 3, y + 6, { align: 'right' });
    y += 13;
  }

  // Signature / approval chain — same 4 stages as the Excel version.
  ensureRoom(35);
  const sigRows: [string, string, string, string][] = [
    ['Digitally Prepared by', data.employee.name, data.sheet.managerActionAt ? fmtDate(data.sheet.managerActionAt) : '', data.sheet.status !== 'draft' ? 'Submitted' : ''],
    ['Digitally Approved by', data.sheet.managerName || '', data.sheet.managerActionAt ? fmtDate(data.sheet.managerActionAt) : '', data.sheet.managerName ? (data.sheet.status === 'manager_change_requested' ? 'Changes Requested' : 'Approved') : 'Pending'],
    ['Digitally Sanctioned by', data.sheet.hrReviewerName || '', data.sheet.hrReviewedAt ? fmtDate(data.sheet.hrReviewedAt) : '', data.sheet.hrReviewerName ? (data.sheet.status === 'hr_change_requested' ? 'Changes Requested' : 'Approved') : 'Pending'],
    ['Accounts / Payment', data.sheet.accountsHandlerName || '', data.sheet.accountsCompletedAt ? fmtDate(data.sheet.accountsCompletedAt) : '', data.sheet.accountsHandlerName ? 'Completed' : 'Pending']
  ];
  runTable({
    head: [['', 'Name', 'Date', 'Status']],
    body: sigRows,
    theme: 'grid',
    styles: { ...baseTableStyle, fontSize: 9 },
    headStyles: headStyle,
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 }, 2: { halign: 'center' }, 3: { halign: 'center', fontStyle: 'bold' } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (hookData: any) => {
      if (hookData.section === 'body' && hookData.column.index === 3) {
        const status = hookData.cell.raw;
        hookData.cell.styles.textColor = status === 'Pending' ? [156, 163, 175] : status === 'Changes Requested' ? [220, 38, 38] : [22, 163, 74];
      }
    }
  });

  if (data.sheet.status === 'payment_done' && data.sheet.paymentReference) {
    ensureRoom(12);
    doc.setFillColor(232, 245, 233);
    doc.rect(marginX, y, rightX - marginX, 8, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(22, 163, 74);
    const paidBy = data.sheet.accountsHandlerName ? ` by ${data.sheet.accountsHandlerName}` : '';
    const paidOn = data.sheet.accountsCompletedAt ? ` on ${fmtDate(data.sheet.accountsCompletedAt)}` : '';
    doc.text(`Payment Completed — Ref: ${data.sheet.paymentReference}${paidBy}${paidOn}`, marginX + 3, y + 5.5);
    y += 12;
  }

  ensureRoom(8);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(107, 114, 128);
  doc.text('Note: Bills / supporting proofs are digitally attached in the internal software, MatrixIQ.', marginX, y);

  doc.save(`Expense_Voucher_${data.employee.employeeId}_${MONTH_NAMES[data.sheet.month]}_${data.sheet.year}.pdf`);
}
