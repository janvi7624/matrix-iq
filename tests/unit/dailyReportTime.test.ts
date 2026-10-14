import { describe, it, expect } from 'vitest';
import {
  DeadlinePolicy,
  IST_OFFSET_MINUTES,
  addDays,
  dayOfWeek,
  formatIst,
  isClockTime,
  isIsoDate,
  isLateSubmission,
  isWorkingDay,
  istClock,
  istDate,
  istInstant,
  monthKey,
  nextWorkingDay,
  previousWorkingDay,
  scheduleFor,
  workingDaysBetween
} from '../../lib/dailyReportTime';

// The deadline arithmetic is the module's load-bearing rule: it decides
// whether a report is late, when a reminder fires, and whether a warning is
// recorded. These tests pin the cases the business actually specified
// (Mon–Sat working week, 11:00 next-working-day deadline, Saturday's report
// due Monday, Sunday excluded) plus the timezone boundaries where a
// fixed-offset implementation would be wrong if it were wrong at all.

const MON_SAT: DeadlinePolicy = {
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: [],
  observeHolidays: false,
  deadlineTime: '11:00',
  eveningReminderTime: '21:00',
  finalReminderTime: '10:00'
};

describe('IST date/instant conversion', () => {
  it('uses a fixed +05:30 offset', () => {
    expect(IST_OFFSET_MINUTES).toBe(330);
  });

  it('maps an instant to the IST calendar day it falls on', () => {
    // 2026-10-14T18:30:00Z is exactly midnight IST on the 15th.
    expect(istDate(new Date('2026-10-14T18:30:00Z'))).toBe('2026-10-15');
    expect(istClock(new Date('2026-10-14T18:30:00Z'))).toBe('00:00');
    // One minute earlier is still the 14th in IST.
    expect(istDate(new Date('2026-10-14T18:29:00Z'))).toBe('2026-10-14');
    expect(istClock(new Date('2026-10-14T18:29:00Z'))).toBe('23:59');
  });

  it('is the exact inverse of istInstant', () => {
    const instant = istInstant('2026-10-15', '11:00');
    expect(instant.toISOString()).toBe('2026-10-15T05:30:00.000Z');
    expect(istDate(instant)).toBe('2026-10-15');
    expect(istClock(instant)).toBe('11:00');
  });

  it('keeps a UTC-evening instant on the correct IST day', () => {
    // This is the bug a naive server-local implementation produces: between
    // 18:30Z and 24:00Z the IST date is already tomorrow.
    expect(istDate(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01');
    expect(monthKey(istDate(new Date('2026-12-31T19:00:00Z')))).toBe('2027-01');
  });
});

describe('date validation', () => {
  it('accepts real dates and rejects impossible ones', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    // 2026 is not a leap year, so the 29th does not exist — Date.UTC would
    // silently roll this over to March 1st.
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-10-32')).toBe(false);
    expect(isIsoDate('14-10-2026')).toBe(false);
    expect(isIsoDate('')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });

  it('accepts 24-hour clock times only', () => {
    expect(isClockTime('00:00')).toBe(true);
    expect(isClockTime('23:59')).toBe(true);
    expect(isClockTime('11:00')).toBe(true);
    expect(isClockTime('24:00')).toBe(false);
    expect(isClockTime('9:00')).toBe(false);
    expect(isClockTime('11:60')).toBe(false);
  });
});

describe('calendar arithmetic', () => {
  it('adds and subtracts days across month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('reports day of week with Sunday = 0', () => {
    // 2026-10-17 is a Saturday, 2026-10-18 a Sunday, 2026-10-19 a Monday.
    expect(dayOfWeek('2026-10-17')).toBe(6);
    expect(dayOfWeek('2026-10-18')).toBe(0);
    expect(dayOfWeek('2026-10-19')).toBe(1);
  });

  it('derives the month key by calendar month, not by a 30-day window', () => {
    expect(monthKey('2026-10-01')).toBe('2026-10');
    expect(monthKey('2026-10-31')).toBe('2026-10');
    expect(monthKey('2026-11-01')).toBe('2026-11');
  });
});

describe('working days', () => {
  it('treats Monday to Saturday as working days and Sunday as not', () => {
    expect(isWorkingDay('2026-10-19', MON_SAT)).toBe(true); // Mon
    expect(isWorkingDay('2026-10-17', MON_SAT)).toBe(true); // Sat
    expect(isWorkingDay('2026-10-18', MON_SAT)).toBe(false); // Sun
  });

  it('treats public holidays as working days until the calendar is observed', () => {
    const withHoliday = { ...MON_SAT, holidays: ['2026-10-19'] };
    // observeHolidays is false — the documented interim policy. The list is
    // stored but inert, so the day is still a working day.
    expect(isWorkingDay('2026-10-19', withHoliday)).toBe(true);
    expect(isWorkingDay('2026-10-19', { ...withHoliday, observeHolidays: true })).toBe(false);
  });

  it('skips Sunday when walking forward and backward', () => {
    expect(nextWorkingDay('2026-10-17', MON_SAT)).toBe('2026-10-19'); // Sat -> Mon
    expect(nextWorkingDay('2026-10-19', MON_SAT)).toBe('2026-10-20'); // Mon -> Tue
    expect(previousWorkingDay('2026-10-19', MON_SAT)).toBe('2026-10-17'); // Mon -> Sat
  });

  it('skips an observed holiday as well as Sunday', () => {
    const policy = { ...MON_SAT, holidays: ['2026-10-19'], observeHolidays: true };
    // Saturday's next working day becomes Tuesday once Monday is a holiday.
    expect(nextWorkingDay('2026-10-17', policy)).toBe('2026-10-20');
  });

  it('throws rather than looping forever on an empty working week', () => {
    expect(() => nextWorkingDay('2026-10-19', { ...MON_SAT, workingDays: [] })).toThrow(/working-day configuration/);
  });

  it('enumerates only the working days in a range', () => {
    // 2026-10-16 (Fri) .. 2026-10-20 (Tue) — Sunday the 18th drops out.
    expect(workingDaysBetween('2026-10-16', '2026-10-20', MON_SAT)).toEqual(['2026-10-16', '2026-10-17', '2026-10-19', '2026-10-20']);
  });
});

describe('the reporting deadline', () => {
  it('is 11:00 IST on the next working day', () => {
    const schedule = scheduleFor('2026-10-19', MON_SAT); // Monday
    expect(schedule.deadlineDate).toBe('2026-10-20');
    expect(schedule.deadlineAt.toISOString()).toBe('2026-10-20T05:30:00.000Z');
  });

  it("makes Saturday's report due Monday at 11:00, not Sunday", () => {
    // The headline case from the brief, and the one a naive "+1 day" would
    // get wrong.
    const schedule = scheduleFor('2026-10-17', MON_SAT); // Saturday
    expect(schedule.deadlineDate).toBe('2026-10-19'); // Monday
    expect(schedule.deadlineAt.toISOString()).toBe('2026-10-19T05:30:00.000Z');
  });

  it('places the two reminders at 9 PM on the day and 10 AM on the deadline day', () => {
    const schedule = scheduleFor('2026-10-17', MON_SAT); // Saturday
    // 21:00 IST on the reporting date itself.
    expect(schedule.eveningReminderAt.toISOString()).toBe('2026-10-17T15:30:00.000Z');
    // 10:00 IST on Monday — exactly one hour before the deadline.
    expect(schedule.finalReminderAt.toISOString()).toBe('2026-10-19T04:30:00.000Z');
    expect(schedule.deadlineAt.getTime() - schedule.finalReminderAt.getTime()).toBe(60 * 60 * 1000);
  });

  it('crosses a month boundary correctly', () => {
    // 2026-10-31 is a Saturday, so its deadline is Monday 2026-11-02 — the
    // deadline is in a different month from the reporting date, while the
    // warning (if any) still belongs to October.
    const schedule = scheduleFor('2026-10-31', MON_SAT);
    expect(dayOfWeek('2026-10-31')).toBe(6);
    expect(schedule.deadlineDate).toBe('2026-11-02');
    expect(monthKey(schedule.reportDate)).toBe('2026-10');
    expect(monthKey(schedule.deadlineDate)).toBe('2026-11');
  });
});

describe('on-time vs late', () => {
  const reportDate = '2026-10-19'; // Monday, due Tuesday 11:00 IST

  it('is on time up to and including the deadline instant', () => {
    expect(isLateSubmission(reportDate, new Date('2026-10-19T12:00:00Z'), MON_SAT)).toBe(false);
    // 10:59 IST on the deadline day.
    expect(isLateSubmission(reportDate, new Date('2026-10-20T05:29:00Z'), MON_SAT)).toBe(false);
    // Exactly 11:00 IST — the boundary is inclusive, so this is not late.
    expect(isLateSubmission(reportDate, new Date('2026-10-20T05:30:00Z'), MON_SAT)).toBe(false);
  });

  it('is late one minute after the deadline', () => {
    expect(isLateSubmission(reportDate, new Date('2026-10-20T05:31:00Z'), MON_SAT)).toBe(true);
  });

  it("does not make a Saturday report late just because Sunday passed", () => {
    // Submitted Sunday evening IST — well after "the next day", but before
    // Monday 11:00, which is the actual deadline.
    expect(isLateSubmission('2026-10-17', new Date('2026-10-18T16:00:00Z'), MON_SAT)).toBe(false);
    // Monday 11:01 IST is late.
    expect(isLateSubmission('2026-10-17', new Date('2026-10-19T05:31:00Z'), MON_SAT)).toBe(true);
  });
});

describe('display formatting', () => {
  it('renders an IST stamp without depending on the host ICU build', () => {
    expect(formatIst(new Date('2026-10-20T05:30:00Z'))).toBe('2026-10-20 11:00 IST');
  });
});
