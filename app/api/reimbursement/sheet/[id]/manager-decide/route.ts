import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { reimbursementSheetStore } from '@/lib/reimbursementSheetStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { listDepartmentManagers, findHrManagers } from '@/lib/departmentStore';
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

    if (decision !== 'manager_approved' && decision !== 'manager_change_requested') {
      return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
    }

    const existing = await reimbursementSheetStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });
    if (existing.status !== 'submitted') {
      return NextResponse.json({ error: 'Sheet is not awaiting manager approval' }, { status: 400 });
    }

    const creator = await findUserByUsername(existing.created_by);
    if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 });

    const allManagers = await listDepartmentManagers();
    const deptManagers = creator.department ? (allManagers[creator.department] || []) : [];
    const isManager = deptManagers.some((m) => m.username === viewer.username);
    const isSuperRole = viewer.role === 'admin' || viewer.role === 'superadmin';

    if (!isManager && !isSuperRole) {
      return NextResponse.json({ error: 'Not authorized — only the department manager can approve' }, { status: 403 });
    }

    const actorUser = await findUserByUsername(viewer.username);
    if (!actorUser) return NextResponse.json({ error: 'Actor not found' }, { status: 404 });

    const updated = await reimbursementSheetStore.managerDecide(id, decision, actorUser.id, remarks);
    const monthName = reimbursementSheetStore.MONTH_NAMES[existing.month] || '';
    const totalStr = `₹${existing.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'reimbursement_sheet', entityId: id,
      action: decision === 'manager_approved' ? 'manager_approve' : 'manager_change_request',
      previousStatus: existing.status, newStatus: decision, remarks,
      ip: getClientIp(request),
    });

    if (decision === 'manager_approved') {
      const hrManagers = findHrManagers(allManagers);
      if (hrManagers.length) {
        await notifyUsers(hrManagers.map((m) => m.username), {
          title: 'Reimbursement sheet needs HR review',
          body: `${existing.creator_name}'s reimbursement for ${monthName} ${existing.year} (${existing.sheet_code}) approved by manager — ${totalStr}`,
          type: 'reimbursement_hr_review',
          entityType: 'reimbursement_sheet',
          entityId: id,
        });

        const hrUsers = await findUsersByUsernames(hrManagers.map((m) => m.username));
        for (const hu of hrUsers) {
          sendReimbursementLifecycleEmail({
            email: hu.email, name: hu.name || hu.username, event: 'manager_approved',
            employeeName: existing.creator_name, employeeId: existing.creator_employee_id,
            department: existing.creator_department, sheetCode: existing.sheet_code,
            month: monthName, year: existing.year, totalAmount: totalStr, remarks,
          });
        }
      }
    } else {
      await notifyUsers([existing.created_by], {
        title: 'Reimbursement sheet returned for changes',
        body: `Your reimbursement sheet for ${monthName} ${existing.year} has been sent back by the manager${remarks ? ': ' + remarks : ''}`,
        type: 'reimbursement_change_requested',
        entityType: 'reimbursement_sheet',
        entityId: id,
      });

      if (creator.email) {
        sendReimbursementLifecycleEmail({
          email: creator.email, name: creator.name || creator.username, event: 'manager_change_requested',
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
