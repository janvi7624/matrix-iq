import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_IDLE_MS, createSessionToken, sessionCookieOptions, verifySessionToken } from '@/lib/auth';
import { apiErrorResponse } from '@/lib/apiError';

// Renews the signed session for another SESSION_IDLE_MS. The client calls this
// only after real interaction (components/SessionTimeoutWatcher.tsx), which is
// what makes the idle timeout mean "nobody is using this" rather than "no
// requests were made" — the notification bell polls in the background every
// 60s and would otherwise keep an abandoned screen signed in indefinitely.
//
// It can only ever extend a session that is still valid: an expired token
// fails verification here exactly as it does anywhere else, so this is not a
// way back in after being timed out.
export async function POST(request: NextRequest) {
  try {
    const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Re-signed from the existing claims only. Nothing here re-reads the user,
    // so a heartbeat can never widen what the session is allowed to do — role
    // and privilege changes still take effect on the next real login, the same
    // staleness trade-off the token already documents.
    const token = await createSessionToken({
      id: session.sub,
      username: session.username,
      role: session.role,
      mustChangePassword: session.mustChangePassword,
      isPrivileged: session.isPrivileged
    });

    const response = NextResponse.json({ ok: true, expiresInMs: SESSION_IDLE_MS });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    return apiErrorResponse(error);
  }
}
