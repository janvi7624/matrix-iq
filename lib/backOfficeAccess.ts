import { UserRole } from './types';
import { listDepartmentManagers } from './departmentStore';

// Delivery Challan actions are deliberately gated on role === 'backoffice'
// only (see app/api/delivery-challans/route.ts and [id]/route.ts,
// components/BackOfficeView.tsx) — NOT the app's usual isPrivileged check —
// so an unrelated manager (e.g. a Sales manager) can't reach into Back
// Office operations just for holding the 'manager' role. But that also shut
// out the Back Office department's own configured manager (e.g. Pragnesh
// Trivedi, a 'manager'-role user set as Back Office's manager in Department
// Master) even though they head that team. Same shape as
// isAccountsPaymentActor for Accounts — additive only, nobody who could
// already act loses access.
export async function isBackOfficeActor(viewer: { role: UserRole; username: string }): Promise<boolean> {
  if (viewer.role === 'backoffice' || viewer.role === 'admin' || viewer.role === 'superadmin') return true;
  const backOfficeManagers = (await listDepartmentManagers())['Back Office'] || [];
  return backOfficeManagers.some((m) => m.username === viewer.username);
}
