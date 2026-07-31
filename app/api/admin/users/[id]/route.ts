import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { countSuperAdmins, deleteUser, findUserById, updateUser } from '@/lib/userStore';
import { UserRole } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

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

    const VALID_ROLES: UserRole[] = ['superadmin', 'admin', 'manager', 'technical', 'user'];
    const role: UserRole | undefined = VALID_ROLES.includes(body.role) ? body.role : undefined;

    // An "admin" (non-superadmin) may create/edit ordinary accounts but must not
    // be able to touch superadmin accounts or grant superadmin to anyone.
    if (session.role !== 'superadmin') {
      if (existing.role === 'superadmin') {
        return NextResponse.json({ error: 'Only a superadmin can edit a superadmin account' }, { status: 403 });
      }
      if (role === 'superadmin') {
        return NextResponse.json({ error: 'Only a superadmin can grant the superadmin role' }, { status: 403 });
      }
    }

    if (existing.role === 'superadmin' && role && role !== 'superadmin' && (await countSuperAdmins()) <= 1) {
      return NextResponse.json({ error: 'Cannot demote the last remaining superadmin' }, { status: 400 });
    }
    if (typeof body.password === 'string' && body.password && body.password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const updated = await updateUser(id, {
      name: typeof body.name === 'string' ? body.name.trim() : undefined,
      phone: typeof body.phone === 'string' ? body.phone.trim() : undefined,
      email: typeof body.email === 'string' ? body.email.trim() : undefined,
      role,
      password: typeof body.password === 'string' && body.password ? body.password : undefined
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
