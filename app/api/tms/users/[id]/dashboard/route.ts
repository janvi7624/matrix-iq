import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, isTmsManagerTier } from '@/lib/tmsAccess';
import { findUserById } from '@/lib/userStore';
import { tmsTaskStore, listRecentTaskUpdatesForAssignee } from '@/lib/tmsTaskStore';
import { tmsProjectStore } from '@/lib/tmsProjectStore';
import { apiErrorResponse } from '@/lib/apiError';

// Manager-tier/privileged for the TARGET's department, or the person
// viewing their own dashboard — mirrors the department-scoped visibility
// tmsProjectStore.list()/tmsTaskStore.list() already apply, just re-derived
// for a single arbitrary target rather than "my own scope".
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  try {
    const target = await findUserById(id);
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const isSelf = viewer.userId === id;
    const sameDepartmentManager = isTmsManagerTier(viewer) && target.department === viewer.department;
    if (!isSelf && !viewer.isPrivileged && !sameDepartmentManager) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Authorization was already fully decided above; this deliberately asks
    // tmsProjectStore.list() for the ORG-WIDE pool (not re-scoped to the
    // viewer's own department) purely to find every project the TARGET is
    // on — including a combined project touching a department the viewer
    // doesn't manage. Never returned to the client as-is, only filtered down
    // to counts for this one target.
    const [allProjects, tasks, recentUpdates] = await Promise.all([
      tmsProjectStore.list({ ...viewer, isPrivileged: true }),
      tmsTaskStore.listForAssignee(id),
      listRecentTaskUpdatesForAssignee(id, 10)
    ]);

    const assignedProjects = allProjects.filter((p) => p.project_manager_id === id || p.team_member_ids.includes(id));
    const activeProjects = assignedProjects.filter((p) => p.status !== 'completed' && p.status !== 'cancelled');
    const completedProjects = assignedProjects.filter((p) => p.status === 'completed');

    const openTasks = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
    const completedTasks = tasks.filter((t) => t.status === 'completed');
    const blockedTasks = tasks.filter((t) => t.status === 'blocked');
    const today = new Date().toISOString().slice(0, 10);
    const overdueTasks = openTasks.filter((t) => t.due_date && t.due_date < today);

    // Lightweight index for a click-through drill-down from the Tasks tiles
    // — mirrors lib/performanceReview.ts's tasksList for the same reason:
    // the tiles here used to be totals with nothing to click through to.
    const tasksList = tasks
      .map((t) => ({ id: t.id, label: t.name, status: t.status, dueDate: t.due_date, projectName: t.project_name }))
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));

    return NextResponse.json({
      user: { id: target.id, username: target.username, name: target.name, department: target.department, designation: target.designation, role: target.role },
      projects: { assigned: assignedProjects.length, active: activeProjects.length, completed: completedProjects.length },
      tasks: {
        total: tasks.length,
        completed: completedTasks.length,
        inProgress: tasks.filter((t) => t.status === 'in_progress').length,
        blocked: blockedTasks.length,
        pending: openTasks.length,
        overdue: overdueTasks.length
      },
      tasksList,
      taskDerivedProgress: tasks.length ? Math.round((completedTasks.length / tasks.length) * 100) : null,
      recentUpdates
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
