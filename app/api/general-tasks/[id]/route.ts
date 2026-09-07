import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canAccessGeneralTaskRow, canManageGeneralTask, generalTaskStore, listTaskUpdates, isValidAssigneeTransition } from '@/lib/generalTaskStore';
import { isHrManager } from '@/lib/hrAccess';
import { listForTask as listDeadlineChanges } from '@/lib/generalTaskDeadlineStore';
import { listAuditLog, logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { GeneralTaskPriority } from '@/lib/types';

const VALID_PRIORITY: GeneralTaskPriority[] = ['low', 'medium', 'high', 'critical'];

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const task = await generalTaskStore.findById(id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!(await canAccessGeneralTaskRow(viewer, task))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const [updates, deadlineChanges, activity, canManage] = await Promise.all([
      listTaskUpdates(id),
      listDeadlineChanges(id),
      listAuditLog('general_task', id),
      canManageGeneralTask(viewer, task)
    ]);

    const isAssignee = task.assignee_id === viewer.userId;
    const isReviewer = task.reviewer_id === viewer.userId || (task.source_module === 'hr' && (await isHrManager(viewer)));
    const permissions = {
      isAssignee,
      canAct: isAssignee && isValidAssigneeTransition(task.status, 'start'),
      canSubmit: isAssignee && isValidAssigneeTransition(task.status, 'submit'),
      canReopen: isAssignee && isValidAssigneeTransition(task.status, 'reopen'),
      canReview: (isReviewer || canManage) && task.status === 'under_review',
      canManage
    };

    return NextResponse.json({ task, updates, deadlineChanges, activity, permissions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Free-form field edits (title/description/priority/category/remarks) plus
// the ONE administrative status escape hatch — 'cancelled' — restricted to
// whoever can manage this task (creator/reviewer/department-manager/
// privileged), never the plain assignee. Every OTHER status value must go
// through /update (assignee) or /review (reviewer), which enforce the real
// transition rules — this route can never be used to skip them (the exact
// bug class found in the TMS work, closed off here from the start).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await generalTaskStore.findById(id);
    if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!(await canManageGeneralTask(viewer, existing))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const patch: Record<string, unknown> = {};
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
    if (typeof body.description === 'string') patch.description = body.description.trim();
    if (VALID_PRIORITY.includes(body.priority)) patch.priority = body.priority;
    if (typeof body.category === 'string') patch.category = body.category.trim();
    if (typeof body.remarks === 'string') patch.remarks = body.remarks.trim();
    if (body.status === 'cancelled' && existing.status !== 'cancelled') patch.status = 'cancelled';

    const updated = await generalTaskStore.update(id, patch);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'general_task',
      entityId: id,
      action: patch.status === 'cancelled' ? 'Task cancelled' : 'Task details updated',
      previousStatus: existing.status,
      newStatus: (patch.status as string) || existing.status,
      ip: getClientIp(request)
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
