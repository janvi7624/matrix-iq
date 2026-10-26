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
  matchesNthWeekdayRule,
  monthKey,
  navigableWorkingDays,
  nthWeekdayOfMonth,
  nextWorkingDay,
  previousWorkingDay,
  scheduleFor,
  missingIsVisibleYet,
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

describe('the third-Saturday rule', () => {
  // Saturdays in Oct 2026: 3, 10, 17, 24, 31 — so the 17th is the third.
  const THIRD_SAT_OFF = { ...MON_SAT, offNthWeekdays: [{ nth: 3, weekday: 6 }] };

  it('counts which occurrence of its weekday a date is', () => {
    // Days 1-7 are the 1st occurrence, 8-14 the 2nd, and so on — which is
    // exactly what "third Saturday" means in ordinary use.
    expect(nthWeekdayOfMonth('2026-10-03')).toBe(1);
    expect(nthWeekdayOfMonth('2026-10-10')).toBe(2);
    expect(nthWeekdayOfMonth('2026-10-17')).toBe(3);
    expect(nthWeekdayOfMonth('2026-10-24')).toBe(4);
    expect(nthWeekdayOfMonth('2026-10-31')).toBe(5);
    // Boundaries of each 7-day block.
    expect(nthWeekdayOfMonth('2026-10-07')).toBe(1);
    expect(nthWeekdayOfMonth('2026-10-08')).toBe(2);
  });

  it('matches only the third Saturday, not the others', () => {
    const rules = [{ nth: 3, weekday: 6 }];
    expect(matchesNthWeekdayRule('2026-10-17', rules)).toBe(true);
    expect(matchesNthWeekdayRule('2026-10-10', rules)).toBe(false);
    expect(matchesNthWeekdayRule('2026-10-24', rules)).toBe(false);
    // Same ordinal, different weekday — the 3rd Wednesday is not affected.
    expect(matchesNthWeekdayRule('2026-10-21', rules)).toBe(false);
    expect(matchesNthWeekdayRule('2026-10-17', [])).toBe(false);
    expect(matchesNthWeekdayRule('2026-10-17', undefined)).toBe(false);
  });

  it('makes the third Saturday a non-working day', () => {
    expect(isWorkingDay('2026-10-17', THIRD_SAT_OFF)).toBe(false);
    // Every other Saturday still works.
    expect(isWorkingDay('2026-10-10', THIRD_SAT_OFF)).toBe(true);
    expect(isWorkingDay('2026-10-24', THIRD_SAT_OFF)).toBe(true);
    // And without the rule it is an ordinary working day.
    expect(isWorkingDay('2026-10-17', MON_SAT)).toBe(true);
  });

  it('finds the right Saturday in later months without being topped up', () => {
    // The point of a rule rather than a list of dates.
    for (const [date, off] of [
      ['2026-11-21', true],  // 3rd Sat of Nov
      ['2026-11-14', false],
      ['2026-12-19', true],  // 3rd Sat of Dec
      ['2027-01-16', true],  // 3rd Sat of Jan, a year later
      ['2027-01-09', false]
    ] as [string, boolean][]) {
      expect(isWorkingDay(date, THIRD_SAT_OFF), date).toBe(!off);
    }
  });

  it('pushes the Friday before it to the following Monday', () => {
    // Fri 16th -> Sat 17th is off -> Sun 18th is off -> Mon 19th.
    // This is the consequence that actually matters to an employee, and it
    // falls out of isWorkingDay rather than needing its own rule.
    const schedule = scheduleFor('2026-10-16', THIRD_SAT_OFF);
    expect(schedule.deadlineDate).toBe('2026-10-19');
    expect(schedule.deadlineAt.toISOString()).toBe('2026-10-19T05:30:00.000Z');
    // Without the rule, that Friday is simply due on the Saturday.
    expect(scheduleFor('2026-10-16', MON_SAT).deadlineDate).toBe('2026-10-17');
  });

  it('skips it when stepping through working days', () => {
    expect(nextWorkingDay('2026-10-16', THIRD_SAT_OFF)).toBe('2026-10-19');
    expect(previousWorkingDay('2026-10-19', THIRD_SAT_OFF)).toBe('2026-10-16');
    expect(workingDaysBetween('2026-10-15', '2026-10-20', THIRD_SAT_OFF)).toEqual([
      '2026-10-15',
      '2026-10-16',
      // 17th third Saturday, 18th Sunday — both absent.
      '2026-10-19',
      '2026-10-20'
    ]);
  });

  it('never expects a report on it, so no warning can arise', () => {
    // A date that is not a working day is never a reporting date, which is
    // what keeps it out of the sweep window entirely.
    expect(workingDaysBetween('2026-10-17', '2026-10-17', THIRD_SAT_OFF)).toEqual([]);
  });

  it('supports the other common Indian pattern, 2nd and 4th Saturday', () => {
    const policy = { ...MON_SAT, offNthWeekdays: [{ nth: 2, weekday: 6 }, { nth: 4, weekday: 6 }] };
    expect(isWorkingDay('2026-10-10', policy)).toBe(false);
    expect(isWorkingDay('2026-10-24', policy)).toBe(false);
    expect(isWorkingDay('2026-10-17', policy)).toBe(true);
  });

  it('simply does not apply in a month with no 5th Saturday', () => {
    const policy = { ...MON_SAT, offNthWeekdays: [{ nth: 5, weekday: 6 }] };
    // Oct 2026 has five Saturdays, Nov has four.
    expect(isWorkingDay('2026-10-31', policy)).toBe(false);
    expect(isWorkingDay('2026-11-28', policy)).toBe(true);
  });
});

