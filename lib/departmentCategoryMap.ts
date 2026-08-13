// Hardcoded best-fit mapping from a user's Department (see the seed names in
// lib/departmentStore.ts) to the module `section` string that should surface
// first/pre-expanded for them on the Sidebar/Dashboard. Not admin-editable —
// revisit if department-based permissions become a real feature. A
// department not listed here, or one that maps to a section the viewer's
// role can't actually see, simply results in no reordering/no pre-expansion.
export const DEPARTMENT_TO_SECTION: Record<string, string> = {
  Sales: 'Sales',
  Marketing: 'Marketing',
  Technical: 'Operations',
  'Back Office': 'Operations',
  Accounts: 'Administration',
  HR: 'Administration',
  Purchase: 'Administration',
  Inventory: 'Administration',
  Management: 'Administration',
  Administration: 'Administration'
};

export function primarySectionForDepartment(department: string | undefined | null): string | null {
  if (!department) return null;
  return DEPARTMENT_TO_SECTION[department] ?? null;
}
