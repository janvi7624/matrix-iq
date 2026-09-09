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
  'GeM',
  'Self / Existing Customer',
  'Website',
  'Other',
] as const;
