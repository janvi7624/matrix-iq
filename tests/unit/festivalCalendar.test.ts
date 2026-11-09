import { describe, it, expect } from 'vitest';
import { getTodaysFestival, FESTIVALS } from '../../lib/festivalCalendar';

describe('getTodaysFestival', () => {
  it('returns the matching festival for an exact calendar date', () => {
    const diwali = getTodaysFestival(new Date('2027-10-29T06:00:00.000Z'));
    expect(diwali?.key).toBe('diwali');
    expect(diwali?.name).toBe('Diwali');
  });

  it('returns null for an ordinary day with no festival', () => {
    expect(getTodaysFestival(new Date('2027-02-15T06:00:00.000Z'))).toBeNull();
  });

  it('matches on the IST calendar day, not the UTC one — a UTC-evening timestamp that is already the next IST day resolves to that next day', () => {
    // 2026-12-24T19:00:00Z is 2026-12-25T00:30 IST — already Christmas in IST, not Dec 24.
    const result = getTodaysFestival(new Date('2026-12-24T19:00:00.000Z'));
    expect(result?.key).toBe('christmas');
  });

  it('every entry has a unique key', () => {
    const keys = FESTIVALS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every entry has a non-empty name and greeting', () => {
    for (const f of FESTIVALS) {
      expect(f.name.length).toBeGreaterThan(0);
      expect(f.greeting.length).toBeGreaterThan(0);
    }
  });
});
