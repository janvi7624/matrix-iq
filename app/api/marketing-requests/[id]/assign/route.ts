import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { marketingRequestStore } from '@/lib/marketingRequestStore';
import { isMarketingManager, isModuleActionAllowed } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { sendMarketingRequestLifecycleEmail } from '@/lib/email/notifications';
import { db } from '@/lib/db';
import { MarketingRequestRecord } from '@/lib/types';

// Manager assigns Marketing Member and/or Technical Member for verification
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const allowed = viewer.isPrivileged || (await isModuleActionAllowed(viewer, 'marketing-requests', 'assign'));
  if (!allowed) return NextResponse.json({ error: 'Forbidden — only a marketing reviewer/manager can assign members' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const records = await marketingRequestStore.list(viewer.username, true);
    const existing = records.find((r) => r.id === id);
    if (!existing) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    const patch: Partial<MarketingRequestRecord> = {
      updated_at: new Date().toISOString()
    };

    let assigneeUsername = '';
    let assigneeEmail = '';
    if (body.assigneeId !== undefined) {
      const assigneeId = typeof body.assigneeId === 'string' ? body.assigneeId.trim() : '';
      if (assigneeId) {
        const assignee = await db.User.findByPk(assigneeId);
        if (!assignee) return NextResponse.json({ error: 'Marketing assignee not found' }, { status: 400 });
        assigneeUsername = assignee.get('username') as string;
        assigneeEmail = (assignee.get('email') as string) || '';
        patch.assigned_to_id = assigneeId;
        patch.assigned_to = assigneeUsername;
        patch.assigned_to_name = (assignee.get('name') as string) || assigneeUsername;
        if (existing.status === 'submitted') {
          patch.status = 'marketing_in_progress';
        }
        // A newly-assigned (or reassigned-to-someone-else) member must
        // accept before they can act on the request — see route.ts's
        // status/send-to-technical/final-submission gates. Assigning the
        // SAME person again is a no-op on this, so an already-accepted
        // assignment doesn't get reset by an unrelated field edit.
        if (assigneeId !== existing.assigned_to_id) {
          patch.assignment_status = 'pending';
          patch.assignment_decline_reason = '';
        }
      } else {
        patch.assigned_to_id = '';
        patch.assigned_to = '';
        patch.assigned_to_name = '';
        patch.assignment_status = '';
      }
    }

    let technicalUsername = '';
    if (body.technicalMemberId !== undefined) {
      const technicalMemberId = typeof body.technicalMemberId === 'string' ? body.technicalMemberId.trim() : '';
      if (technicalMemberId) {
        const techUser = await db.User.findByPk(technicalMemberId);
        if (!techUser) return NextResponse.json({ error: 'Technical member not found' }, { status: 400 });
        technicalUsername = techUser.get('username') as string;
        patch.technical_member_id = technicalMemberId;
        patch.technical_member_username = technicalUsername;
        patch.technical_member_name = (techUser.get('name') as string) || technicalUsername;
      } else {
        patch.technical_member_id = '';
        patch.technical_member_username = '';
        patch.technical_member_name = '';
      }
    }

    const updated = await marketingRequestStore.update(id, patch);
    if (!updated) return NextResponse.json({ error: 'Marketing request not found' }, { status: 404 });

    // Audit logs
    if (body.assigneeId !== undefined) {
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
        newStatus: patch.status || existing.status,
        remarks: existing.assigned_to ? `Previously: ${existing.assigned_to}` : '',
        ip: getClientIp(request)
      });

      if (assigneeUsername && assigneeUsername !== viewer.username) {
        await notifyUsers([assigneeUsername], {
          title: 'Marketing request assigned to you',
          body: `"${existing.title}" was assigned to you by ${viewer.username}. Please confirm your availability.`,
          type: 'marketing_request_assigned',
          entityType: 'marketing_request',
          entityId: id
        });
        if (assigneeEmail) {
          void sendMarketingRequestLifecycleEmail({
            name: patch.assigned_to_name || assigneeUsername,
            email: assigneeEmail,
            event: 'assigned',
            title: existing.title,
            detail: `Assigned by ${viewer.username}`
          });
        }
      }
    }

    if (body.technicalMemberId !== undefined && technicalUsername) {
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'marketing_request',
        entityId: id,
        action: `Technical verifier set to ${technicalUsername}`,
        previousStatus: existing.status,
        newStatus: patch.status || existing.status,
        remarks: `Assigned technical reviewer: ${technicalUsername}`,
        ip: getClientIp(request)
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
