import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageGeneralTask, generalTaskStore } from '@/lib/generalTaskStore';
import { changeDeadline, InvalidDeadlineChangeError } from '@/lib/generalTaskDeadlineStore';
import { findUserById, findUserByUsername } from '@/lib/userStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const remark = typeof body?.remark === 'string' ? body.remark.trim() : '';
  if (!remark) return NextResponse.json({ error: 'A remark is required to change the deadline' }, { status: 400 });
  if (!isValidDateString(body?.newDeadline)) return NextResponse.json({ error: 'A valid new deadline date is required' }, { status: 400 });

  try {
    const task = await generalTaskStore.findById(id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!(await canManageGeneralTask(viewer, task))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const actor = await findUserByUsername(viewer.username);
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const change = await changeDeadline({
      taskId: id,
      previousDeadline: task.deadline,
      newDeadline: body.newDeadline,
      remark,
      changedByUserId: actor.id
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'general_task',
      entityId: id,
      action: 'Deadline changed',
      previousStatus: task.deadline || 'Not set',
      newStatus: body.newDeadline,
      remarks: remark,
      ip: getClientIp(request)
    });

    const notifyUsernames = new Set<string>();
    const assignee = await findUserById(task.assignee_id);
    if (assignee) notifyUsernames.add(assignee.username);
    if (task.reviewer_username) notifyUsernames.add(task.reviewer_username);
    notifyUsernames.delete(viewer.username);
    await notifyUsers([...notifyUsernames], {
      title: 'Task Deadline Changed',
      body: `"${task.title}"\nNew deadline: ${body.newDeadline}\nReason: ${remark}`,
      type: 'general_task_deadline_changed',
      entityType: 'general_task',
      entityId: id
    });

    const updated = await generalTaskStore.findById(id);
    return NextResponse.json({ task: updated, change });
  } catch (error) {
    if (error instanceof InvalidDeadlineChangeError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
