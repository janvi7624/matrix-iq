import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore, assignLeads, findLeadById } from '@/lib/leadStore';
import { canAssignLeads } from '@/lib/permissions';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';
import { createProjectFromLead, reassignLinkedProject } from '@/lib/leadProjectAutomation';
import { notifyUsers } from '@/lib/notificationStore';

// A sales manager routes captured leads to the reps who will work them.
//
// One endpoint handles both the per-row action and the bulk "assign N
// selected" — the client always sends an array, so a single lead is just an
// array of one. That keeps the authorisation and audit path identical for both
// rather than having a second endpoint that could drift.
//
// Passing assigneeId: '' unassigns, returning the leads to the manager's queue.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canAssignLeads(viewer))) {
    return NextResponse.json({ error: 'Forbidden — only a sales manager can assign leads' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const leadIds: string[] = Array.isArray(body.leadIds) ? body.leadIds.filter((v: unknown): v is string => typeof v === 'string' && !!v) : [];
  if (!leadIds.length) return NextResponse.json({ error: 'No leads selected' }, { status: 400 });

  const assigneeId = typeof body.assigneeId === 'string' ? body.assigneeId.trim() : '';

  try {
    let assigneeUsername = '';
    let assigneeName = '';
    if (assigneeId) {
      const assignee = await db.User.findByPk(assigneeId);
      if (!assignee) return NextResponse.json({ error: 'Assignee not found' }, { status: 400 });
      if ((assignee.get('status') as string) !== 'active') {
        return NextResponse.json({ error: 'Cannot assign leads to a deactivated account' }, { status: 400 });
      }
      assigneeUsername = assignee.get('username') as string;
      assigneeName = (assignee.get('name') as string) || assigneeUsername;
    }

    // Only leads this manager can already see may be reassigned — being a
    // sales manager grants the right to route leads, not to reach leads
    // outside their own visibility scope by guessing ids.
    const visible = await leadStore.list(viewer.username, viewer.isPrivileged);
    const visibleIds = new Set(visible.map((l) => l.id));
    const permitted = leadIds.filter((id) => visibleIds.has(id));
    const rejected = leadIds.filter((id) => !visibleIds.has(id));
    if (!permitted.length) {
      return NextResponse.json({ error: 'None of the selected leads are available to you' }, { status: 403 });
    }

    // Captured before the write so the audit trail can name the previous
    // owner — that information is gone once the update lands.
    const previousById = new Map(visible.filter((l) => permitted.includes(l.id)).map((l) => [l.id, l]));

    const result = await assignLeads(permitted, assigneeId, viewer.username);

    for (const id of permitted) {
      const before = previousById.get(id);
      if (!before) continue;
      const label = before.name || before.company || id;
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'lead',
        entityId: id,
        action: assigneeUsername
          ? `Lead ${before.assigned_to ? 'reassigned' : 'assigned'} to ${assigneeUsername}: ${label}`
          : `Lead unassigned: ${label}`,
        previousStatus: before.assigned_to || 'unassigned',
        newStatus: assigneeUsername || 'unassigned',
        remarks: before.assigned_to ? `Previously assigned to ${before.assigned_to}` : `Captured by ${before.created_by}`,
        ip: getClientIp(request)
      });
    }

    // Lead -> Project automation (Part 2 of the plan): assigning a lead is
    // the trigger, not a separate manual step. Unassigning (assigneeId: '')
    // never creates/touches a project — there's no one to auto-create it
    // for. A lead with no project yet gets one created and attributed to
    // the ASSIGNEE (not the manager doing the assigning); a lead that
    // already has a linked project (this is a reassignment) has that
    // existing project's ownership moved instead of a second one being
    // created — see lib/leadProjectAutomation.ts for why both paths share
    // one function and how the duplicate-project guard works.
    if (assigneeUsername) {
      for (const id of permitted) {
        const before = previousById.get(id);
        if (!before) continue;
        try {
          if (before.project_id) {
            const project = await reassignLinkedProject(before.project_id, assigneeUsername);
            if (project) {
              await logAudit({
                by: viewer.username, role: viewer.role, entityType: 'project', entityId: project.id,
                action: `Project reassigned (via lead reassignment) to ${assigneeUsername}`,
                previousStatus: before.assigned_to || 'unassigned', newStatus: assigneeUsername,
                ip: getClientIp(request)
              });
              await notifyUsers([assigneeUsername], {
                title: 'Project reassigned to you',
                body: `${project.client_name || project.company} — please review and confirm.`,
                type: 'project_assigned_from_lead', entityType: 'project', entityId: project.id
              });
            }
          } else {
            const freshLead = await findLeadById(id);
            if (!freshLead) continue;
            const result = await createProjectFromLead(freshLead, { attributeToUsername: assigneeUsername, autoCreated: true });
            if (result) {
              await logAudit({
                by: viewer.username, role: viewer.role, entityType: 'project', entityId: result.project.id,
                action: `Project auto-created from lead assignment, assigned to ${assigneeUsername}`,
                previousStatus: '', newStatus: 'pending_confirmation',
                ip: getClientIp(request)
              });
              await notifyUsers([assigneeUsername], {
                title: 'New lead assigned — project created for you',
                body: `${result.project.client_name || result.project.company} — please review and confirm the assignment.`,
                type: 'project_assigned_from_lead', entityType: 'project', entityId: result.project.id
              });
            }
          }
        } catch (automationError) {
          // Best-effort — the lead assignment itself already succeeded and
          // must not be rolled back just because the follow-on project
          // automation hit an error; it's logged server-side by
          // apiErrorResponse's console.error pattern elsewhere, but since
          // this isn't the top-level catch, log directly here instead.
          console.error(`[lead-project-automation] Failed for lead ${id}:`, automationError instanceof Error ? automationError.message : automationError);
        }
      }
    }

    // Return the updated rows so the client can patch its list in place
    // instead of refetching everything.
    const updated = (await Promise.all(permitted.map((id) => findLeadById(id)))).filter(Boolean);

    return NextResponse.json({
      assigned: result.assigned,
      failed: [...result.failed, ...rejected],
      assigneeUsername,
      assigneeName,
      leads: updated
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
