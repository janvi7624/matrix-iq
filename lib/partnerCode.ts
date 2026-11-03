// Which segment a partner's code gets, from its departments —
// PTR-AI-0002, PTR-ROB-0002, PTR-AV-0002, or PTR-ALL-0002 when it covers
// every TMS department. Same department vocabulary as
// lib/projectDepartmentOptions.ts's PROJECT_DEPARTMENTS ('ai' | 'av' |
// 'robotics' | 'other') — 'other' never affects the segment, since it names
// no real department to abbreviate.
//
// Pure and dependency-free so PartnerCreateView can preview the resulting
// code client-side without a round trip.
const TMS_DEPARTMENT_ABBR: Record<string, string> = { ai: 'AI', robotics: 'ROB', av: 'AV' };
const TMS_DEPARTMENT_KEYS = Object.keys(TMS_DEPARTMENT_ABBR);

/**
 * '' when the partner isn't tied to exactly one TMS department or all three
 * — e.g. no departments, only 'other', or two of the three picked without
 * the third. A '' segment falls back to the plain PTR-#### series (see
 * nextPartnerCode in lib/partnerStore.ts), rather than guessing.
 */
export function partnerCodeSegment(departments: readonly string[] | undefined | null): string {
  const present = new Set((departments || []).map((d) => d.toLowerCase()));
  const matched = TMS_DEPARTMENT_KEYS.filter((key) => present.has(key));
  if (matched.length === TMS_DEPARTMENT_KEYS.length) return 'ALL';
  if (matched.length === 1) return TMS_DEPARTMENT_ABBR[matched[0]];
  return '';
}

/** 'PTR-AI-' / 'PTR-ALL-' / 'PTR-' — the prefix nextPartnerCode numbers within. */
export function partnerCodePrefix(departments: readonly string[] | undefined | null): string {
  const segment = partnerCodeSegment(departments);
  return segment ? `PTR-${segment}-` : 'PTR-';
}
