import { describe, it, expect } from 'vitest';
import {
  DepartmentPeriodSummary,
  PeriodLeave,
  PeriodReport,
  PeriodSubject,
  emptyTotals,
  rollUp,
  summarisePeriodByDepartment,
  summarisePeriodByEmployee,
  worstFirst
} from '../../lib/dailyReportPeriodSummary';

// Compliance over a period. The classification decisions are the whole point
// of this module, so each one is pinned: an approved leave day is not a
// failure, a pending claim does not excuse anything, and a draft is not a
// filed report.

const subject = (employeeId: string, reportDate: string): PeriodSubject => ({ employeeId, reportDate });

const DAYS = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'];
const owedAll = (employeeId: string) => DAYS.map((d) => subject(employeeId, d));

describe('summarisePeriodByEmployee', () => {
  it('counts an on-time report', () => {
    const reports: PeriodReport[] = DAYS.map((d) => ({ employeeId: 'a', reportDate: d, submissionStatus: 'SUBMITTED' }));
    const [row] = summarisePeriodByEmployee(owedAll('a'), reports);
    expect(row).toMatchObject({
      employeeId: 'a', owed: 5, expected: 5, onTime: 5, late: 0, filed: 5, missing: 0,
      filedPercent: 100, onTimePercent: 100
    });
  });

  it('separates late from on time, because they are different questions', () => {
    const reports: PeriodReport[] = [
      { employeeId: 'a', reportDate: '2026-10-01', submissionStatus: 'SUBMITTED' },
      { employeeId: 'a', reportDate: '2026-10-02', submissionStatus: 'SUBMITTED_LATE' },
      { employeeId: 'a', reportDate: '2026-10-05', submissionStatus: 'SUBMITTED_LATE' }
    ];
    const [row] = summarisePeriodByEmployee(owedAll('a'), reports);
    expect(row).toMatchObject({ onTime: 1, late: 2, filed: 3, missing: 2 });
    // Everything arrived for 3 of 5, but only 1 of 5 arrived on time.
    expect(row.filedPercent).toBe(60);
    expect(row.onTimePercent).toBe(20);
  });

  // A draft means somebody opened the form. It is not a report.
  it('counts a draft as missing', () => {
    const reports: PeriodReport[] = [{ employeeId: 'a', reportDate: '2026-10-01', submissionStatus: 'DRAFT' }];
    const [row] = summarisePeriodByEmployee(owedAll('a'), reports);
    expect(row).toMatchObject({ onTime: 0, late: 0, filed: 0, missing: 5 });
  });

  it('counts nothing filed as entirely missing', () => {
    const [row] = summarisePeriodByEmployee(owedAll('a'), []);
    expect(row).toMatchObject({ owed: 5, expected: 5, missing: 5, filedPercent: 0, onTimePercent: 0 });
  });

  describe('leave', () => {
    // Sanctioned leave is not a failure to do anything, so it comes out of the
    // denominator rather than counting against the person.
    it('excuses an approved leave day and removes it from what was expected', () => {
      const leave: PeriodLeave[] = [
        { employeeId: 'a', reportDate: '2026-10-01', status: 'APPROVED' },
        { employeeId: 'a', reportDate: '2026-10-02', status: 'APPROVED' }
      ];
      const reports: PeriodReport[] = [
        { employeeId: 'a', reportDate: '2026-10-05', submissionStatus: 'SUBMITTED' },
        { employeeId: 'a', reportDate: '2026-10-06', submissionStatus: 'SUBMITTED' },
        { employeeId: 'a', reportDate: '2026-10-07', submissionStatus: 'SUBMITTED' }
      ];
      const [row] = summarisePeriodByEmployee(owedAll('a'), reports, leave);
      expect(row).toMatchObject({ owed: 5, onLeave: 2, expected: 3, filed: 3, missing: 0 });
      // 100%, not 60% — the two leave days were never owed.
      expect(row.filedPercent).toBe(100);
    });

    // Otherwise a compliance figure could be improved by filing a claim nobody
    // has looked at yet.
    it('does NOT excuse a pending claim', () => {
      const leave: PeriodLeave[] = DAYS.map((d) => ({ employeeId: 'a', reportDate: d, status: 'PENDING' }));
      const [row] = summarisePeriodByEmployee(owedAll('a'), [], leave);
      expect(row).toMatchObject({ onLeave: 0, expected: 5, missing: 5, filedPercent: 0 });
    });

    it('does not excuse a rejected claim either', () => {
      const leave: PeriodLeave[] = [{ employeeId: 'a', reportDate: '2026-10-01', status: 'REJECTED' }];
      const [row] = summarisePeriodByEmployee(owedAll('a'), [], leave);
      expect(row.onLeave).toBe(0);
      expect(row.expected).toBe(5);
    });

    it('has no percentage at all when every day was excused', () => {
      const leave: PeriodLeave[] = DAYS.map((d) => ({ employeeId: 'a', reportDate: d, status: 'APPROVED' }));
      const [row] = summarisePeriodByEmployee(owedAll('a'), [], leave);
      expect(row).toMatchObject({ owed: 5, onLeave: 5, expected: 0, missing: 0 });
      // Null, not 0 — somebody who owed nothing has not failed at anything,
      // and 0% would read as total non-compliance.
      expect(row.filedPercent).toBeNull();
      expect(row.onTimePercent).toBeNull();
    });
  });

  // A report filed on a non-working day, or by someone not yet eligible, is
  // real but is not evidence against an obligation that never existed —
  // counting it could push a percentage past 100.
  it('ignores a report with no matching obligation', () => {
    const reports: PeriodReport[] = [
      { employeeId: 'a', reportDate: '2026-10-01', submissionStatus: 'SUBMITTED' },
      { employeeId: 'a', reportDate: '2026-10-03', submissionStatus: 'SUBMITTED' },
      { employeeId: 'a', reportDate: '2026-10-04', submissionStatus: 'SUBMITTED' }
    ];
    const [row] = summarisePeriodByEmployee(owedAll('a'), reports);
    expect(row.filed).toBe(1);
    expect(row.filedPercent).toBe(20);
    expect(row.filedPercent).toBeLessThanOrEqual(100);
  });

  it('ignores a report belonging to somebody who owed nothing', () => {
    const reports: PeriodReport[] = [{ employeeId: 'ghost', reportDate: '2026-10-01', submissionStatus: 'SUBMITTED' }];
    const rows = summarisePeriodByEmployee(owedAll('a'), reports);
    expect(rows).toHaveLength(1);
    expect(rows[0].employeeId).toBe('a');
  });

  it('keeps each person separate', () => {
    const subjects = [...owedAll('a'), ...owedAll('b')];
    const reports: PeriodReport[] = DAYS.map((d) => ({ employeeId: 'a', reportDate: d, submissionStatus: 'SUBMITTED' }));
    const rows = summarisePeriodByEmployee(subjects, reports).sort((x, y) => x.employeeId.localeCompare(y.employeeId));
    expect(rows.map((r) => [r.employeeId, r.filedPercent])).toEqual([['a', 100], ['b', 0]]);
  });

  it('returns nothing when nobody owed anything', () => {
    expect(summarisePeriodByEmployee([], [])).toEqual([]);
  });

  // The actual bug report: "This Month" selected while the month is still in
  // progress reported every remaining working day as missing before anyone
  // could have filed it — e.g. picking October on the 29th counted the 30th
  // and 31st against everybody. `now` is what opts a caller into excluding a
  // day that has not reached its own deadline yet (missingIsVisibleYet).
  describe('a day that has not reached its deadline yet (the `now` parameter)', () => {
    const PAST = ['2026-10-26', '2026-10-27'];
    const FUTURE_IN_RANGE = ['2026-10-30', '2026-10-31'];
    const ALL = [...PAST, ...FUTURE_IN_RANGE];
    const subjectsFor = (employeeId: string) => ALL.map((d) => subject(employeeId, d));
    // 2026-10-29, well past the default MISSING_VISIBLE_AFTER cutoff (18:30
    // IST) — the two PAST days are genuinely missing-visible; the two
    // FUTURE_IN_RANGE days (30th, 31st) have not happened yet relative to
    // this `now` regardless of the clock, since missingIsVisibleYet treats
    // any date after today as never-yet-visible.
    const NOW = new Date('2026-10-29T20:00:00+05:30');

    it('without `now` (every existing caller), future-in-range days still count as owed and missing — unchanged', () => {
      const [row] = summarisePeriodByEmployee(subjectsFor('a'), []);
      expect(row).toMatchObject({ owed: 4, expected: 4, missing: 4 });
    });

    it('with `now`, a day not yet due is excluded from owed/missing entirely', () => {
      const [row] = summarisePeriodByEmployee(subjectsFor('a'), [], [], NOW);
      // Only the 2 PAST days are owed — the 2 future-in-range days are not
      // counted against anyone yet.
      expect(row).toMatchObject({ owed: 2, expected: 2, missing: 2, filedPercent: 0 });
    });

    it('a day not yet due that was already filed still counts — filing early is never ignored', () => {
      const reports: PeriodReport[] = [{ employeeId: 'a', reportDate: '2026-10-30', submissionStatus: 'SUBMITTED' }];
      const [row] = summarisePeriodByEmployee(subjectsFor('a'), reports, [], NOW);
      // The 2 past days (missing) + the 1 early-filed future day (on time) —
      // the 31st, genuinely not filed and not yet due, still excluded.
      expect(row).toMatchObject({ owed: 3, onTime: 1, missing: 2, filed: 1 });
    });

    it('an employee whose ONLY obligations are not yet due still appears, with nothing counted against them', () => {
      const [row] = summarisePeriodByEmployee([subject('a', '2026-10-31')], [], [], NOW);
      expect(row).toMatchObject({ owed: 0, expected: 0, missing: 0, filedPercent: null });
    });

    it('still excuses approved leave on a not-yet-due day the same as any other day', () => {
      const leave: PeriodLeave[] = [{ employeeId: 'a', reportDate: '2026-10-30', status: 'APPROVED' }];
      const [row] = summarisePeriodByEmployee(subjectsFor('a'), [], leave, NOW);
      expect(row).toMatchObject({ owed: 3, onLeave: 1, expected: 2, missing: 2 });
    });

    // The literal "after deadline only" case: TODAY itself, before vs. after
    // the 18:30 IST cutoff — not a future date at all, just too early in the
    // same day.
    it('does not count TODAY as missing before 18:30 IST, even with nothing filed yet', () => {
      const [row] = summarisePeriodByEmployee([subject('a', '2026-10-29')], [], [], new Date('2026-10-29T09:00:00+05:30'));
      expect(row).toMatchObject({ owed: 0, missing: 0, filedPercent: null });
    });

    it('counts TODAY as missing once 18:30 IST has passed, same as any other day', () => {
      const [row] = summarisePeriodByEmployee([subject('a', '2026-10-29')], [], [], new Date('2026-10-29T19:00:00+05:30'));
      expect(row).toMatchObject({ owed: 1, missing: 1, filedPercent: 0 });
    });
  });
});

