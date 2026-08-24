import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { countSuperAdmins, deleteUser, findUserById, updateUser } from '@/lib/userStore';
import { listActiveRoles } from '@/lib/roleStore';
import { UserRole, UserStatus } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import { canViewRole } from '@/lib/permissions';

// Base auth + admin/superadmin gating happens in proxy.ts (matcher: /api/admin/:path*),
// including a blanket "DELETE under /api/admin requires superadmin" rule.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });

  try {
    const existing = await findUserById(id);
    if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    // Superadmin accounts are invisible to every other role — a generic
    // "not found" here, not a 403, so a non-superadmin can't even confirm
    // this id belongs to a superadmin account (see lib/permissions.ts's
    // canViewRole).
    if (!canViewRole(session.role, existing.role)) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const scope = await resolveVisibilityScope(session.username);
    if (!scope.seesOrgWide && !scope.scopedUserIds!.includes(id)) {
      return NextResponse.json({ error: 'Forbidden — outside your department' }, { status: 403 });
    }

    const activeRoles = await listActiveRoles();
    const role: UserRole | undefined = activeRoles.some((r) => r.key === body.role) ? body.role : undefined;
    const VALID_STATUSES: UserStatus[] = ['active', 'inactive'];
    const status: UserStatus | undefined = VALID_STATUSES.includes(body.status) ? body.status : undefined;

    // An "admin" (non-superadmin) must not be able to grant superadmin to
    // anyone — existing.role === 'superadmin' is already handled above.
    if (session.role !== 'superadmin' && role === 'superadmin') {
      return NextResponse.json({ error: 'Only a superadmin can grant the superadmin role' }, { status: 403 });
    }

    if (existing.role === 'superadmin' && role && role !== 'superadmin' && (await countSuperAdmins()) <= 1) {
      return NextResponse.json({ error: 'Cannot demote the last remaining superadmin' }, { status: 400 });
    }
    if (existing.role === 'superadmin' && status === 'inactive' && (await countSuperAdmins()) <= 1) {
      return NextResponse.json({ error: 'Cannot deactivate the last remaining superadmin' }, { status: 400 });
    }
    if (typeof body.password === 'string' && body.password && body.password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const updated = await updateUser(id, {
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      phone: typeof body.phone === 'string' ? body.phone.trim() : undefined,
      email: typeof body.email === 'string' ? body.email.trim() : undefined,
      employeeId: typeof body.employeeId === 'string' ? body.employeeId.trim() : undefined,
      department: typeof body.department === 'string' ? body.department.trim() : undefined,
      designation: typeof body.designation === 'string' ? body.designation.trim() : undefined,
      role,
      status,
      password: typeof body.password === 'string' && body.password ? body.password : undefined,
      passwordChangeInitiatedBy: 'admin'
    });

    return NextResponse.json(updated);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const existing = await findUserById(id);
    if (!existing) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    if (existing.role === 'superadmin' && (await countSuperAdmins()) <= 1) {
      return NextResponse.json({ error: 'Cannot delete the last remaining superadmin' }, { status: 400 });
    }

    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
