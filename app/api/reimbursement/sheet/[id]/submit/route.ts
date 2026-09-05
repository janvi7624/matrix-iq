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
import { getEffectiveDeadline } from '@/lib/reimbursementDeadlineStore';
import { ordinalDay } from '@/lib/format';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const existing = await reimbursementSheetStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 });

    const allowed = ['draft', 'manager_change_requested', 'hr_change_requested'];
    if (!allowed.includes(existing.status)) {
      return NextResponse.json({ error: 'Sheet cannot be submitted in its current status' }, { status: 400 });
    }
    if (existing.created_by !== viewer.username && !viewer.isPrivileged) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }
    if (existing.entry_count === 0) {
      return NextResponse.json({ error: 'Cannot submit an empty sheet — add at least one entry' }, { status: 400 });
    }

    const today = new Date();
    const dayOfMonth = today.getDate();
    const deadline = await getEffectiveDeadline(today.getFullYear(), today.getMonth() + 1);
    if (deadline.day !== null && dayOfMonth > deadline.day) {
      const extendedNote = deadline.extended ? ` (extended${deadline.extendedByName ? ` by ${deadline.extendedByName}` : ''})` : '';
      return NextResponse.json({ error: `Reimbursement sheets can only be submitted through the ${ordinalDay(deadline.day)} of the month${extendedNote}.` }, { status: 400 });
    }

    const allManagers = await listDepartmentManagers();
    // A department manager has nobody above them in their own department to
    // approve their sheet — route it straight to HR instead of notifying
    // them to approve their own submission (see the "all managers'
    // reimbursement will directly go to HR" requirement).
    const submitterIsManager = Object.values(allManagers).some((managers) => managers.some((m) => m.username === viewer.username));

    const monthName = reimbursementSheetStore.MONTH_NAMES[existing.month] || '';
    const totalStr = `₹${existing.total_amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

    if (submitterIsManager) {
      const updated = await reimbursementSheetStore.submitDirectToHr(id);

      await logAudit({
        by: viewer.username, role: viewer.role, entityType: 'reimbursement_sheet', entityId: id,
        action: 'submit_direct_to_hr', previousStatus: existing.status, newStatus: 'manager_approved',
        ip: getClientIp(request),
      });

      const hrManagers = findHrManagers(allManagers);
      if (hrManagers.length) {
        await notifyUsers(hrManagers.map((m) => m.username), {
          title: 'Reimbursement sheet needs HR review',
          body: `${viewer.name} (a department manager) submitted their reimbursement sheet for ${monthName} ${existing.year} (${existing.sheet_code}) — routed directly to HR — ${totalStr}`,
          type: 'reimbursement_hr_review',
          entityType: 'reimbursement_sheet',
          entityId: id,
        });

        const hrUsers = await findUsersByUsernames(hrManagers.map((m) => m.username));
        for (const hu of hrUsers) {
          sendReimbursementLifecycleEmail({
            email: hu.email, name: hu.name || hu.username, event: 'submitted_by_manager',
            employeeName: existing.creator_name, employeeId: existing.creator_employee_id,
            department: existing.creator_department, sheetCode: existing.sheet_code,
            month: monthName, year: existing.year, totalAmount: totalStr,
          });
        }
      }

      return NextResponse.json(updated);
    }

    const updated = await reimbursementSheetStore.submit(id);

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'reimbursement_sheet', entityId: id,
      action: 'submit', previousStatus: existing.status, newStatus: 'submitted',
      ip: getClientIp(request),
    });

    const user = await findUserByUsername(viewer.username);
    const creatorDept = user?.department || '';
    const managers = creatorDept ? (allManagers[creatorDept] || []) : [];

    if (managers.length) {
      await notifyUsers(managers.map((m) => m.username), {
        title: 'Reimbursement sheet needs your approval',
        body: `${viewer.name} submitted reimbursement sheet for ${monthName} ${existing.year} (${existing.sheet_code}) — ${totalStr}`,
        type: 'reimbursement_manager_approval',
        entityType: 'reimbursement_sheet',
        entityId: id,
      });

      const managerUsers = await findUsersByUsernames(managers.map((m) => m.username));
      for (const mu of managerUsers) {
        sendReimbursementLifecycleEmail({
          email: mu.email, name: mu.name || mu.username, event: 'submitted',
          employeeName: existing.creator_name, employeeId: existing.creator_employee_id,
          department: existing.creator_department, sheetCode: existing.sheet_code,
          month: monthName, year: existing.year, totalAmount: totalStr,
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
