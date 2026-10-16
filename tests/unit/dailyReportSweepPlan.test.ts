import { describe, it, expect } from 'vitest';
import { DeadlinePolicy } from '../../lib/dailyReportTime';
import {
  SweepState,
  escalationKey,
  eventKey,
  missedDatePattern,
  planAutoSubmits,
  planEscalations,
  planSweep,
  planZeroTotalWarnings,
  subjectKey,
  sweepWindow,
  warningBanner
} from '../../lib/dailyReportSweepPlan';

// The scheduler's decisions. Every requirement in the brief about the
// reminder engine is a property of this function — idempotency under retry,
// reconciliation after a missed run, a draft not counting as filed, a
// pending leave claim suppressing a warning — so each one is pinned here
// rather than being verified by watching a live cron job.

const MON_SAT: DeadlinePolicy = {
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: [],
  observeHolidays: false,
  deadlineTime: '11:00',
  eveningReminderTime: '21:00',
  finalReminderTime: '10:00'
};

const EMP = '11111111-1111-1111-1111-111111111111';
const EMP2 = '22222222-2222-2222-2222-222222222222';

function state(over: Partial<SweepState> = {}): SweepState {
  return { submitted: new Set(), leaveCovered: new Set(), sent: new Set(), ...over };
}

/** Monday 2026-10-19, report due Tuesday 2026-10-20 at 11:00 IST. */
const MONDAY = '2026-10-19';
const MONDAY_9PM = new Date('2026-10-19T15:30:00Z');
const TUESDAY_10AM = new Date('2026-10-20T04:30:00Z');
const TUESDAY_11AM = new Date('2026-10-20T05:30:00Z');

describe('what is due when', () => {
  const subjects = [{ employeeId: EMP, reportDate: MONDAY }];

  it('issues nothing before 9 PM on the reporting date', () => {
    const planned = planSweep(subjects, state(), new Date('2026-10-19T15:29:00Z'), MON_SAT);
    expect(planned).toEqual([]);
  });

  it('issues the first reminder at 9 PM on the reporting date', () => {
    const planned = planSweep(subjects, state(), MONDAY_9PM, MON_SAT);
    expect(planned.map((e) => e.kind)).toEqual(['REMINDER_EVENING']);
    expect(planned[0].late).toBe(false);
  });

  it('issues the final reminder at 10 AM on the deadline day', () => {
    const planned = planSweep(subjects, state({ sent: new Set([eventKey(EMP, MONDAY, 'REMINDER_EVENING')]) }), TUESDAY_10AM, MON_SAT);
    expect(planned.map((e) => e.kind)).toEqual(['REMINDER_FINAL']);
  });

  it('records the warning at 11 AM on the deadline day', () => {
    const sent = new Set([eventKey(EMP, MONDAY, 'REMINDER_EVENING'), eventKey(EMP, MONDAY, 'REMINDER_FINAL')]);
    const planned = planSweep(subjects, state({ sent }), TUESDAY_11AM, MON_SAT);
    expect(planned.map((e) => e.kind)).toEqual(['WARNING']);
  });

  it("uses Monday's 11 AM for a Saturday report, not Sunday's", () => {
    const saturday = [{ employeeId: EMP, reportDate: '2026-10-17' }];
    // Sunday 11 AM IST — nothing is due yet beyond Saturday's own 9 PM nudge.
    const sunday = planSweep(saturday, state(), new Date('2026-10-18T05:30:00Z'), MON_SAT);
    expect(sunday.map((e) => e.kind)).toEqual(['REMINDER_EVENING']);
    // Monday 11 AM IST — now the final reminder and the warning are both due.
    const monday = planSweep(saturday, state({ sent: new Set([eventKey(EMP, '2026-10-17', 'REMINDER_EVENING')]) }), new Date('2026-10-19T05:30:00Z'), MON_SAT);
    expect(monday.map((e) => e.kind)).toEqual(['REMINDER_FINAL', 'WARNING']);
  });
});

