// Fixed list for Project.source (still a free-text DB column — see
// lib/types.ts's ProjectRecord). Named individuals first (people who
// personally refer business), then channels, "Other" last as the escape
// hatch for anything not covered. Order is the dropdown's display order.
export const PROJECT_SOURCE_OPTIONS = [
  'Mayank Jani',
  'Pankaj Sharma',
  'Manoj Menon',
  'Referral',
  'Cold Call',
  'Expo',
  'Marketing',
  'Meta',
  'IndiaMART',
  // Renamed from plain 'GeM': the same channel covers open tenders that never
  // go through the GeM portal, and picking it now reveals the tender detail
  // fields (ref number, deadline, EMD, PBG, ...). Existing projects stored as
  // 'GeM' are migrated to this value by 20260929-project-intake-fields, so no
  // historical row falls through to "Other".
  'GeM / Tender',
  'Self / Existing Customer',
  'Website',
  'Other',
] as const;
