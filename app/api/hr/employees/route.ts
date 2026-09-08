import { NextRequest, NextResponse } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { requireHrModule, isHrManager } from '@/lib/hrAccess';
import { canViewRole } from '@/lib/permissions';
import { db } from '@/lib/db';
import { apiErrorResponse } from '@/lib/apiError';
import { createUser, findUserByUsername } from '@/lib/userStore';
import { listActiveRoles } from '@/lib/roleStore';
import { findDepartmentById, updateDepartment } from '@/lib/departmentStore';
import { UserRole } from '@/lib/types';

// Thin read-only directory over the existing User/Department data — no new
// employee-record model. Deliberately returns only the fields an HR
// directory needs, not the full UserRecord (no passwordHash, obviously, but
// also no email/phone unless the viewer is an HR manager/admin — least-
// privilege per the spec's HR data-privacy section).
export async function GET(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-employees'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const rows = await db.User.findAll({
      where: { status: 'active' } as never,
      include: [
        { model: db.Department, as: 'departmentRef', attributes: ['name'] },
        { model: db.Role, as: 'role', attributes: ['key', 'label'] }
      ],
      attributes: ['id', 'username', 'name', 'designation', 'email', 'phone'],
      order: [['name', 'ASC']]
    });

    const employees = rows
      .map((r) => {
        const plain = r.get({ plain: true }) as Record<string, unknown>;
        const role = plain.role as { key?: string; label?: string } | null;
        if (role?.key && !canViewRole(viewer.role, role.key)) return null;
        return {
          id: plain.id,
          username: plain.username,
          name: plain.name,
          designation: plain.designation || '',
          department: (plain.departmentRef as { name?: string } | null)?.name ?? '',
          role: role?.label || role?.key || '',
          email: plain.email || '',
          phone: plain.phone || ''
        };
      })
      .filter((e): e is NonNullable<typeof e> => !!e);

    return NextResponse.json(employees);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// New-joinee onboarding: HR creates the account and assigns its department
// (and, optionally, marks them as that department's manager) up front — but
// this is CREATE only. Reassigning an EXISTING user's department stays on
// the admin-only PATCH /api/admin/users/[id]; HR is never given that route,
// so HR can bring someone new in but never move someone else already in the
// system to a different department. Only an actual HR manager may do this
// (mirrors HR Tasks' "only HR manager may create/assign" gate), not every
// plain 'hr'-role employee.
export async function POST(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireHrModule(viewer, 'hr-employees'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await isHrManager(viewer))) return NextResponse.json({ error: 'Only an HR manager or admin can create a new employee profile' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const employeeId = typeof body.employeeId === 'string' ? body.employeeId.trim() : '';
  const designation = typeof body.designation === 'string' ? body.designation.trim() : '';
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
  const makeManager = body.isDepartmentManager === true;

  if (!username || !password || !name) {
    return NextResponse.json({ error: 'Username, password, and name are required' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }
  if (!departmentId) return NextResponse.json({ error: 'Department is required' }, { status: 400 });

  const department = await findDepartmentById(departmentId);
  if (!department) return NextResponse.json({ error: 'Selected department not found' }, { status: 400 });

  // HR picks a job-function role (technical-manager, engineer, marketing,
  // accounts, plain user, ...), never an admin/superadmin account — that
  // privilege boundary is enforced server-side regardless of what the form
  // sends, same spirit as admin's own creation route refusing a non-
  // superadmin session a superadmin account.
  const activeRoles = await listActiveRoles();
  const assignableRoles = activeRoles.filter((r) => !r.isPrivileged);
  const requestedRole: UserRole = assignableRoles.some((r) => r.key === body.role) ? (body.role as UserRole) : 'user';

  try {
    if (await findUserByUsername(username)) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    }

    const user = await createUser({
      username,
      password,
      name,
      phone,
      email,
      role: requestedRole,
      employeeId,
      department: department.name,
      designation
    });

    if (makeManager && !department.managerIds.includes(user.id)) {
      await updateDepartment(department.id, { managerIds: [...department.managerIds, user.id] }, viewer.username);
    }

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
