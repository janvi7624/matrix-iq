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

// Report access, in full: Hardik (named individual, above) OR either of
// these roles OR anyone in this department (by department NAME, not role —
// e.g. a Sales person who happens to sit in the Administration department
// still gets it, an admin-role person in a different department gets it too
// via the role check). Widen here, not at each of the four call sites
// (report API, export API, page, sidebar) that all key off these.
export const REPORT_VIEWER_ROLES = ['admin', 'superadmin'];
export const REPORT_VIEWER_DEPARTMENT = 'Administration';
