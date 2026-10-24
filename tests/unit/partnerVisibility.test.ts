import { describe, it, expect } from 'vitest';
import type { ProjectRecord } from '../../lib/types';
import { PARTNER_SUBMITTABLE_FIELDS, PARTNER_WITHHELD_PROJECT_FIELDS, toPartnerVisibleProject } from '../../lib/partnerVisibility';

// The redaction layer. These assertions are the ones that would catch a real
// leak, so they name the dangerous fields explicitly rather than checking a
// shape in the abstract.

function project(over: Record<string, unknown> = {}): ProjectRecord {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    created_at: '2026-10-01T10:00:00.000Z',
    created_by: 'priya.rm',
    project_name: 'Lobby video wall',
    client_name: 'Ravi Kumar',
    company: 'Acme Hotels',
    city: 'Surat',
    state: 'Gujarat',
    departments: ['av'],
    stage: 'quotation',
    status: 'active',
    sales_person: 'deepak',
    // Everything below is internal and must never appear in the output.
    approx_price: 5000000,
    quote_value: 4800000,
    closing_probability_percent: 65,
    closing_percent_override_reason: 'Manager override — customer wobbling',
    remarks: 'Internal: customer is price shopping against a competitor',
    tender_emd: 250000,
    tender_pbg: 'BG required',
    payment_terms: '30% advance',
    lost_reason: '',
    partner_submission_status: 'approved',
    partner_submitted_value: 4500000,
    partner_expected_timeline: 'Q1 2027',
    partner_review_remarks: 'Looks good, assigning Deepak',
    partner_reviewed_at: '2026-10-02T09:00:00.000Z',
    notes: [],
    timeline: [],
    ...over
  } as unknown as ProjectRecord;
}

const context = { hasSharedQuotation: false, hasDemo: false, salespersonName: 'Deepak Shah' };

describe('toPartnerVisibleProject — allow-list', () => {
  it('never emits internal commercial fields', () => {
    const view = toPartnerVisibleProject(project(), context);
    const serialised = JSON.stringify(view);

    // Our own pricing and forecast position.
    expect(serialised).not.toContain('5000000');
    expect(serialised).not.toContain('4800000');
    expect(serialised).not.toContain('65');
    // Internal commentary and tender terms.
    expect(serialised).not.toContain('price shopping');
    expect(serialised).not.toContain('250000');
    expect(serialised).not.toContain('BG required');
    expect(serialised).not.toContain('30% advance');
    expect(serialised).not.toContain('Manager override');
    // Internal identities.
    expect(serialised).not.toContain('priya.rm');
    expect(serialised).not.toContain('deepak');
  });

  it('emits the partner’s own data back to them', () => {
    const view = toPartnerVisibleProject(project(), context);
    expect(view.submitted_value).toBe(4500000);
    expect(view.expected_timeline).toBe('Q1 2027');
    expect(view.company).toBe('Acme Hotels');
    // The reviewer's note is deliberately partner-facing: a decision with no
    // stated reason is an unexplained dead end.
    expect(view.review_remarks).toBe('Looks good, assigning Deepak');
  });

  it('gives a human reference rather than exposing the raw UUID as the ID', () => {
    const view = toPartnerVisibleProject(project(), context);
    expect(view.reference).toBe('PRJ-AAAAAAAA');
  });

  it('shows the salesperson’s resolved display name, not the raw column', () => {
    // The sales_person COLUMN holds usernames far more often than names, so
    // the payload carries a name resolved from the user record instead.
    //
    // Scope note: this asserts the PROJECTION. The resolution
    // (salespersonNameOf in lib/partnerProjectStore.ts) falls back to a
    // username when an account has no display name at all — there is no
    // better handle, and blanking it would read as "nobody is assigned".
    // What is guaranteed unconditionally is that no user ID is ever emitted.
    const view = toPartnerVisibleProject(project(), context);
    expect(view.salesperson_name).toBe('Deepak Shah');
    expect(JSON.stringify(view)).not.toContain('deepak');
    expect(JSON.stringify(view)).not.toContain('priya.rm');
  });
});

