import { UserRole } from './types';
import { isModuleAccessAllowed } from './moduleConfigStore';

export const OFFICE_OPERATION_EXPENSES_MODULE_KEY = 'office-operation-expenses';

// HR + Admin + Super Admin. This is NOT the same as "any privileged role":
// the generic 'manager' role is deliberately excluded even though its
// isPrivileged flag is true, because that role covers every department's
// managers (Sales, Accounts, Technical, ...) and this register is the
// HR/Admin department's own spend. moduleConfigStore.isModuleAccessAllowed
// special-cases this key so the isPrivileged bypass can't reopen it to them —
// see HR_RESTRICTED_KEYS there, same shape as the existing
// TMS_OVERSIGHT_ROLES restriction.
export const OFFICE_OPERATION_EXPENSES_ROLES: UserRole[] = ['hr', 'superadmin', 'admin'];

// Cheap synchronous check for the page-level guard (app/office-operation-
// expenses/page.tsx), which only has the session's role claim to work with.
export function roleCanAccessOfficeOperationExpenses(role: string): boolean {
  return OFFICE_OPERATION_EXPENSES_ROLES.includes(role);
}

// The real gate for every API route in this module: the role allow-list AND
// Module Manager's enabled/visibility config, so disabling the tile in Module
// Manager actually closes the API too and a non-HR role can't reach the data
// by hitting the URL directly.
export async function viewerCanAccessOfficeOperationExpenses(viewer: { role: UserRole; isPrivileged: boolean; department?: string | null }): Promise<boolean> {
  if (!roleCanAccessOfficeOperationExpenses(viewer.role)) return false;
  return isModuleAccessAllowed(OFFICE_OPERATION_EXPENSES_MODULE_KEY, viewer);
}
