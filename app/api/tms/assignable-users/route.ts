import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsModule, TMS_DEPARTMENTS, TMS_ROLE_KEYS } from '@/lib/tmsAccess';
import { listUsers } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';
import { canViewRole } from '@/lib/permissions';

// A lightweight "who can I assign this to" list for the PersonPicker —
// unlike /api/tms/users (which backs the manager-only TMS Users admin CRUD
// page, gated on tms-users:view), this is usable by ANY TMS-authorized
// viewer, since assigning a project/task to a colleague is something an
// Engineer or Technician needs to be able to do too, not just a manager.
// Same TMS_DEPARTMENTS/TMS_ROLE_KEYS scoping as /api/tms/users, plus an
// explicit active-only filter (that route doesn't apply one).
export async function GET(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Gate on being able to view EITHER projects or tasks — whichever module
  // is asking for a picker — rather than requiring both, since a viewer's
  // permission matrix could plausibly grant one without the other.
  const canView = (await requireTmsModule(viewer, 'tms-projects')) || (await requireTmsModule(viewer, 'tms-tasks'));
  if (!canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const users = await listUsers();
    const scoped = users
      .filter(
        (u) =>
          u.status === 'active' &&
          TMS_DEPARTMENTS.includes(u.department as (typeof TMS_DEPARTMENTS)[number]) &&
          TMS_ROLE_KEYS.includes(u.role as (typeof TMS_ROLE_KEYS)[number]) &&
          canViewRole(viewer.role, u.role)
      )
      .map((u) => ({ id: u.id, username: u.username, name: u.name, department: u.department, role: u.role }));
    return NextResponse.json(scoped);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