describe('idempotency', () => {
  const subjects = [{ employeeId: EMP, reportDate: MONDAY }];

  it('plans nothing a second time for an event already in the ledger', () => {
    const first = planSweep(subjects, state(), MONDAY_9PM, MON_SAT);
    expect(first).toHaveLength(1);
    // Replay with that event recorded — which is exactly what the executor
    // writes before it sends.
    const second = planSweep(subjects, state({ sent: new Set([eventKey(EMP, MONDAY, 'REMINDER_EVENING')]) }), MONDAY_9PM, MON_SAT);
    expect(second).toEqual([]);
  });

  it('is stable across many consecutive runs at the same instant', () => {
    const sent = new Set<string>();
    for (let run = 0; run < 5; run++) {
      const planned = planSweep(subjects, state({ sent }), TUESDAY_11AM, MON_SAT);
      for (const event of planned) sent.add(eventKey(event.employeeId, event.reportDate, event.kind));
    }
    // Three events total across all five runs — one of each kind, never a
    // duplicate.
    expect(sent.size).toBe(3);
    expect(planSweep(subjects, state({ sent }), TUESDAY_11AM, MON_SAT)).toEqual([]);
  });

  it('does not re-plan a warning just because the deadline is further in the past', () => {
    const sent = new Set([eventKey(EMP, MONDAY, 'WARNING')]);
    const planned = planSweep(subjects, state({ sent }), new Date('2026-10-25T05:30:00Z'), MON_SAT);
    expect(planned.some((e) => e.kind === 'WARNING')).toBe(false);
  });
});

describe('what suppresses a reminder or warning', () => {
  const subjects = [{ employeeId: EMP, reportDate: MONDAY }];

  it('stops everything once the report is submitted', () => {
    const planned = planSweep(subjects, state({ submitted: new Set([subjectKey(EMP, MONDAY)]) }), TUESDAY_11AM, MON_SAT);
    expect(planned).toEqual([]);
  });

  it('does NOT treat a saved draft as submitted', () => {
    // The brief is explicit: a draft neither satisfies the filing
    // requirement nor suppresses a reminder. A draft simply never appears in
    // the `submitted` set, so the warning still lands.
    const planned = planSweep(subjects, state(), TUESDAY_11AM, MON_SAT);
    expect(planned.map((e) => e.kind)).toEqual(['REMINDER_EVENING', 'REMINDER_FINAL', 'WARNING']);
  });

  it('stops everything while a leave claim is pending or approved', () => {
    const planned = planSweep(subjects, state({ leaveCovered: new Set([subjectKey(EMP, MONDAY)]) }), TUESDAY_11AM, MON_SAT);
    expect(planned).toEqual([]);
  });

  it('respects a submission made one minute before the deadline', () => {
    // The executor re-reads submission state immediately before planning, so
    // a report filed at 10:59 is already in the set by 11:00.
    const planned = planSweep(subjects, state({ submitted: new Set([subjectKey(EMP, MONDAY)]), sent: new Set([eventKey(EMP, MONDAY, 'REMINDER_EVENING'), eventKey(EMP, MONDAY, 'REMINDER_FINAL')]) }), TUESDAY_11AM, MON_SAT);
    expect(planned).toEqual([]);
  });
});

