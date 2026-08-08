import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, createSessionToken } from '@/lib/auth';
import { verifyLogin, recordLogin } from '@/lib/userStore';
import { logLoginAttempt } from '@/lib/loginHistoryStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const ip = getClientIp(request);

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
  }

  try {
    const user = await verifyLogin(username, password);
    if (!user) {
      await logLoginAttempt({ username, success: false, ip });
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    await Promise.all([recordLogin(user.id), logLoginAttempt({ username, success: true, ip })]);
    const token = await createSessionToken({ id: user.id, username: user.username, role: user.role, mustChangePassword: user.mustChangePassword });
    const response = NextResponse.json({
      ok: true,
      user: { name: user.name, phone: user.phone, email: user.email, role: user.role, username: user.username }
    });
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
