import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { travelScheduleStore } from '@/lib/travelScheduleStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { findUserByUsername } from '@/lib/userStore';

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
    if (existing.status !== 'submitted') {
      return NextResponse.json({ error: 'This request is not awaiting manager approval' }, { status: 400 });
    }

    // Authorization: creator's department manager or admin/superadmin override
    const isOverride = viewer.role === 'admin' || viewer.role === 'superadmin';
    const creator = await findUserByUsername(existing.created_by);
    if (creator?.department) {
      const managers = (await listDepartmentManagers())[creator.department] || [];
      const isManager = managers.some((m) => m.username === viewer.username);
      if (!isManager && !isOverride) {
        return NextResponse.json({ error: 'Only the department manager can approve this request' }, { status: 403 });
      }
    } else if (!viewer.isPrivileged) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
    const newStatus = decision === 'approve' ? 'manager_approved' : 'changes_requested';
    const updated = await travelScheduleStore.managerDecide(id, newStatus as 'manager_approved' | 'changes_requested', viewer.username, remarks);

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'travel_schedule', entityId: id,
      action: decision === 'approve' ? 'manager_approve' : 'manager_request_changes',
      previousStatus: existing.status, newStatus, remarks, ip: getClientIp(request)
    });

    if (decision === 'approve') {
      // Notify HR department managers
      const hrManagers = (await listDepartmentManagers())['HR'] || [];
      if (hrManagers.length) {
        await notifyUsers(hrManagers.map((m) => m.username), {
          title: 'Travel request needs HR review',
          body: `${existing.created_by}'s travel request (${existing.origin} → ${existing.destination}) approved by manager`,
          type: 'travel_hr_review', entityType: 'travel_schedule', entityId: id
        });
      }
    } else {
      // Notify creator about changes requested
      await notifyUsers([existing.created_by], {
        title: 'Travel request needs changes',
        body: `Your travel request ${existing.request_code} needs changes: ${remarks}`,
        type: 'travel_changes_requested', entityType: 'travel_schedule', entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
