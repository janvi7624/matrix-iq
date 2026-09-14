import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findProjectById, projectStore } from '@/lib/projectStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

// Lead -> Project automation, Part 2's confirmation step. Only the project's
// own assignee (created_by — set to the assignee, not the manager, by
// lib/leadProjectAutomation.ts) may confirm; a normal manually-created
// project (lead_confirmation_status === '') has nothing to confirm.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const existing = await findProjectById(id);
    if (!existing) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    if (existing.lead_confirmation_status !== 'pending_confirmation') {
      return NextResponse.json({ error: 'This project is not awaiting confirmation' }, { status: 400 });
    }
    if (existing.created_by !== viewer.username && !viewer.isPrivileged) {
      return NextResponse.json({ error: 'Only the assigned owner can confirm this project' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const clarification = typeof body?.clarification === 'string' ? body.clarification.trim() : '';

    if (clarification) {
      // "Request Clarification" (Part 18's lighter-weight alternative to a
      // full reject/rollback — nothing in the Project model has a rejection
      // state to hook a real rollback into) — leaves lead_confirmation_status
      // as-is (still pending) and just gets a remark to the assigner.
      await notifyUsers([existing.sales_person].filter(Boolean), {
        title: 'Clarification requested on an assigned project',
        body: `${viewer.name || viewer.username} needs more information on ${existing.client_name || existing.company}: ${clarification}`,
        type: 'project_assignment_clarification', entityType: 'project', entityId: id
      });
      await logAudit({
        by: viewer.username, role: viewer.role, entityType: 'project', entityId: id,
        action: 'Requested clarification on lead assignment', previousStatus: 'pending_confirmation', newStatus: 'pending_confirmation',
        remarks: clarification, ip: getClientIp(request)
      });
      return NextResponse.json({ ok: true, clarificationRequested: true });
    }

    const updated = await projectStore.update(id, {
      lead_confirmation_status: 'confirmed',
      // confirmed_by is a real UUID column (unlike created_by, it has no
      // special username-resolution handling in projectStore.update — see
      // FIELDS there) — viewer.userId, not viewer.username.
      confirmed_by: viewer.userId,
      confirmed_at: new Date().toISOString()
    });

    await logAudit({
      by: viewer.username, role: viewer.role, entityType: 'project', entityId: id,
      action: 'Confirmed lead assignment', previousStatus: 'pending_confirmation', newStatus: 'confirmed',
      ip: getClientIp(request)
    });

    // Notify the manager who made the assignment (Part 16/27) — the Project
    // itself doesn't track "who assigned it," only the originating Lead
    // does (assigned_by), so it's looked up via the same reverse
    // Lead.project_id link ProjectDetailView's "Created From Lead" line uses.
    const originatingLead = await db.Lead.findOne({ where: { project_id: id } as never, include: [{ model: db.User, as: 'assigner', attributes: ['username'] }] });
    const assignerUsername = originatingLead ? ((originatingLead.get({ plain: true }) as { assigner?: { username?: string } }).assigner?.username) : undefined;
    if (assignerUsername) {
      await notifyUsers([assignerUsername], {
        title: 'Assignment confirmed',
        body: `${viewer.name || viewer.username} confirmed the ${existing.client_name || existing.company} assignment.`,
        type: 'project_assignment_confirmed', entityType: 'project', entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
