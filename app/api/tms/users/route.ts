import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction, TMS_DEPARTMENTS, TMS_ROLE_KEYS } from '@/lib/tmsAccess';
import { createUser, listUsers } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';

// A scoped view of the real User/Role/Department system (lib/userStore.ts),
// not a parallel store — /admin/users itself is isPrivileged-only and
// Technical Manager deliberately isn't privileged (that would hand them
// company-wide user management), so this is the TMS-scoped equivalent.
export async function GET(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-users', 'view'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const users = await listUsers();
    const scoped = users.filter((u) => TMS_DEPARTMENTS.includes(u.department as (typeof TMS_DEPARTMENTS)[number]));
    return NextResponse.json(scoped);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-users', 'create'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!username || !password || !name) {
    return NextResponse.json({ error: 'Username, password, and name are required' }, { status: 400 });
  }

  // Hard-scoped to TMS — a Technical Manager creating a user through this
  // endpoint can only create TMS roles in TMS departments, never a role/
  // department outside their remit.
  if (!TMS_ROLE_KEYS.includes(body.role)) {
    return NextResponse.json({ error: 'Role must be one of Technical Manager, Team Lead, Engineer, or Technician' }, { status: 400 });
  }
  if (!TMS_DEPARTMENTS.includes(body.department)) {
    return NextResponse.json({ error: 'Department must be one of Robotics, AI, AV, or Marketing' }, { status: 400 });
  }

  try {
    const created = await createUser({
      username,
      password,
      name,
      phone: typeof body.phone === 'string' ? body.phone.trim() : '',
      email: typeof body.email === 'string' ? body.email.trim() : '',
      role: body.role,
      employeeId: typeof body.employeeId === 'string' ? body.employeeId.trim() : '',
      department: body.department,
      designation: typeof body.designation === 'string' ? body.designation.trim() : '',
      location: typeof body.location === 'string' ? body.location.trim() : ''
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
