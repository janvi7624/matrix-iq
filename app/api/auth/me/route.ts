import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken, isSessionEpochCurrent } from '@/lib/auth';
import { findUserById, findUserStatusById } from '@/lib/userStore';
import { apiErrorResponse } from '@/lib/apiError';

export async function GET(request: NextRequest) {
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const user = await findUserById(session.sub);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Found missing in an attack pass: this route is the frontend's own
    // "am I still logged in" check, and previously never re-read anything
    // that a logout/password-change could have re-stamped — see
    // SessionPayload.sessionEpoch.
    const liveStatus = await findUserStatusById(session.sub);
    if (!liveStatus || !isSessionEpochCurrent(session, liveStatus.sessionEpoch)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      username: user.username,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      isPrivileged: session.isPrivileged ?? (user.role === 'manager' || user.role === 'admin' || user.role === 'superadmin'),
      department: user.department,
      designation: user.designation
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
