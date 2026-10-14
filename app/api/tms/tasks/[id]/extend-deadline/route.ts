import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsModule, resolveTmsDeadlineTier, findTmsManagerTierUsers } from '@/lib/tmsAccess';
import { canAccessTask, tmsTaskStore } from '@/lib/tmsTaskStore';
import { requestTaskExtension, InvalidTaskDeadlineExtensionError } from '@/lib/tmsTaskDeadlineExtensionStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { findAdminUsers, findUserById, findUserByUsername } from '@/lib/userStore';
import { DeadlineExtensionReason } from '@/lib/types';

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

const VALID_REASONS: DeadlineExtensionReason[] = ['user_end', 'client_end'];

// Request a new due date for a TMS task.
//
// Open to anyone who can already see the task (canAccessTask — the assignee,
// its creator, or a manager/admin over its department), NOT only to whoever
// may edit it: the person who knows the client has slipped is usually the
// engineer holding the task, and making them chase a manager to even ask is
// what this replaces. What they cannot do is grant it themselves — the tier
// chain in lib/tmsTaskDeadlineExtensionStore.ts decides that, and the task's
// own due_date is untouched until something reaches 'approved'.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsModule(viewer, 'tms-tasks'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const remark = typeof body.remark === 'string' ? body.remark.trim() : '';
  if (!remark) return NextResponse.json({ error: 'A remark is required to extend the deadline' }, { status: 400 });
  if (!isValidDateString(body.newDeadline)) return NextResponse.json({ error: 'A valid new deadline date is required' }, { status: 400 });
  if (!VALID_REASONS.includes(body.reason)) return NextResponse.json({ error: 'A valid reason (From User End / From Client End) is required' }, { status: 400 });
  const attachments = Array.isArray(body.attachmentUrls) ? body.attachmentUrls.filter((u: unknown): u is string => typeof u === 'string') : [];

  try {
    const task = await tmsTaskStore.findById(id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!(await canAccessTask(viewer, task))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const actor = await findUserByUsername(viewer.username);
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const requesterTier = resolveTmsDeadlineTier(viewer);
    const extension = await requestTaskExtension({
      taskId: id,
      previousDeadline: task.due_date,
      newDeadline: body.newDeadline,
      reason: body.reason,
      remark,
      attachments,
      requestedByUserId: actor.id,
      requesterTier
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_task',
      entityId: id,
      action:
        extension.status === 'approved'
          ? 'Task deadline extended'
          : `Task deadline extension requested (${extension.status === 'pending_admin' ? 'awaiting Admin approval' : 'awaiting Manager approval'})`,
      previousStatus: task.due_date || 'Not set',
      newStatus: body.newDeadline,
      remarks: remark,
      ip: getClientIp(request)
    });

    if (extension.status === 'approved') {
      // Only the assignee is affected by a task-level date move — unlike a
      // project extension, which shifts everyone working on it.
      const notifyUserIds = new Set<string>();
      if (task.assignee_id) notifyUserIds.add(task.assignee_id);
      notifyUserIds.delete(actor.id);
      const rows = await Promise.all([...notifyUserIds].map((uid) => findUserById(uid)));
      const usernames = rows.filter((u): u is NonNullable<typeof u> => !!u).map((u) => u.username);
      if (usernames.length) {
        await notifyUsers(usernames, {
          title: 'Task Deadline Extended',
          body: `"${task.name}"\nNew deadline: ${body.newDeadline}\nReason: ${remark}`,
          type: 'tms_task_deadline_extended',
          entityType: 'tms_task',
          entityId: id
        });
      }
    } else {
      const approvers = extension.status === 'pending_admin' ? await findAdminUsers() : await findTmsManagerTierUsers();
      const usernames = approvers.map((a) => a.username).filter((u) => u !== viewer.username);
      await notifyUsers(usernames, {
        title: 'Task Deadline Extension Awaiting Your Approval',
        body: `"${task.name}"\nRequested by: ${viewer.name}\nNew deadline: ${body.newDeadline}\nReason: ${remark}`,
        type: 'tms_task_deadline_extended',
        entityType: 'tms_task',
        entityId: id
      });
    }

    const updated = await tmsTaskStore.findById(id);
    return NextResponse.json({ task: updated, extension });
  } catch (error) {
    if (error instanceof InvalidTaskDeadlineExtensionError) return NextResponse.json({ error: error.message }, { status: 400 });
    return apiErrorResponse(error);
  }
}
