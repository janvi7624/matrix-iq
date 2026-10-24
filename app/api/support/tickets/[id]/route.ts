import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canViewTicket, resolveSupportActor } from '@/lib/supportTicketAccess';
import {
  addComment,
  findTicketById,
  SupportTicketError,
  transitionTicket,
  triageTicket
} from '@/lib/supportTicketStore';
import { canAssign, canSetPriority, isSupportTicketStatus } from '@/lib/supportTicketWorkflow';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const found = await findTicketById(id);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const allowed = await canViewTicket(
      { ...viewer, partnerId: viewer.partnerId },
      { created_by_user_id: (found.raw.created_by_user_id as string) ?? '', assigned_to_id: (found.raw.assigned_to_id as string) ?? '' }
    );
    if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const actor = resolveSupportActor({ ...viewer, partnerId: viewer.partnerId });
    return NextResponse.json({ ...found, raw: undefined, actor });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const actor = resolveSupportActor({ ...viewer, partnerId: viewer.partnerId });
  if (actor !== 'manager' && actor !== 'engineer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const { id } = await params;

    // Triage — priority, department, assignment. Gated separately from the
    // status transition below: an engineer may work a ticket without being
    // able to reassign it or raise its priority.
    if (body.priority !== undefined || body.departmentId !== undefined || body.assigneeId !== undefined) {
      if (body.assigneeId !== undefined && !canAssign(actor)) {
        return NextResponse.json({ error: 'Only a technical manager may assign tickets' }, { status: 403 });
      }
      if (body.priority !== undefined && !canSetPriority(actor)) {
        return NextResponse.json({ error: 'Only a technical manager may change priority' }, { status: 403 });
      }
      const updated = await triageTicket(
        id,
        { priority: body.priority, departmentId: body.departmentId, assigneeId: body.assigneeId },
        viewer.userId
      );
      if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      if (body.assigneeId) {
        const assignee = await db.User.findByPk(body.assigneeId, { attributes: ['username'] });
        const username = assignee?.get('username') as string | undefined;
        if (username) {
          void notifyUsers([username], {
            title: 'Support ticket assigned to you',
            body: `${updated.ticket_number}: ${updated.title}`,
            type: 'support_ticket_assigned',
            entityType: 'support_ticket',
            entityId: id
          });
        }
      }
      return NextResponse.json(updated);
    }

    // Status transition.
    if (typeof body.status === 'string') {
      if (!isSupportTicketStatus(body.status)) return NextResponse.json({ error: 'Unknown status' }, { status: 400 });
      const updated = await transitionTicket({
        ticketId: id,
        to: body.status,
        actor,
        byUserId: viewer.userId,
        reason: typeof body.reason === 'string' ? body.reason : '',
        resolution: {
          summary: typeof body.resolutionSummary === 'string' ? body.resolutionSummary : undefined,
          rootCause: typeof body.rootCause === 'string' ? body.rootCause : undefined,
          correctiveAction: typeof body.correctiveAction === 'string' ? body.correctiveAction : undefined
        }
      });
      if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      // Tell the partner about the changes that matter to them.
      if (updated.partner_id && ['resolved', 'awaiting_partner', 'closed'].includes(body.status)) {
        const partnerUsers = await db.User.findAll({ where: { partnerId: updated.partner_id, status: 'active' } as never, attributes: ['username'] });
        const usernames = partnerUsers.map((u) => u.get('username') as string);
        if (usernames.length) {
          void notifyUsers(usernames, {
            title:
              body.status === 'resolved' ? 'Your support ticket is resolved'
                : body.status === 'awaiting_partner' ? 'We need more information'
                : 'Your support ticket is closed',
            body: `${updated.ticket_number}: ${updated.title}`,
            type: 'support_ticket_update',
            entityType: 'partner_support_ticket',
            entityId: id
          });
        }
      }

      void logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'support_ticket',
        entityId: id,
        action: `Support ticket ${updated.ticket_number} -> ${body.status}`,
        previousStatus: '',
        newStatus: body.status,
        remarks: typeof body.reason === 'string' ? body.reason : '',
        ip: getClientIp(request)
      });

      return NextResponse.json(updated);
    }

    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  } catch (error) {
    if (error instanceof SupportTicketError) return NextResponse.json({ error: error.message }, { status: 409 });
    return apiErrorResponse(error);
  }
}

// Adding a comment. isInternal comes from the engineer's explicit choice and
// defaults to TRUE — a note written without deciding stays internal.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const actor = resolveSupportActor({ ...viewer, partnerId: viewer.partnerId });
  if (actor !== 'manager' && actor !== 'engineer') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  try {
    const { id } = await params;
    const isInternal = body?.isInternal !== false;
    await addComment(id, viewer.userId, typeof body?.body === 'string' ? body.body : '', isInternal,
      Array.isArray(body?.attachments) ? body.attachments.filter((a: unknown): a is string => typeof a === 'string') : []);

    if (!isInternal) {
      const found = await findTicketById(id);
      if (found?.ticket.partner_id) {
        const partnerUsers = await db.User.findAll({ where: { partnerId: found.ticket.partner_id, status: 'active' } as never, attributes: ['username'] });
        const usernames = partnerUsers.map((u) => u.get('username') as string);
        if (usernames.length) {
          void notifyUsers(usernames, {
            title: 'New reply on your support ticket',
            body: `${found.ticket.ticket_number}: ${found.ticket.title}`,
            type: 'support_ticket_comment',
            entityType: 'partner_support_ticket',
            entityId: id
          });
        }
      }
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof SupportTicketError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
