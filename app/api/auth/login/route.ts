import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from '@/lib/auth';
import { verifyLogin, recordLogin, findUserStatusById } from '@/lib/userStore';
import { logLoginAttempt } from '@/lib/loginHistoryStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { resolveIsPrivileged } from '@/lib/permissions';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  // Trimmed here, not just client-side — credentials copy-pasted from
  // WhatsApp/email/notes routinely carry a trailing space or stray
  // whitespace character invisible in the input box, which silently fails
  // the exact username lookup below even though the password is right.
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
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

    // partnerBinding is read here rather than taken from `user` because
    // UserRecord deliberately has no partner field: the binding is an access
    // -control fact, not profile data, and keeping it off the widely-passed
    // user shape means no screen can accidentally render or edit it.
    const [, , isPrivileged, partnerBinding] = await Promise.all([
      recordLogin(user.id),
      logLoginAttempt({ username, success: true, ip }),
      resolveIsPrivileged(user.role),
      findUserStatusById(user.id)
    ]);
    const token = await createSessionToken({
      id: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      isPrivileged,
      partnerId: partnerBinding?.partnerId
    });
    const response = NextResponse.json({
      ok: true,
      user: { name: user.name, phone: user.phone, email: user.email, role: user.role, username: user.username },
      // Lets the login screen send a partner straight to the portal instead
      // of bouncing off `/` and through proxy.ts's redirect. Purely a
      // navigation hint — it grants nothing, and the real gate runs on every
      // subsequent request regardless of what the client does with it.
      isPartner: !!partnerBinding?.partnerId
    });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
