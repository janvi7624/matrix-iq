import { describe, it, expect } from 'vitest';
import { computeLeadCallStats, LeadCallError } from '../../lib/leadCall';
import { LEAD_CALL_OUTCOMES, LeadRecord } from '../../lib/types';

// A fixed "today" so the call-back window never depends on when the suite
// runs. computeLeadCallStats compares YYYY-MM-DD day keys, so midday UTC
// keeps the key unambiguous.
const TODAY = new Date('2026-09-24T12:00:00.000Z');

function makeLead(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return {
    id: 'lead-1',
    created_at: '2026-09-20T10:00:00.000Z',
    created_by: 'hardik',
    updated_at: '2026-09-20T10:00:00.000Z',
    name: 'Test Contact',
    mobile: '9999999999',
    email: '',
    designation: '',
    company: 'Test Co',
    city: '',
    card_image_url: '',
    interests: [],
    sub_interests: [],
    priority: '',
    follow_up_actions: [],
    budget: '',
    notes: '',
    project_id: '',
    source: 'business_card',
    meta_lead_id: '',
    meta_page_id: '',
    meta_form_id: '',
    meta_form_name: '',
    meta_campaign_id: '',
    meta_campaign_name: '',
    meta_adset_id: '',
    meta_adset_name: '',
    meta_ad_id: '',
    meta_ad_name: '',
    meta_platform: '',
    meta_created_at: '',
    meta_raw_field_data: [],
    assigned_to_id: '',
    assigned_by_id: '',
    assigned_at: '',
    assigned_to: '',
    assigned_to_name: '',
    assigned_by: '',
    call_outcome: '',
    called_at: '',
    called_by_id: '',
    called_by_name: '',
    call_remark: '',
    callback_at: '',
    ...overrides
  };
}

const assigned = (overrides: Partial<LeadRecord> = {}) =>
  makeLead({ assigned_to_id: 'u1', assigned_to: 'janvi', assigned_at: '2026-09-21T10:00:00.000Z', ...overrides });

describe('computeLeadCallStats — toCall (the queue a rep has to ring)', () => {
  it('counts an assigned, unconverted lead nobody has called yet', () => {
    const stats = computeLeadCallStats([assigned()], TODAY);
    expect(stats.toCall).toBe(1);
  });

  it('does not count an unassigned lead — nobody has been asked to ring it', () => {
    const stats = computeLeadCallStats([makeLead()], TODAY);
    expect(stats).toEqual({ toCall: 0, suitable: 0, notSuitable: 0, callbackDue: 0 });
  });

  it('does not count an assigned lead that already has a project (converted before the call step existed)', () => {
    const stats = computeLeadCallStats([assigned({ project_id: 'proj-1' })], TODAY);
    expect(stats.toCall).toBe(0);
  });

  it('drops a lead out of toCall as soon as any outcome is recorded', () => {
    const outcomes = ['suitable', 'not_suitable', 'callback'] as const;
    for (const outcome of outcomes) {
      const stats = computeLeadCallStats([assigned({ call_outcome: outcome, callback_at: outcome === 'callback' ? '2026-10-01' : '' })], TODAY);
      expect(stats.toCall).toBe(0);
    }
  });
});

describe('computeLeadCallStats — verdicts', () => {
  it('counts suitable and not-suitable separately', () => {
    const stats = computeLeadCallStats(
      [
        assigned({ id: 'a', call_outcome: 'suitable', project_id: 'proj-1' }),
        assigned({ id: 'b', call_outcome: 'not_suitable', call_remark: 'Retail shop, no AV budget' }),
        assigned({ id: 'c', call_outcome: 'not_suitable', call_remark: 'Wrong number' })
      ],
      TODAY
    );
    expect(stats.suitable).toBe(1);
    expect(stats.notSuitable).toBe(2);
  });

  it('counts a verdict even on a lead nobody is assigned to (a manager qualified it themselves)', () => {
    const stats = computeLeadCallStats([makeLead({ call_outcome: 'suitable', project_id: 'proj-9' })], TODAY);
    expect(stats.suitable).toBe(1);
  });

  it('still counts a "suitable" lead whose project creation has not landed yet', () => {
    const stats = computeLeadCallStats([assigned({ call_outcome: 'suitable', project_id: '' })], TODAY);
    expect(stats).toEqual({ toCall: 0, suitable: 1, notSuitable: 0, callbackDue: 0 });
  });
});

