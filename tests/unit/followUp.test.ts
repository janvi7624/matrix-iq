import { describe, it, expect } from 'vitest';
import { isLeadUnattended, daysSince, FOLLOW_UP_DAYS } from '../../lib/followUp';

// The exact structural shape isLeadUnattended reads, so this fixture can't
// drift from the function's own parameter type.
type UnattendedLead = Parameters<typeof isLeadUnattended>[0];

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

// `callback_at` is a YYYY-MM-DD day key that isLeadUnattended re-parses as
// `${callback_at}T00:00:00` — i.e. LOCAL midnight — so the fixture has to
// build it in local time too, not off toISOString() (UTC).
function dayKey(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Defaults are a card captured a week ago and never handed to anyone. Every
// case below sets the events it cares about; the SLA clock is the LATEST of
// created/assigned/called, so fixtures keep those in a realistic order.
function lead(overrides: Partial<UnattendedLead> = {}): UnattendedLead {
  return {
    follow_up_actions: [],
    created_at: daysAgo(7),
    assigned_to_id: '',
    assigned_at: '',
    project_id: '',
    call_outcome: '',
    called_at: '',
    callback_at: '',
    ...overrides
  };
}

describe('isLeadUnattended — who the alert is for', () => {
  it('never flags a lead nobody has been given, however old it is', () => {
    // That's the "To Assign" queue's job — no one has been asked to do
    // anything yet, so nobody is late.
    expect(isLeadUnattended(lead({ created_at: daysAgo(100) }))).toBe(false);
  });

  it('does not flag a lead assigned today', () => {
    expect(isLeadUnattended(lead({ assigned_to_id: 'u1', assigned_at: daysAgo(0) }))).toBe(false);
  });

  it('flags a lead assigned 4 days ago that has never been called', () => {
    expect(isLeadUnattended(lead({ assigned_to_id: 'u1', assigned_at: daysAgo(4) }))).toBe(true);
  });

  it('flags exactly at the SLA boundary (>= FOLLOW_UP_DAYS, not >)', () => {
    const atBoundary = lead({ assigned_to_id: 'u1', assigned_at: daysAgo(FOLLOW_UP_DAYS) });
    const justInside = lead({ assigned_to_id: 'u1', assigned_at: daysAgo(FOLLOW_UP_DAYS - 1) });
    expect(isLeadUnattended(atBoundary)).toBe(true);
    expect(isLeadUnattended(justInside)).toBe(false);
  });
});

describe('isLeadUnattended — work that finishes the lead', () => {
  it('never flags a lead that already has a project', () => {
    expect(isLeadUnattended(lead({ created_at: daysAgo(40), assigned_to_id: 'u1', assigned_at: daysAgo(30), project_id: 'p1' }))).toBe(false);
  });

  it('never flags a lead called "suitable"', () => {
    const qualified = lead({ created_at: daysAgo(40), assigned_to_id: 'u1', assigned_at: daysAgo(35), called_at: daysAgo(30), call_outcome: 'suitable' });
    expect(isLeadUnattended(qualified)).toBe(false);
  });

  it('never flags a lead called "not suitable" — it is ruled out, not neglected', () => {
    const ruledOut = lead({ created_at: daysAgo(40), assigned_to_id: 'u1', assigned_at: daysAgo(35), called_at: daysAgo(30), call_outcome: 'not_suitable' });
    expect(isLeadUnattended(ruledOut)).toBe(false);
  });

  it('REGRESSION: an assigned lead with a project and zero follow-up chips, older than the SLA, is NOT unattended', () => {
    // The live-data case that made the alert permanent: the old rule was
    // `follow_up_actions.length === 0 && age(created_at) >= SLA`, and every
    // flagged lead looked exactly like this — assigned, already converted,
    // no chips (those are capture-time intentions, not work done). Nothing a
    // rep could do would clear it.
    const converted = lead({
      follow_up_actions: [],
      created_at: daysAgo(30),
      assigned_to_id: 'u1',
      assigned_at: daysAgo(29),
      project_id: 'proj-1'
    });
    expect(isLeadUnattended(converted)).toBe(false);
  });

  it('ignores follow-up chips entirely — having them does not excuse an uncalled lead', () => {
    const withChips = lead({ follow_up_actions: ['Call in 3 days'], assigned_to_id: 'u1', assigned_at: daysAgo(4) });
    const withoutChips = lead({ follow_up_actions: [], assigned_to_id: 'u1', assigned_at: daysAgo(4) });
    expect(isLeadUnattended(withChips)).toBe(true);
    expect(isLeadUnattended(withoutChips)).toBe(true);
  });
});

describe('isLeadUnattended — a promised call-back is its own deadline', () => {
  it('does not flag a call-back promised for a future date', () => {
    const promised = lead({ created_at: daysAgo(40), assigned_to_id: 'u1', assigned_at: daysAgo(30), called_at: daysAgo(10), call_outcome: 'callback', callback_at: dayKey(7) });
    expect(isLeadUnattended(promised)).toBe(false);
  });

  it('does not flag a call-back promised for today — it is due, not yet missed', () => {
    const promised = lead({ created_at: daysAgo(40), assigned_to_id: 'u1', assigned_at: daysAgo(30), called_at: daysAgo(10), call_outcome: 'callback', callback_at: dayKey(0) });
    expect(isLeadUnattended(promised)).toBe(false);
  });

  it('flags a call-back that was promised for yesterday', () => {
    const missed = lead({ assigned_to_id: 'u1', assigned_at: daysAgo(2), called_at: daysAgo(2), call_outcome: 'callback', callback_at: dayKey(-1) });
    expect(isLeadUnattended(missed)).toBe(true);
  });

  it('a missed call-back date beats a fresh call — the promise is the deadline', () => {
    // Called today, but the day promised has already gone by: still late.
    const promised = lead({ assigned_to_id: 'u1', assigned_at: daysAgo(0), called_at: daysAgo(0), call_outcome: 'callback', callback_at: dayKey(-2) });
    expect(isLeadUnattended(promised)).toBe(true);
  });

  it('a future call-back date beats a long-stale assignment', () => {
    const promised = lead({ created_at: daysAgo(90), assigned_to_id: 'u1', assigned_at: daysAgo(60), called_at: daysAgo(30), call_outcome: 'callback', callback_at: dayKey(3) });
    expect(isLeadUnattended(promised)).toBe(false);
  });

  it('falls back to the normal SLA clock when a "callback" has no date stored', () => {
    const stale = lead({ created_at: daysAgo(20), assigned_to_id: 'u1', assigned_at: daysAgo(10), called_at: daysAgo(4), call_outcome: 'callback', callback_at: '' });
    const fresh = lead({ created_at: daysAgo(20), assigned_to_id: 'u1', assigned_at: daysAgo(10), called_at: daysAgo(0), call_outcome: 'callback', callback_at: '' });
    expect(isLeadUnattended(stale)).toBe(true);
    expect(isLeadUnattended(fresh)).toBe(false);
  });
});

describe('isLeadUnattended — which clock it measures', () => {
  it('flags a lead called 4 days ago that still has no outcome recorded', () => {
    const called = lead({ created_at: daysAgo(20), assigned_to_id: 'u1', assigned_at: daysAgo(10), called_at: daysAgo(4), call_outcome: '' });
    expect(isLeadUnattended(called)).toBe(true);
  });

  it('runs from the call, not the assignment — a call today clears an old assignment', () => {
    const calledToday = lead({ created_at: daysAgo(40), assigned_to_id: 'u1', assigned_at: daysAgo(30), called_at: daysAgo(0), call_outcome: '' });
    expect(isLeadUnattended(calledToday)).toBe(false);
  });

  it('runs from the assignment, not the capture — an old card assigned today is not late', () => {
    const freshlyAssigned = lead({ created_at: daysAgo(30), assigned_to_id: 'u1', assigned_at: daysAgo(0) });
    expect(isLeadUnattended(freshlyAssigned)).toBe(false);
  });

  it('takes the LATEST event, so reassigning today gives the new owner the full SLA', () => {
    // Worked and dropped by someone else ten days ago, handed over today:
    // the new owner is not already in breach the second it lands on them.
    const reassigned = lead({ created_at: daysAgo(40), assigned_to_id: 'u2', assigned_at: daysAgo(0), called_at: daysAgo(10), call_outcome: '' });
    expect(isLeadUnattended(reassigned)).toBe(false);
  });

  it('falls back to created_at when an assigned lead has no assigned_at stored', () => {
    // Rows assigned before the assigned_at column existed.
    expect(isLeadUnattended(lead({ created_at: daysAgo(4), assigned_to_id: 'u1', assigned_at: '' }))).toBe(true);
    expect(isLeadUnattended(lead({ created_at: daysAgo(1), assigned_to_id: 'u1', assigned_at: '' }))).toBe(false);
  });

  it('does not flag (or crash on) an assigned row with no usable dates at all', () => {
    expect(isLeadUnattended(lead({ created_at: '', assigned_to_id: 'u1', assigned_at: '' }))).toBe(false);
  });
});

describe('daysSince (the clock behind the SLA)', () => {
  it('counts whole elapsed days, rounding down', () => {
    expect(daysSince(daysAgo(0))).toBe(0);
    expect(daysSince(daysAgo(3))).toBe(3);
  });

  it('returns 0 for an unparseable date rather than NaN', () => {
    expect(daysSince('not-a-date')).toBe(0);
  });

  it('returns a negative count for a future date, so a future deadline is not overdue', () => {
    expect(daysSince(new Date(Date.now() + 2 * DAY_MS).toISOString())).toBeLessThan(0);
  });
});
