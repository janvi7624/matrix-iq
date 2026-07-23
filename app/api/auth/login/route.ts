import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, createSessionToken } from '@/lib/auth';
import { verifyLogin } from '@/lib/userStore';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === 'string' ? body.username : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
  }

  const user = await verifyLogin(username, password);
  if (!user) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  const token = await createSessionToken(user);
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
}