describe('date navigation (the arrows on the employee page)', () => {
  // 2026-10-17 Sat, 2026-10-18 Sun, 2026-10-19 Mon, 2026-10-20 Tue.

  it('can always step back, and skips Sunday doing it', () => {
    expect(navigableWorkingDays('2026-10-19', '2026-10-22', MON_SAT).prev).toBe('2026-10-17');
    expect(navigableWorkingDays('2026-10-20', '2026-10-22', MON_SAT).prev).toBe('2026-10-19');
  });

  it('steps forward while the next working day has already happened', () => {
    expect(navigableWorkingDays('2026-10-19', '2026-10-22', MON_SAT).next).toBe('2026-10-20');
    // Saturday forward lands on Monday, not Sunday.
    expect(navigableWorkingDays('2026-10-17', '2026-10-22', MON_SAT).next).toBe('2026-10-19');
  });

  it('refuses to step into the future', () => {
    // THE regression: on the most recent working day there is nowhere
    // forward to go, so the arrow must be disabled rather than walking into
    // a day that has not started.
    expect(navigableWorkingDays('2026-10-22', '2026-10-22', MON_SAT).next).toBe('');
    // ...but back is still available, which is the other half of the ask.
    expect(navigableWorkingDays('2026-10-22', '2026-10-22', MON_SAT).prev).toBe('2026-10-21');
  });

  it('allows forward onto today itself', () => {
    // Yesterday -> today is not the future; the boundary is inclusive.
    expect(navigableWorkingDays('2026-10-21', '2026-10-22', MON_SAT).next).toBe('2026-10-22');
  });

  it('offers no forward step from Saturday when today is the Sunday after', () => {
    // Monday has not happened, so there is nothing forward even though
    // Saturday is not the newest calendar day.
    expect(navigableWorkingDays('2026-10-17', '2026-10-18', MON_SAT).next).toBe('');
    expect(navigableWorkingDays('2026-10-17', '2026-10-18', MON_SAT).prev).toBe('2026-10-16');
  });

  it('walks a long way back without limit', () => {
    // Someone who jumped to late September with the picker can still step.
    const nav = navigableWorkingDays('2026-09-25', '2026-10-22', MON_SAT);
    expect(nav.prev).toBe('2026-09-24');
    expect(nav.next).toBe('2026-09-26');
  });

  it('skips an observed holiday in both directions', () => {
    const policy = { ...MON_SAT, holidays: ['2026-10-20'], observeHolidays: true };
    expect(navigableWorkingDays('2026-10-19', '2026-10-24', policy).next).toBe('2026-10-21');
    expect(navigableWorkingDays('2026-10-21', '2026-10-24', policy).prev).toBe('2026-10-19');
  });

  it('crosses a month boundary in both directions', () => {
    // 2026-11-01 is a Sunday, so stepping back from Monday the 2nd lands on
    // Saturday 2026-10-31.
    expect(navigableWorkingDays('2026-11-02', '2026-11-05', MON_SAT).prev).toBe('2026-10-31');
    expect(navigableWorkingDays('2026-10-31', '2026-11-05', MON_SAT).next).toBe('2026-11-02');
  });
});

describe('display formatting', () => {
  it('renders an IST stamp without depending on the host ICU build', () => {
    expect(formatIst(new Date('2026-10-20T05:30:00Z'))).toBe('2026-10-20 11:00 IST');
  });
});

