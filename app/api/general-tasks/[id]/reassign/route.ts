import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { canManageGeneralTask, generalTaskStore } from '@/lib/generalTaskStore';
import { employeeBelongsToDepartment } from '@/lib/departmentEmployeeStore';
import { findUserById } from '@/lib/userStore';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

// Reassignment requires a new employee (who must still belong to the task's
// existing department — never trust the client) and a mandatory reason.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const newAssigneeId = typeof body?.newAssigneeId === 'string' ? body.newAssigneeId.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!newAssigneeId) return NextResponse.json({ error: 'A new employee is required' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'A reason is required to reassign this task' }, { status: 400 });

  try {
    const task = await generalTaskStore.findById(id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!(await canManageGeneralTask(viewer, task))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const belongs = await employeeBelongsToDepartment(newAssigneeId, task.department_id);
    if (!belongs) return NextResponse.json({ error: 'The new employee must be an active member of this task\'s department' }, { status: 400 });

    const previousAssigneeName = task.assignee_name;
    const updated = await generalTaskStore.update(id, { assignee_id: newAssigneeId, status: task.status === 'rework_required' || task.status === 'in_progress' ? 'pending' : task.status });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'general_task',
      entityId: id,
      action: `Reassigned from ${previousAssigneeName || 'unassigned'} to ${updated?.assignee_name || 'someone new'}: ${reason}`,
      previousStatus: previousAssigneeName,
      newStatus: updated?.assignee_name || '',
      remarks: reason,
      ip: getClientIp(request)
    });

    const newAssignee = await findUserById(newAssigneeId);
    if (newAssignee) {
      await notifyUsers([newAssignee.username], {
        title: 'Task Reassigned to You',
        body: `"${task.title}"\nReassigned by: ${viewer.name}\nReason: ${reason}`,
        type: 'general_task_reassigned',
        entityType: 'general_task',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
