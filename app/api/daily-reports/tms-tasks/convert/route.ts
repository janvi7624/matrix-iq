import { NextRequest, NextResponse } from 'next/server';
import { guardDailyReport, dailyReportErrorResponse, isGuardFailure } from '@/lib/dailyReportApi';
import { resolveEmployeeAccess } from '@/lib/dailyReportAccess';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsTaskStore } from '@/lib/tmsTaskStore';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { findUserById } from '@/lib/userStore';
import { TmsPriority, TmsTaskRecord } from '@/lib/types';
import { taskAssignedNotification } from '@/lib/tmsLabels';
import { notifyUsers } from '@/lib/notificationStore';
import { sendTaskLifecycleEmail } from '@/lib/email/notifications';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// Workflow B's conversion step: a standalone AI Daily Report task, typed by
// hand with no TMS link, becomes a real tracked TMS task — created exactly
// once, through TMS's own create path (tmsTaskStore.create, the same
// store function POST /api/tms/tasks itself calls), never a second,
// parallel insert. The caller then sets tms_task_id on that entry locally
// and saves the report normally, same as "select existing" does — this
// route only ever creates and returns an id, it never touches the report.
//
// Gated on the SAME tms-tasks:create permission the real TMS create route
// requires — per the seeded roles, that's team-lead/technical-manager, not
// a plain engineer/technician (lib/roleStore.ts's ENGINEER_MODULES has no
// create). So in practice this is a manager's action, same as "who creates
// a task" already means in TMS itself; this does not loosen that.
const VALID_PRIORITY: TmsPriority[] = ['low', 'medium', 'high'];

export async function POST(request: NextRequest) {
  const guard = await guardDailyReport(request, 'daily-report');
  if (isGuardFailure(guard)) return guard.response;
  const { viewer } = guard;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const employeeId = typeof body.employeeId === 'string' && body.employeeId ? body.employeeId : viewer.userId;
  const taskDescription = typeof body.taskDescription === 'string' ? body.taskDescription.trim() : '';
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
  const dueDate = typeof body.dueDate === 'string' ? body.dueDate : '';
  if (!taskDescription || !projectId) {
    return NextResponse.json({ error: 'A task description and a TMS project are required to create a task.' }, { status: 400 });
  }

  try {
    const access = await resolveEmployeeAccess(viewer, employeeId);
    if (!access.canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const tmsViewer = await getTmsViewer(request);
    if (!tmsViewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await requireTmsAction(tmsViewer, 'tms-tasks', 'create'))) {
      return NextResponse.json({ error: 'You do not have permission to create TMS tasks. Ask a Technical Manager or Team Lead to create one and assign it to you instead.' }, { status: 403 });
    }

    const project = await tmsProjectStore.findById(projectId);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const now = new Date().toISOString();
    const record: TmsTaskRecord = {
      id: `${Date.now()}`,
      created_at: now,
      created_by: tmsViewer.username,
      project_id: projectId,
      project_name: project.name,
      name: taskDescription.slice(0, 200),
      assignee_id: employeeId,
      assignee_name: '',
      department_id: project.department_id,
      department_name: '',
      description: taskDescription,
      priority: VALID_PRIORITY.includes(body.priority) ? body.priority : 'medium',
      status: 'to_do',
      progress_percent: 0,
      start_date: '',
      due_date: dueDate,
      completion_date: '',
      remarks: 'Created from an AI Daily Report entry.',
      attachments: [],
      updated_at: now
    };

    const created = await tmsTaskStore.create(record);

    const assignee = await findUserById(employeeId);
    if (assignee && assignee.username !== tmsViewer.username) {
      const notification = taskAssignedNotification(record.name, project.name, tmsViewer.name, record.priority, created.due_date);
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
          taskName: record.name,
          projectName: project.name,
          detail: created.due_date ? `Due: ${created.due_date}` : undefined
        });
      }
    }

    await logAudit({
      by: tmsViewer.username,
      role: tmsViewer.role,
      entityType: 'tms_task',
      entityId: created.id,
      action: `Task created from an AI Daily Report entry${created.assignee_name ? ` and assigned to ${created.assignee_name}` : ''}`,
      previousStatus: '',
      newStatus: created.status,
      remarks: created.name,
      ip: getClientIp(request)
    });

    return NextResponse.json({ task: created }, { status: 201 });
  } catch (error) {
    return dailyReportErrorResponse(error);
  }
}
