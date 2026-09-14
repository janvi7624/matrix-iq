import { ViewerContext } from './viewerContext';
import { listDepartmentManagers } from './departmentStore';

// The single gate for the Accounts Payment Queue and for every existing
// "Accounts completes a payment" action it now also broadens
// (reimbursement accounts-complete, BOM mark-payment, travel
// complete-booking). Before this, all three were gated purely on
// Department.managerIds['Accounts'] — which today only contains Pragnesh
// Trivedi (a 'manager'-role user configured as the department's manager),
// NOT Vaishali Jagani or Naresh Prajapati (role 'accounts', the actual
// Accounts team this workspace is for). Adding the role check here is
// additive — nobody who could already act loses access, and it doesn't
// touch Department.managerIds itself, so anything else keyed off that field
// elsewhere in the app is unaffected.
export async function isAccountsPaymentActor(viewer: ViewerContext): Promise<boolean> {
  if (viewer.isPrivileged || viewer.role === 'accounts') return true;
  const accountsManagers = (await listDepartmentManagers())['Accounts'] || [];
  return accountsManagers.some((m) => m.username === viewer.username);
}