describe('reconciling a missed run', () => {
  it('catches up on every outstanding event and marks them as late', () => {
    // The sweep did not run for three days. It now sees Monday's three
    // events plus Tuesday's, all overdue.
    const subjects = [
      { employeeId: EMP, reportDate: MONDAY },
      { employeeId: EMP, reportDate: '2026-10-20' }
    ];
    const planned = planSweep(subjects, state(), new Date('2026-10-22T06:00:00Z'), MON_SAT);
    expect(planned).toHaveLength(6);
    // Every one is flagged as a catch-up, which is what the admin log shows.
    expect(planned.every((e) => e.late)).toBe(true);
    // Oldest first, so the employee's inbox reads chronologically rather
    // than Tuesday's reminder arriving before Monday's.
    expect(planned[0].reportDate).toBe(MONDAY);
    expect(planned[planned.length - 1].reportDate).toBe('2026-10-20');
  });

  it('leaves already-processed events alone while catching up on the rest', () => {
    const subjects = [{ employeeId: EMP, reportDate: MONDAY }];
    const sent = new Set([eventKey(EMP, MONDAY, 'REMINDER_EVENING')]);
    const planned = planSweep(subjects, state({ sent }), new Date('2026-10-22T06:00:00Z'), MON_SAT);
    expect(planned.map((e) => e.kind)).toEqual(['REMINDER_FINAL', 'WARNING']);
  });
});

describe('the sweep window', () => {
  it('covers only working days, back to the configured limit', () => {
    // Thursday 2026-10-22, window 7 days back to the 15th.
    const window = sweepWindow(new Date('2026-10-22T06:00:00Z'), 7, MON_SAT);
    expect(window[0]).toBe('2026-10-15');
    expect(window[window.length - 1]).toBe('2026-10-22');
    // Sunday the 18th is excluded, so no report is ever expected for it.
    expect(window).not.toContain('2026-10-18');
  });

  it('is bounded, so enabling the scheduler cannot reach back indefinitely', () => {
    const narrow = sweepWindow(new Date('2026-10-22T06:00:00Z'), 0, MON_SAT);
    expect(narrow).toEqual(['2026-10-22']);
  });

  it('uses the IST day, not the host day', () => {
    // 19:00Z on the 21st is already the 22nd in IST.
    const window = sweepWindow(new Date('2026-10-21T19:00:00Z'), 0, MON_SAT);
    expect(window).toEqual(['2026-10-22']);
  });
});

describe('HR escalation', () => {
  it('escalates only at or above the threshold', () => {
    const counts = new Map([
      [escalationKey(EMP, '2026-10'), 2],
      [escalationKey(EMP2, '2026-10'), 3]
    ]);
    const planned = planEscalations(counts, new Set(), 3);
    expect(planned).toHaveLength(1);
    expect(planned[0]).toEqual({ employeeId: EMP2, monthKey: '2026-10', activeWarnings: 3 });
  });

  it('escalates once per employee per calendar month, however many warnings follow', () => {
    const counts = new Map([[escalationKey(EMP, '2026-10'), 7]]);
    // Already escalated this month — the fourth, fifth and sixth missed day
    // keep being recorded as warnings but send no further escalation.
    expect(planEscalations(counts, new Set([escalationKey(EMP, '2026-10')]), 3)).toEqual([]);
  });

  it('escalates again in a new calendar month', () => {
    const counts = new Map([
      [escalationKey(EMP, '2026-10'), 4],
      [escalationKey(EMP, '2026-11'), 3]
    ]);
    const planned = planEscalations(counts, new Set([escalationKey(EMP, '2026-10')]), 3);
    expect(planned).toEqual([{ employeeId: EMP, monthKey: '2026-11', activeWarnings: 3 }]);
  });

  it('drops below the threshold when a warning is waived', () => {
    // Waived warnings are excluded from the count the store passes in, so
    // waiving the third one genuinely takes someone back under.
    const afterWaiver = new Map([[escalationKey(EMP, '2026-10'), 2]]);
    expect(planEscalations(afterWaiver, new Set(), 3)).toEqual([]);
  });

  it('honours a configured threshold other than three', () => {
    const counts = new Map([[escalationKey(EMP, '2026-10'), 2]]);
    expect(planEscalations(counts, new Set(), 2)).toHaveLength(1);
    expect(planEscalations(counts, new Set(), 5)).toHaveLength(0);
  });
});

