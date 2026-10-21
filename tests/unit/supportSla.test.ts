import { describe, it, expect } from 'vitest';
import { SlaInput, SlaPolicy, assessSla, computeDueDates, computePausedMs, shouldAutoEscalate } from '../../lib/supportSla';

const POLICY: SlaPolicy = {
  priority: 'high',
  firstResponseMinutes: 120,
  resolutionMinutes: 480,
  pauseOnAwaitingPartner: true,
  businessHoursOnly: false,
  escalateAfterMinutes: null
};

const T0 = '2026-10-19T09:00:00.000Z';

function input(over: Partial<SlaInput> = {}): SlaInput {
  return {
    createdAt: T0,
    responseDueAt: '2026-10-19T11:00:00.000Z',
    resolutionDueAt: '2026-10-19T17:00:00.000Z',
    firstResponseAt: '',
    resolvedAt: '',
    closedAt: '',
    status: 'in_progress',
    history: [],
    policy: POLICY,
    ...over
  };
}

describe('computeDueDates', () => {
  it('measures from the ticket’s creation, not from triage', () => {
    // The customer's clock started when they reported the problem. Measuring
    // from triage would let a slow triage erase its own delay.
    const due = computeDueDates(T0, POLICY);
    expect(due.responseDueAt).toBe('2026-10-19T11:00:00.000Z');
    expect(due.resolutionDueAt).toBe('2026-10-19T17:00:00.000Z');
  });

  it('returns empty when there is no policy', () => {
    expect(computeDueDates(T0, null)).toEqual({ responseDueAt: '', resolutionDueAt: '' });
  });
});

describe('computePausedMs', () => {
  it('sums completed awaiting-partner periods', () => {
    const paused = computePausedMs(
      [
        { from_status: 'in_progress', to_status: 'awaiting_partner', at: '2026-10-19T10:00:00.000Z' },
        { from_status: 'awaiting_partner', to_status: 'in_progress', at: '2026-10-19T12:00:00.000Z' }
      ],
      'in_progress',
      new Date('2026-10-19T13:00:00.000Z')
    );
    expect(paused).toBe(2 * 60 * 60 * 1000);
  });

  it('counts an still-open pause up to now', () => {
    // Otherwise a ticket parked on the customer would quietly breach while
    // the clock was supposed to be stopped.
    const paused = computePausedMs(
      [{ from_status: 'in_progress', to_status: 'awaiting_partner', at: '2026-10-19T10:00:00.000Z' }],
      'awaiting_partner',
      new Date('2026-10-19T13:00:00.000Z')
    );
    expect(paused).toBe(3 * 60 * 60 * 1000);
  });

  it('does not double count a repeated entry into the paused status', () => {
    const paused = computePausedMs(
      [
        { from_status: 'in_progress', to_status: 'awaiting_partner', at: '2026-10-19T10:00:00.000Z' },
        { from_status: 'awaiting_partner', to_status: 'awaiting_partner', at: '2026-10-19T10:30:00.000Z' },
        { from_status: 'awaiting_partner', to_status: 'in_progress', at: '2026-10-19T11:00:00.000Z' }
      ],
      'in_progress',
      new Date('2026-10-19T13:00:00.000Z')
    );
    expect(paused).toBe(60 * 60 * 1000);
  });

  it('returns zero for a ticket that never waited', () => {
    expect(computePausedMs([], 'in_progress', new Date())).toBe(0);
  });
});

