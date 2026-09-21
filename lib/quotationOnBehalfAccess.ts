// Zero-dependency (no server-only imports) so this is safe to import from
// both API routes AND client components (components/QuotationCalculator.tsx
// needs it to decide whether to show the team-member picker at all) —
// same reasoning as lib/adminExpenseReportAccess.ts's REPORT_VIEWER_*
// constants. There's no per-user permission-grant mechanism in this app's
// RBAC (role/department visibility only — see lib/moduleConfigStore.ts), so
// a named-user allowlist is this codebase's established pattern for "grant
// this to specific people" (see also lib/adminExpenseAccess.ts's
// APPROVER_USERNAME).
export const ON_BEHALF_USERNAMES = ['khushi.panchal', 'maulik.hirpara'];

export function canActOnBehalf(username: string): boolean {
  return ON_BEHALF_USERNAMES.includes(username);
}
