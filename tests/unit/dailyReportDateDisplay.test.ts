import { describe, it, expect } from 'vitest';
import {
  formatIstClock,
  formatIstDate,
  formatIstDateTime,
  formatIstDayShort,
  formatIstWeekday
} from '../../lib/dailyReportTime';

// How the Daily Report module writes a date on screen.
//
// Every one of these used to be toLocaleDateString('en-IN', …), which put a
// comma into the middle of a date ("02 Nov, 6:58 pm", "Mon, 2 Nov") while
// also dropping the year — so a "Submitted" stamp read as a truncation. The
// format is fixed here instead of asked of ICU, for the same reason
// formatIst is: the module computes IST arithmetically and the string it
// shows must not depend on the build it renders on.
//
// The no-comma rule gets its own assertion at the bottom, because that is
// the part a future "let's just use toLocaleString" would quietly undo.

describe('formatIstDate', () => {
  it('writes a stored date the way a person reads it', () => {
    expect(formatIstDate('2026-11-02')).toBe('02 Nov 2026');
    expect(formatIstDate('2026-01-09')).toBe('09 Jan 2026');
    expect(formatIstDate('2026-12-31')).toBe('31 Dec 2026');
  });

  it('always carries the year', () => {
    expect(formatIstDate('2025-11-02')).toContain('2025');
    expect(formatIstDate('2026-11-02')).toContain('2026');
  });

  // A date field can hold whatever was typed before it validated. Showing it
  // back beats showing "Invalid Date" or an empty cell.
  it('passes anything that is not an ISO date straight through', () => {
    expect(formatIstDate('')).toBe('');
    expect(formatIstDate('not a date')).toBe('not a date');
    expect(formatIstDate('2026-13-01')).toBe('2026-13-01');
    expect(formatIstDate('2026-11-2')).toBe('2026-11-2');
  });
});

describe('formatIstClock', () => {
  it('writes 24-hour storage as a 12-hour clock', () => {
    expect(formatIstClock('18:58')).toBe('6:58 pm');
    expect(formatIstClock('09:30')).toBe('9:30 am');
  });

  // The two that an `hours % 12` without the guard gets wrong.
  it('writes both noon and midnight as 12', () => {
    expect(formatIstClock('12:00')).toBe('12:00 pm');
    expect(formatIstClock('00:00')).toBe('12:00 am');
    expect(formatIstClock('00:45')).toBe('12:45 am');
  });

  it('passes a non-time straight through', () => {
    expect(formatIstClock('')).toBe('');
    expect(formatIstClock('25:00')).toBe('25:00');
  });
});

describe('formatIstDateTime', () => {
  // 2026-11-02T13:28:59Z is 18:58 IST on the same day.
  const instant = new Date('2026-11-02T13:28:59.897Z');

  it('shows the IST date and time of an instant', () => {
    expect(formatIstDateTime(instant)).toBe('02 Nov 2026 · 6:58 pm');
  });

  // The case the old formatter got wrong in a way nobody would notice until
  // a report was reviewed months later: 23:00 UTC is already the next day in
  // IST, and the year has to come along for the ride.
  it('rolls the date forward when IST is already tomorrow', () => {
    expect(formatIstDateTime(new Date('2026-12-31T19:30:00Z'))).toBe('01 Jan 2027 · 1:00 am');
  });
});

describe('formatIstDayShort / formatIstWeekday', () => {
  it('names the weekday of a stored date', () => {
    // 2 Nov 2026 is a Monday.
    expect(formatIstWeekday('2026-11-02')).toBe('Mon');
    expect(formatIstDayShort('2026-11-02')).toBe('Mon 2 Nov');
  });

  it('drops the leading zero on the day, which a column heading does not need', () => {
    expect(formatIstDayShort('2026-11-09')).toBe('Mon 9 Nov');
  });

  it('passes a non-date straight through', () => {
    expect(formatIstDayShort('')).toBe('');
    expect(formatIstWeekday('nope')).toBe('');
  });
});

// The reason this file exists.
describe('no stray comma anywhere', () => {
  it('never punctuates a date with a comma', () => {
    const rendered = [
      formatIstDate('2026-11-02'),
      formatIstClock('18:58'),
      formatIstDateTime(new Date('2026-11-02T13:28:59.897Z')),
      formatIstDayShort('2026-11-02'),
      formatIstWeekday('2026-11-02')
    ];
    for (const text of rendered) {
      expect(text, `${text} must not contain a comma`).not.toContain(',');
    }
  });
});
