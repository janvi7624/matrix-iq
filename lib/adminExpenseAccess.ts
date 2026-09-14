import { NextRequest } from 'next/server';
import { getViewerContext } from '@/lib/viewerContext';
import { findUsersByIds, findUsersByDepartmentName } from '@/lib/userStore';
import { notifyUsers } from '@/lib/notificationStore';
import { sendAdminExpenseNoticeEmail } from '@/lib/email/notifications';

// Shared between app/api/admin-expenses/route.ts and .../[batchId]/approve/
// route.ts — a plain route.ts can only export HTTP method handlers, so
// anything reused across those two files has to live outside either of them.

export const ALLOWED_ROLES = new Set(['superadmin', 'admin', 'hr']);

// A batch created by anyone other than this specific person needs his
// sign-off before Accounts is told about it — a named-approver requirement,
// not a role (Hardik himself is `hr`, same role as several other people who
// are NOT exempt from this gate).
export const APPROVER_USERNAME = 'hardik.acharya';

export async function assertAdmin(request: NextRequest) {
  const viewer = await getViewerContext(request);
  if (!viewer) return null;
  if (!ALLOWED_ROLES.has(viewer.role)) return null;
  return viewer;
}

// Admin Expenses have no approval chain of their own otherwise — created
// directly, no manager/HR review, unlike a Reimbursement sheet which always
// passes through HR before payment. That means Accounts otherwise never
// hears money moved here, so this is their only notice — mirrors the
// Accounts fan-out added to app/api/reimbursement/sheet/[id]/hr-decide/
// route.ts for the HR-approved case, so the "which payments does Accounts
// get told about" behavior is consistent across both paths.
export async function notifyAccountsOfAdminExpense(opts: {
  action: 'created' | 'updated' | 'approved';
  addedByName: string;
  expenseType: string;
  totalAmount: number;
  resolvedDate: string;
  batchId: string;
  employeeIds: string[];
}): Promise<void> {
  const accountsUsers = await findUsersByDepartmentName('Accounts');
  if (!accountsUsers.length) return;

  const employees = await findUsersByIds(opts.employeeIds);
  const employeeNames = employees.map((e) => e.name || e.username);
  const totalStr = `₹${opts.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  const verb = opts.action === 'created' ? 'created' : opts.action === 'updated' ? 'updated' : 'approved';

  await notifyUsers(accountsUsers.map((u) => u.username), {
    title: `Company-paid expense ${verb}`,
    body: `${opts.expenseType} — ${totalStr} ${verb} by ${opts.addedByName}, split across ${opts.employeeIds.length} employee${opts.employeeIds.length === 1 ? '' : 's'}`,
    type: 'admin_expense_accounts_notice',
    entityType: 'admin_expense',
    entityId: opts.batchId,
  });

  await Promise.allSettled(
    accountsUsers.map((u) =>
      sendAdminExpenseNoticeEmail({
        email: u.email, name: u.name || u.username, action: opts.action === 'approved' ? 'created' : opts.action,
        expenseType: opts.expenseType, totalAmount: totalStr, employeeNames,
        addedBy: opts.addedByName, date: opts.resolvedDate,
      })
    )
  );
}

// A batch that isn't auto-approved (i.e. not created by APPROVER_USERNAME
// himself) is withheld from Accounts entirely until he approves it — so he's
// the only one told about it while it's pending.
export async function notifyApproverOfPendingExpense(opts: {
  addedByName: string;
  expenseType: string;
  totalAmount: number;
  batchId: string;
}): Promise<void> {
  await notifyUsers([APPROVER_USERNAME], {
    title: 'Expense awaiting your approval',
    body: `${opts.expenseType} — ₹${opts.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} added by ${opts.addedByName}, needs your approval before Accounts is notified`,
    type: 'admin_expense_approval_needed',
    entityType: 'admin_expense',
    entityId: opts.batchId,
  });
}
