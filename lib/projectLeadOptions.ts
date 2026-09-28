// Project Lead / Mentor — every Sales project must name one of these people.
// A fixed short list on purpose (same idea as lib/projectSourceOptions.ts's
// fixed Source dropdown), keyed by username because that's the stable identity
// — display names get edited, usernames don't. To add or swap a lead, change
// this list; the dropdown, the API validation and the "lead sees their led
// projects" visibility rule all read from it.
//
// Pure/dependency-free so client components can import it too; the lookup that
// turns these usernames into real user records lives in lib/projectLeadStore.ts.
export const PROJECT_LEAD_USERNAMES = ['manoj', 'pankaj'] as const;

export interface ProjectLeadOption {
  id: string;
  username: string;
  name: string;
}

// What kind of deal a project is. It only exists to pre-fill the Project Lead
// (below) — Distribution deals default to Manoj Menon, Project deals to Pankaj
// Sharma — but it's stored on the project and shown on the dashboard, since
// the lead can be changed afterwards and the type is what explains the default.
export const OPPORTUNITY_TYPES = ['distribution', 'project'] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const OPPORTUNITY_TYPE_LABEL: Record<OpportunityType, string> = {
  distribution: 'Distribution',
  project: 'Project'
};

export const DEFAULT_LEAD_USERNAME_BY_OPPORTUNITY: Record<OpportunityType, (typeof PROJECT_LEAD_USERNAMES)[number]> = {
  distribution: 'manoj',
  project: 'pankaj'
};

// Server-side gate for a client-supplied type — null for anything that isn't
// exactly one of the two values (blank included).
export function parseOpportunityType(value: unknown): OpportunityType | null {
  return typeof value === 'string' && (OPPORTUNITY_TYPES as readonly string[]).includes(value) ? (value as OpportunityType) : null;
}

export function defaultLeadIdFor(type: OpportunityType | '', leads: ProjectLeadOption[]): string {
  if (!type) return '';
  return leads.find((l) => l.username === DEFAULT_LEAD_USERNAME_BY_OPPORTUNITY[type])?.id ?? '';
}

// What the Project Lead dropdown should hold after the Opportunity Type
// changes. The default follows the type — but only while nobody has picked a
// lead by hand: once `leadTouched` (the person chose from the lead dropdown, or
// the project already had a lead saved), the lead is theirs and changing the
// type never moves it (e.g. keeping Manoj on a Project deal). Comparing against
// the previous type's default instead can't work — a hand-picked Manoj looks
// exactly like Distribution's untouched default.
export function nextLeadOnTypeChange(currentLeadId: string, leadTouched: boolean, nextType: OpportunityType | '', leads: ProjectLeadOption[]): string {
  if (currentLeadId && leadTouched) return currentLeadId;
  return defaultLeadIdFor(nextType, leads);
}
