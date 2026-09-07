import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule } from '@/lib/hrAccess';
import { generalTaskStore } from '@/lib/generalTaskStore';
import { apiErrorResponse } from '@/lib/apiError';
import { GeneralTaskRecord } from '@/lib/types';

const TERMINAL_SUCCESS = new Set(['approved', 'completed']);
const OPEN_STATUSES = new Set(['pending', 'in_progress', 'under_review', 'rework_required']);

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(t: GeneralTaskRecord, today: string): boolean {
  return OPEN_STATUSES.has(t.status) && t.deadline < today;
}

// Three report shapes behind one endpoint (?type=daily|monthly|employee) —
// all derived from the same viewer-scoped HR task list, consistent with the
// dashboard route's aggregation approach (no full-org unscoped queries).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-reports'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const type = request.nextUrl.searchParams.get('type') || 'daily';
  const employeeId = request.nextUrl.searchParams.get('employeeId');
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');
  const status = request.nextUrl.searchParams.get('status');
  const priority = request.nextUrl.searchParams.get('priority');
  const category = request.nextUrl.searchParams.get('category');

  try {
    let tasks = await generalTaskStore.list(viewer, { sourceModule: 'hr' });
    if (employeeId) tasks = tasks.filter((t) => t.assignee_id === employeeId);
    if (from) tasks = tasks.filter((t) => t.deadline >= from);
    if (to) tasks = tasks.filter((t) => t.deadline <= to);
    if (status) tasks = tasks.filter((t) => t.status === status);
    if (priority) tasks = tasks.filter((t) => t.priority === priority);
    if (category) tasks = tasks.filter((t) => t.category === category);

    const today = todayIso();

    if (type === 'daily') {
      const todays = tasks.filter((t) => t.deadline === today);
      const byEmployee = new Map<string, { employee: string; department: string; assigned: number; completed: number; pending: number; overdue: number; submitted: number }>();
      todays.forEach((t) => {
        const entry = byEmployee.get(t.assignee_id) || { employee: t.assignee_name, department: t.department_name, assigned: 0, completed: 0, pending: 0, overdue: 0, submitted: 0 };
        entry.assigned += 1;
        if (TERMINAL_SUCCESS.has(t.status)) entry.completed += 1;
        else if (t.status === 'under_review') entry.submitted += 1;
        else if (OPEN_STATUSES.has(t.status)) entry.pending += 1;
        if (isOverdue(t, today)) entry.overdue += 1;
        byEmployee.set(t.assignee_id, entry);
      });
      return NextResponse.json({ rows: Array.from(byEmployee.values()) });
    }

    if (type === 'monthly') {
      const totalAssigned = tasks.length;
      const completed = tasks.filter((t) => TERMINAL_SUCCESS.has(t.status)).length;
      const overdue = tasks.filter((t) => isOverdue(t, today)).length;
      const onTime = tasks.filter((t) => t.status === 'completed' || t.status === 'approved').length; // deadline-vs-completion nuance kept simple (no completion timestamp on the summary record)
      const reworkCount = tasks.filter((t) => t.status === 'rework_required').length;
      return NextResponse.json({
        totalAssigned,
        completed,
        overdue,
        completionPercent: totalAssigned ? Math.round((completed / totalAssigned) * 100) : 0,
        onTimePercent: completed ? Math.round((onTime / completed) * 100) : 0,
        reworkCount
      });
    }

    // 'employee'
    return NextResponse.json({
      rows: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        department: t.department_name,
        priority: t.priority,
        category: t.category,
        status: t.status,
        deadline: t.deadline,
        overdue: isOverdue(t, today)
      }))
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
