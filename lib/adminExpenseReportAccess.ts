// Zero-dependency (no server-only imports) so this same constant is safe to
// import from both API routes/server pages AND client components like
// Sidebar.tsx — avoids the drift risk of copy-pasting the literal username
// in multiple places (see the "must match APPROVER_USERNAME" comment
// components/AdminExpensesView.tsx already had to add for that exact reason).
//
// Deliberately a SEPARATE constant from lib/adminExpenseAccess.ts's
// APPROVER_USERNAME even though both currently name Hardik Acharya — "who
// approves an Admin Expense batch" and "who can view the Admin Expense
// Report" are two different authorities that happen to be the same person
// today, not one rule. Keeping them independent means one can change later
// without silently changing the other.
export const REPORT_VIEWER_USERNAME = 'hardik.acharya';
