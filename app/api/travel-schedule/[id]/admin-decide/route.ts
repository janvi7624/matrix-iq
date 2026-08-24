import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { travelScheduleStore } from '@/lib/travelScheduleStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { listDepartmentManagers } from '@/lib/departmentStore';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const decision = body.decision as string;
  if (decision !== 'approve' && decision !== 'request_changes') {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }

  try {
    const existing = await travelScheduleStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Travel request not found' }, { status: 404 });
    if (existing.status !== 'hr_reviewed') {
      return NextResponse.json({ error: 'This request is not awaiting admin approval' }, { status: 400 });
    }

    // Authorization: admin/superadmin role or Admin department managers
    const isOverride = viewer.role === 'admin' || viewer.role === 'superadmin';
    if (!isOverride) {
      const adminManagers = (await listDepartmentManagers())['Admin'] || (await listDepartmentManagers())['Administration'] || [];
      const isAdminManager = adminManagers.some((m) => m.username === viewer.username);
      if (!isAdminManager && !viewer.isPrivileged) {
        return NextResponse.json({ error: 'Only Admin can approve this request' }, { status: 403 });
      }
    }

    const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
    const newStatus = decision === 'approve' ? 'admin_approved' : 'changes_requested';
    const updated = await travelScheduleStore.adminDecide(id, newStatus as 'admin_approved' | 'changes_requested', viewer.username, remarks);

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'travel_schedule', entityId: id,
      action: decision === 'approve' ? 'admin_approve' : 'admin_request_changes',
      previousStatus: existing.status, newStatus, remarks, ip: getClientIp(request)
    });

    if (decision === 'approve') {
      // Notify Accounts department for ticket booking
      const accountsManagers = (await listDepartmentManagers())['Accounts'] || [];
      if (accountsManagers.length) {
        await notifyUsers(accountsManagers.map((m) => m.username), {
          title: 'Travel request ready for ticket booking',
          body: `${existing.created_by}'s travel request (${existing.origin} → ${existing.destination}) approved — please book tickets`,
          type: 'travel_ticket_booking', entityType: 'travel_schedule', entityId: id
        });
      }
    } else {
      // Admin can send back to employee (draft), manager (submitted), or HR (manager_approved)
      const sendBackTo = typeof body.sendBackTo === 'string' ? body.sendBackTo : 'employee';
      let revertStatus = 'changes_requested'; // default: back to employee
      let changeBy = 'Admin Department';
      const notifyUsernames: string[] = [];

      if (sendBackTo === 'manager') {
        revertStatus = 'submitted';
        changeBy = 'Admin Department (re-verify by Manager)';
        const allManagers = await listDepartmentManagers();
        const { findUserByUsername } = await import('@/lib/userStore');
        const creator = await findUserByUsername(existing.created_by);
        const creatorDept = creator?.department || '';
        const managers = creatorDept ? (allManagers[creatorDept] || []) : [];
        notifyUsernames.push(...managers.map((m) => m.username));
      } else if (sendBackTo === 'hr') {
        revertStatus = 'manager_approved';
        changeBy = 'Admin Department (re-verify by HR)';
        const hrManagers = (await listDepartmentManagers())['HR'] || [];
        notifyUsernames.push(...hrManagers.map((m) => m.username));
      } else {
        notifyUsernames.push(existing.created_by);
      }

      await travelScheduleStore.update(id, {
        status: revertStatus,
        change_request_remarks: remarks,
        change_requested_by: changeBy,
        admin_reviewer_id: '',
        admin_reviewed_at: '',
        admin_remarks: ''
      } as never);

      if (notifyUsernames.length) {
        await notifyUsers(notifyUsernames, {
          title: 'Travel request sent back for review',
          body: `Travel request ${existing.request_code} (${existing.origin} → ${existing.destination}) sent back by Admin: ${remarks}`,
          type: 'travel_changes_requested', entityType: 'travel_schedule', entityId: id
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
