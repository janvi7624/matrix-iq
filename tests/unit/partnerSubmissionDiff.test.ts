import { describe, it, expect } from 'vitest';
import {
  PARTNER_FIELD_LABEL,
  displayValue,
  formatChangeSummary,
  summariseSubmissionChanges
} from '../../lib/partnerSubmissionDiff';
import { PARTNER_SUBMITTABLE_FIELDS } from '../../lib/partnerVisibility';

describe('displayValue', () => {
  it('renders empty things as one consistent dash', () => {
    // Consistency matters more than the character: the two sides render the
    // same string, so a value that read '' on one and '—' on the other would
    // look like a change that never happened.
    for (const empty of ['', null, undefined, []]) {
      expect(displayValue(empty)).toBe('—');
    }
  });

  it('joins lists and formats numbers the way the form shows them', () => {
    expect(displayValue(['Robotics', 'AI'])).toBe('Robotics, AI');
    expect(displayValue(250000)).toBe('2,50,000');
  });

  it('trims so whitespace-only edits are not reported as changes', () => {
    expect(displayValue('  Acme  ')).toBe('Acme');
    expect(displayValue('   ')).toBe('—');
  });
});

describe('summariseSubmissionChanges', () => {
  const before = {
    client_name: 'Rahul',
    company: 'Acme Ltd',
    phone: '9000000000',
    city: 'Pune',
    departments: ['Robotics'],
    partner_submitted_value: 100000,
    remarks: 'Original description'
  };

  it('names only what actually moved', () => {
    const changes = summariseSubmissionChanges(before, { ...before, phone: '9111111111', city: 'Mumbai' });
    expect(changes.map((c) => c.field)).toEqual(['phone', 'city']);
    expect(changes[0]).toEqual({ field: 'phone', label: 'Phone', from: '9000000000', to: '9111111111' });
  });

  it('ignores a field the revision never mentioned', () => {
    // The bug this prevents: a form posting a subset would otherwise report
    // every absent field as cleared, and the write path would clear them.
    const changes = summariseSubmissionChanges(before, { phone: '9111111111' });
    expect(changes.map((c) => c.field)).toEqual(['phone']);
  });

  it('distinguishes "not mentioned" from "deliberately cleared"', () => {
    expect(summariseSubmissionChanges(before, {})).toEqual([]);
    const cleared = summariseSubmissionChanges(before, { phone: '' });
    expect(cleared).toEqual([{ field: 'phone', label: 'Phone', from: '9000000000', to: '—' }]);
  });

  it('treats null and empty string as the same non-change', () => {
    const changes = summariseSubmissionChanges({ email: null }, { email: '' });
    expect(changes).toEqual([]);
  });

  it('reports list and number changes readably', () => {
    const changes = summariseSubmissionChanges(before, {
      departments: ['Robotics', 'AI'],
      partner_submitted_value: 250000
    });
    expect(changes).toEqual([
      { field: 'departments', label: 'Departments', from: 'Robotics', to: 'Robotics, AI' },
      { field: 'partner_submitted_value', label: 'Estimated value', from: '1,00,000', to: '2,50,000' }
    ]);
  });

  it('never reports a field a partner is not allowed to change', () => {
    // Even if one is somehow present in the payload, it must not appear in
    // the log claiming the partner changed it — the write path would not
    // have applied it.
    const changes = summariseSubmissionChanges(
      { ...before, sales_person: 'anita', stage: 'prospect', approx_price: 1 },
      { ...before, sales_person: 'raj', stage: 'commit', approx_price: 999 } as Record<string, unknown>
    );
    expect(changes).toEqual([]);
  });

  it('returns nothing when the revision changes nothing', () => {
    expect(summariseSubmissionChanges(before, { ...before })).toEqual([]);
  });
});

describe('labels', () => {
  it('names every submittable field, so no change logs as a raw column name', () => {
    for (const field of PARTNER_SUBMITTABLE_FIELDS) {
      expect(PARTNER_FIELD_LABEL[field], `missing label for ${field}`).toBeTruthy();
    }
  });
});

describe('formatChangeSummary', () => {
  it('writes one line per change', () => {
    const summary = formatChangeSummary([
      { field: 'phone', label: 'Phone', from: '900', to: '911' },
      { field: 'city', label: 'City', from: 'Pune', to: 'Mumbai' }
    ]);
    expect(summary).toBe('Phone: 900 → 911\nCity: Pune → Mumbai');
  });

  it('is empty when nothing changed, so the note carries only the message', () => {
    expect(formatChangeSummary([])).toBe('');
  });

  it('clips a pasted essay rather than producing an unscrollable note', () => {
    const long = 'x'.repeat(400);
    const summary = formatChangeSummary([{ field: 'remarks', label: 'Description', from: '—', to: long }]);
    expect(summary.length).toBeLessThan(200);
    expect(summary.endsWith('…')).toBe(true);
  });
});
