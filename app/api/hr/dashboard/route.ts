import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule } from '@/lib/hrAccess';
import { generalTaskStore } from '@/lib/generalTaskStore';
import { ensureRecurringInstancesForToday } from '@/lib/hrRecurringTaskStore';
import { apiErrorResponse } from '@/lib/apiError';
import { GeneralTaskRecord } from '@/lib/types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const OPEN_STATUSES = new Set(['pending', 'in_progress', 'under_review', 'rework_required']);
const TERMINAL_SUCCESS = new Set(['approved', 'completed']);

// Aggregated over the viewer's own HR task scope (their own department's
// worth of HR tasks, or org-wide if privileged/viewAllDepartments) — not a
// full-org unscoped query, and not one query per stat card.
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-tasks'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    await ensureRecurringInstancesForToday();
    const tasks = await generalTaskStore.list(viewer, { sourceModule: 'hr' });
    const today = todayIso();

    const isOverdue = (t: GeneralTaskRecord) => OPEN_STATUSES.has(t.status) && t.deadline && t.deadline < today;
    const isDueToday = (t: GeneralTaskRecord) => OPEN_STATUSES.has(t.status) && t.deadline === today;

    const todayCreated = tasks.filter((t) => t.created_at.slice(0, 10) === today);
    const summary = {
      totalToday: todayCreated.length,
      completed: tasks.filter((t) => TERMINAL_SUCCESS.has(t.status)).length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      submittedForReview: tasks.filter((t) => t.status === 'under_review').length,
      overdue: tasks.filter(isOverdue).length,
      dueToday: tasks.filter(isDueToday).length,
      upcoming: tasks.filter((t) => OPEN_STATUSES.has(t.status) && t.deadline > today).length,
      reworkRequired: tasks.filter((t) => t.status === 'rework_required').length
    };

    const byAssignee = new Map<string, { name: string; assigned: number; completed: number; pending: number; overdue: number }>();
    tasks.forEach((t) => {
      const entry = byAssignee.get(t.assignee_id) || { name: t.assignee_name, assigned: 0, completed: 0, pending: 0, overdue: 0 };
      entry.assigned += 1;
      if (TERMINAL_SUCCESS.has(t.status)) entry.completed += 1;
      if (OPEN_STATUSES.has(t.status)) entry.pending += 1;
      if (isOverdue(t)) entry.overdue += 1;
      byAssignee.set(t.assignee_id, entry);
    });
    const workload = Array.from(byAssignee.entries()).map(([id, w]) => ({
      id,
      ...w,
      completionPercent: w.assigned ? Math.round((w.completed / w.assigned) * 100) : 0
    }));

    const alerts = {
      overdue: tasks.filter(isOverdue).map((t) => ({ id: t.id, title: t.title, assignee: t.assignee_name, deadline: t.deadline })),
      pendingReview: tasks.filter((t) => t.status === 'under_review').map((t) => ({ id: t.id, title: t.title, assignee: t.assignee_name })),
      dueToday: tasks.filter(isDueToday).map((t) => ({ id: t.id, title: t.title, assignee: t.assignee_name })),
      reworkRequired: tasks.filter((t) => t.status === 'rework_required').map((t) => ({ id: t.id, title: t.title, assignee: t.assignee_name }))
    };

    return NextResponse.json({ summary, workload, alerts });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
