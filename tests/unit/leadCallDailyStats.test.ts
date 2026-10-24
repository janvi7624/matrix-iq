import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Op } from 'sequelize';

// db is mocked because lib/db.ts requires db/models at module scope, which
// would open a real Sequelize connection in a unit test — the same reason the
// other store tests mock it (tests/unit/partnerStatusTransitions.test.ts).
const findAll = vi.fn();
vi.mock('../../lib/db', () => ({ db: { Lead: { findAll: (...args: unknown[]) => findAll(...args) } }, sequelize: {}, isUuid: () => true }));

import { computeLeadCallCounts, fetchLeadCallDetail, LEAD_CALL_MEASURES } from '../../lib/leadCallDailyStats';

const CHANNELS = ['AI', 'AV', 'Robotics'];
const BOTH = ['Customer Calls', 'Follow-ups Completed'];

// Sequelize rows, as the module reads them.
function rows(...leads: { id: string; name?: string; company?: string; call_outcome?: string; interests?: string[] }[]) {
  return leads.map((lead) => ({
    get: () => ({
      id: lead.id,
      name: lead.name ?? '',
      company: lead.company ?? '',
      call_outcome: lead.call_outcome ?? '',
      interests: lead.interests ?? []
    })
  }));
}

beforeEach(() => {
  findAll.mockReset();
  findAll.mockResolvedValue([]);
});

describe('computeLeadCallCounts', () => {
  it('counts a logged call against the channel the lead is interested in', async () => {
    findAll.mockResolvedValue(rows(
      { id: 'a', interests: ['ai'], call_outcome: 'suitable' },
      { id: 'b', interests: ['av'], call_outcome: 'not_suitable' },
      { id: 'c', interests: ['ai'], call_outcome: 'callback' }
    ));
    const out = await computeLeadCallCounts('emp-1', '2026-10-24', BOTH, CHANNELS);
    expect(out['Customer Calls']).toEqual({ AI: 2, AV: 1, Robotics: 0 });
  });

  // The same rule New Leads Generated already uses, and the one
  // Project.departments uses for revenue splitting.
  it('counts a lead interested in two channels toward both', async () => {
    findAll.mockResolvedValue(rows({ id: 'a', interests: ['ai', 'av'], call_outcome: 'completed' }));
    const out = await computeLeadCallCounts('emp-1', '2026-10-24', BOTH, CHANNELS);
    expect(out['Customer Calls']).toEqual({ AI: 1, AV: 1, Robotics: 0 });
    expect(out['Follow-ups Completed']).toEqual({ AI: 1, AV: 1, Robotics: 0 });
  });

  it('does not double count a channel listed twice on one lead', async () => {
    // Interests are user-picked chips; a duplicate is a data accident, not two
    // calls, and counting it twice would inflate the report.
    findAll.mockResolvedValue(rows({ id: 'a', interests: ['ai', 'AI'], call_outcome: 'completed' }));
    const out = await computeLeadCallCounts('emp-1', '2026-10-24', BOTH, CHANNELS);
    expect(out['Customer Calls'].AI).toBe(1);
  });

  it('counts only the completed outcome as a finished follow-up', async () => {
    // 'suitable' opens a project, 'callback' defers, 'not_suitable' rejects —
    // only 'completed' means the thread was finished on this call.
    findAll.mockResolvedValue(rows(
      { id: 'a', interests: ['ai'], call_outcome: 'completed' },
      { id: 'b', interests: ['ai'], call_outcome: 'suitable' },
      { id: 'c', interests: ['ai'], call_outcome: 'callback' },
      { id: 'd', interests: ['ai'], call_outcome: 'not_suitable' }
    ));
    const out = await computeLeadCallCounts('emp-1', '2026-10-24', BOTH, CHANNELS);
    expect(out['Customer Calls'].AI).toBe(4);
    expect(out['Follow-ups Completed'].AI).toBe(1);
  });

  it('ignores an interest that is not one of the template channels', async () => {
    findAll.mockResolvedValue(rows({ id: 'a', interests: ['drones'], call_outcome: 'completed' }));
    const out = await computeLeadCallCounts('emp-1', '2026-10-24', BOTH, CHANNELS);
    expect(out['Customer Calls']).toEqual({ AI: 0, AV: 0, Robotics: 0 });
  });

  it('honours a department override that leaves one measure manual', async () => {
    // Absent from the result, NOT zero: the caller merges this over the
    // employee's matrix, so a zero here would wipe a typed value on every save.
    findAll.mockResolvedValue(rows({ id: 'a', interests: ['ai'], call_outcome: 'completed' }));
    const out = await computeLeadCallCounts('emp-1', '2026-10-24', ['Customer Calls'], CHANNELS);
    expect(Object.keys(out)).toEqual(['Customer Calls']);
    expect(out['Follow-ups Completed']).toBeUndefined();
  });

  it('returns nothing, and asks the database nothing, when neither measure is wanted', async () => {
    const out = await computeLeadCallCounts('emp-1', '2026-10-24', ['Meetings Completed'], CHANNELS);
    expect(out).toEqual({});
    expect(findAll).not.toHaveBeenCalled();
  });

  it('returns nothing when the template has no channels', async () => {
    const out = await computeLeadCallCounts('emp-1', '2026-10-24', BOTH, []);
    expect(out).toEqual({});
    expect(findAll).not.toHaveBeenCalled();
  });

  it('reports zero for a day with no calls rather than omitting the measure', async () => {
    // An explicit zero is what overwrites a stale number from an earlier save.
    const out = await computeLeadCallCounts('emp-1', '2026-10-24', BOTH, CHANNELS);
    expect(out['Customer Calls']).toEqual({ AI: 0, AV: 0, Robotics: 0 });
    expect(out['Follow-ups Completed']).toEqual({ AI: 0, AV: 0, Robotics: 0 });
  });

  it('asks only for calls this employee logged, bounded to the IST day', async () => {
    await computeLeadCallCounts('emp-1', '2026-10-24', BOTH, CHANNELS);
    const where = (findAll.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.called_by_id).toBe('emp-1');
    // A day boundary in IST, not UTC — 2026-10-24 00:00 IST is 18:30 UTC the
    // day before, and getting this wrong shifts every call across midnight.
    // Read through the Op symbols: Sequilize's operator keys are symbols, so
    // Object.values/keys do not see them at all.
    const range = where.called_at as Record<symbol, Date>;
    expect(range[Op.gte].toISOString()).toBe('2026-10-23T18:30:00.000Z');
    expect(range[Op.lt].toISOString()).toBe('2026-10-24T18:30:00.000Z');
  });
});