describe('rollUp', () => {
  it('sums the counts and recomputes the percentage from the totals', () => {
    const a = summarisePeriodByEmployee(owedAll('a'), DAYS.map((d) => ({ employeeId: 'a', reportDate: d, submissionStatus: 'SUBMITTED' as const })));
    const b = summarisePeriodByEmployee(owedAll('b'), []);
    const total = rollUp([...a, ...b]);
    expect(total).toMatchObject({ owed: 10, expected: 10, filed: 5, missing: 5 });
    // 50% of ten, not the average of 100% and 0% — which would coincide here
    // but diverges the moment the two people owe different amounts.
    expect(total.filedPercent).toBe(50);
  });

  it('weights by volume rather than averaging percentages', () => {
    // One person owing 1 day and filing it, another owing 9 and filing none.
    const one = summarisePeriodByEmployee([subject('a', '2026-10-01')], [{ employeeId: 'a', reportDate: '2026-10-01', submissionStatus: 'SUBMITTED' }]);
    const nine = summarisePeriodByEmployee(
      Array.from({ length: 9 }, (_, i) => subject('b', `2026-10-${String(i + 10).padStart(2, '0')}`)),
      []
    );
    const total = rollUp([...one, ...nine]);
    // 1 of 10 = 10%. Averaging the two people's percentages would say 50%.
    expect(total.filedPercent).toBe(10);
  });

  it('is an empty set of totals for no rows', () => {
    expect(rollUp([])).toEqual(emptyTotals());
  });
});

