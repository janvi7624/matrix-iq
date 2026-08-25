import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { findUserByUsername, findUsersByUsernames } from '@/lib/userStore';
import { sendReimbursementLifecycleEmail } from '@/lib/email/notifications';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const body = await request.json().catch(() => null);
    const decision = body?.decision as string;
    const remarks = (body?.remarks as string) || '';

    if (decision !== 'hr_approved' && decision !== 'hr_change_requested') {
      return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
    }

    const existing = await reimbursementSheetStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
    if (existing.status !== 'manager_approved') {
      return NextResponse.json({ error: 'Sheet is not awaiting HR review' }, { status: 400 });
    }

    const allManagers = await listDepartmentManagers();
    const hrManagers = allManagers['HR'] || [];
    const isHr = hrManagers.some((m) => m.username === viewer.username);
    const isSuperRole = viewer.role === 'admin' || viewer.role === 'superadmin';

    if (!isHr && !isSuperRole) {
      return NextResponse.json({ error: 'Not authorized — only HR managers can review' }, { status: 403 });
    }

    const actorUser = await findUserByUsername(viewer.username);
    if (!actorUser) return NextResponse.json({ error: 'Actor not found' }, { status: 404 });

    const creator = await findUserByUsername(existing.created_by);

    const updated = await reimbursementSheetStore.hrDecide(id, decision, actorUser.id, remarks);
    const monthName = reimbursementSheetStore.MONTH_NAMES[existing.month] || '';
    const totalStr = `₹${existing.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'reimbursement_sheet', entityId: id,
      action: decision === 'hr_approved' ? 'hr_approve' : 'hr_change_request',
      previousStatus: existing.status, newStatus: decision, remarks,
      ip: getClientIp(request),
    });

    if (decision === 'hr_approved') {
      const accountsManagers = allManagers['Accounts'] || allManagers['Finance'] || [];
      if (accountsManagers.length) {
        await notifyUsers(accountsManagers.map((m) => m.username), {
          title: 'Reimbursement sheet ready for payment',
          body: `${existing.creator_name}'s reimbursement for ${monthName} ${existing.year} (${existing.sheet_code}) approved by HR — ${totalStr}`,
          type: 'reimbursement_accounts_payment',
          entityType: 'reimbursement_sheet',
          entityId: id,
        });

        const accountsUsers = await findUsersByUsernames(accountsManagers.map((m) => m.username));
        for (const au of accountsUsers) {
          sendReimbursementLifecycleEmail({
            email: au.email, name: au.name || au.username, event: 'hr_approved',
            employeeName: existing.creator_name, employeeId: existing.creator_employee_id,
            department: existing.creator_department, sheetCode: existing.sheet_code,
            month: monthName, year: existing.year, totalAmount: totalStr, remarks,
          });
        }
      }
    } else {
      await notifyUsers([existing.created_by], {
        title: 'Reimbursement sheet returned by HR',
        body: `Your reimbursement sheet for ${monthName} ${existing.year} has been sent back by HR${remarks ? ': ' + remarks : ''}`,
        type: 'reimbursement_change_requested',
        entityType: 'reimbursement_sheet',
        entityId: id,
      });

      if (creator?.email) {
        sendReimbursementLifecycleEmail({
          email: creator.email, name: creator.name || creator.username, event: 'hr_change_requested',
          employeeName: existing.creator_name, employeeId: existing.creator_employee_id,
          department: existing.creator_department, sheetCode: existing.sheet_code,
          month: monthName, year: existing.year, totalAmount: totalStr, remarks,
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
