import { UserRole } from './types';
import { isModuleAccessAllowed } from './moduleConfigStore';
import { canAccessHrExpenseModule } from './hrExpenseAccess';

export const OFFICE_OPERATION_EXPENSES_MODULE_KEY = 'office-operation-expenses';

// Super Admin + Admin + named individuals — see lib/hrExpenseAccess.ts.
// Was ['hr', 'superadmin', 'admin'], which gave every HR account the whole
// register; access is now granted per person instead.
//
// The generic 'manager' role stays excluded even though its isPrivileged
// flag is true: that role covers every department's managers (Sales,
// Accounts, Technical, …) and this register is the HR/Admin department's
// own spend.
//
// Takes the username as well as the role — the session carries both, and a
// role alone can no longer answer the question.
export function roleCanAccessOfficeOperationExpenses(role: string, username?: string): boolean {
  return canAccessHrExpenseModule(OFFICE_OPERATION_EXPENSES_MODULE_KEY, { role, username });
}

// The real gate for every API route in this module: the role allow-list AND
// Module Manager's enabled/visibility config, so disabling the tile in Module
// Manager actually closes the API too and a non-HR role can't reach the data
// by hitting the URL directly.
export async function viewerCanAccessOfficeOperationExpenses(viewer: { role: UserRole; username?: string; isPrivileged: boolean; department?: string | null }): Promise<boolean> {
  if (!roleCanAccessOfficeOperationExpenses(viewer.role, viewer.username)) return false;
  return isModuleAccessAllowed(OFFICE_OPERATION_EXPENSES_MODULE_KEY, viewer);
}
