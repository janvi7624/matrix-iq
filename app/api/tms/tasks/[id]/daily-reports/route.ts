import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction } from '@/lib/tmsAccess';
import { tmsTaskStore, canAccessTask } from '@/lib/tmsTaskStore';
import { apiErrorResponse } from '@/lib/apiError';
import { db } from '@/lib/db';

// The task detail page's "Linked Daily Reports" panel — every AI Daily
// Report entry anyone has filed against this task, across every reporting
// date. A task may accumulate many of these over the weeks it's open; each
// keeps its own reporting date and notes rather than being folded into one
// running total, since "what did Tuesday actually say" is exactly what a
// manager reviewing this panel wants to be able to answer.
//
// Same gate as the task's own detail route (requireTmsAction 'view' +
// canAccessTask) — this is TMS task data being read from a TMS task page,
// so TMS's own access rule is what governs it, not Daily Report's.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-tasks', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;

  try {
    const task = await tmsTaskStore.findById(id);
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    if (!(await canAccessTask(viewer, task))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rows = await db.DailyReportEntry.findAll({
      where: { 'data.tms_task_id': id } as never,
      include: [
        {
          model: db.DailyReport,
          as: 'report',
          attributes: ['id', 'report_date', 'employee_id'],
          include: [{ model: db.User, as: 'employee', attributes: ['id', 'name', 'username'] }]
        }
      ],
      order: [[{ model: db.DailyReport, as: 'report' }, 'report_date', 'DESC']]
    });

    const entries = rows
      .map((row) => {
        const data = (row.get('data') as Record<string, unknown>) ?? {};
        const report = row.get('report') as unknown as { get: (k: string) => unknown } | null;
        if (!report) return null;
        const employee = report.get('employee') as { get: (k: string) => unknown } | null;
        return {
          reportId: report.get('id') as string,
          reportDate: report.get('report_date') as string,
          employeeName: (employee?.get('name') as string) || (employee?.get('username') as string) || '',
          notes: (data.notes as string) || '',
          status: (data.tms_status_label as string) || '',
          progressPercent: (data.tms_progress_percent as string) || ''
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    return NextResponse.json({ entries });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
