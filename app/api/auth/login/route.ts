import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from '@/lib/auth';
import { verifyLogin, recordLogin, findUserStatusById } from '@/lib/userStore';
import { logLoginAttempt, isLoginLocked } from '@/lib/loginHistoryStore';
import { getClientIp } from '@/lib/requestIp';
import { apiErrorResponse } from '@/lib/apiError';
import { resolveIsPrivileged } from '@/lib/permissions';
import { isConfiguredPartnerCreator } from '@/lib/partnerAccess';

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
    // Checked BEFORE touching the password at all, and rejected with the
    // exact same status/message as a wrong password below — an attacker
    // locked out can't tell that apart from simply guessing wrong again,
    // which is what keeps this from becoming a username-enumeration or
    // lockout-probing side channel.
    if (await isLoginLocked(username)) {
      await logLoginAttempt({ username, success: false, ip });
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    const user = await verifyLogin(username, password);
    if (!user) {
      await logLoginAttempt({ username, success: false, ip });
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // partnerBinding is read here rather than taken from `user` because
    // UserRecord deliberately has no partner field: the binding is an access
    // -control fact, not profile data, and keeping it off the widely-passed
    // user shape means no screen can accidentally render or edit it.
    // partnerBinding is read here rather than taken from `user` because
    // UserRecord deliberately has no partner field: the binding is an access
    // -control fact, not profile data, and keeping it off the widely-passed
    // user shape means no screen can accidentally render or edit it.
    const [loginTimestamp, , isPrivileged, partnerBinding, partnerCreator] = await Promise.all([
      recordLogin(user.id),
      logLoginAttempt({ username, success: true, ip }),
      resolveIsPrivileged(user.role),
      findUserStatusById(user.id),
      // Opens /admin/partners for the named sales staff who bring partners
      // in, without making them admins — see SessionPayload.partnerCreator.
      isConfiguredPartnerCreator(user.id)
    ]);
    const token = await createSessionToken({
      id: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      isPrivileged,
      partnerCreator,
      partnerId: partnerBinding?.partnerId,
      // The exact value recordLogin just wrote — see SessionPayload.sessionEpoch.
      // The fallback is unreachable in practice (verifyLogin just confirmed
      // this user row exists), kept only so the type stays a plain number.
      //
      // TODO(pending migration 20261105100000): this means a second login
      // currently invalidates the first login's session too — see the TODO
      // on lib/userStore.ts's touchSessionEpoch for why, and what to change
      // here once that migration is applied.
      sessionEpoch: loginTimestamp?.getTime() ?? Date.now()
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
