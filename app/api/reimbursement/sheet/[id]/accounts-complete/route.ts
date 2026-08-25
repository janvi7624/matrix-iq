import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { findUserByUsername } from '@/lib/userStore';
import { sendReimbursementLifecycleEmail } from '@/lib/email/notifications';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const body = await request.json().catch(() => null);
    const paymentReference = (body?.paymentReference as string) || '';
    const remarks = (body?.remarks as string) || '';

    const existing = await reimbursementSheetStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
    if (existing.status !== 'hr_approved') {
      return NextResponse.json({ error: 'Sheet is not awaiting payment' }, { status: 400 });
    }

    const allManagers = await listDepartmentManagers();
    const accountsManagers = allManagers['Accounts'] || allManagers['Finance'] || [];
    const isAccounts = accountsManagers.some((m) => m.username === viewer.username);
    const isSuperRole = viewer.role === 'admin' || viewer.role === 'superadmin';

    if (!isAccounts && !isSuperRole) {
      return NextResponse.json({ error: 'Not authorized — only Accounts team can mark payment' }, { status: 403 });
    }

    const actorUser = await findUserByUsername(viewer.username);
    if (!actorUser) return NextResponse.json({ error: 'Actor not found' }, { status: 404 });

    const creator = await findUserByUsername(existing.created_by);

    const updated = await reimbursementSheetStore.accountsComplete(id, actorUser.id, paymentReference, remarks);
    const monthName = reimbursementSheetStore.MONTH_NAMES[existing.month] || '';
    const totalStr = `₹${existing.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'reimbursement_sheet', entityId: id,
      action: 'payment_done', previousStatus: existing.status, newStatus: 'payment_done',
      remarks: paymentReference ? `Ref: ${paymentReference}` : remarks,
      ip: getClientIp(request),
    });

    await notifyUsers([existing.created_by], {
      title: 'Reimbursement payment completed',
      body: `Your reimbursement for ${monthName} ${existing.year} (${existing.sheet_code}) — ${totalStr} has been paid${paymentReference ? '. Ref: ' + paymentReference : ''}`,
      type: 'reimbursement_payment_done',
      entityType: 'reimbursement_sheet',
      entityId: id,
    });

    if (creator?.email) {
      sendReimbursementLifecycleEmail({
        email: creator.email, name: creator.name || creator.username, event: 'payment_done',
        employeeName: existing.creator_name, employeeId: existing.creator_employee_id,
        department: existing.creator_department, sheetCode: existing.sheet_code,
        month: monthName, year: existing.year, totalAmount: totalStr,
        remarks, paymentReference,
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
