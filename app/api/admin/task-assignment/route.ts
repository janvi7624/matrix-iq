import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isModuleActionAllowed } from '@/lib/permissions';
import { generalTaskStore } from '@/lib/generalTaskStore';
import { employeeBelongsToDepartment } from '@/lib/departmentEmployeeStore';
import { findDepartmentById, listDepartmentManagers } from '@/lib/departmentStore';
import { findUserById } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { GeneralTaskPriority } from '@/lib/types';

const VALID_PRIORITY: GeneralTaskPriority[] = ['low', 'medium', 'high', 'critical'];

async function canAssign(viewer: { role: string; isPrivileged: boolean }): Promise<boolean> {
  return isModuleActionAllowed(viewer, 'admin-task-assignment', 'assign');
}

// GET — every admin-sourced task the viewer is authorized to see (their own
// scope — org-wide for privileged/viewAllDepartments viewers).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const tasks = await generalTaskStore.list(viewer, { sourceModule: 'admin' });
    return NextResponse.json(tasks);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// POST — the actual "Department -> Employee" assignment. Never trusts the
// frontend's own cascading-dropdown pairing: re-verifies the department
// exists and the employee is active and actually belongs to it.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canAssign(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
  const assigneeId = typeof body.assigneeId === 'string' ? body.assigneeId.trim() : '';
  const deadline = typeof body.deadline === 'string' ? body.deadline : '';
  if (!title) return NextResponse.json({ error: 'Task name is required' }, { status: 400 });
  if (!deadline) return NextResponse.json({ error: 'Deadline is required' }, { status: 400 });
  if (!departmentId || !assigneeId) return NextResponse.json({ error: 'Department and employee are required' }, { status: 400 });

  const department = await findDepartmentById(departmentId);
  if (!department) return NextResponse.json({ error: 'Selected department not found' }, { status: 400 });

  const belongs = await employeeBelongsToDepartment(assigneeId, departmentId);
  if (!belongs) return NextResponse.json({ error: 'The selected employee is not an active member of the selected department' }, { status: 400 });

  try {
    const created = await generalTaskStore.create({
      sourceModule: 'admin',
      title,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      departmentId,
      assigneeId,
      priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
      requiresReview: body.requiresReview !== false,
      category: typeof body.category === 'string' ? body.category.trim() : '',
      projectId: typeof body.projectId === 'string' ? body.projectId.trim() : '',
      deadline,
      remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
      attachments: Array.isArray(body.attachments) ? body.attachments.filter((a: unknown): a is string => typeof a === 'string') : [],
      createdByUsername: viewer.username
    });

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'general_task',
      entityId: created.id,
      action: `Task assigned to ${created.assignee_name} (${department.name})`,
      previousStatus: '',
      newStatus: created.status,
      remarks: title,
      ip: getClientIp(request)
    });

    const assignee = await findUserById(assigneeId);
    const managers = (await listDepartmentManagers())[department.name] || [];
    const notifyUsernames = new Set<string>();
    if (assignee) notifyUsernames.add(assignee.username);
    managers.forEach((m) => notifyUsernames.add(m.username));
    notifyUsernames.delete(viewer.username);

    await notifyUsers([...notifyUsernames], {
      title: 'New Task Assigned',
      body: `"${title}"\nDepartment: ${department.name}\nAssigned By: ${viewer.name}\nPriority: ${created.priority}\nDeadline: ${deadline}`,
      type: 'general_task_assigned',
      entityType: 'general_task',
      entityId: created.id
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