describe('the employee banner', () => {
  it('counts up to the threshold', () => {
    expect(warningBanner(0, 3, false).headline).toBe('0 of 3 missed this month');
    expect(warningBanner(1, 3, false).headline).toBe('1 of 3 missed this month');
    expect(warningBanner(2, 3, false).headline).toBe('2 of 3 missed this month');
  });

  it('says "HR informed" once escalated, rather than continuing to count', () => {
    const banner = warningBanner(3, 3, true);
    expect(banner.headline).toBe('HR informed');
    expect(banner.tone).toBe('escalated');
    // Still mentions the count in the detail, so the employee knows where
    // they stand.
    expect(banner.detail).toContain('3 missed reports');
  });

  it('escalates its tone as the count approaches the threshold', () => {
    expect(warningBanner(0, 3, false).tone).toBe('clear');
    expect(warningBanner(1, 3, false).tone).toBe('notice');
    expect(warningBanner(2, 3, false).tone).toBe('warning');
  });

  it('tells the employee what to do about a missed date', () => {
    expect(warningBanner(1, 3, false).detail).toMatch(/leave claim/i);
    expect(warningBanner(2, 3, false).detail).toMatch(/one more/i);
  });
});

describe('missed-date pattern', () => {
  it('distinguishes a run of days from scattered ones', () => {
    expect(missedDatePattern([])).toBe('none');
    expect(missedDatePattern(['2026-10-19'])).toBe('single');
    expect(missedDatePattern(['2026-10-19', '2026-10-20', '2026-10-21'])).toBe('consecutive');
    expect(missedDatePattern(['2026-10-05', '2026-10-19', '2026-10-28'])).toBe('scattered');
  });

  it('reads a Saturday and the following Monday as consecutive', () => {
    // There is no working day between them, and "away for the weekend" is
    // what the label is for.
    expect(missedDatePattern(['2026-10-17', '2026-10-19'])).toBe('consecutive');
  });

  it('does not care what order the dates arrive in', () => {
    expect(missedDatePattern(['2026-10-21', '2026-10-19', '2026-10-20'])).toBe('consecutive');
  });
});

describe('Sales/GEM-Sales auto-submit', () => {
  const subjects = [{ employeeId: EMP, reportDate: MONDAY }];
  // Monday's report, auto-submitted 10:30 IST Tuesday — 30 minutes before
  // the 11:00 deadline/warning used throughout the rest of this file.
  const TUESDAY_1029AM = new Date('2026-10-20T04:59:00Z');
  const TUESDAY_1030AM = new Date('2026-10-20T05:00:00Z');

  it('issues nothing before the configured auto-submit time', () => {
    const planned = planAutoSubmits(subjects, state(), TUESDAY_1029AM, '10:30', MON_SAT);
    expect(planned).toEqual([]);
  });

  it('is due once the configured time passes, for an unsubmitted report', () => {
    const planned = planAutoSubmits(subjects, state(), TUESDAY_1030AM, '10:30', MON_SAT);
    expect(planned.map((p) => p.employeeId)).toEqual([EMP]);
    expect(planned[0].reportDate).toBe(MONDAY);
    expect(planned[0].late).toBe(false);
  });

  it('is not due for a report already submitted', () => {
    const submitted = new Set([subjectKey(EMP, MONDAY)]);
    const planned = planAutoSubmits(subjects, state({ submitted }), TUESDAY_1030AM, '10:30', MON_SAT);
    expect(planned).toEqual([]);
  });

  it('is not due for a date covered by a leave claim', () => {
    const leaveCovered = new Set([subjectKey(EMP, MONDAY)]);
    const planned = planAutoSubmits(subjects, state({ leaveCovered }), TUESDAY_1030AM, '10:30', MON_SAT);
    expect(planned).toEqual([]);
  });

  it("uses Monday's auto-submit time for a Saturday report, not Sunday's", () => {
    const saturday = [{ employeeId: EMP, reportDate: '2026-10-17' }];
    // Sunday 10:30 IST — nothing due yet, Monday is the next working day.
    const sundayMorning = new Date('2026-10-18T05:00:00Z');
    expect(planAutoSubmits(saturday, state(), sundayMorning, '10:30', MON_SAT)).toEqual([]);
    expect(planAutoSubmits(saturday, state(), TUESDAY_1030AM, '10:30', MON_SAT).length).toBe(1);
  });

  it('flags a catch-up run as late', () => {
    const now = new Date('2026-10-21T05:00:00Z'); // a full day after it was due
    const planned = planAutoSubmits(subjects, state(), now, '10:30', MON_SAT);
    expect(planned[0].late).toBe(true);
  });
});

