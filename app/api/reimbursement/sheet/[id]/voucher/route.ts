import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { reimbursementStore } from '@/lib/reimbursementStore';
import { numberToIndianWords } from '@/lib/numberToWords';
import { apiErrorResponse } from '@/lib/apiError';
import { findUserByUsername } from '@/lib/userStore';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const sheet = await reimbursementSheetStore.findById(id);
    if (!sheet) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });

    const creator = await findUserByUsername(sheet.created_by);
    if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 });

    const allRecords = await reimbursementStore.listByUserId(creator.id, sheet.year, sheet.month);
    const canSeeAdmin = ['superadmin', 'admin', 'hr', 'accounts'].includes(viewer.role);
    const records = canSeeAdmin ? allRecords : allRecords.filter((r) => !r.is_admin_entry);
    const total = allRecords.filter((r) => !r.is_admin_entry).reduce((sum, r) => sum + r.amount, 0);

    const MONTH_NAMES = reimbursementSheetStore.MONTH_NAMES;
    const lastDay = new Date(sheet.year, sheet.month, 0).getDate();

    return NextResponse.json({
      employee: {
        name: sheet.creator_name,
        employeeId: sheet.creator_employee_id || 'NA',
        department: sheet.creator_department || '—',
        designation: sheet.creator_designation || '—',
      },
      sheet: {
        code: sheet.sheet_code,
        month: sheet.month,
        year: sheet.year,
        status: sheet.status,
        expensePeriod: `${String(1).padStart(2, '0')}.${String(sheet.month).padStart(2, '0')}.${sheet.year} to ${String(lastDay).padStart(2, '0')}.${String(sheet.month).padStart(2, '0')}.${sheet.year}`,
        paidTo: sheet.creator_name,
        managerName: sheet.manager_name || '',
        managerActionAt: sheet.manager_action_at || '',
        hrReviewerName: sheet.hr_reviewer_name || '',
        hrReviewedAt: sheet.hr_reviewed_at || '',
        accountsHandlerName: sheet.accounts_handler_name || '',
        accountsCompletedAt: sheet.accounts_completed_at || '',
        paymentReference: sheet.payment_reference || '',
      },
      records,
      total: Math.round(total * 100) / 100,
      totalInWords: numberToIndianWords(total),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
