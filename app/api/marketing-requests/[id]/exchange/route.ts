import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingTeamMember } from '@/lib/permissions';
import { listMarketingRoster } from '@/lib/marketingRoster';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { sendMarketingRequestLifecycleEmail } from '@/lib/email/notifications';
import { db } from '@/lib/db';
import { MarketingRequestRecord } from '@/lib/types';

// Self-service hand-off between Marketing teammates — deliberately NOT
// gated on isMarketingManager/'assign' like /assign: this is the current
// assignee moving their own work to a named colleague, not a manager
// reassigning. The only thing this can ever do is swap ownership to another
// verified Marketing roster member, so it can't be used to escalate access.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const isTeamMember = await isMarketingTeamMember({ username: viewer.username });
  if (!isTeamMember && !viewer.isPrivileged) {
    return NextResponse.json({ error: 'Only a Marketing team member can hand off a request' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const targetId = typeof body?.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId) return NextResponse.json({ error: 'targetId is required' }, { status: 400 });

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    const isCurrentAssignee =
      existing.assigned_to_id === viewer.userId ||
      (existing.assigned_to && existing.assigned_to.toLowerCase() === viewer.username.toLowerCase());
    if (!isCurrentAssignee && !viewer.isPrivileged) {
      return NextResponse.json({ error: 'Only the current assignee can hand this off' }, { status: 403 });
    }

    const roster = await listMarketingRoster();
    const target = roster.find((m) => m.id === targetId);
    if (!target) return NextResponse.json({ error: 'That person is not on the Marketing team' }, { status: 400 });

    const targetUser = await db.User.findByPk(targetId);
    const targetEmail = targetUser ? ((targetUser.get('email') as string) || '') : '';

    const patch: Partial<MarketingRequestRecord> = {
      updated_at: new Date().toISOString(),
      assigned_to_id: targetId,
      assigned_to: target.username,
      assigned_to_name: target.name || target.username,
      // The new owner picks up exactly where the previous one left off — a
      // hand-off between teammates is not a fresh assignment that needs
      // re-confirming, unlike a manager assigning someone new.
      assignment_status: existing.assignment_status || ''
    };

    const updated = await marketingRequestStore.update(id, patch);
    if (!updated) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'marketing_request',
      entityId: id,
      action: `Marketing request handed off to ${target.username}`,
      previousStatus: existing.status,
      newStatus: existing.status,
      remarks: `Previously: ${existing.assigned_to || 'unassigned'}`,
      ip: getClientIp(request)
    });

    if (target.username.toLowerCase() !== viewer.username.toLowerCase()) {
      await notifyUsers([target.username], {
        title: 'Marketing request handed off to you',
        body: `${viewer.username} handed off "${existing.title}" to you.`,
        type: 'marketing_request_assigned',
        entityType: 'marketing_request',
        entityId: id
      });
      if (targetEmail) {
        void sendMarketingRequestLifecycleEmail({
          name: target.name || target.username,
          email: targetEmail,
          event: 'assigned',
          title: existing.title,
          detail: `Handed off by ${viewer.username}`
        });
      }
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