describe('computeLeadCallStats — callbackDue', () => {
  it('counts a call-back promised for today', () => {
    const stats = computeLeadCallStats([assigned({ call_outcome: 'callback', callback_at: '2026-09-24' })], TODAY);
    expect(stats.callbackDue).toBe(1);
  });

  it('counts a call-back whose date has already gone by', () => {
    const stats = computeLeadCallStats([assigned({ call_outcome: 'callback', callback_at: '2026-09-01' })], TODAY);
    expect(stats.callbackDue).toBe(1);
  });

  it('does not count a call-back promised for tomorrow', () => {
    const stats = computeLeadCallStats([assigned({ call_outcome: 'callback', callback_at: '2026-09-25' })], TODAY);
    expect(stats.callbackDue).toBe(0);
  });

  it('compares day keys, not clock time — a date next year is not due today', () => {
    const stats = computeLeadCallStats([assigned({ call_outcome: 'callback', callback_at: '2027-01-02' })], TODAY);
    expect(stats.callbackDue).toBe(0);
  });

  it('puts a "callback" with no date back in the to-call queue rather than losing it', () => {
    // A dateless call-back can never come due, so counting it only under
    // callbackDue would drop it out of every tile — nobody would chase it.
    const stats = computeLeadCallStats([assigned({ call_outcome: 'callback', callback_at: '' })], TODAY);
    expect(stats).toEqual({ toCall: 1, suitable: 0, notSuitable: 0, callbackDue: 0 });
  });

  it('…but only when it is still somebody\'s to chase', () => {
    const unassignedNoDate = computeLeadCallStats([{ ...assigned({ call_outcome: 'callback', callback_at: '' }), assigned_to_id: '', assigned_to: '' }], TODAY);
    expect(unassignedNoDate).toEqual({ toCall: 0, suitable: 0, notSuitable: 0, callbackDue: 0 });
  });

  it('uses the real current date when no "today" is passed', () => {
    const longPast = computeLeadCallStats([assigned({ call_outcome: 'callback', callback_at: '2020-01-01' })]);
    const farFuture = computeLeadCallStats([assigned({ call_outcome: 'callback', callback_at: '2099-01-01' })]);
    expect(longPast.callbackDue).toBe(1);
    expect(farFuture.callbackDue).toBe(0);
  });
});

describe('computeLeadCallStats — the expo funnel as a whole', () => {
  it('returns all zeros for an empty list', () => {
    expect(computeLeadCallStats([], TODAY)).toEqual({ toCall: 0, suitable: 0, notSuitable: 0, callbackDue: 0 });
  });

  it('splits a batch of cards across the four buckets, counting each lead once', () => {
    const leads = [
      makeLead({ id: '1' }), // captured, not assigned yet
      assigned({ id: '2' }), // waiting on a call
      assigned({ id: '3' }),
      assigned({ id: '4', call_outcome: 'suitable', project_id: 'proj-1' }),
      assigned({ id: '5', call_outcome: 'not_suitable', call_remark: 'No requirement' }),
      assigned({ id: '6', call_outcome: 'callback', callback_at: '2026-09-23' }),
      assigned({ id: '7', call_outcome: 'callback', callback_at: '2026-10-05' })
    ];
    expect(computeLeadCallStats(leads, TODAY)).toEqual({ toCall: 2, suitable: 1, notSuitable: 1, callbackDue: 1 });
  });
});

describe('LEAD_CALL_OUTCOMES (what the call form may submit)', () => {
  it('lists exactly the three recordable verdicts', () => {
    expect(LEAD_CALL_OUTCOMES).toEqual(['suitable', 'not_suitable', 'callback']);
  });

  it('excludes the empty outcome — "not called yet" is a state, never something a rep submits', () => {
    expect(LEAD_CALL_OUTCOMES).not.toContain('');
  });
});

describe('LeadCallError (what the route turns into an HTTP status)', () => {
  it('carries the status the API route should answer with', () => {
    expect(new LeadCallError('Pick what came of the call.', 400).status).toBe(400);
    expect(new LeadCallError('Lead not found', 404).status).toBe(404);
  });

  it('is a real Error, so an unexpected throw is still distinguishable from it', () => {
    const err = new LeadCallError('Say why this lead is not suitable, so the next person knows.', 400);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LeadCallError);
    expect(err.message).toBe('Say why this lead is not suitable, so the next person knows.');
    expect(new Error('boom')).not.toBeInstanceOf(LeadCallError);
  });
});
