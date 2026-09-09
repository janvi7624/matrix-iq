import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canAccessProject, findProjectById, resolveProjectDeadlineTier } from '@/lib/projectStore';
import { requestExtension, InvalidDeadlineExtensionError } from '@/lib/projectDeadlineExtensionStore';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { findAdminUsers, findUserByUsername } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { DeadlineExtensionReason } from '@/lib/types';

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

const VALID_REASONS: DeadlineExtensionReason[] = ['user_end', 'client_end'];

// Anyone who can already open the project may REQUEST a deadline
// extension — a tiered approval chain decides whether it's applied
// immediately (Admin) or needs sign-off (Manager approves a plain user's
// request; Admin approves a Manager's). See lib/projectStore.ts's
// resolveProjectDeadlineTier.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const remark = typeof body.remark === 'string' ? body.remark.trim() : '';
  if (!remark) return NextResponse.json({ error: 'A remark is required to extend the deadline' }, { status: 400 });
  if (!isValidDateString(body.newDeadline)) return NextResponse.json({ error: 'A valid new deadline date is required' }, { status: 400 });
  if (!VALID_REASONS.includes(body.reason)) return NextResponse.json({ error: 'A valid reason (From User End / From Client End) is required' }, { status: 400 });

  try {
    const project = await findProjectById(id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!(await canAccessProject(viewer.username, project))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const actor = await findUserByUsername(viewer.username);
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const requesterTier = await resolveProjectDeadlineTier(viewer);
    const extension = await requestExtension({
      projectId: id,
      previousDeadline: project.expected_closing_date,
      newDeadline: body.newDeadline,
      reason: body.reason,
      remark,
      requestedByUserId: actor.id,
      requesterTier
    });

    const label = project.client_name || project.company || id;
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'project',
      entityId: id,
      action: extension.status === 'approved' ? 'Deadline extended' : `Deadline extension requested (${extension.status === 'pending_admin' ? 'awaiting Admin approval' : 'awaiting Manager approval'})`,
      previousStatus: project.expected_closing_date || 'Not set',
      newStatus: body.newDeadline,
      remarks: remark,
      ip: getClientIp(request)
    });

    if (extension.status === 'approved') {
      const notifyUsernames = new Set<string>();
      if (project.created_by) notifyUsernames.add(project.created_by);
      notifyUsernames.delete(viewer.username);
      await notifyUsers([...notifyUsernames], {
        title: 'Project Deadline Extended',
        body: `"${label}"\nNew deadline: ${body.newDeadline}\nReason: ${remark}`,
        type: 'project_deadline_extended',
        entityType: 'project',
        entityId: id
      });
    } else if (extension.status === 'pending_admin') {
      const admins = await findAdminUsers();
      const usernames = admins.map((a) => a.username).filter((u) => u !== viewer.username);
      await notifyUsers(usernames, {
        title: 'Deadline Extension Awaiting Your Approval',
        body: `"${label}"\nRequested by: ${viewer.name}\nNew deadline: ${body.newDeadline}\nReason: ${remark}`,
        type: 'project_deadline_extended',
        entityType: 'project',
        entityId: id
      });
    } else {
      // pending_manager — notify the requester's own department manager(s);
      // no manager configured for their department -> fall back to Admins,
      // same safety net lib/tmsAccess.ts's isAdministrationManager/
      // isAccountsManager already use, so a request can never get stuck.
      const departmentManagers = actor.department ? (await listDepartmentManagers())[actor.department] || [] : [];
      const approvers = departmentManagers.length ? departmentManagers : await findAdminUsers();
      const usernames = approvers.map((a) => a.username).filter((u) => u !== viewer.username);
      await notifyUsers(usernames, {
        title: 'Deadline Extension Awaiting Your Approval',
        body: `"${label}"\nRequested by: ${viewer.name}\nNew deadline: ${body.newDeadline}\nReason: ${remark}`,
        type: 'project_deadline_extended',
        entityType: 'project',
        entityId: id
      });
    }

    const updated = await findProjectById(id);
    return NextResponse.json({ project: updated, extension });
  } catch (error) {
    if (error instanceof InvalidDeadlineExtensionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
