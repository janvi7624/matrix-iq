// Who may reach the /admin area, as a pure decision.
//
// Lives here rather than inline in proxy.ts so the rule can be tested
// directly. proxy.ts runs in the middleware runtime and cannot load
// Sequelize, so this module must stay free of db/fs imports — it is string
// and boolean logic only.

/** The prefixes proxy.ts treats as admin-only. */
export const ADMIN_ONLY_PREFIXES = ['/admin', '/quotation-history', '/api/admin'] as const;

/**
 * Partner Management — the one /admin area a non-privileged account can
 * reach, and only with the partnerCreator claim.
 *
 * The sales people who bring partners in sit on the generic 'user' role.
 * Making them admins so they can run their own partners would also hand them
 * User Management, Role Management and every other /admin screen, so the
 * exemption is exactly these two subtrees and nothing else.
 */
export function isPartnerAdminArea(pathname: string): boolean {
  return (
    pathname === '/admin/partners' ||
    pathname.startsWith('/admin/partners/') ||
    pathname === '/api/admin/partners' ||
    pathname.startsWith('/api/admin/partners/')
  );
}

const USER_ID_PATH = /^\/api\/admin\/users\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The slice of User Management a department head (departmentHead claim, any
 * role) may reach: the Users screen, listing/creating users, editing one user,
 * and READING the role list for the dropdown. Nothing else under /admin —
 * not bulk import, not resend-welcome-email, not roles/departments writes.
 * The user routes themselves confine every action to the departments the
 * person manages and to non-admin roles (lib/userAdminScope.ts).
 */
export function isDepartmentHeadUserArea(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  if (pathname === '/admin/users') return m === 'GET' || m === 'HEAD';
  if (pathname === '/api/admin/users') return m === 'GET' || m === 'POST';
  if (USER_ID_PATH.test(pathname)) return m === 'PATCH';
  if (pathname === '/api/admin/roles') return m === 'GET';
  return false;
}

export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * May this session reach `pathname`, as far as the admin-area gate is
 * concerned?
 *
 * Only answers the admin-area question. Every other proxy rule — the
 * partner route lock, the force-password-change lock, the superadmin-only
 * DELETE — is applied separately, and the handlers themselves re-check with
 * canCreatePartner/canReviewPartnerDocuments rather than trusting this claim.
 */
export function mayReachAdminArea(
  pathname: string,
  session: { isPrivileged?: boolean; partnerCreator?: boolean; departmentHead?: boolean },
  method = 'GET'
): boolean {
  if (!isAdminOnlyPath(pathname)) return true;
  if (session.isPrivileged) return true;
  if (session.partnerCreator && isPartnerAdminArea(pathname)) return true;
  return !!session.departmentHead && isDepartmentHeadUserArea(pathname, method);
}
