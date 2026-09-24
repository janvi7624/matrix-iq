import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { leadStore, assignLeads, findLeadsByIds } from '@/lib/leadStore';
import { canAssignLeads } from '@/lib/permissions';
import { logAudit, logAuditMany } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';
import { reassignLinkedProject } from '@/lib/leadProjectAutomation';
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

    // One audit row per lead, written as a single batch — an expo assignment
    // is 600 rows, and one INSERT each would take longer than the request has.
    await logAuditMany(
      permitted.flatMap((id) => {
        const before = previousById.get(id);
        if (!before) return [];
        const label = before.name || before.company || id;
        return [{
          by: viewer.username,
          role: viewer.role,
          entityType: 'lead' as const,
          entityId: id,
          action: assigneeUsername
            ? `Lead ${before.assigned_to ? 'reassigned' : 'assigned'} to ${assigneeUsername}: ${label}`
            : `Lead unassigned: ${label}`,
          previousStatus: before.assigned_to || 'unassigned',
          newStatus: assigneeUsername || 'unassigned',
          remarks: before.assigned_to ? `Previously assigned to ${before.assigned_to}` : `Captured by ${before.created_by}`,
          ip: getClientIp(request)
        }];
      })
    );

    // Assigning a lead NO LONGER creates a project. It used to: one project
    // per assigned lead, which after an expo meant 600 projects nobody had
    // spoken to, swamping the pipeline and every conversion chart. A project
    // is now created only by a qualification call that goes well
    // (lib/leadCall.ts — outcome 'suitable').
    //
    // The one case that still touches a project is REASSIGNMENT of a lead
    // that already has one: its ownership has to follow the new assignee,
    // otherwise the work silently stays with the person who left it.
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
          }
        } catch (automationError) {
          // Best-effort — the lead assignment itself already succeeded and
          // must not be rolled back just because moving the linked project
          // hit an error.
          console.error(`[lead-project-automation] Failed for lead ${id}:`, automationError instanceof Error ? automationError.message : automationError);
        }
      }

      // One notification for the batch, not one per lead: assigning 600 expo
      // cards must not fire 600 notifications at the person who has to call
      // them. Their queue is the "To Call" list on Lead Capture.
      //
      // Counted from what assignLeads actually wrote, not from what was asked
      // for: a lead that failed mid-batch isn't in the rep's queue, so telling
      // them "600 leads were assigned to you" when 580 landed sends them
      // looking for twenty calls that aren't there. If none landed, there is
      // nothing to tell them at all.
      const failedIds = new Set(result.failed);
      const assignedIds = permitted.filter((id) => !failedIds.has(id));
      if (assignedIds.length) {
        const count = assignedIds.length;
        await notifyUsers([assigneeUsername], {
          title: count === 1 ? 'A lead was assigned to you' : `${count} leads were assigned to you`,
          body: `${viewer.name} assigned you ${count === 1 ? 'a lead' : `${count} leads`} to call. Record what comes of each call — only the suitable ones become projects.`,
          type: 'lead_assigned',
          entityType: 'lead_assignment',
          entityId: assignedIds[0]
        });
      }
    }

    // Return the updated rows so the client can patch its list in place
    // instead of refetching everything — in ONE query, not one per lead.
    const updated = await findLeadsByIds(permitted);

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
