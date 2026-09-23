import { TMS_ROLE_KEYS } from './tmsConstants';

// Plain constants/helpers only — safe to import from client components (no
// db/auth imports; see lib/tmsConstants.ts for why that matters).

// The departments a project's sales owner comes from. Same pair the lead
// assignment rules use (lib/permissions.ts, app/api/leads/assignees).
export const SALES_DEPARTMENTS = ['Sales', 'GEM - Sales'];

// Technical staff (engineer, technical-manager, team-lead, technician). When
// needed they may originate Sales work — create a Sales project or a
// quotation — and hand the project to a sales person, who then owns it.
export function isTechnicalRole(role: string): boolean {
  return (TMS_ROLE_KEYS as readonly string[]).includes(role);
}
