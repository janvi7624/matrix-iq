import { NextRequest, NextResponse } from 'next/server';
import { getTmsViewer, requireTmsAction, TMS_DEPARTMENTS, TMS_ROLE_KEYS } from '@/lib/tmsAccess';
import { findUserById, updateUser } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getTmsViewer(request);
  if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await requireTmsAction(viewer, 'tms-users', 'edit'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findUserById(id);
    if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    // Can't reach an outside-scope account just by knowing its id, even to
    // edit it — the target must already be a TMS-department user.
    if (!TMS_DEPARTMENTS.includes(existing.department as (typeof TMS_DEPARTMENTS)[number])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (body.role !== undefined && !TMS_ROLE_KEYS.includes(body.role)) {
      return NextResponse.json({ error: 'Role must be one of Technical Manager, Team Lead, Engineer, or Technician' }, { status: 400 });
    }
    if (body.department !== undefined && !TMS_DEPARTMENTS.includes(body.department)) {
      return NextResponse.json({ error: 'Department must be one of Robotics, AI, AV, or Marketing' }, { status: 400 });
    }

    const updated = await updateUser(id, {
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      phone: typeof body.phone === 'string' ? body.phone.trim() : undefined,
      email: typeof body.email === 'string' ? body.email.trim() : undefined,
      role: body.role,
      employeeId: typeof body.employeeId === 'string' ? body.employeeId.trim() : undefined,
      department: body.department,
      designation: typeof body.designation === 'string' ? body.designation.trim() : undefined,
      location: typeof body.location === 'string' ? body.location.trim() : undefined,
      password: typeof body.password === 'string' && body.password ? body.password : undefined,
      passwordChangeInitiatedBy: 'admin',
      status: body.status === 'active' || body.status === 'inactive' ? body.status : undefined
    });
    if (!updated) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