// The tracking start date — the day the module began counting. October was
// spent rehearsing the scheduler in dry-run, which claimed every notification
// slot without sending anything, so those dates were never really tracked.
// Counting them would have shown the whole company weeks behind on reports
// nobody was ever asked for.
describe('tracking start date', () => {
  const TRACKED: DeadlinePolicy = { ...MON_SAT, trackingStartDate: '2026-10-24' };

  it('is opt-in, so the date arithmetic is unchanged without one', () => {
    // Every other test in this file relies on this: a policy with no floor
    // behaves exactly as it did before the floor existed.
    expect(workingDaysBetween('2026-10-05', '2026-10-07', MON_SAT)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('reports nothing expected for a range entirely before it', () => {
    // [] is what makes past "missing" counts read as zero: the period summary
    // treats no obligation as a null compliance percentage, not 0%.
    expect(workingDaysBetween('2026-10-01', '2026-10-23', TRACKED)).toEqual([]);
  });

  it('clips a range that straddles it rather than refusing the whole thing', () => {
    // 2026-10-25 is a Sunday, so Saturday the 24th is followed by Monday 26th.
    expect(workingDaysBetween('2026-10-01', '2026-10-26', TRACKED)).toEqual(['2026-10-24', '2026-10-26']);
  });

  it('leaves a range that starts after it completely alone', () => {
    expect(workingDaysBetween('2026-10-26', '2026-10-28', TRACKED)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28']);
  });

  it('counts the start date itself', () => {
    // An off-by-one here would silently drop day one for everybody.
    expect(workingDaysBetween('2026-10-24', '2026-10-24', TRACKED)).toEqual(['2026-10-24']);
  });

  it('still honours the working-day rules inside the tracked range', () => {
    const withHoliday: DeadlinePolicy = { ...TRACKED, holidays: ['2026-10-26'], observeHolidays: true };
    expect(workingDaysBetween('2026-10-01', '2026-10-27', withHoliday)).toEqual(['2026-10-24', '2026-10-27']);
  });

  it('stops the back arrow at the start date', () => {
    // '' is the sentinel DailyReportView already renders as a disabled button
    // reading "No earlier day in your history".
    expect(navigableWorkingDays('2026-10-24', '2026-10-28', TRACKED).prev).toBe('');
    // ...but stepping back WITHIN the tracked range still works: 2026-10-25
    // is a Sunday, so Monday the 26th steps back to Saturday the 24th.
    expect(navigableWorkingDays('2026-10-26', '2026-10-28', TRACKED).prev).toBe('2026-10-24');
  });

  it('leaves the forward arrow governed by today, not by the floor', () => {
    expect(navigableWorkingDays('2026-10-24', '2026-10-28', TRACKED).next).toBe('2026-10-26');
    expect(navigableWorkingDays('2026-10-28', '2026-10-28', TRACKED).next).toBe('');
  });
});

// "Missing" is a judgement about a day that has finished being open, so it
// waits until the evening rather than appearing at midnight. Only the label
// waits: the obligation, the reminders and the warning are all unchanged.
describe('when an unfiled report starts reading as missing', () => {
  // 2026-10-26 13:30 IST == 08:00Z; 19:00 IST == 13:30Z.
  const at = (iso: string) => new Date(iso);

  it('says nothing is missing earlier in the day', () => {
    expect(missingIsVisibleYet('2026-10-26', at('2026-10-26T03:30:00Z'))).toBe(false); // 09:00 IST
    expect(missingIsVisibleYet('2026-10-26', at('2026-10-26T08:00:00Z'))).toBe(false); // 13:30 IST
  });

  it('turns over exactly at 19:00 IST, not a minute before', () => {
    expect(missingIsVisibleYet('2026-10-26', at('2026-10-26T13:29:00Z'))).toBe(false); // 18:59 IST
    expect(missingIsVisibleYet('2026-10-26', at('2026-10-26T13:30:00Z'))).toBe(true); // 19:00 IST
    expect(missingIsVisibleYet('2026-10-26', at('2026-10-26T15:00:00Z'))).toBe(true); // 20:30 IST
  });

  it('treats any earlier day as missing from the moment it closes', () => {
    // 00:30 IST on the 27th — the 26th is over, so it is missing even though
    // the cut-off time of day has not come round again.
    expect(missingIsVisibleYet('2026-10-26', at('2026-10-26T19:00:00Z'))).toBe(true);
    expect(missingIsVisibleYet('2026-10-19', at('2026-10-26T03:30:00Z'))).toBe(true);
  });

  it('never calls a future day missing', () => {
    expect(missingIsVisibleYet('2026-10-27', at('2026-10-26T15:00:00Z'))).toBe(false);
  });

  // The IST boundary is the bit most likely to be broken by a refactor: at
  // 19:30Z it is already the NEXT day in India, so today's date has moved on.
  it('reads the day in IST, not UTC', () => {
    // 2026-10-26T19:30:00Z is 2026-10-27 01:00 IST.
    expect(missingIsVisibleYet('2026-10-27', at('2026-10-26T19:30:00Z'))).toBe(false);
    expect(missingIsVisibleYet('2026-10-26', at('2026-10-26T19:30:00Z'))).toBe(true);
  });
});
