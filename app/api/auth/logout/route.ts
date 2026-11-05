import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, getSessionFromRequest } from '@/lib/auth';
import { touchSessionEpoch } from '@/lib/userStore';

export async function POST(request: NextRequest) {
  // Found missing in an attack pass: this previously only cleared the
  // client cookie — the exact same token, replayed directly after
  // "logout," kept authenticating successfully. Re-stamping the session
  // epoch here (see SessionPayload.sessionEpoch) kills it server-side too,
  // along with every other token issued for this account before now (this
  // app has no notion of one session among several — logging out signs
  // the account out everywhere, which is the accepted trade-off).
  //
  // Best-effort: the client must still get signed out of ITS OWN browser
  // (cookie cleared below) even if this DB write fails — a revocation
  // hiccup should never be the reason logout itself appears broken.
  try {
    const session = await getSessionFromRequest(request);
    if (session) await touchSessionEpoch(session.sub);
  } catch {
    // intentionally swallowed — see above
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
