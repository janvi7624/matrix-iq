import { describe, it, expect } from 'vitest';
import { EligibleEmployee, effectiveStartFromAccount, employeeOwesDate, expandSubjects } from '../../lib/dailyReportEligibility';

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
    accountCreatedOn: '',
    ...over
  };
}

describe('joining date', () => {
  it('owes every date when neither a joining date nor a creation date is known', () => {
    // Most existing accounts predate the profile field, and refusing to
    // expect anything from them would silently exempt most of the company.
    expect(employeeOwesDate(employee(), '2020-01-02')).toBe(true);
  });

  it('falls back to the account creation date when the joining date is blank', () => {
    // The 2026-11-12 incident: two accounts created that day were warned for
    // missing 2026-11-05, a week before they had a login. dateOfJoining was
    // null and the old default was "owes every date", so the sweep billed
    // them for days that predated their own existence.
    const fresh = employee({ dateOfJoining: '', accountCreatedOn: '2026-11-12' });
    expect(employeeOwesDate(fresh, '2026-11-05')).toBe(false);
    expect(employeeOwesDate(fresh, '2026-11-11')).toBe(false);
    expect(employeeOwesDate(fresh, '2026-11-12')).toBe(true);
    expect(employeeOwesDate(fresh, '2026-11-13')).toBe(true);
  });

  it('prefers a real joining date over the creation date, in both directions', () => {
    // Someone hired long before their login was created still owes the days
    // since they were hired...
    const backdated = employee({ dateOfJoining: '2026-01-23', accountCreatedOn: '2026-08-13' });
    expect(employeeOwesDate(backdated, '2026-02-02')).toBe(true);
    // ...and someone whose account was made before they started does not owe
    // the gap in between.
    const earlyAccount = employee({ dateOfJoining: '2026-12-01', accountCreatedOn: '2026-11-12' });
    expect(employeeOwesDate(earlyAccount, '2026-11-20')).toBe(false);
    expect(employeeOwesDate(earlyAccount, '2026-12-01')).toBe(true);
  });

  it('does not exempt an account outright just because HR left the joining date blank', () => {
    // The opposite failure mode: a blank joining date must not mean "owes
    // nothing", or 12 active accounts would quietly stop being counted.
    const fresh = employee({ dateOfJoining: '', accountCreatedOn: '2026-11-12' });
    expect(employeeOwesDate(fresh, '2026-11-20')).toBe(true);
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

describe('effective start date from the account timestamp', () => {
  // All times below are real values from the users table.
  it('uses the IST calendar day, not the UTC one', () => {
    // 19:00 UTC on the 12th is 00:30 IST on the 13th. Slicing the ISO string
    // would have billed this account for the 12th, a day it did not exist in
    // the only timezone this module reasons in.
    expect(effectiveStartFromAccount('2026-11-12T19:00:00.000Z', '11:30')).toBe('2026-11-13');
  });

  it('starts the next day when the account was created after the deadline', () => {
    // Jagdishbhai Makwana: 11:58 UTC = 17:28 IST, deadline 11:30. The day was
    // already unwinnable when the login appeared.
    expect(effectiveStartFromAccount('2026-11-12T11:58:55.710Z', '11:30')).toBe('2026-11-13');
  });

  it('starts the same day when there was still time to file', () => {
    // SHIVAM JAVIYA: 04:58 UTC = 10:28 IST, an hour before the 11:30 deadline.
    expect(effectiveStartFromAccount('2026-11-12T04:58:57.370Z', '11:30')).toBe('2026-11-12');
  });

  it('treats the deadline minute itself as still in time', () => {
    expect(effectiveStartFromAccount('2026-11-12T06:00:00.000Z', '11:30')).toBe('2026-11-12');
  });

  it('returns no floor when the timestamp is missing or unparseable', () => {
    expect(effectiveStartFromAccount(null, '11:30')).toBe('');
    expect(effectiveStartFromAccount('not-a-date', '11:30')).toBe('');
  });
});
