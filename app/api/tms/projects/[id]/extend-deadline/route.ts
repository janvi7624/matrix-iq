import { NextRequest, NextResponse } from 'next/server';
import { canExtendTmsDeadline, getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { canAccessTmsProjectRow, tmsProjectStore } from '@/lib/tmsProjectStore';
import { createExtension, InvalidDeadlineExtensionError } from '@/lib/tmsDeadlineExtensionStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { tmsTaskStore } from '@/lib/tmsTaskStore';
import { findUserById, findUserByUsername } from '@/lib/userStore';

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-projects', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!canExtendTmsDeadline(viewer)) return NextResponse.json({ error: 'Only a Manager or Admin can extend a project deadline' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const remark = typeof body.remark === 'string' ? body.remark.trim() : '';
  if (!remark) return NextResponse.json({ error: 'A remark is required to extend the deadline' }, { status: 400 });
  if (!isValidDateString(body.newDeadline)) return NextResponse.json({ error: 'A valid new deadline date is required' }, { status: 400 });
  const attachments = Array.isArray(body.attachmentUrls) ? body.attachmentUrls.filter((u: unknown): u is string => typeof u === 'string') : [];

  try {
    const project = await tmsProjectStore.findById(id);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    if (!canAccessTmsProjectRow(viewer, project)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const actor = await findUserByUsername(viewer.username);
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const extension = await createExtension({
      tmsProjectId: id,
      previousDeadline: project.deadline,
      newDeadline: body.newDeadline,
      remark,
      attachments,
      extendedByUserId: actor.id
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_project',
      entityId: id,
      action: 'Deadline extended',
      previousStatus: project.deadline || 'Not set',
      newStatus: body.newDeadline,
      remarks: remark,
      ip: getClientIp(request)
    });

    // Notify the project team + assignees of its still-open tasks — every
    // one of them is "affected" by a project-level deadline shift, not just
    // whoever happens to have a task due near the old date.
    const openTasks = (await tmsTaskStore.readAll()).filter((t) => t.project_id === id && t.status !== 'completed' && t.status !== 'cancelled');
    const notifyUserIds = new Set<string>([...(project.team_member_ids || [])]);
    if (project.project_manager_id) notifyUserIds.add(project.project_manager_id);
    for (const t of openTasks) if (t.assignee_id) notifyUserIds.add(t.assignee_id);
    notifyUserIds.delete(actor.id);

    const notifyUsersRows = await Promise.all([...notifyUserIds].map((uid) => findUserById(uid)));
    const usernames = notifyUsersRows.filter((u): u is NonNullable<typeof u> => !!u).map((u) => u.username);
    await notifyUsers(usernames, {
      title: 'Project Deadline Extended',
      body: `"${project.name}"\nNew deadline: ${body.newDeadline}\nReason: ${remark}`,
      type: 'tms_project_deadline_extended',
      entityType: 'tms_project',
      entityId: id
    });

    const updated = await tmsProjectStore.findById(id);
    return NextResponse.json({ project: updated, extension });
  } catch (error) {
    if (error instanceof InvalidDeadlineExtensionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
