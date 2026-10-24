// Fixed list for Lead.reference — who personally referred this lead, when it
// was one of these three rather than a cold capture. Same idea as
// lib/projectSourceOptions.ts's named individuals (the same three people, for
// the same reason: they personally refer business), kept as its own short
// list rather than reusing that one — Lead and Project are different records
// with different "who gets listed here" questions, and a list that happens to
// match today is not a reason to couple them.
//
// Optional: most leads have no particular internal reference, so '' (no
// selection) is always valid and is not included in this list.
export const LEAD_REFERENCE_OPTIONS = ['Mayank Jani', 'Manoj Menon', 'Pankaj Sharma'] as const;

export type LeadReference = (typeof LEAD_REFERENCE_OPTIONS)[number] | '';

export function isLeadReference(value: unknown): value is LeadReference {
  return value === '' || (typeof value === 'string' && (LEAD_REFERENCE_OPTIONS as readonly string[]).includes(value));
}
