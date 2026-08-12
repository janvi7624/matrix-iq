import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { db } from '@/lib/db';

// Assignment is independent of status — a ticket can be in_progress AND
// (re)assigned. Never touches `timeline`.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const allowed = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'marketing-requests', 'assign'));
  if (!allowed) return NextResponse.json({ error: 'Forbidden — only a marketing reviewer can assign this request' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const assigneeId = typeof body?.assigneeId === 'string' ? body.assigneeId.trim() : '';

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    let assigneeUsername = '';
    if (assigneeId) {
      const assignee = await db.User.findByPk(assigneeId);
      if (!assignee) return NextResponse.json({ error: 'Assignee not found' }, { status: 400 });
      assigneeUsername = assignee.get('username') as string;
    }

    const updated = await marketingRequestStore.assign(id, assigneeId || null);
    if (!updated) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    const wasAssigned = Boolean(existing.assigned_to);
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: assigneeUsername
        ? `Marketing request ${wasAssigned ? 'reassigned' : 'assigned'} to ${assigneeUsername}`
        : 'Marketing request unassigned',
      previousStatus: existing.status,
      newStatus: existing.status,
      remarks: existing.assigned_to ? `Previously: ${existing.assigned_to}` : '',
      ip: getClientIp(request)
    });

    if (assigneeUsername && assigneeUsername !== viewer.username) {
      await notifyUsers([assigneeUsername], {
        title: 'Marketing request assigned to you',
        body: `"${existing.title}" was assigned to you by ${viewer.username}.`,
        type: 'marketing_request_assigned',
        entityType: 'marketing_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