describe('summarisePeriodByDepartment', () => {
  const dept = (id: string, name: string) => ({ id, name });
  const lookup: Record<string, { id: string; name: string } | null> = {
    a: dept('ai', 'AI'),
    b: dept('ai', 'AI'),
    c: dept('av', 'AV'),
    d: null
  };

  const employees = summarisePeriodByEmployee(
    [...owedAll('a'), ...owedAll('b'), ...owedAll('c'), ...owedAll('d')],
    DAYS.map((x) => ({ employeeId: 'a', reportDate: x, submissionStatus: 'SUBMITTED' as const }))
  );

  const rows = summarisePeriodByDepartment(employees, (id) => lookup[id] ?? null);

  it('groups people and counts how many owed anything', () => {
    const ai = rows.find((r) => r.departmentId === 'ai');
    expect(ai).toMatchObject({ departmentName: 'AI', people: 2, owed: 10, filed: 5, missing: 5 });
    expect(ai?.filedPercent).toBe(50);
  });

  // A summary whose parts do not add up to its whole is worse than one with an
  // awkward row in it.
  it('keeps an employee with no department rather than dropping them', () => {
    const none = rows.find((r) => r.departmentId === '');
    expect(none).toMatchObject({ departmentName: 'No department', people: 1, owed: 5 });
    expect(rows.reduce((sum, r) => sum + r.owed, 0)).toBe(20);
  });

  it('sorts by department name', () => {
    expect(rows.map((r) => r.departmentName)).toEqual(['AI', 'AV', 'No department']);
  });
});

describe('worstFirst', () => {
  const row = (name: string, missing: number, expected: number): DepartmentPeriodSummary => ({
    ...emptyTotals(),
    departmentId: name,
    departmentName: name,
    people: 1,
    owed: expected,
    expected,
    missing,
    filed: expected - missing,
    filedPercent: expected ? Math.round(((expected - missing) / expected) * 100) : null
  });

  // A nine-person department at 80% has more unfiled reports than one person
  // at 0%, and the nine are the bigger problem.
  it('orders by how many reports are actually missing, not by percentage', () => {
    const ordered = worstFirst([row('OnePersonAtZero', 1, 1), row('BigTeam', 9, 45)]);
    expect(ordered.map((r) => r.departmentName)).toEqual(['BigTeam', 'OnePersonAtZero']);
  });

  it('breaks a tie on the worse percentage', () => {
    const ordered = worstFirst([row('Better', 2, 20), row('Worse', 2, 4)]);
    expect(ordered.map((r) => r.departmentName)).toEqual(['Worse', 'Better']);
  });

  it('drops departments with nothing expected, since there is nothing to act on', () => {
    expect(worstFirst([row('Idle', 0, 0)])).toEqual([]);
  });
});
