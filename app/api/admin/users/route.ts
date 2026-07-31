import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/auth';
import { createUser, findUserByUsername, listUsers } from '@/lib/userStore';
import { UserRole } from '@/lib/types';
import { apiErrorResponse } from '@/lib/apiError';

// Base auth + admin/superadmin gating happens in proxy.ts (matcher: /api/admin/:path*).
export async function GET() {
  try {
    const users = await listUsers();
    return NextResponse.json(users);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const VALID_ROLES: UserRole[] = ['superadmin', 'admin', 'manager', 'technical', 'user'];
  const requestedRole: UserRole = VALID_ROLES.includes(body?.role) ? body.role : 'user';

  // Only a superadmin may create another superadmin — an "admin" account
  // can create/edit users but must not be able to mint itself a superuser.
  if (requestedRole === 'superadmin' && session.role !== 'superadmin') {
    return NextResponse.json({ error: 'Only a superadmin can create a superadmin account' }, { status: 403 });
  }

  if (!username || !password || !name) {
    return NextResponse.json({ error: 'Username, password, and name are required' }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  try {
    if (await findUserByUsername(username)) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
    }

    const user = await createUser({ username, password, name, phone, email, role: requestedRole });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
