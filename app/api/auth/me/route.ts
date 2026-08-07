import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    return NextResponse.json({
      username: user.username,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      department: user.department,
      designation: user.designation
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
