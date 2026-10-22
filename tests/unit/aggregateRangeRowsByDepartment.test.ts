import { describe, it, expect } from 'vitest';
import { aggregateRangeRowsByDepartment } from '../../lib/dailyReportService';
import { TeamDailyReportRangeRow } from '../../lib/dailyReportTypes';

function row(overrides: Partial<TeamDailyReportRangeRow> = {}): TeamDailyReportRangeRow {
  return {
    employee_id: `emp-${Math.random()}`,
    employee_name: 'Someone',
    employee_username: 'someone',
    department_id: 'dept-1',
    department_name: 'Sales',
    expected: 20,
    submitted: 18,
    submitted_late: 2,
    missing: 2,
    leave_covered: 0,
    compliance_percent: 90,
    ...overrides
  };
}

describe('aggregateRangeRowsByDepartment', () => {
  it('sums every numeric field across employees in the same department', () => {
    const rows = [
      row({ employee_id: 'a', expected: 20, submitted: 18, submitted_late: 2, missing: 2, leave_covered: 0 }),
      row({ employee_id: 'b', expected: 20, submitted: 15, submitted_late: 1, missing: 3, leave_covered: 2 })
    ];
    const result = aggregateRangeRowsByDepartment(rows);
    expect(result).toEqual([
      { department_id: 'dept-1', department_name: 'Sales', expected: 40, submitted: 33, submitted_late: 3, missing: 5, leave_covered: 2, compliance_percent: Math.round((33 / 38) * 100) }
    ]);
  });

  it('keeps separate departments as separate rows', () => {
    const rows = [
      row({ employee_id: 'a', department_id: 'dept-1', department_name: 'Sales' }),
      row({ employee_id: 'b', department_id: 'dept-2', department_name: 'Marketing' })
    ];
    const result = aggregateRangeRowsByDepartment(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.department_name)).toEqual(['Marketing', 'Sales']); // alphabetical
  });

  it('recomputes compliance_percent from the SUMMED totals, not by averaging the per-row percentages', () => {
    // Employee A: 10/10 (100%). Employee B: 0/10 (0%). A naive average would
    // say 50%; the correct answer from combined totals is 10/20 = 50% too
    // here, but with UNEQUAL expected counts the two diverge — this is the
    // case that actually catches an averaging bug.
    const rows = [
      row({ employee_id: 'a', expected: 2, submitted: 2, missing: 0, leave_covered: 0 }),
      row({ employee_id: 'b', expected: 18, submitted: 0, missing: 18, leave_covered: 0 })
    ];
    const result = aggregateRangeRowsByDepartment(rows);
    // Naive average of 100% and 0% = 50%. Correct combined = 2/20 = 10%.
    expect(result[0].compliance_percent).toBe(10);
  });

  it('excludes leave_covered from the compliance denominator, same as the per-employee row', () => {
    const rows = [row({ expected: 10, submitted: 5, missing: 0, leave_covered: 5 })];
    const result = aggregateRangeRowsByDepartment(rows);
    // 5 submitted / (10 expected - 5 leave) = 100%, not 50%.
    expect(result[0].compliance_percent).toBe(100);
  });

  it('reports 100% compliance for a department with nothing expected (nothing to fall short of)', () => {
    const rows = [row({ expected: 0, submitted: 0, missing: 0, leave_covered: 0 })];
    expect(aggregateRangeRowsByDepartment(rows)[0].compliance_percent).toBe(100);
  });

  it('returns an empty array for no rows', () => {
    expect(aggregateRangeRowsByDepartment([])).toEqual([]);
  });
});
