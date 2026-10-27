// The "Other / Unallocated" bucket for admin expenses.
//
// Some admin costs genuinely belong to nobody — a courier fee, a stall
// rental, a shared booking with no beneficiary. The form used to insist on
// at least one employee, so those costs were either pinned to whoever
// happened to be picked or not recorded at all.
//
// Such a row carries created_by = NULL. This module is the one place that
// names it, so the expense list, the HR expense report and the Accounts
// payment queue all call it the same thing instead of each falling back to
// its own 'Unknown' or ''.

/** The sentinel the browser sends in place of an employee id. */
export const UNALLOCATED_EMPLOYEE_ID = '__unallocated__';

/** What a reader sees wherever the employee would normally be named. */
export const UNALLOCATED_LABEL = 'Other / Unallocated';

export function isUnallocatedSelection(ids: unknown): boolean {
  return Array.isArray(ids) && ids.length === 1 && ids[0] === UNALLOCATED_EMPLOYEE_ID;
}

/**
 * Name the payee of an admin-expense row.
 *
 * An admin row with no creator is unallocated BY DESIGN and says so. Any
 * other missing creator is a genuine data problem and still reads as
 * 'Unknown', so the two are never confused.
 */
export function payeeName(creatorName: string, isAdminEntry: boolean, createdBy: string | null | undefined): string {
  if (creatorName) return creatorName;
  if (isAdminEntry && !createdBy) return UNALLOCATED_LABEL;
  return 'Unknown';
}
