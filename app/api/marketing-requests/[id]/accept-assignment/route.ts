import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { listDepartmentManagers } from '@/lib/departmentStore';

// The assigned marketing member confirms their availability. Only they can
// accept their own assignment — see assign/route.ts for where
// assignment_status is set to 'pending'.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    if (existing.assigned_to !== viewer.username) {
      return NextResponse.json({ error: 'Forbidden — only the assigned marketing member can accept this assignment' }, { status: 403 });
    }
    if (existing.assignment_status !== 'pending') {
      return NextResponse.json({ error: 'This assignment is not awaiting your confirmation' }, { status: 400 });
    }

    const updated = await marketingRequestStore.update(id, { assignment_status: 'accepted', updated_at: new Date().toISOString() });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: 'Assignment accepted',
      previousStatus: existing.status,
      newStatus: existing.status,
      ip: getClientIp(request)
    });

    const marketingManagers = (await listDepartmentManagers())['Marketing'] || [];
    const notifyTargets = marketingManagers.map((m) => m.username).filter((u) => u && u !== viewer.username);
    if (notifyTargets.length) {
      await notifyUsers(notifyTargets, {
        title: 'Assignment accepted',
        body: `${viewer.username} confirmed availability for "${existing.title}"`,
        type: 'marketing_request_assignment_accepted',
        entityType: 'marketing_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
