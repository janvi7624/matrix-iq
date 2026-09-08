import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { isModuleActionAllowed } from '@/lib/permissions';
import { generalTaskStore } from '@/lib/generalTaskStore';
import { sequelize } from '@/lib/db';
import { employeeBelongsToDepartment, listActiveEmployeesForDepartment } from '@/lib/departmentEmployeeStore';
import { findDepartmentById, listDepartmentManagers } from '@/lib/departmentStore';
import { findUserById } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { GeneralTaskPriority, GeneralTaskRecord } from '@/lib/types';

const VALID_PRIORITY: GeneralTaskPriority[] = ['low', 'medium', 'high', 'critical'];
type AssignMode = 'employee' | 'selected' | 'department' | 'manager' | 'unassigned';
const VALID_MODES: AssignMode[] = ['employee', 'selected', 'department', 'manager', 'unassigned'];

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

// POST — Task Planner's assignment engine. Supports 5 modes (Task Planner
// spec's "Assign To -> Department/Employee" model) but creates exactly the
// same kind of GeneralTask row generalTaskStore.create() always has —
// several individually-traceable rows for a multi-employee mode, never one
// ambiguous shared-ownership row. The employee/department pairing is NEVER
// trusted from the client for 'selected'/'department'/'manager' modes — the
// real employee list is always re-derived here from the department id.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await canAssign(viewer))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
  const deadline = typeof body.deadline === 'string' ? body.deadline : '';
  const startDate = typeof body.startDate === 'string' ? body.startDate.trim() : '';
  if (!title) return NextResponse.json({ error: 'Task name is required' }, { status: 400 });
  if (!deadline) return NextResponse.json({ error: 'Deadline is required' }, { status: 400 });
  if (startDate && startDate > deadline) return NextResponse.json({ error: 'Due Date cannot be before Start Date' }, { status: 400 });
  if (!departmentId) return NextResponse.json({ error: 'Department is required' }, { status: 400 });

  const mode: AssignMode = VALID_MODES.includes(body.assignMode)
    ? body.assignMode
    : typeof body.assigneeId === 'string' && body.assigneeId
      ? 'employee'
      : 'employee';

  const department = await findDepartmentById(departmentId);
  if (!department) return NextResponse.json({ error: 'Selected department not found' }, { status: 400 });

  let assigneeIds: string[] = [];
  if (mode === 'employee') {
    const assigneeId = typeof body.assigneeId === 'string' ? body.assigneeId.trim() : '';
    if (!assigneeId) return NextResponse.json({ error: 'Employee is required' }, { status: 400 });
    if (!(await employeeBelongsToDepartment(assigneeId, departmentId))) {
      return NextResponse.json({ error: 'The selected employee is not an active member of the selected department' }, { status: 400 });
    }
    assigneeIds = [assigneeId];
  } else if (mode === 'selected') {
    const requested = Array.isArray(body.assigneeIds) ? body.assigneeIds.filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '') : [];
    if (!requested.length) return NextResponse.json({ error: 'Select at least one employee' }, { status: 400 });
    const verified = await Promise.all(requested.map((id: string) => employeeBelongsToDepartment(id, departmentId)));
    assigneeIds = requested.filter((_id: string, i: number) => verified[i]);
    if (!assigneeIds.length) return NextResponse.json({ error: 'None of the selected employees are active members of this department' }, { status: 400 });
  } else if (mode === 'department') {
    const employees = await listActiveEmployeesForDepartment(departmentId);
    if (!employees.length) return NextResponse.json({ error: 'This department has no active employees' }, { status: 400 });
    assigneeIds = employees.map((e) => e.id);
  } else if (mode === 'manager') {
    const managers = (await listDepartmentManagers())[department.name] || [];
    if (!managers.length) return NextResponse.json({ error: 'This department has no manager configured' }, { status: 400 });
    assigneeIds = managers.map((m) => m.id);
  }
  // mode === 'unassigned' -> assigneeIds stays [] and the loop below runs
  // exactly once with no assignee.

  const priority: GeneralTaskPriority = VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const remarks = typeof body.remarks === 'string' ? body.remarks.trim() : '';
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  const tmsProjectId = typeof body.tmsProjectId === 'string' ? body.tmsProjectId.trim() : '';
  const labels = Array.isArray(body.labels) ? body.labels.filter((l: unknown): l is string => typeof l === 'string' && l.trim() !== '') : [];
  const requiresReview = body.requiresReview !== false;
  const attachments = Array.isArray(body.attachments) ? body.attachments.filter((a: unknown): a is string => typeof a === 'string') : [];

  const targets: (string | null)[] = mode === 'unassigned' ? [null] : assigneeIds;

  try {
    const created: GeneralTaskRecord[] = await sequelize.transaction(async (t) => {
      const rows: GeneralTaskRecord[] = [];
      for (const assigneeId of targets) {
        const row = await generalTaskStore.create({
          sourceModule: 'admin',
          title,
          description,
          departmentId,
          assigneeId: assigneeId || undefined,
          priority,
          requiresReview,
          category,
          projectId,
          tmsProjectId,
          startDate,
          deadline,
          remarks,
          attachments,
          labels,
          createdByUsername: viewer.username,
          transaction: t
        });
        rows.push(row);
      }
      return rows;
    });

    const isBulk = created.length > 1;
    for (const row of created) {
      await logAudit({
        by: viewer.username,
        role: viewer.role,
        entityType: 'general_task',
        entityId: row.id,
        action: `Task assigned to ${row.assignee_name || 'Unassigned'} (${department.name})${isBulk ? ` — part of a ${created.length}-employee bulk assignment` : ''}`,
        previousStatus: '',
        newStatus: row.status,
        remarks: title,
        ip: getClientIp(request)
      });
    }

    if (mode === 'unassigned') {
      const managers = (await listDepartmentManagers())[department.name] || [];
      const notifyUsernames = new Set(managers.map((m) => m.username));
      notifyUsernames.delete(viewer.username);
      if (notifyUsernames.size) {
        await notifyUsers([...notifyUsernames], {
          title: 'Unassigned Department Task Created',
          body: `"${title}"\nDepartment: ${department.name}\nAssigned By: ${viewer.name}\nPriority: ${priority}\nDeadline: ${deadline}`,
          type: 'general_task_assigned',
          entityType: 'general_task',
          entityId: created[0].id
        });
      }
    } else {
      const managers = (await listDepartmentManagers())[department.name] || [];
      for (const row of created) {
        const assignee = await findUserById(row.assignee_id);
        const notifyUsernames = new Set<string>();
        if (assignee) notifyUsernames.add(assignee.username);
        managers.forEach((m) => notifyUsernames.add(m.username));
        notifyUsernames.delete(viewer.username);
        if (notifyUsernames.size) {
          await notifyUsers([...notifyUsernames], {
            title: 'New Task Assigned',
            body: `"${title}"\nDepartment: ${department.name}\nAssigned By: ${viewer.name}\nPriority: ${priority}\nDeadline: ${deadline}`,
            type: 'general_task_assigned',
            entityType: 'general_task',
            entityId: row.id
          });
        }
      }
    }

    return NextResponse.json({ created }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
