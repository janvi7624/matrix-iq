import { isTechnicalRole, SALES_DEPARTMENTS } from './technicalRoles';

// Which parts of a Performance Review are worth showing for the person being
// reviewed.
//
// The review aggregates every module, which meant an engineer's page led with
// "Quotations Created: 0 / Lost Leads: 0" and an HR person's was a wall of
// sales metrics they will never touch. Zeros on a performance page are not
// neutral — they read as underperformance. So the page now shows only the
// sections that person's work actually lands in.
//
// Pure/dependency-free on purpose (no db, no auth), so the page component and
// the API can both import it — same constraint lib/projectCompleteness.ts and
// lib/technicalRoles.ts are written under.
//
// This is presentation scope, NOT authorization. Who may open a review at all
// is decided by proxy.ts's /api/admin gate plus the department-scope check in
// app/api/admin/performance-review/[username]/route.ts. Hiding a section here
// never hides data from someone entitled to it — an oversight role still sees
// everything.

export const REVIEW_SECTIONS = [
  'crm',
  'sales',
  'projects',
  'siteVisits',
  'demo',
  'followUps',
  'dc',
  'customerResponse',
  'tms',
  'marketing',
  'tasks'
] as const;

export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

// Everything a sales person's week lands in: the lead they rang, the quotation
// they raised, the visit they made, the follow-up they owe.
const SALES_SECTIONS: ReviewSection[] = [
  'crm',
  'sales',
  'projects',
  'siteVisits',
  'demo',
  'followUps',
  'dc',
  'customerResponse',
  'tasks'
];

// A technical person is measured on delivery, not on pipeline: their TMS tasks
// and the projects they are assigned to. They can originate a quotation when
// needed (see isTechnicalRole's comment), but that is the exception and is not
// what their performance is judged on.
const TECHNICAL_SECTIONS: ReviewSection[] = ['tms', 'projects', 'tasks'];

const MARKETING_SECTIONS: ReviewSection[] = ['marketing', 'tasks'];

// HR carries no pipeline and no delivery queue of its own in this app, so the
// planner tasks assigned to them are the honest measure. Deliberately NOT
// given the sales block — that is the specific complaint this scoping fixes.
const HR_SECTIONS: ReviewSection[] = ['tasks'];

// The delivery departments behind TMS, plus the two non-TMS technical ones.
// 'R&D' is included because it exists in this install and is absent from
// lib/departmentCategoryMap.ts's DEPARTMENT_TO_SECTION — a gap that already
// leaves those users with no pre-expanded sidebar section.
const TECHNICAL_DEPARTMENTS = ['AI', 'AV', 'Robotics', 'R&D', 'Technical', 'Back Office'];

// Departments that oversee other people's work rather than carrying a queue of
// their own. They get the unabridged review, because narrowing it would hide
// the very numbers they are looking at it for.
const OVERSIGHT_DEPARTMENTS = ['Administration', 'Accounts', 'Management', 'Purchase', 'Inventory'];

function matches(department: string, list: string[]): boolean {
  const d = department.trim().toLowerCase();
  return list.some((name) => name.toLowerCase() === d);
}

// Mirrors isHrDepartmentName in lib/departmentStore.ts, which cannot be
// imported here — that module pulls in db. Same rule: anything starting "HR"
// ("HR", "HR & Admin", which is what this install actually calls it).
function isHrDepartment(department: string): boolean {
  return /^hr\b/i.test(department.trim());
}

/**
 * The sections to render for this person. Order follows REVIEW_SECTIONS so the
 * page reads the same way whoever is being looked at.
 */
export function reviewSectionsFor(user: { role?: string; department?: string | null }): ReviewSection[] {
  const department = (user.department || '').trim();
  const role = user.role || '';

  // No department recorded — 10 active users are in this state. Narrowing on a
  // blank field would silently blank most of the page, so these fall back to
  // the full review rather than to a guess.
  const everything = !department
    || matches(department, OVERSIGHT_DEPARTMENTS)
    || role === 'admin'
    || role === 'superadmin';

  let chosen: ReviewSection[];
  if (everything) chosen = [...REVIEW_SECTIONS];
  else if (matches(department, SALES_DEPARTMENTS)) chosen = SALES_SECTIONS;
  else if (matches(department, TECHNICAL_DEPARTMENTS) || isTechnicalRole(role)) chosen = TECHNICAL_SECTIONS;
  else if (isHrDepartment(department)) chosen = HR_SECTIONS;
  else if (matches(department, ['Marketing'])) chosen = MARKETING_SECTIONS;
  // A department nobody has mapped yet: show everything rather than an empty
  // page. A new department should fail loud and complete, not quiet and blank.
  else chosen = [...REVIEW_SECTIONS];

  const set = new Set(chosen);
  return REVIEW_SECTIONS.filter((s) => set.has(s));
}

/** Convenience for the page's conditional rendering. */
export function showsSection(user: { role?: string; department?: string | null }, section: ReviewSection): boolean {
  return reviewSectionsFor(user).includes(section);
}

// What the page prints above the metrics so nobody wonders why an engineer's
// review has no quotation count. An oversight/unmapped viewer gets no note,
// because nothing was narrowed.
export function reviewScopeNote(user: { role?: string; department?: string | null }): string {
  const sections = reviewSectionsFor(user);
  if (sections.length === REVIEW_SECTIONS.length) return '';
  const department = (user.department || '').trim();
  return `Showing the measures that apply to ${department || 'this role'} — other modules are hidden rather than shown as zero.`;
}
