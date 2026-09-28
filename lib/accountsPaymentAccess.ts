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
// The payment queue is for the Accounts team and the admins — NOT for every
// manager. `viewer.isPrivileged` used to be enough here, and that flag is true
// for the plain 'manager' role, so a Sales manager could read and act on the
// whole company's payment queue through this API even once the sidebar tile
// was hidden from them. Naming the roles explicitly is the fix: hiding a tile
// is presentation, this is the actual gate.
//
// The Accounts department's own manager (Department.managerIds['Accounts'])
// still qualifies regardless of role — that is a deliberate, configured
// grant rather than an accident of the privileged flag. Remove them from that
// department's managers if they should not have it.
const ACCOUNTS_PAYMENT_ROLES = ['accounts', 'superadmin', 'admin'];

export async function isAccountsPaymentActor(viewer: ViewerContext): Promise<boolean> {
  if (ACCOUNTS_PAYMENT_ROLES.includes(viewer.role)) return true;
  const accountsManagers = (await listDepartmentManagers())['Accounts'] || [];
  return accountsManagers.some((m) => m.username === viewer.username);
}
