import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, createSessionToken, getSessionFromRequest } from '@/lib/auth';
import { findUserById, updateUser } from '@/lib/userStore';
import { verifyPassword } from '@/lib/passwords';
import { apiErrorResponse } from '@/lib/apiError';
import { resolveIsPrivileged } from '@/lib/permissions';

// Self-service — works for any logged-in account, not only ones force-locked
// by mustChangePassword (see proxy.ts), so it doubles as a normal "change my
// password" action. Requires the current password so a hijacked session
// alone can't silently take over the account.
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Current and new password are required' }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 });
  }

  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });

    await updateUser(user.id, { password: newPassword, mustChangePassword: false, passwordChangeInitiatedBy: 'self' });

    const isPrivileged = await resolveIsPrivileged(user.role);
    const token = await createSessionToken({ id: user.id, username: user.username, role: user.role, mustChangePassword: false, isPrivileged });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 8 * 60 * 60
    });
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
