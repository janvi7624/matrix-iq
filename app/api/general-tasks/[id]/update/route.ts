import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { generalTaskStore, isValidAssigneeTransition, recordTaskUpdate } from '@/lib/generalTaskStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

const VALID_ACTIONS = ['start', 'submit', 'reopen'] as const;
type AssigneeAction = (typeof VALID_ACTIONS)[number];

const ACTION_STATUS: Record<AssigneeAction, string> = { start: 'in_progress', submit: 'under_review', reopen: 'in_progress' };

// Assignee-only: start / submit-for-review (or straight-to-completed when
// the task doesn't require review) / reopen after rework. This is the ONLY
// route that can move a task through these transitions — never the generic
// PATCH — and it enforces isValidAssigneeTransition itself, not just the UI.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !VALID_ACTIONS.includes(body.action)) return NextResponse.json({ error: 'A valid action is required' }, { status: 400 });
  const action: AssigneeAction = body.action;

  try {
    const task = await generalTaskStore.findById(id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (task.assignee_id !== viewer.userId) return NextResponse.json({ error: 'Only the assignee can perform this action' }, { status: 403 });
    if (!isValidAssigneeTransition(task.status, action)) {
      return NextResponse.json({ error: `Cannot go from "${task.status}" to this action` }, { status: 400 });
    }

    const workSummary = typeof body.workSummary === 'string' ? body.workSummary.trim() : '';
    const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
    const attachments = Array.isArray(body.attachments) ? body.attachments.filter((a: unknown): a is string => typeof a === 'string') : [];
    if (action === 'submit' && !workSummary) {
      return NextResponse.json({ error: 'A work summary is required to submit this task' }, { status: 400 });
    }

    const nextStatus = action === 'submit' && !task.requires_review ? 'completed' : ACTION_STATUS[action];

    const updated = await recordTaskUpdate({ taskId: id, status: nextStatus as never, workSummary, remarks, attachments, updatedByUserId: viewer.userId });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'general_task',
      entityId: id,
      action: `Task ${action}${workSummary ? `: ${workSummary}` : ''}`,
      previousStatus: task.status,
      newStatus: nextStatus,
      remarks,
      ip: getClientIp(request)
    });

    if (nextStatus === 'under_review') {
      // reviewer_username is set at creation (defaults to the creator — see
      // generalTaskStore.create) so this is always resolvable without a
      // fallback lookup.
      const reviewerUsername = task.reviewer_username || task.created_by;
      if (reviewerUsername) {
        await notifyUsers([reviewerUsername], {
          title: 'Task Submitted for Review',
          body: `"${task.title}"\nSubmitted by: ${viewer.name}`,
          type: 'general_task_submitted',
          entityType: 'general_task',
          entityId: id
        });
      }
    } else if (nextStatus === 'completed' && task.created_by && task.created_by !== viewer.username) {
      await notifyUsers([task.created_by], {
        title: 'Task Completed',
        body: `"${task.title}" was completed by ${viewer.name}.`,
        type: 'general_task_completed',
        entityType: 'general_task',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
