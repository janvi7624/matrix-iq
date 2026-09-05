import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';
import { findUserById } from '@/lib/userStore';
import { resolveIsPrivileged } from '@/lib/permissions';
import { listDepartmentManagers } from '@/lib/departmentStore';
import ReimbursementView from '@/components/ReimbursementView';

export default async function ReimbursementPage() {
  const cookieStore = await cookies();
  const session = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value);
  if (!session) redirect('/login');

  const user = await findUserById(session.sub);
  if (!user) redirect('/login');

  const isPrivileged = await resolveIsPrivileged(user.role);

  // Eligible to see the Pending/Approved review tabs — admin/superadmin, or
  // a manager of any department (incl. HR/Accounts). Mirrors the exact
  // eligibility check GET /api/reimbursement/sheet/pending already applies
  // server-side, so a plain department manager (not "privileged") still
  // sees the tabs their own sheets are already correctly routed into.
  const allManagers = await listDepartmentManagers();
  const isDeptManager = Object.values(allManagers).some((managers) => managers.some((m) => m.username === user.username));
  const isReviewer = isPrivileged || isDeptManager;

  return <ReimbursementView currentUser={{ username: user.username, role: user.role, isPrivileged, isReviewer }} />;
}
