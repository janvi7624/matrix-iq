// What a partner actually changed when they revised a submission.
//
// A revision that only says "updated" is useless to the reviewer who asked
// for it: they have to re-read the whole form to find the one field that
// moved. This turns the before/after pair into a short list of named
// changes, which goes into the conversation thread so BOTH sides see the
// same account of what happened.
//
// Pure, no Sequelize — the store calls it inside the transaction and the
// tests call it directly.

import { PARTNER_SUBMITTABLE_FIELDS } from './partnerVisibility';

/** Form labels, mirroring the partner submission form field for field. */
export const PARTNER_FIELD_LABEL: Record<string, string> = {
  project_name: 'Project name',
  client_name: 'Client representative name',
  company: 'Company',
  contact_person: 'Contact person',
  alt_contact_phone: 'Alternate phone',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  city: 'City',
  state: 'State',
  opportunity_type: 'Opportunity type',
  departments: 'Departments',
  priority: 'Priority',
  expected_closing_date: 'Expected closing date',
  remarks: 'Description',
  partner_submitted_value: 'Estimated value',
  partner_expected_timeline: 'Expected timeline',
  attachments: 'Attachments'
};

export interface SubmissionChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

/**
 * Render one stored value as the short string a person reads in the log.
 *
 * Everything collapses to a string on purpose: the log is prose, not a data
 * structure, and an array or a number rendered inconsistently between the
 * two sides would be the same drift this module exists to prevent.
 */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'number') return value.toLocaleString('en-IN');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  return text || '—';
}

/** Two values are "the same" if they read the same — '' and null both mean empty. */
function sameValue(a: unknown, b: unknown): boolean {
  return displayValue(a) === displayValue(b);
}

/**
 * The named changes between two versions of a submission.
 *
 * Only PARTNER_SUBMITTABLE_FIELDS are compared. That is not merely a tidy
 * default: it is the same allow-list the write path enforces, so a field a
 * partner cannot change can never appear in the log claiming they did.
 */
export function summariseSubmissionChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>
): SubmissionChange[] {
  const changes: SubmissionChange[] = [];
  for (const field of PARTNER_SUBMITTABLE_FIELDS) {
    // A field the revision did not mention is not a change to blank — it is
    // simply absent. Treating undefined as "cleared" would log a wipe every
    // time the form posted a subset.
    if (!(field in after)) continue;
    if (sameValue(before[field], after[field])) continue;
    changes.push({
      field,
      label: PARTNER_FIELD_LABEL[field] ?? field,
      from: displayValue(before[field]),
      to: displayValue(after[field])
    });
  }
  return changes;
}

/**
 * The change list as the single block of text stored on the note.
 *
 * One string rather than a structured column because the thread renders
 * plain text, and because a revision log is read, not queried. Capped so a
 * partner pasting an essay into Description cannot produce a note nobody
 * can scroll past; the full value is on the project either way.
 */
export function formatChangeSummary(changes: SubmissionChange[]): string {
  if (!changes.length) return '';
  const MAX = 120;
  const clip = (text: string) => (text.length > MAX ? `${text.slice(0, MAX)}…` : text);
  return changes.map((c) => `${c.label}: ${clip(c.from)} → ${clip(c.to)}`).join('\n');
}
