import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { resolveIsPrivileged } from '@/lib/permissions';

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout']);
// admin + superadmin only — plain 'user' accounts are blocked from all of these.
const ADMIN_ONLY_PREFIXES = ['/admin', '/quotation-history', '/api/admin'];

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

  const isAdminOnly = ADMIN_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  // Whether this role reaches /admin/* now comes from Role Management
  // (RoleRecord.isPrivileged) instead of a fixed 3-role blocklist, so a
  // brand-new admin-created role is correctly excluded by default and only
  // gets in if an admin explicitly marks it privileged.
  if (isAdminOnly && !(await resolveIsPrivileged(session.role))) {
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
