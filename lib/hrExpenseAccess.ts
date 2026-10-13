// Who may reach the three HR/Admin spend modules.
//
// These used to be role-gated to ['hr', 'superadmin', 'admin'], which gave
// every HR account all three. The requirement is narrower — named people
// per module, on top of the admin tier:
//
//   Office Operation Expenses  Hardik Acharya
//   Admin Expenses             Medha Dave, Hardik Acharya
//   HR Expense Report          Hardik Acharya
//
// A role list cannot express that: Medha needs Admin Expenses but not the
// other two, and another HR account needs none of them. So the grant is by
// username, in the same shape as lib/accountsPaymentAccess.ts — a role list
// for the tier that always qualifies, plus an explicit configured grant.
//
// Super Admin and Admin always qualify, by request ("by default admin
// account can also access things"). The 'hr' ROLE on its own no longer
// grants anything here — an HR account gets in only by being named below.

export const HR_EXPENSE_MODULE_KEYS = ['office-operation-expenses', 'admin-expenses', 'hr-reports'] as const;

export type HrExpenseModuleKey = (typeof HR_EXPENSE_MODULE_KEYS)[number];

// Deliberately NOT the generic isPrivileged flag: that is true for every
// 'manager' account (Sales, Accounts, Technical, …), and this is the
// HR/Admin department's own spend.
const ALWAYS_ALLOWED_ROLES = ['superadmin', 'admin'];

// Usernames, not display names — `medha` and `hardik.acharya` are the login
// usernames. Note the trap this guards against: the admin account `main`
// has the display name "test", so matching on anything but username would
// grant the wrong person.
export const HR_EXPENSE_USER_GRANTS: Record<HrExpenseModuleKey, string[]> = {
  'office-operation-expenses': ['hardik.acharya'],
  'admin-expenses': ['medha', 'hardik.acharya'],
  'hr-reports': ['hardik.acharya']
};

export function isHrExpenseModule(key: string): key is HrExpenseModuleKey {
  return (HR_EXPENSE_MODULE_KEYS as readonly string[]).includes(key);
}

// The single gate. Used by the tile list (so the nav matches reality), by
// isModuleAccessAllowed (so the APIs match the nav), and by each page's own
// guard (so typing the URL doesn't bypass either).
export function canAccessHrExpenseModule(key: HrExpenseModuleKey, viewer: { role: string; username?: string }): boolean {
  if (ALWAYS_ALLOWED_ROLES.includes(viewer.role)) return true;
  if (!viewer.username) return false;
  return HR_EXPENSE_USER_GRANTS[key].includes(viewer.username);
}
