import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

// IMPORTANT — this file must never import anything that touches the database
// (Sequelize/lib/db.ts or anything built on it, directly or transitively).
// Next's Proxy (formerly "Middleware") gets its own separate build trace,
// and — confirmed by inspecting the actual .next build output on this
// project — outputFileTracingIncludes does not apply to it the way it does
// for regular routes: Sequelize's own dynamic `require('pg')` never gets
// picked up, so the deployed bundle silently ships without `pg`'s files and
// every request 500s with "Please install pg package manually", even though
// the exact same code works perfectly in every real API route (verified:
// those trace `pg` completely correctly). Next's own docs for this file
// agree: "you should not attempt relying on shared modules or globals" here.
// Anything that needs live DB state (module enable/disable, an account's
// current active/inactive status, a role's current isPrivileged flag) has to
// be resolved inside an actual route handler instead — see
// lib/viewerContext.ts's getViewerContext() for where the equivalent checks
// now live, and SessionPayload.isPrivileged (lib/auth.ts) for how this file
// gets a privilege check without a DB call: baked into the signed token at
// login/token-reissue time.

// /api/integrations/meta/webhook supplies its own authenticity check in
// place of session auth — Meta's GET verification handshake (hub.verify_token)
// and POST signature verification (X-Hub-Signature-256), see that route —
// since Meta's servers never carry a MatrixIQ session cookie.
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout', '/manifest.webmanifest', '/api/integrations/meta/webhook']);
// admin + superadmin only — plain 'user' accounts are blocked from all of these.
const ADMIN_ONLY_PREFIXES = ['/admin', '/quotation-history', '/api/admin'];
// Reachable even while a bulk-imported account is force-locked to changing
// its temporary password — see the mustChangePassword gate below.
const CHANGE_PASSWORD_ALLOWED_PATHS = new Set(['/change-password', '/api/auth/change-password', '/api/auth/me']);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const isApi = pathname.startsWith('/api/');
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    if (isApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // A bulk-imported account must change its temporary password before it can
  // do anything else — existing accounts never carry this claim (see
  // lib/userImportStore.ts / lib/auth.ts), so this never engages for them.
  if (session.mustChangePassword && !CHANGE_PASSWORD_ALLOWED_PATHS.has(pathname)) {
    if (isApi) return NextResponse.json({ error: 'Password change required' }, { status: 403 });
    return NextResponse.redirect(new URL('/change-password', request.url));
  }

  const isAdminOnly = ADMIN_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  // session.isPrivileged is computed once at login (see app/api/auth/login,
  // app/api/auth/change-password) from Role Management's live isPrivileged
  // flag and signed into the token — see the SessionPayload.isPrivileged
  // comment in lib/auth.ts for the staleness trade-off this accepts.
  if (isAdminOnly && !session.isPrivileged) {
    if (isApi) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.redirect(new URL('/', request.url));
  }

  // "admin"/"manager" can create/edit users and view quotation history, but never delete
  // anything — only "superadmin" can. Role-escalation checks (an admin trying
  // to create/promote a superadmin) are handled in the user routes themselves.
  if (request.method === 'DELETE' && pathname.startsWith('/api/admin/') && session.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden — superadmin only' }, { status: 403 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|map|txt|woff|woff2)$).*)']
};
