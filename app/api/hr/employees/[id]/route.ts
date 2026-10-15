import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule, isHrManager } from '@/lib/hrAccess';
import { canViewRole } from '@/lib/permissions';
import { findUserById, updateUser } from '@/lib/userStore';
import { listActiveRoles } from '@/lib/roleStore';
import { apiErrorResponse } from '@/lib/apiError';
import { UserRole } from '@/lib/types';

// Fixing a mistake on an existing profile — name typo, wrong phone/email,
// wrong designation or job-function role — NOT the same thing as the
// department reassignment the POST handler's own comment deliberately keeps
// admin-only (see app/api/hr/employees/route.ts). `department` is not in
// this patch's allow-list on purpose: HR can bring someone new in and fix
// their own data-entry mistakes afterward, but still can't move an existing
// employee to a different department from this screen.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-employees'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await isHrManager(viewer))) return NextResponse.json({ error: 'Only an HR manager or admin can edit an employee profile' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findUserById(id);
    // Same "not found rather than forbidden" rule the admin route uses for
    // a role this viewer can't see (e.g. an admin/superadmin profile) — an
    // HR manager editing employees should never be able to confirm, via a
    // 403, that a given id even belongs to a privileged account.
    if (!existing || !canViewRole(viewer.role, existing.role)) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

    // Same non-privileged role allow-list the create form is restricted to
    // — HR fixing a wrong job-function role still can never hand out an
    // admin/superadmin account from this screen.
    const activeRoles = await listActiveRoles();
    const assignableRoles = activeRoles.filter((r) => !r.isPrivileged);
    const role: UserRole | undefined = assignableRoles.some((r) => r.key === body.role) ? (body.role as UserRole) : undefined;

    const updated = await updateUser(id, {
      name,
      phone: typeof body.phone === 'string' ? body.phone.trim() : undefined,
      email: typeof body.email === 'string' ? body.email.trim() : undefined,
      employeeId: typeof body.employeeId === 'string' ? body.employeeId.trim() : undefined,
      designation: typeof body.designation === 'string' ? body.designation.trim() : undefined,
      role
    });
    if (!updated) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