describe('toPartnerVisibleProject — timeline and notes are internal by default', () => {
  const entries = {
    timeline: [
      { id: '1', at: '2026-10-01T10:00:00.000Z', by: 'partner', stage: 'created', label: 'Submitted by partner', remarks: '', partner_visible: true },
      { id: '2', at: '2026-10-03T10:00:00.000Z', by: 'deepak', stage: 'quotation', label: 'Internal pricing review', remarks: 'Undercut competitor by 8%', partner_visible: false }
    ],
    notes: [
      { id: '3', at: '2026-10-04T10:00:00.000Z', by: 'deepak', text: 'Customer is desperate, hold firm on price', partner_visible: false },
      { id: '4', at: '2026-10-05T10:00:00.000Z', by: 'partner', text: 'Customer asked about delivery', partner_visible: true }
    ]
  };

  it('includes only events explicitly marked visible', () => {
    const view = toPartnerVisibleProject(project(entries), context);
    expect(view.timeline).toHaveLength(1);
    expect(view.timeline[0].label).toBe('Submitted by partner');
    expect(JSON.stringify(view)).not.toContain('Undercut competitor');
  });

  it('includes only notes explicitly marked visible', () => {
    const view = toPartnerVisibleProject(project(entries), context);
    expect(view.notes).toHaveLength(1);
    expect(view.notes[0].remarks).toBe('Customer asked about delivery');
    expect(JSON.stringify(view)).not.toContain('hold firm on price');
  });

  it('treats a missing partner_visible flag as internal', () => {
    // An older row, or a partial select that did not load the column. The
    // absence of a decision must not read as permission.
    const view = toPartnerVisibleProject(
      project({ notes: [{ id: '5', at: '2026-10-06T10:00:00.000Z', by: 'x', text: 'legacy internal note' }] }),
      context
    );
    expect(view.notes).toHaveLength(0);
  });

  it('drops the author of a visible note', () => {
    const view = toPartnerVisibleProject(project(entries), context);
    expect(JSON.stringify(view.notes)).not.toContain('partner');
    expect(view.notes[0]).not.toHaveProperty('by');
  });
});

describe('PARTNER_SUBMITTABLE_FIELDS', () => {
  it('excludes every field that would let a partner drive internal state', () => {
    const forbidden = [
      'approx_price',
      'quote_value',
      'sales_person',
      'stage',
      'status',
      // 'priority' is NOT here any more: it is an ordinary working field on
      // the internal form (low/medium/high), carries no commercial or
      // assignment meaning, and the brief is that a partner submission
      // captures the same fields. A sales manager can still change it.
      'partner_id',
      'partner_submission_status',
      'partner_reviewed_by',
      'project_lead_id',
      'assigned_technical_person_id',
      'closing_probability_percent',
      'source',
      'created_by'
    ];
    for (const field of forbidden) {
      expect(PARTNER_SUBMITTABLE_FIELDS as readonly string[]).not.toContain(field);
    }
  });

  it('still carries the fields the submission form genuinely needs', () => {
    for (const field of ['company', 'client_name', 'partner_submitted_value', 'departments', 'remarks']) {
      expect(PARTNER_SUBMITTABLE_FIELDS as readonly string[]).toContain(field);
    }
  });

  it('matches the internal New Project form field for field, bar the withheld set', () => {
    // The brief: a partner submission should capture everything the internal
    // form does, except the pickers only a sales manager may use.
    for (const field of [
      'project_name',
      'client_name',
      'company',
      'phone',
      'email',
      'address',
      'contact_person',
      'alt_contact_phone',
      'city',
      'state',
      'opportunity_type',
      'departments',
      'priority',
      'expected_closing_date',
      'remarks'
    ]) {
      expect(PARTNER_SUBMITTABLE_FIELDS as readonly string[]).toContain(field);
    }
  });

  it('withholds exactly the internal-only fields, and never lets them overlap', () => {
    // The two lists are the whole contract; an overlap would mean a field was
    // declared off-limits and accepted anyway.
    for (const field of PARTNER_WITHHELD_PROJECT_FIELDS) {
      expect(PARTNER_SUBMITTABLE_FIELDS as readonly string[]).not.toContain(field);
    }
    // The three internal-person pickers specifically — the sales manager's
    // call, per the brief.
    for (const field of ['sales_person', 'assigned_technical_person_id', 'project_lead_id']) {
      expect(PARTNER_WITHHELD_PROJECT_FIELDS as readonly string[]).toContain(field);
    }
  });
});