describe('assessSla', () => {
  it('reports on track well before the deadline', () => {
    const a = assessSla(input(), new Date('2026-10-19T10:00:00.000Z'));
    expect(a.resolutionState).toBe('on_track');
    expect(a.breached).toBe(false);
  });

  it('warns when the deadline is within the hour', () => {
    const a = assessSla(input(), new Date('2026-10-19T16:30:00.000Z'));
    expect(a.resolutionState).toBe('due_soon');
  });

  it('breaches once the deadline passes with nothing resolved', () => {
    const a = assessSla(input(), new Date('2026-10-19T18:00:00.000Z'));
    expect(a.resolutionState).toBe('breached');
    expect(a.breached).toBe(true);
  });

  it('extends the deadline by time spent awaiting the partner', () => {
    // The whole point of the pause rule: a slow customer reply must not read
    // as our SLA failure.
    const a = assessSla(
      input({
        status: 'in_progress',
        history: [
          { from_status: 'in_progress', to_status: 'awaiting_partner', at: '2026-10-19T10:00:00.000Z' },
          { from_status: 'awaiting_partner', to_status: 'in_progress', at: '2026-10-19T14:00:00.000Z' }
        ]
      }),
      new Date('2026-10-19T18:00:00.000Z')
    );
    // 4 hours paused pushes the 17:00 target to 21:00, so 18:00 is fine.
    expect(a.pausedMs).toBe(4 * 60 * 60 * 1000);
    expect(a.effectiveResolutionDueAt).toBe('2026-10-19T21:00:00.000Z');
    expect(a.resolutionState).toBe('on_track');
  });

  it('does not pause when the policy says not to', () => {
    const a = assessSla(
      input({
        policy: { ...POLICY, pauseOnAwaitingPartner: false },
        history: [{ from_status: 'in_progress', to_status: 'awaiting_partner', at: '2026-10-19T10:00:00.000Z' }],
        status: 'awaiting_partner'
      }),
      new Date('2026-10-19T18:00:00.000Z')
    );
    expect(a.pausedMs).toBe(0);
    expect(a.resolutionState).toBe('breached');
  });

  it('judges a met target as met, not breached, even when assessed later', () => {
    const a = assessSla(
      input({ firstResponseAt: '2026-10-19T10:00:00.000Z', resolvedAt: '2026-10-19T15:00:00.000Z' }),
      new Date('2026-10-20T09:00:00.000Z')
    );
    expect(a.resolutionState).toBe('met');
    expect(a.breached).toBe(false);
  });

  it('counts a missed RESPONSE target as a breach even when resolution was met', () => {
    // A ticket resolved inside the resolution window but never replied to is
    // still an SLA failure — the customer waited in silence. Reporting it as
    // green because the fix landed on time would hide exactly the failure
    // the response target exists to catch.
    const a = assessSla(
      input({ firstResponseAt: '', resolvedAt: '2026-10-19T15:00:00.000Z' }),
      new Date('2026-10-20T09:00:00.000Z')
    );
    expect(a.resolutionState).toBe('met');
    expect(a.responseState).toBe('breached');
    expect(a.breached).toBe(true);
  });

  it('judges a late resolution as breached', () => {
    const a = assessSla(input({ resolvedAt: '2026-10-19T19:00:00.000Z' }), new Date('2026-10-20T09:00:00.000Z'));
    expect(a.resolutionState).toBe('breached');
  });

  it('judges closure on when the ticket was RESOLVED, not closed', () => {
    // Closure often waits on the customer confirming, which is not our delay.
    const a = assessSla(
      input({ resolvedAt: '2026-10-19T15:00:00.000Z', closedAt: '2026-10-25T09:00:00.000Z' }),
      new Date('2026-10-26T09:00:00.000Z')
    );
    expect(a.resolutionState).toBe('met');
  });

  it('reports not_started for a ticket that has never been triaged', () => {
    // No due dates stamped yet — it must not read as on track OR breached.
    const a = assessSla(input({ responseDueAt: '', resolutionDueAt: '' }), new Date());
    expect(a.responseState).toBe('not_started');
    expect(a.resolutionState).toBe('not_started');
    expect(a.breached).toBe(false);
  });

  it('treats a first response as meeting the response target', () => {
    const a = assessSla(input({ firstResponseAt: '2026-10-19T10:00:00.000Z' }), new Date('2026-10-19T12:00:00.000Z'));
    expect(a.responseState).toBe('met');
  });
});

describe('shouldAutoEscalate', () => {
  const escalating: SlaPolicy = { ...POLICY, escalateAfterMinutes: 300 };

  it('escalates once the threshold passes', () => {
    expect(shouldAutoEscalate(input({ policy: escalating }), new Date('2026-10-19T15:00:00.000Z'))).toBe(true);
  });

  it('does not escalate a resolved ticket', () => {
    expect(
      shouldAutoEscalate(input({ policy: escalating, resolvedAt: '2026-10-19T10:00:00.000Z' }), new Date('2026-10-19T15:00:00.000Z'))
    ).toBe(false);
  });

  it('does not re-escalate an already escalated ticket', () => {
    expect(shouldAutoEscalate(input({ policy: escalating, status: 'escalated' }), new Date('2026-10-19T15:00:00.000Z'))).toBe(false);
  });

  it('discounts paused time before escalating', () => {
    const result = shouldAutoEscalate(
      input({
        policy: escalating,
        status: 'awaiting_partner',
        history: [{ from_status: 'in_progress', to_status: 'awaiting_partner', at: '2026-10-19T10:00:00.000Z' }]
      }),
      new Date('2026-10-19T15:00:00.000Z')
    );
    // 6h elapsed minus 5h paused = 1h of our time; below the 5h threshold.
    expect(result).toBe(false);
  });

  it('never escalates without a configured threshold', () => {
    expect(shouldAutoEscalate(input(), new Date('2027-01-01T00:00:00.000Z'))).toBe(false);
  });
});
