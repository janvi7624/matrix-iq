import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageGeneralTask, generalTaskStore, recordTaskUpdate } from '@/lib/generalTaskStore';
import { isHrManager } from '@/lib/hrAccess';
import { findUserById } from '@/lib/userStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

const VALID_ACTIONS = ['approve', 'rework', 'reject'] as const;
type ReviewAction = (typeof VALID_ACTIONS)[number];

const ACTION_STATUS: Record<ReviewAction, string> = { approve: 'approved', rework: 'rework_required', reject: 'rejected' };
const ACTION_LABEL: Record<ReviewAction, string> = { approve: 'Approved', rework: 'Rework Required', reject: 'Rejected' };

// Only meaningful from 'under_review'. Authorized reviewer = the task's own
// reviewer_id, an HR manager (for hr-sourced tasks), or anyone
// canManageGeneralTask already authorizes (creator/department-manager/
// privileged) — reused rather than a parallel check.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !VALID_ACTIONS.includes(body.action)) return NextResponse.json({ error: 'A valid review action is required' }, { status: 400 });
  const action: ReviewAction = body.action;
  const remark = typeof body.remark === 'string' ? body.remark.trim() : '';

  if (action !== 'approve' && !remark) {
    return NextResponse.json({ error: `A remark is required to mark this task "${ACTION_LABEL[action]}"` }, { status: 400 });
  }

  try {
    const task = await generalTaskStore.findById(id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (task.status !== 'under_review') return NextResponse.json({ error: 'This task is not awaiting review' }, { status: 400 });

    const isReviewer = task.reviewer_id === viewer.userId;
    const isHr = task.source_module === 'hr' && (await isHrManager(viewer));
    if (!isReviewer && !isHr && !(await canManageGeneralTask(viewer, task))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const nextStatus = ACTION_STATUS[action];
    const updated = await recordTaskUpdate({ taskId: id, status: nextStatus as never, remarks: remark, updatedByUserId: viewer.userId });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'general_task',
      entityId: id,
      action: `Review: ${ACTION_LABEL[action]}${remark ? ` — ${remark}` : ''}`,
      previousStatus: 'under_review',
      newStatus: nextStatus,
      remarks: remark,
      ip: getClientIp(request)
    });

    const assignee = await findUserById(task.assignee_id);
    if (assignee && assignee.username !== viewer.username) {
      await notifyUsers([assignee.username], {
        title: `Task ${ACTION_LABEL[action]}`,
        body: `"${task.title}"${remark ? `\nReviewer note: ${remark}` : ''}`,
        type: `general_task_${action}`,
        entityType: 'general_task',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
