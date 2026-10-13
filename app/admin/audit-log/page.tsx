import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { canViewAuditLog } from '@/lib/permissions';
import AuditLogView from '@/components/AuditLogView';
import AccessDenied from '@/components/AccessDenied';

// Audit Log is Super Admin + Admin. Everything else under /admin/* just
// needs proxy.ts's blanket privileged check, which 'manager' also passes —
// this page is tightened past that, so it needs its own check.
//
// The role list lives in lib/permissions.ts and is shared with
// app/api/admin/audit-log/route.ts, so the page and its API can never
// disagree about who may read the trail.
export default async function AuditLogPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  // Rendered, not redirected. A silent bounce to the dashboard is
  // indistinguishable from a broken link — which is exactly how this page
  // looked "not to open" at all for an admin.
  if (!canViewAuditLog(user.role)) {
    return (
      <AccessDenied
        title="Audit Log is restricted"
        message="Only Super Admin and Admin accounts can read the audit trail. Ask a Super Admin if you need access."
      />
    );
  }

  return <AuditLogView />;
}
