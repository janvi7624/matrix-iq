import { NextRequest, NextResponse } from 'next/server';
import { canManageAllTmsTasks, getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsTaskStore } from '@/lib/tmsTaskStore';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { sendTaskLifecycleEmail } from '@/lib/email/notifications';
import { findUserById, findUserByUsername } from '@/lib/userStore';
import { TmsPriority, TmsTaskRecord, TmsTaskStatus } from '@/lib/types';
import { taskAssignedNotification } from '@/lib/tmsLabels';
import { logAudit, listAuditLog } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

const VALID_STATUS: TmsTaskStatus[] = ['to_do', 'in_progress', 'on_hold', 'completed', 'cancelled'];
const VALID_PRIORITY: TmsPriority[] = ['low', 'medium', 'high'];

// A task's own record has no owner/department scope check beyond the module
// gate — the own-tasks-only restriction is already applied inside
// tmsTaskStore.list(); a direct single-record fetch by id still respects it
// by re-deriving the same "own or can-manage-all" rule here.
async function canAccessTask(viewer: Awaited<ReturnType<typeof getTmsViewer>>, task: { assignee_id: string; created_by: string }): Promise<boolean> {
  if (!viewer) return false;
  if (await canManageAllTmsTasks(viewer)) return true;
  // created_by is a resolved username (see tmsTaskStore's toRecord); assignee_id
  // stays the raw FK, hence comparing against viewer.userId, not viewer.username.
  return task.created_by === viewer.username || task.assignee_id === viewer.userId;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-tasks', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const task = await tmsTaskStore.findById(id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!(await canAccessTask(viewer, { assignee_id: task.assignee_id, created_by: task.created_by }))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const activity = await listAuditLog('tms_task', id);
    return NextResponse.json({ task, activity });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-tasks', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await tmsTaskStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!(await canAccessTask(viewer, { assignee_id: existing.assignee_id, created_by: existing.created_by }))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (body.action === 'addAttachment') {
      const urls = Array.isArray(body.urls) ? body.urls.filter((u: unknown): u is string => typeof u === 'string') : [];
      if (!urls.length) return NextResponse.json({ error: 'No attachment URLs provided' }, { status: 400 });
      const updated = await tmsTaskStore.update(id, { attachments: [...existing.attachments, ...urls], updated_at: new Date().toISOString() });
      await logAudit({ by: viewer.username, role: viewer.role, entityType: 'tms_task', entityId: id, action: `${urls.length} attachment${urls.length === 1 ? '' : 's'} added`, previousStatus: '', newStatus: '', ip: getClientIp(request) });
      return NextResponse.json(updated);
    }

    const patch: Partial<TmsTaskRecord> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.description === 'string') patch.description = body.description.trim();
    if (VALID_PRIORITY.includes(body.priority)) patch.priority = body.priority;
    if (VALID_STATUS.includes(body.status)) patch.status = body.status;
    if (typeof body.startDate === 'string') patch.start_date = body.startDate;
    if (typeof body.dueDate === 'string') patch.due_date = body.dueDate;
    if (typeof body.remarks === 'string') patch.remarks = body.remarks.trim();
    if (typeof body.departmentId === 'string') patch.department_id = body.departmentId.trim();

    let newAssigneeId = '';
    if (typeof body.assigneeId === 'string' && body.assigneeId.trim() !== existing.assignee_id) {
      newAssigneeId = body.assigneeId.trim();
      patch.assignee_id = newAssigneeId;
    }

    const updated = await tmsTaskStore.update(id, patch);

    const newAssignee = newAssigneeId ? await findUserById(newAssigneeId) : null;
    if (newAssigneeId) {
      const assignee = newAssignee;
      if (assignee && assignee.username !== viewer.username) {
        const notification = taskAssignedNotification(
          patch.name || existing.name,
          existing.project_name,
          viewer.name,
          patch.priority || existing.priority,
          patch.due_date !== undefined ? patch.due_date : existing.due_date
        );
        await notifyUsers([assignee.username], {
          title: notification.title,
          body: notification.body,
          type: 'tms_task_assigned',
          entityType: 'tms_task',
          entityId: id
        });
        if (assignee.email) {
          void sendTaskLifecycleEmail({
            name: assignee.name,
            email: assignee.email,
            event: 'assigned',
            taskName: existing.name,
            projectName: existing.project_name
          });
        }
      }
    }

    // No notification exists for a plain status change today — email the
    // creator so they learn of progress/completion without having to check
    // the board, unless they're the one who just made the change themselves.
    if (patch.status && patch.status !== existing.status && existing.created_by && existing.created_by !== viewer.username) {
      const creator = await findUserByUsername(existing.created_by);
      if (creator?.email) {
        void sendTaskLifecycleEmail({
          name: creator.name,
          email: creator.email,
          event: 'status_changed',
          taskName: existing.name,
          projectName: existing.project_name,
          detail: `Status: ${patch.status.replace(/_/g, ' ')}`
        });
      }
    }

    // Every meaningful change gets one audit row (status, reassignment, or a
    // plain field edit if neither of those changed) — this is the task
    // detail page's entire "Activity" history, see TmsTaskDetailView.tsx.
    const changeParts: string[] = [];
    if (patch.status && patch.status !== existing.status) changeParts.push(`status → ${patch.status.replace(/_/g, ' ')}`);
    if (newAssigneeId) changeParts.push(`reassigned to ${newAssignee?.name || newAssignee?.username || 'someone new'}`);
    // A comment (see TmsTaskDetailView.tsx's "Add Comment") is just a
    // remarks-append PATCH with nothing else changed — labeled distinctly
    // so it reads as "Comment added" in Activity rather than a vague edit.
    const isCommentOnly = changeParts.length === 0 && typeof body.remarks === 'string' && body.remarks !== existing.remarks;
    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_task',
      entityId: id,
      action: changeParts.length ? `Task updated: ${changeParts.join(', ')}` : isCommentOnly ? 'Comment added' : 'Task details updated',
      previousStatus: existing.status,
      newStatus: patch.status || existing.status,
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const allowed = await requireTmsAction(viewer, 'tms-tasks', 'delete');
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  try {
    const ok = await tmsTaskStore.remove(id, allowed);
    if (!ok) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
