// Where a lead CAME FROM — the campaign, event or channel that produced it.
//
// Deliberately separate from LeadRecord.source, which records how the lead
// got INTO MatrixIQ (a scanned business card, a CSV import, typed by hand,
// the Meta webhook). Those answer different questions: 300 cards scanned at
// one expo share a capture method but say nothing about which expo, and the
// same InfoComm lead might arrive by scan, by CSV or typed in later. Sales
// reports on the origin; the capture method stays as supporting detail.
//
// Pure data with no imports, so both the API routes and the client bundle can
// share one list instead of two copies that drift.

export type LeadOrigin =
  | ''
  | 'infocomm_2026'
  | 'google_leads'
  | 'meta_leads'
  | 'website'
  | 'meeting'
  | 'expo'
  | 'other';

export interface LeadOriginOption {
  value: Exclude<LeadOrigin, ''>;
  label: string;
}

// Order is the order shown in the picker and the filter row — the event
// currently driving the pipeline first, then the standing channels.
export const LEAD_ORIGIN_OPTIONS: LeadOriginOption[] = [
  { value: 'infocomm_2026', label: 'InfoComm 2026' },
  { value: 'google_leads', label: 'Google Leads' },
  { value: 'meta_leads', label: 'Meta Leads' },
  { value: 'website', label: 'Website' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'expo', label: 'Expo' },
  { value: 'other', label: 'Other' }
];

export const LEAD_ORIGIN_VALUES: Exclude<LeadOrigin, ''>[] = LEAD_ORIGIN_OPTIONS.map((o) => o.value);

// '' is what every lead captured before this field existed still holds. It is
// shown rather than hidden — "Not set" is a real state a sales manager needs
// to be able to find and clean up, not an absence to paper over.
export const LEAD_ORIGIN_UNSET_LABEL = 'Not set';

export function leadOriginLabel(value: string): string {
  if (!value) return LEAD_ORIGIN_UNSET_LABEL;
  return LEAD_ORIGIN_OPTIONS.find((o) => o.value === value)?.label || value;
}

export function isLeadOrigin(value: unknown): value is Exclude<LeadOrigin, ''> {
  return typeof value === 'string' && LEAD_ORIGIN_VALUES.includes(value as Exclude<LeadOrigin, ''>);
}
