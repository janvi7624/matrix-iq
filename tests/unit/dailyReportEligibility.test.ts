import { describe, it, expect } from 'vitest';
import { EligibleEmployee, employeeOwesDate, expandSubjects } from '../../lib/dailyReportEligibility';

// Who owes a report on which day. The exclusions here are the difference
// between a compliance tool people trust and one that warns a new joiner
// for every working day before they were hired.

function employee(over: Partial<EligibleEmployee> = {}): EligibleEmployee {
  return {
    id: 'emp-1',
    username: 'priya',
    name: 'Priya',
    email: 'priya@example.com',
    departmentId: 'dept-1',
    departmentName: 'Marketing',
    templateKey: 'marketing',
    dateOfJoining: '',
    ...over
  };
}

describe('joining date', () => {
  it('owes every date when no joining date is recorded', () => {
    // Most existing accounts predate the profile field, and refusing to
    // expect anything from them would silently exempt most of the company.
    expect(employeeOwesDate(employee(), '2020-01-02')).toBe(true);
  });

  it('owes nothing before the joining date', () => {
    const joiner = employee({ dateOfJoining: '2026-10-19' });
    expect(employeeOwesDate(joiner, '2026-10-16')).toBe(false);
    expect(employeeOwesDate(joiner, '2026-10-17')).toBe(false);
  });

  it('owes the joining date itself and everything after', () => {
    const joiner = employee({ dateOfJoining: '2026-10-19' });
    expect(employeeOwesDate(joiner, '2026-10-19')).toBe(true);
    expect(employeeOwesDate(joiner, '2026-10-20')).toBe(true);
  });
});

describe('expanding the subject list', () => {
  const dates = ['2026-10-16', '2026-10-17', '2026-10-19'];

  it('pairs every employee with every date they owe', () => {
    const subjects = expandSubjects([employee({ id: 'a' }), employee({ id: 'b' })], dates);
    expect(subjects).toHaveLength(6);
    expect(subjects.filter((s) => s.employeeId === 'a').map((s) => s.reportDate)).toEqual(dates);
  });

  it('drops the dates a new joiner does not owe', () => {
    const subjects = expandSubjects([employee({ id: 'a' }), employee({ id: 'b', dateOfJoining: '2026-10-19' })], dates);
    // 3 for the existing employee, 1 for the joiner.
    expect(subjects).toHaveLength(4);
    expect(subjects.filter((s) => s.employeeId === 'b')).toEqual([{ employeeId: 'b', reportDate: '2026-10-19' }]);
  });

  it('produces nothing for an empty roster or an empty window', () => {
    expect(expandSubjects([], dates)).toEqual([]);
    expect(expandSubjects([employee()], [])).toEqual([]);
  });
});
