import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { sendMarketingRequestLifecycleEmail } from '@/lib/email/notifications';
import { findUsersByUsernames } from '@/lib/userStore';
import { listDepartmentManagers } from '@/lib/departmentStore';

// The assigned marketing member declines — bounces the request back to
// 'submitted' and clears the assignment so the manager can pick someone
// else, same shape as assign/route.ts's unassign branch.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'A reason is required to decline an assignment' }, { status: 400 });

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    if (existing.assigned_to !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden — only the assigned marketing member can decline this assignment' }, { status: 403 });
    }
    if (existing.assignment_status !== 'pending') {
      return NextResponse.json({ error: 'This assignment is not awaiting your confirmation' }, { status: 400 });
    }

    const updated = await marketingRequestStore.update(id, {
      status: 'submitted',
      assigned_to_id: '',
      assigned_to: '',
      assigned_to_name: '',
      assignment_status: 'declined',
      assignment_decline_reason: reason,
      updated_at: new Date().toISOString()
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: 'Assignment declined',
      previousStatus: existing.status,
      newStatus: 'submitted',
      remarks: reason,
      ip: getClientIp(request)
    });

    const marketingManagers = (await listDepartmentManagers())['Marketing'] || [];
    const notifyTargets = marketingManagers.filter((m) => m.username && m.username !== viewer.username);
    if (notifyTargets.length) {
      await notifyUsers(notifyTargets.map((m) => m.username), {
        title: 'Assignment declined',
        body: `${viewer.username} declined "${existing.title}": ${reason}`,
        type: 'marketing_request_assignment_declined',
        entityType: 'marketing_request',
        entityId: id
      });
      const managerUsers = await findUsersByUsernames(notifyTargets.map((m) => m.username));
      managerUsers.forEach((managerUser) => {
        if (managerUser.email) {
          void sendMarketingRequestLifecycleEmail({
            name: managerUser.name,
            email: managerUser.email,
            event: 'assignment_declined',
            title: existing.title,
            detail: `Declined by ${viewer.username} — Reason: ${reason}`
          });
        }
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
