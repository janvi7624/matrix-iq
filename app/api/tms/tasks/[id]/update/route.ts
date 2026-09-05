import { NextRequest, NextResponse } from 'next/server';
import { canManageAllTmsTasks, getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { canAccessTask, EngineerTaskAction, isValidEngineerTransition, listTaskUpdates, recordTaskUpdate, statusForEngineerAction, tmsTaskStore } from '@/lib/tmsTaskStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { notifyUsers } from '@/lib/notificationStore';
import { getClientIp } from '@/lib/requestIp';
import { listDepartmentManagers } from '@/lib/departmentStore';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { findUserById } from '@/lib/userStore';

const VALID_ACTIONS: EngineerTaskAction[] = ['start', 'progress', 'blocked', 'ready_for_review', 'reopen'];

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
    return NextResponse.json({ updates: await listTaskUpdates(id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-tasks', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !VALID_ACTIONS.includes(body.action)) return NextResponse.json({ error: 'A valid action is required' }, { status: 400 });

  try {
    const task = await tmsTaskStore.findById(id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!(await canAccessTask(viewer, { assignee_id: task.assignee_id, created_by: task.created_by }))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const action: EngineerTaskAction = body.action;
    const isManagerTier = await canManageAllTmsTasks(viewer);
    if (!isManagerTier && !isValidEngineerTransition(task.status, action)) {
      return NextResponse.json({ error: `Cannot go from "${task.status}" to this action` }, { status: 400 });
    }
    if (action === 'blocked' && !(typeof body.remark === 'string' && body.remark.trim())) {
      return NextResponse.json({ error: 'A remark is required to mark a task blocked' }, { status: 400 });
    }

    const newStatus = statusForEngineerAction(action);
    const remark = typeof body.remark === 'string' ? body.remark.trim() : '';
    const progressPercent = typeof body.progressPercent === 'number' ? body.progressPercent : undefined;
    const actor = viewer.userId;

    const updated = await recordTaskUpdate({ taskId: id, status: newStatus, progressPercent, remark, updatedByUserId: actor });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_task',
      entityId: id,
      action: `Task update: ${action.replace(/_/g, ' ')}${remark ? ` — ${remark}` : ''}`,
      previousStatus: task.status,
      newStatus,
      ip: getClientIp(request)
    });

    if (action === 'blocked' || action === 'ready_for_review') {
      const project = await tmsProjectStore.findById(task.project_id);
      const managerUsernames = new Set<string>();
      if (project?.project_manager_id) {
        const manager = await findUserById(project.project_manager_id);
        if (manager) managerUsernames.add(manager.username);
      }
      if (task.department_name) {
        const byDept = (await listDepartmentManagers())[task.department_name] || [];
        byDept.forEach((m) => managerUsernames.add(m.username));
      }
      managerUsernames.delete(viewer.username);
      await notifyUsers([...managerUsernames], {
        title: action === 'blocked' ? 'Task Blocked' : 'Task Ready for Review',
        body: `"${task.name}"\nProject: ${task.project_name}\n${remark ? `Note: ${remark}` : ''}`,
        type: `tms_task_${action}`,
        entityType: 'tms_task',
        entityId: id
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
