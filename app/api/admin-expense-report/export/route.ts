import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { assertReportViewer } from '@/lib/adminExpenseAccess';
import { getAdminExpenseReport, isValidMonthKey } from '@/lib/adminExpenseReportStore';
import { apiErrorResponse } from '@/lib/apiError';

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Unlike every other export in this app (lib/officeOperationExpenseXlsx.ts,
// lib/exportPdf.ts), this one is generated server-side. Those are pure
// client-side renders of data the browser already fetched, which gives no
// URL of their own to test authorization against directly — Part 13 of the
// spec explicitly requires a real endpoint that independently 403s and
// re-validates the month server-side, so this had to be a genuine API route
// rather than a client-side workbook build.
export async function GET(request: NextRequest) {
  const viewer = await assertReportViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const month = request.nextUrl.searchParams.get('month') || currentMonthKey();
  if (!isValidMonthKey(month)) {
    return NextResponse.json({ error: 'Invalid month — expected YYYY-MM' }, { status: 400 });
  }

  try {
    const report = await getAdminExpenseReport(month);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MatrixIQ';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Admin Expense Report', { views: [{ state: 'frozen', ySplit: 1 }] });

    sheet.columns = [
      { header: 'Month', key: 'month', width: 12 },
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Description', key: 'description', width: 22 },
      { header: 'From', key: 'from', width: 16 },
      { header: 'To', key: 'to', width: 16 },
      { header: 'Amount', key: 'amount', width: 16 }
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      cell.border = { bottom: { style: 'thin' } };
    });

    for (const row of report.rows) {
      sheet.addRow({
        month: report.monthLabel,
        name: row.employeeName,
        description: row.description,
        from: row.fromLocation || '-',
        to: row.toLocation || '-',
        amount: row.amount
      });
    }

    const amountColumn = sheet.getColumn('amount');
    amountColumn.numFmt = '#,##0.00';
    amountColumn.alignment = { horizontal: 'right' };

    const totalRow = sheet.addRow({ description: '', from: '', to: 'Total', amount: report.totalAmount });
    totalRow.font = { bold: true };
    totalRow.getCell('amount').numFmt = '#,##0.00';
    totalRow.getCell('amount').alignment = { horizontal: 'right' };

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Admin_Expense_Report_${report.monthLabel}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
