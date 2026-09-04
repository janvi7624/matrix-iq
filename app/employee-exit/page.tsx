import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveVisibilityScope } from '@/lib/departmentScope';
import EmployeeExitView from '@/components/EmployeeExitView';

// A general department-manager action (not Sales-specific) — anyone who
// manages at least one department, or sees org-wide, can exit/reassign
// their own team's people. Mirrors the same resolveVisibilityScope gate the
// API routes under /api/employee-exit/* enforce.
export default async function EmployeeExitPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const scope = await resolveVisibilityScope(user.username);
  if (!scope.seesOrgWide && (scope.scopedUserIds ?? []).length <= 1) redirect('/');

  return <EmployeeExitView />;
}
