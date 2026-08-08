import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { resolveIsPrivileged } from '@/lib/permissions';
import { isModuleAccessAllowed } from '@/lib/moduleConfigStore';
import { findUserById } from '@/lib/userStore';

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout']);
// admin + superadmin only — plain 'user' accounts are blocked from all of these.
const ADMIN_ONLY_PREFIXES = ['/admin', '/quotation-history', '/api/admin'];
// Reachable even while a bulk-imported account is force-locked to changing
// its temporary password — see the mustChangePassword gate below.
const CHANGE_PASSWORD_ALLOWED_PATHS = new Set(['/change-password', '/api/auth/change-password', '/api/auth/me']);

// Module Manager's enable/disable/visibleToRoles for a BUILT-IN (non-custom,
// non-admin-area) module used to be enforced only by hiding the sidebar
// tile — a disabled module's page and API were still fully reachable by
// direct URL. This maps each such module's key to the path prefixes it
// actually controls, so proxy.ts can enforce it the same way
// getModuleForViewer() already does for custom modules. Admin-area modules
// (user-management, role-management, etc.) aren't listed here — they're
// already fully gated by ADMIN_ONLY_PREFIXES above. 'quotation'/'my-quotations'
// only gate their pages, not /api/quotations, since that one API prefix is
// genuinely shared between both modules (create vs. list/manage) — an
// unambiguous per-module split isn't possible without an API restructure.
const BUILTIN_MODULE_GATES: { key: string; prefixes: string[] }[] = [
  { key: 'projects', prefixes: ['/projects', '/api/projects'] },
  { key: 'quotation', prefixes: ['/quotation'] },
  { key: 'my-quotations', prefixes: ['/my-quotations'] },
  { key: 'site-visits', prefixes: ['/site-visits', '/api/site-visits'] },
  { key: 'leads', prefixes: ['/leads', '/api/leads'] },
  { key: 'demo-schedule', prefixes: ['/demo-schedule', '/api/demo-schedule'] },
  { key: 'travel-schedule', prefixes: ['/travel-schedule', '/api/travel-schedule'] },
  { key: 'backoffice', prefixes: ['/backoffice', '/api/delivery-challans'] },
  { key: 'marketing-requests', prefixes: ['/marketing-requests', '/api/marketing-requests'] }
];

function matchBuiltinModule(pathname: string): string | null {
  for (const gate of BUILTIN_MODULE_GATES) {
    if (gate.prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return gate.key;
  }
  return null;
}

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

  // The session token itself is just a signed claim (sub/username/role) with
  // no server-side revocation — verifySessionToken above only checks the
  // signature and expiry, not whether the account behind it still exists or
  // is still active. Without this check, deleting or deactivating a user
  // would only block their *next login*; an already-issued token would keep
  // working exactly as before for up to its full 8-hour lifetime — Deactivate
  // wouldn't actually cut off a currently-logged-in user. Same DB round trip
  // cost class as resolveIsPrivileged() below, so this doesn't change the
  // route's performance profile.
  const currentUser = await findUserById(session.sub);
  if (!currentUser || currentUser.status === 'inactive') {
    if (isApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return response;
  }

  // A bulk-imported account must change its temporary password before it can
  // do anything else — existing accounts never carry this claim (see
  // lib/userImportStore.ts / lib/auth.ts), so this never engages for them.
  if (session.mustChangePassword && !CHANGE_PASSWORD_ALLOWED_PATHS.has(pathname)) {
    if (isApi) return NextResponse.json({ error: 'Password change required' }, { status: 403 });
    return NextResponse.redirect(new URL('/change-password', request.url));
  }

  const moduleKey = matchBuiltinModule(pathname);
  if (moduleKey && !(await isModuleAccessAllowed(moduleKey, { role: session.role, isPrivileged: await resolveIsPrivileged(session.role) }))) {
    if (isApi) return NextResponse.json({ error: 'Forbidden — this module is disabled or not available to your role' }, { status: 403 });
    return NextResponse.redirect(new URL('/', request.url));
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
