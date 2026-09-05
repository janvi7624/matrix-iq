import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsTaskStore } from '@/lib/tmsTaskStore';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { apiErrorResponse } from '@/lib/apiError';
import { notifyUsers } from '@/lib/notificationStore';
import { sendTaskLifecycleEmail } from '@/lib/email/notifications';
import { findUserById } from '@/lib/userStore';
import { TmsPriority, TmsTaskRecord } from '@/lib/types';
import { taskAssignedNotification } from '@/lib/tmsLabels';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';
import { notifyIfCrossDepartmentAssignment } from '@/lib/tmsCrossDepartment';

const VALID_PRIORITY: TmsPriority[] = ['low', 'medium', 'high'];

export async function GET(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-tasks', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const records = await tmsTaskStore.list(viewer);
    return NextResponse.json(records);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-tasks', 'create'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  if (!name || !projectId) return NextResponse.json({ error: 'Task name and project are required' }, { status: 400 });

  const project = await tmsProjectStore.findById(projectId);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const assigneeId = typeof body.assigneeId === 'string' ? body.assigneeId.trim() : '';
  const now = new Date().toISOString();
  const record: TmsTaskRecord = {
    id: `${Date.now()}`,
    created_at: now,
    created_by: viewer.username,
    project_id: projectId,
    project_name: project.name,
    name,
    assignee_id: assigneeId,
    assignee_name: '',
    department_id: typeof body.departmentId === 'string' ? body.departmentId.trim() : project.department_id,
    department_name: '',
    description: typeof body.description === 'string' ? body.description.trim() : '',
    priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
    status: 'to_do',
    progress_percent: 0,
    start_date: typeof body.startDate === 'string' ? body.startDate : '',
    due_date: typeof body.dueDate === 'string' ? body.dueDate : '',
    completion_date: '',
    remarks: typeof body.remarks === 'string' ? body.remarks.trim() : '',
    attachments: [],
    updated_at: now
  };

  try {
    const created = await tmsTaskStore.create(record);

    if (assigneeId) {
      const assignee = await findUserById(assigneeId);
      if (assignee && assignee.username !== viewer.username) {
        const notification = taskAssignedNotification(name, project.name, viewer.name, record.priority, created.due_date);
        await notifyUsers([assignee.username], {
          title: notification.title,
          body: notification.body,
          type: 'tms_task_assigned',
          entityType: 'tms_task',
          entityId: created.id
        });
        if (assignee.email) {
          void sendTaskLifecycleEmail({
            name: assignee.name,
            email: assignee.email,
            event: 'assigned',
            taskName: name,
            projectName: project.name,
            detail: created.due_date ? `Due: ${created.due_date}` : undefined
          });
        }
        await notifyIfCrossDepartmentAssignment({
          project,
          assignee: { username: assignee.username, name: assignee.name, department: assignee.department },
          taskName: name,
          taskId: created.id,
          assignerName: viewer.name,
          assignerUsername: viewer.username,
          dueDate: created.due_date
        });
      }
    }

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      entityType: 'tms_task',
      entityId: created.id,
      action: `Task created${created.assignee_name ? ` and assigned to ${created.assignee_name}` : ''}`,
      previousStatus: '',
      newStatus: created.status,
      remarks: created.name,
      ip: getClientIp(request)
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
