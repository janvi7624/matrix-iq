import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { countSuperAdmins, deleteUser, findUserById } from '@/lib/userStore';
import { getAssignedWorkSummary } from '@/lib/employeeExitStore';
import { apiErrorResponse } from '@/lib/apiError';
import { logAudit } from '@/lib/auditLogStore';
import { getClientIp } from '@/lib/requestIp';

// Remove an employee who has already been exited.
//
// Deliberately NOT under /api/admin: proxy.ts blocks every DELETE there for
// anyone who is not a superadmin, and that blanket rule guards a lot more than
// users. Rather than widen it — which would quietly hand managers the ability
// to delete roles, departments, modules and everything else under that prefix
// — this lives in the employee-exit module, which is already scoped to the
// viewer's own departments (resolveVisibilityScope, same check the exit
// summary and commit routes use).
//
// "Delete" is a SOFT delete: db/models/user.js is paranoid, so destroy() sets
// deleted_at. Every project, quotation, task and audit row that references
// this person keeps its foreign key and its history; they simply stop
// appearing in pickers and lists. That is what makes this safe to hand to a
// department manager at all.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { userId } = await params;

  try {
    // Same department gate as the rest of this module: an org-wide viewer
    // (admin/superadmin) may act on anyone, a department manager only on the
    // people inside their own scope.
    const scope = await resolveVisibilityScope(viewer.username);
    if (!scope.seesOrgWide && !(scope.scopedUserIds ?? []).includes(userId)) {
      return NextResponse.json({ error: 'Forbidden — outside your department' }, { status: 403 });
    }

    const target = await findUserById(userId);
    if (!target) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    // Nobody deletes themselves. Easy to do by accident from a row action,
    // and it would lock the viewer out of their own session.
    if (target.username === viewer.username) {
      return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
    }

    // The exit has to have happened first. This is the whole premise of the
    // button: it replaces "they are sitting here inactive forever", not the
    // exit process itself. Deleting an active employee would skip the
    // reassignment step and strand their open work with no owner.
    if (target.status !== 'inactive') {
      return NextResponse.json(
        { error: 'Run Employee Exit first — only an exited (inactive) employee can be deleted.' },
        { status: 400 }
      );
    }

    // A superadmin is never removable from here regardless of count: this
    // route's authorization is department scope, which is a weaker claim than
    // the one needed to touch the top-level account.
    if (target.role === 'superadmin') {
      return NextResponse.json({ error: 'A superadmin cannot be deleted here.' }, { status: 403 });
    }
    // Belt and braces — mirrors the guard on the admin delete route.
    if (target.role === 'superadmin' && (await countSuperAdmins()) <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last remaining superadmin' }, { status: 400 });
    }

    // Still-open work means the exit was never finished (or new work landed on
    // them afterwards). Deleting now would hide live projects, tasks, leads
    // and quotations behind a removed owner, which is exactly the mess the
    // exit flow exists to prevent — so this refuses and says what is left.
    const summary = await getAssignedWorkSummary(userId);
    const open =
      summary.projects.length + summary.tasks.length + summary.leads.length + summary.quotations.length;
    if (open > 0) {
      return NextResponse.json(
        {
          error: `${target.name || target.username} still has ${open} open item(s) — reassign them through Employee Exit before deleting.`
        },
        { status: 400 }
      );
    }

    await deleteUser(userId);

    await logAudit({
      by: viewer.username,
      role: viewer.role,
      // This module's own audit type, already in the union — the exit and the
      // deletion that follows it then read as one story on the audit log
      // rather than the removal landing under an unrelated entity.
      entityType: 'employee_exit',
      entityId: userId,
      action: 'Employee deleted after exit',
      previousStatus: 'inactive',
      newStatus: 'deleted',
      remarks: `${target.name || target.username} (${target.username})${target.department ? ` · ${target.department}` : ''}`,
      ip: getClientIp(request)
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