describe('fetchLeadCallDetail', () => {
  it('lists the leads behind a Customer Calls cell, for that channel only', async () => {
    findAll.mockResolvedValue(rows(
      { id: 'a', name: 'Asha', company: 'Acme', interests: ['ai'], call_outcome: 'suitable' },
      { id: 'b', name: 'Bala', company: 'Byte', interests: ['av'], call_outcome: 'completed' }
    ));
    const items = await fetchLeadCallDetail('emp-1', '2026-10-24', 'Customer Calls', 'AI');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'a', title: 'Asha', href: '/leads' });
    expect(items[0].subtitle).toContain('Acme');
  });

  it('narrows a Follow-ups Completed cell to the completed calls', async () => {
    findAll.mockResolvedValue(rows(
      { id: 'a', name: 'Asha', interests: ['ai'], call_outcome: 'completed' },
      { id: 'b', name: 'Bala', interests: ['ai'], call_outcome: 'callback' }
    ));
    const items = await fetchLeadCallDetail('emp-1', '2026-10-24', 'Follow-ups Completed', 'AI');
    expect(items.map((i) => i.id)).toEqual(['a']);
  });

  it('agrees with the count, so a cell and its drill-down can never differ', async () => {
    const sample = rows(
      { id: 'a', name: 'Asha', interests: ['ai'], call_outcome: 'completed' },
      { id: 'b', name: 'Bala', interests: ['ai', 'av'], call_outcome: 'completed' },
      { id: 'c', name: 'Chetan', interests: ['ai'], call_outcome: 'callback' }
    );
    findAll.mockResolvedValue(sample);
    const counts = await computeLeadCallCounts('emp-1', '2026-10-24', BOTH, CHANNELS);
    for (const measure of LEAD_CALL_MEASURES) {
      for (const channel of CHANNELS) {
        findAll.mockResolvedValue(sample);
        const items = await fetchLeadCallDetail('emp-1', '2026-10-24', measure, channel);
        expect(items).toHaveLength(counts[measure][channel]);
      }
    }
  });

  it('falls back to the company when a lead has no contact name', async () => {
    findAll.mockResolvedValue(rows({ id: 'a', company: 'Acme', interests: ['ai'], call_outcome: 'completed' }));
    const items = await fetchLeadCallDetail('emp-1', '2026-10-24', 'Customer Calls', 'AI');
    expect(items[0].title).toBe('Acme');
  });

  it('returns nothing for a measure it does not own', async () => {
    const items = await fetchLeadCallDetail('emp-1', '2026-10-24', 'Quotations Sent', 'AI');
    expect(items).toEqual([]);
    expect(findAll).not.toHaveBeenCalled();
  });
});
