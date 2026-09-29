// Which delivery department(s) a Sales project belongs to — AI, AV or
// Robotics. A fixed short list on purpose, same reasoning as
// lib/projectLeadOptions.ts: these are the three technical departments a deal
// is actually delivered by, and they are the same three lib/domainLeads.ts
// already routes demo requests to (DOMAIN_DEPARTMENT there maps av/robotics/ai
// onto the real Department rows).
//
// Deliberately NOT a foreign key into the org-wide `departments` table: that
// one also holds Sales, HR, Accounts, Purchase and the rest, none of which a
// project can belong to, and it is administered independently (a Super Admin
// renaming or deactivating "HR" must never affect what a deal is for).
//
// Stored as an ARRAY (projects.departments, JSONB) rather than a single
// column, so a deal spanning two departments stays one project with both
// rather than a duplicate row per department. "Combined" is not a stored
// value — it is simply a selection of length > 1, which is why filtering and
// display both derive it instead of trusting a separate flag that could drift
// out of step with the list.
//
// Pure/dependency-free so client components can import it directly.
export const PROJECT_DEPARTMENTS = ['ai', 'av', 'robotics'] as const;
export type ProjectDepartment = (typeof PROJECT_DEPARTMENTS)[number];

export const PROJECT_DEPARTMENT_LABEL: Record<ProjectDepartment, string> = {
  ai: 'AI',
  av: 'AV',
  robotics: 'Robotics'
};

// What the picker is currently showing: one department, "Combined" (two or
// three), or nothing chosen yet.
export type ProjectDepartmentMode = ProjectDepartment | 'combined' | '';

export const COMBINED_VALUE = 'combined';

export function isProjectDepartment(value: unknown): value is ProjectDepartment {
  return typeof value === 'string' && (PROJECT_DEPARTMENTS as readonly string[]).includes(value);
}

// Server-side gate for a client-supplied list — the dropdown is a
// convenience, this is the actual rule. Unknown entries are dropped rather
// than rejected outright, duplicates collapse, and the result is ordered by
// PROJECT_DEPARTMENTS so "AI + AV" and "AV + AI" store identically and
// compare equal everywhere downstream.
export function parseProjectDepartments(value: unknown): ProjectDepartment[] {
  if (!Array.isArray(value)) return [];
  const picked = new Set(value.filter(isProjectDepartment));
  return PROJECT_DEPARTMENTS.filter((d) => picked.has(d));
}

// Two or more departments on one deal.
export function isCombinedDepartments(list: readonly ProjectDepartment[]): boolean {
  return list.length > 1;
}

// Display string for a project's departments: "AI", or "AI + Robotics" for a
// combined one. '-' when nothing is set (every project created before this
// field existed).
export function formatProjectDepartments(list: readonly ProjectDepartment[] | undefined | null): string {
  if (!list || !list.length) return '-';
  return list.map((d) => PROJECT_DEPARTMENT_LABEL[d]).join(' + ');
}

// What the picker should show for an already-saved project.
export function departmentModeFor(list: readonly ProjectDepartment[] | undefined | null): ProjectDepartmentMode {
  if (!list || !list.length) return '';
  if (list.length > 1) return COMBINED_VALUE;
  return list[0];
}

// The Projects dashboard filter. Picking a single department shows every deal
// that department works on — including combined ones, since a combined AI+AV
// deal genuinely IS AI work and hiding it from the AI filter would under-count
// that department. 'combined' narrows to the multi-department deals only.
export type ProjectDepartmentFilter = ProjectDepartment | 'combined' | '';

export function matchesDepartmentFilter(
  list: readonly ProjectDepartment[] | undefined | null,
  filter: ProjectDepartmentFilter
): boolean {
  if (!filter) return true;
  const departments = list ?? [];
  if (filter === COMBINED_VALUE) return isCombinedDepartments(departments);
  return departments.includes(filter);
}
