import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { apiErrorResponse } from '@/lib/apiError';
import { assertAdmin, APPROVER_USERNAME, notifyAccountsOfAdminExpense } from '@/lib/adminExpenseAccess';

export async function POST(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const admin = await assertAdmin(request);
  if (!admin) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  if (admin.username !== APPROVER_USERNAME) {
    return NextResponse.json({ error: 'Only the designated approver can approve this expense' }, { status: 403 });
  }

  const { batchId } = await params;

  try {
    const rows = await db.Reimbursement.findAll({ where: { admin_note: batchId, is_admin_entry: true } as never });
    if (!rows.length) return NextResponse.json({ error: 'Batch not found' }, { status: 404 });

    const plain = rows.map((r) => r.get({ plain: true })) as Record<string, unknown>[];
    if (plain[0].approval_status !== 'pending_approval') {
      return NextResponse.json({ error: 'This batch is not awaiting approval' }, { status: 400 });
    }

    await db.Reimbursement.update(
      { approval_status: 'approved', approved_by: admin.userId, approved_at: new Date() } as never,
      { where: { admin_note: batchId, is_admin_entry: true } as never }
    );

    const description = plain[0].description as string;
    const totalAmount = Number(plain[0].admin_total_amount) || 0;
    const resolvedDate = plain[0].date as string;
    const employeeIds = Array.from(new Set(plain.map((r) => r.created_by as string)));

    await notifyAccountsOfAdminExpense({
      action: 'approved', addedByName: admin.name, expenseType: description,
      totalAmount, resolvedDate, batchId, employeeIds,
    });

    return NextResponse.json({ message: 'Expense approved and sent to Accounts' });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
