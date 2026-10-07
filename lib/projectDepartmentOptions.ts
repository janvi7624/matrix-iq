// Which delivery department(s) a Sales project belongs to — AI, AV, Robotics,
// SI, or several at once — and how much of the project's value belongs to
// each.
//
// A fixed short list on purpose, same reasoning as lib/projectLeadOptions.ts:
// these are the technical departments a deal is actually delivered by, and
// their keys are the same ones lib/types.ts's DomainKey already uses for lead
// interests, site visits and quotations ('si' = System Integrator — see
// lib/leadInterestOptions.ts, where it is spelled out in full on the capture
// tile). Deliberately NOT a foreign key into the org-wide `departments`
// table, which also holds Sales, HR, Accounts and the rest.
//
// A 50L Adani deal split AI 27L / AV 23L is ONE project carrying both
// departments and both amounts — not two projects, and not one project whose
// value has to be guessed at per department. The split is what lets the
// Projects dashboard answer "what is AI's pipeline worth" (27L) and "what is
// the whole pipeline worth" (50L) from the same row.
//
// Pure/dependency-free so client components can import it directly.
// 'other' covers a delivery department outside the three fixed ones (e.g. a
// one-off SI/VisitIQ deal) — ticking it doesn't collect free text, same as
// the other three: this field is "whose pipeline does this count toward",
// not a place to name the department.
export const PROJECT_DEPARTMENTS = ['ai', 'av', 'robotics', 'other'] as const;
export type ProjectDepartment = (typeof PROJECT_DEPARTMENTS)[number];

// Short labels — these appear in a checkbox row, a filter dropdown, a column
// header ("SI Value") and a joined chip ("AI + SI"), none of which can carry
// an expansion. PROJECT_DEPARTMENT_FULL_LABEL below is for the one place
// there is room for it.
export const PROJECT_DEPARTMENT_LABEL: Record<ProjectDepartment, string> = {
  ai: 'AI',
  av: 'AV',
  robotics: 'Robotics',
  other: 'Other'
};

// Value per department, in rupees. Partial because a project that predates
// this field has none, and a single-department project needs no split.
export type DepartmentAmounts = Partial<Record<ProjectDepartment, number>>;

export function isProjectDepartment(value: unknown): value is ProjectDepartment {
  return typeof value === 'string' && (PROJECT_DEPARTMENTS as readonly string[]).includes(value);
}

// Server-side gate for a client-supplied list — the dropdown is a
// convenience, this is the actual rule. Unknown entries are dropped rather
// than rejected, duplicates collapse, and the result is ordered by
// PROJECT_DEPARTMENTS so "AI + AV" and "AV + AI" store identically.
export function parseProjectDepartments(value: unknown): ProjectDepartment[] {
  const candidates = Array.isArray(value) ? value : [value];
  const picked = new Set(candidates.filter(isProjectDepartment));
  return PROJECT_DEPARTMENTS.filter((d) => picked.has(d));
}

// Amounts are only ever kept for departments the project actually has, so the
// two can never drift into "AV is owed 23L on a project that isn't AV's".
// Anything unparseable, negative or zero is dropped rather than stored as 0,
// which would read as "this department's share is nil" instead of "not set".
export function parseDepartmentAmounts(value: unknown, departments: readonly ProjectDepartment[]): DepartmentAmounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: DepartmentAmounts = {};
  for (const department of departments) {
    const raw = source[department];
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(num) && num > 0) out[department] = num;
  }
  return out;
}

export function sumDepartmentAmounts(amounts: DepartmentAmounts | undefined | null): number {
  if (!amounts) return 0;
  return PROJECT_DEPARTMENTS.reduce((total, d) => total + (amounts[d] ?? 0), 0);
}

export function isMultiDepartment(list: readonly ProjectDepartment[] | undefined | null): boolean {
  return (list?.length ?? 0) > 1;
}

// Display string: "AI", or "AI + AV" for a project spanning several. '-' when
// nothing is set (every project created before this field existed).
export function formatProjectDepartments(list: readonly ProjectDepartment[] | undefined | null): string {
  if (!list || !list.length) return '-';
  return list.map((d) => PROJECT_DEPARTMENT_LABEL[d]).join(' + ');
}

export type ProjectDepartmentFilter = ProjectDepartment | '';

// A project matches a department filter when that department is one of its
// own — a 50L AI+AV deal IS AI work and must appear under the AI filter.
export function matchesDepartmentFilter(
  list: readonly ProjectDepartment[] | undefined | null,
  filter: ProjectDepartmentFilter
): boolean {
  if (!filter) return true;
  return (list ?? []).includes(filter);
}

// How much of a project's value to count, given the active department filter.
//
// Unfiltered, that is the project's own approx_price — the whole 50L. Filtered
// to AI, it is AI's share of it — 27L. This is the one function the dashboard's
// Total Value tile and the Approx. Price column both go through, so a filtered
// view can never show a total that disagrees with the rows making it up.
//
// Falls back to the full price when a project carries no split at all: a
// single-department project has nothing to divide, and one predating this
// field would otherwise silently drop out of its own department's total.
export function departmentValueOf(
  project: { approx_price: number | ''; departments?: readonly ProjectDepartment[]; department_amounts?: DepartmentAmounts },
  filter: ProjectDepartmentFilter
): number {
  const price = typeof project.approx_price === 'number' ? project.approx_price : 0;
  if (!filter) return price;
  if (!matchesDepartmentFilter(project.departments, filter)) return 0;
  const share = project.department_amounts?.[filter];
  if (typeof share === 'number') return share;
  // No split recorded: credit the whole price only when this department is
  // the project's sole one, otherwise we would count the full 50L under AI
  // AND again under AV.
  return (project.departments?.length ?? 0) > 1 ? 0 : price;
}
