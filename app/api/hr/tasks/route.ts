import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule, isHrManager } from '@/lib/hrAccess';
import { generalTaskStore } from '@/lib/generalTaskStore';
import { employeeBelongsToDepartment } from '@/lib/departmentEmployeeStore';
import { findDepartmentById } from '@/lib/departmentStore';
import { findUserById } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { GeneralTaskPriority } from '@/lib/types';
import { db } from '@/lib/db';

const VALID_PRIORITY: GeneralTaskPriority[] = ['low', 'medium', 'high', 'critical'];

export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-tasks'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const tasks = await generalTaskStore.list(viewer, { sourceModule: 'hr' });
    return NextResponse.json(tasks);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Only an actual HR manager (or admin/superadmin) may create/assign an HR
// task — a plain 'hr'-role employee can still open the module (view their
// own tasks, the dashboard) but not hand out new work.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-tasks'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await isHrManager(viewer))) return NextResponse.json({ error: 'Only an HR manager or admin can create HR tasks' }, { status: 403 });

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

  const belongs = await employeeBelongsToDepartment(assigneeId, departmentId);
  if (!belongs) return NextResponse.json({ error: 'The selected employee is not an active member of the selected department' }, { status: 400 });

  let categoryName = '';
  if (typeof body.categoryId === 'string' && body.categoryId.trim()) {
    const category = await db.HrTaskCategory.findByPk(body.categoryId.trim());
    if (category) categoryName = category.get('name') as string;
  }

  try {
    const created = await generalTaskStore.create({
      sourceModule: 'hr',
      title,
      description: typeof body.description === 'string' ? body.description.trim() : '',
      departmentId,
      assigneeId,
      reviewerId: typeof body.reviewerId === 'string' && body.reviewerId.trim() ? body.reviewerId.trim() : undefined,
      priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
      requiresReview: body.requiresReview !== false,
      category: categoryName,
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
      action: `HR task assigned to ${created.assignee_name}`,
      previousStatus: '',
      newStatus: created.status,
      remarks: title,
      ip: getClientIp(request)
    });

    const assignee = await findUserById(assigneeId);
    if (assignee && assignee.username !== viewer.username) {
      await notifyUsers([assignee.username], {
        title: 'New HR Task Assigned',
        body: `"${title}"\nAssigned By: ${viewer.name}\nPriority: ${created.priority}\nDeadline: ${deadline}`,
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
