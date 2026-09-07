import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { cancel, decide, findById } from '@/lib/leaveRequestStore';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { isHrManager } from '@/lib/hrAccess';
import { findUserById, findUserByUsername } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';

// Approve/reject (manager of the requester's department, HR manager, or
// privileged) or cancel (the requester themself, only while still pending).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await isModuleAccessAllowed('leave', viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const leave = await findById(id);
    if (!leave) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });

    if (body.action === 'cancel') {
      if (leave.user_id !== viewer.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const ok = await cancel(id, viewer.userId);
      if (!ok) return NextResponse.json({ error: 'Only a pending request can be cancelled' }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    if (body.action !== 'approve' && body.action !== 'reject') {
      return NextResponse.json({ error: 'A valid action is required' }, { status: 400 });
    }

    const scope = await resolveVisibilityScope(viewer.username);
    const isDeptManager = scope.seesOrgWide || (scope.scopedUserIds ?? []).includes(leave.user_id);
    const isSelfManaging = leave.user_id === viewer.userId;
    if (isSelfManaging || (!isDeptManager && !(await isHrManager(viewer)))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const actor = await findUserByUsername(viewer.username);
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
    const updated = await decide(id, body.action === 'approve' ? 'approved' : 'rejected', actor.id, remarks);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'leave_request',
      entityId: id,
      action: `Leave ${body.action === 'approve' ? 'approved' : 'rejected'}${remarks ? `: ${remarks}` : ''}`,
      previousStatus: 'pending',
      newStatus: body.action === 'approve' ? 'approved' : 'rejected',
      remarks,
      ip: getClientIp(request)
    });

    const requester = await findUserById(leave.user_id);
    if (requester) {
      await notifyUsers([requester.username], {
        title: `Leave ${body.action === 'approve' ? 'Approved' : 'Rejected'}`,
        body: `${leave.leave_type} leave (${leave.start_date} to ${leave.end_date})${remarks ? `\nNote: ${remarks}` : ''}`,
        type: `leave_${body.action}d`,
        entityType: 'leave_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
