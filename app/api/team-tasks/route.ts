import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireTeamTasksModule, isTeamTaskManager } from '@/lib/teamTasksAccess';
import { generalTaskStore } from '@/lib/generalTaskStore';
import { employeeBelongsToDepartment } from '@/lib/departmentEmployeeStore';
import { findDepartmentById, departmentsManagedBy } from '@/lib/departmentStore';
import { findUserById } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { GeneralTaskPriority } from '@/lib/types';

const VALID_PRIORITY: GeneralTaskPriority[] = ['low', 'medium', 'high', 'critical'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTeamTasksModule(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const tasks = await generalTaskStore.list(viewer, { sourceModule: 'team' });
    return NextResponse.json(tasks);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Generalizes app/api/hr/tasks/route.ts's "only an actual HR manager may
// create/assign" rule to every department: only a recognized manager of the
// TARGET department (or admin/superadmin) may create a Team Task — never
// trusts the frontend's own department picker, re-verifies managedDepartments
// server-side, same as that route re-verifies department/employee pairing.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTeamTasksModule(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await isTeamTaskManager(viewer))) {
    return NextResponse.json({ error: 'Only a department manager or admin can create Team Tasks' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
  const assigneeId = typeof body.assigneeId === 'string' ? body.assigneeId.trim() : '';
  const deadline = typeof body.deadline === 'string' ? body.deadline : '';
  if (!title) return NextResponse.json({ error: 'Task title is required' }, { status: 400 });
  if (!deadline) return NextResponse.json({ error: 'Deadline is required' }, { status: 400 });
  if (!departmentId || !assigneeId) return NextResponse.json({ error: 'Department and employee are required' }, { status: 400 });

  const department = await findDepartmentById(departmentId);
  if (!department) return NextResponse.json({ error: 'Selected department not found' }, { status: 400 });

  if (!viewer.isPrivileged) {
    const managed = await departmentsManagedBy(viewer.username);
    if (!managed.some((d) => d.id === departmentId)) {
      return NextResponse.json({ error: 'You can only assign Team Tasks within a department you manage' }, { status: 403 });
    }
  }

  const belongs = await employeeBelongsToDepartment(assigneeId, departmentId);
  if (!belongs) return NextResponse.json({ error: 'The selected employee is not an active member of the selected department' }, { status: 400 });

  try {
    const created = await generalTaskStore.create({
      sourceModule: 'team',
      title,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      departmentId,
      assigneeId,
      reviewerId: typeof body.reviewerId === 'string' && body.reviewerId.trim() ? body.reviewerId.trim() : undefined,
      priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
      requiresReview: body.requiresReview !== false,
      category: typeof body.category === 'string' ? body.category.trim() : '',
      startDate: typeof body.startDate === 'string' ? body.startDate : '',
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
      action: `Team task assigned to ${created.assignee_name} (${department.name})`,
      previousStatus: '',
      newStatus: created.status,
      remarks: title,
      ip: getClientIp(request)
    });

    const assignee = await findUserById(assigneeId);
    if (assignee && assignee.username !== viewer.username) {
      await notifyUsers([assignee.username], {
        title: 'New Task Assigned',
        body: `"${title}"\nDepartment: ${department.name}\nAssigned By: ${viewer.name}\nPriority: ${created.priority}\nDeadline: ${deadline}`,
        type: 'general_task_assigned',
        entityType: 'general_task',
        entityId: created.id
      });
    }

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
