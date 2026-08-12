import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isModuleActionAllowed } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { MarketingRequestComment } from '@/lib/types';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ error: 'Comment text is required' }, { status: 400 });

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    const canSeeAll = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'marketing-requests', 'approve'));
    if (existing.created_by !== viewer.username && !canSeeAll) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const comment: MarketingRequestComment = { id: `${Date.now()}`, at: new Date().toISOString(), by: viewer.username, text };
    const updated = await marketingRequestStore.update(id, { comments: [...existing.comments, comment], updated_at: new Date().toISOString() });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: 'Comment added',
      previousStatus: existing.status,
      newStatus: existing.status,
      remarks: text,
      ip: getClientIp(request)
    });

    // Notify "the other party" — the requester if staff commented, or the
    // assignee/owner if the requester commented.
    const isRequester = viewer.username === existing.created_by;
    const targets = (isRequester ? [existing.assigned_to] : [existing.created_by]).filter((u) => u && u !== viewer.username);
    if (targets.length) {
      await notifyUsers(targets, {
        title: 'New comment on marketing request',
        body: `${viewer.username} commented on "${existing.title}": ${text}`,
        type: 'marketing_request_comment',
        entityType: 'marketing_request',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