describe('the 2-zero-day streak warning', () => {
  const D1 = '2026-10-19';
  const D2 = '2026-10-20';
  const D3 = '2026-10-21';

  it('does not warn on a single zero day', () => {
    const totals = new Map([[subjectKey(EMP, D1), 0]]);
    const planned = planZeroTotalWarnings(new Map([[EMP, [D1]]]), totals, new Set());
    expect(planned).toEqual([]);
  });

  it('warns on the second consecutive zero day', () => {
    const totals = new Map([
      [subjectKey(EMP, D1), 0],
      [subjectKey(EMP, D2), 0]
    ]);
    const planned = planZeroTotalWarnings(new Map([[EMP, [D1, D2]]]), totals, new Set());
    expect(planned).toEqual([{ employeeId: EMP, reportDate: D2 }]);
  });

  it('keeps warning on a third consecutive zero day too', () => {
    const totals = new Map([
      [subjectKey(EMP, D1), 0],
      [subjectKey(EMP, D2), 0],
      [subjectKey(EMP, D3), 0]
    ]);
    const planned = planZeroTotalWarnings(new Map([[EMP, [D1, D2, D3]]]), totals, new Set());
    expect(planned).toEqual([
      { employeeId: EMP, reportDate: D2 },
      { employeeId: EMP, reportDate: D3 }
    ]);
  });

  it('a non-zero day breaks the streak', () => {
    const totals = new Map([
      [subjectKey(EMP, D1), 0],
      [subjectKey(EMP, D2), 4],
      [subjectKey(EMP, D3), 0]
    ]);
    const planned = planZeroTotalWarnings(new Map([[EMP, [D1, D2, D3]]]), totals, new Set());
    expect(planned).toEqual([]);
  });

  it('a date that was never submitted breaks the streak rather than counting as zero', () => {
    // D2 has no entry at all — not submitted, so it is neither a zero day
    // nor a non-zero day, it simply is not there to extend the streak.
    const totals = new Map([
      [subjectKey(EMP, D1), 0],
      [subjectKey(EMP, D3), 0]
    ]);
    const planned = planZeroTotalWarnings(new Map([[EMP, [D1, D2, D3]]]), totals, new Set());
    expect(planned).toEqual([]);
  });

  it('does not re-warn a date already recorded', () => {
    const totals = new Map([
      [subjectKey(EMP, D1), 0],
      [subjectKey(EMP, D2), 0]
    ]);
    const alreadyWarned = new Set([subjectKey(EMP, D2)]);
    const planned = planZeroTotalWarnings(new Map([[EMP, [D1, D2]]]), totals, alreadyWarned);
    expect(planned).toEqual([]);
  });

  it('tracks a separate streak per employee', () => {
    const totals = new Map([
      [subjectKey(EMP, D1), 0],
      [subjectKey(EMP, D2), 0],
      [subjectKey(EMP2, D1), 5],
      [subjectKey(EMP2, D2), 0]
    ]);
    const datesByEmployee = new Map([
      [EMP, [D1, D2]],
      [EMP2, [D1, D2]]
    ]);
    const planned = planZeroTotalWarnings(datesByEmployee, totals, new Set());
    // EMP2's D1 was non-zero, so EMP2's D2 is only a first zero day, not a
    // second — only EMP warns.
    expect(planned).toEqual([{ employeeId: EMP, reportDate: D2 }]);
  });
});
