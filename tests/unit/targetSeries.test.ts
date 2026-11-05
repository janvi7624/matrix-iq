import { describe, it, expect } from 'vitest';
import { listPeriodOptions } from '../../lib/targetPeriod';
import { assembleTargetSeries } from '../../lib/targetSeries';

const FY = '2026-27';
const LAKH = 100000;
const MONTHS = listPeriodOptions('monthly', FY);

// Mid-September 2026: April-August are past, September is current, the rest
// of the fiscal year is still ahead.
const SEPT = new Date(2026, 8, 15);

function targets(amount: number): Record<string, number> {
  return Object.fromEntries(MONTHS.map((m) => [m.key, amount]));
}

describe('assembleTargetSeries', () => {
  it('returns all twelve months of the fiscal year, April first', () => {
    const series = assembleTargetSeries(FY, MONTHS, {}, {}, SEPT);
    expect(series.points).toHaveLength(12);
    expect(series.points[0].key).toBe('2026-04');
    expect(series.points[0].label).toBe('Apr 26');
    expect(series.points[11].key).toBe('2027-03');
    expect(series.points[11].label).toBe('Mar 27');
  });

  it('marks months past, current and future relative to now', () => {
    const series = assembleTargetSeries(FY, MONTHS, {}, {}, SEPT);
    const state = (key: string) => series.points.find((p) => p.key === key)!.state;
    expect(state('2026-04')).toBe('past');
    expect(state('2026-08')).toBe('past');
    expect(state('2026-09')).toBe('current');
    expect(state('2026-10')).toBe('future');
    expect(state('2027-03')).toBe('future');
  });

  // The point of null-not-zero: a future month drawn as 0 achieved reads as a
  // total miss on the chart, which is a lie about work nobody was due to do.
  it('leaves achieved null for months that have not started', () => {
    const series = assembleTargetSeries(FY, MONTHS, targets(LAKH), {}, SEPT);
    expect(series.points.find((p) => p.key === '2026-10')!.achieved).toBeNull();
    expect(series.points.find((p) => p.key === '2026-10')!.achievementPercent).toBeNull();
    // ...but its target is still known, because the plan exists.
    expect(series.points.find((p) => p.key === '2026-10')!.target).toBe(LAKH);
    expect(series.points.find((p) => p.key === '2026-09')!.achieved).toBe(0);
  });

  it('totals only the months that have started, but annualTarget covers the year', () => {
    const series = assembleTargetSeries(FY, MONTHS, targets(LAKH), { '2026-04': 2 * LAKH, '2026-05': LAKH }, SEPT);
    // April..September = 6 started months.
    expect(series.totals.target).toBe(6 * LAKH);
    expect(series.totals.achieved).toBe(3 * LAKH);
    expect(series.totals.achievementPercent).toBe(50);
    expect(series.annualTarget).toBe(12 * LAKH);
  });

  // A month nobody was given a target for is not a month they missed: the
  // target is null, so the dashed line breaks there instead of diving to the
  // axis and reading as a collapse.
  it('leaves target null when no target was set, and never divides by zero', () => {
    const series = assembleTargetSeries(FY, MONTHS, {}, { '2026-04': LAKH }, SEPT);
    const april = series.points.find((p) => p.key === '2026-04')!;
    expect(april.target).toBeNull();
    expect(april.achievementPercent).toBeNull();
    expect(series.totals.achievementPercent).toBe(0);
    expect(series.hasAnyTarget).toBe(false);
    expect(series.hasAnyAchievement).toBe(true);
  });

  // The Targets screen writes a 0 row for every month left blank, and
  // computeStatus already calls a 0 target 'not_started' — so a stored zero
  // has to read as 'none set' here too, or the two disagree on screen.
  it('treats a stored zero target as none set', () => {
    const mixed = { ...targets(0), '2026-04': LAKH };
    const series = assembleTargetSeries(FY, MONTHS, mixed, {}, SEPT);
    expect(series.points.find((p) => p.key === '2026-04')!.target).toBe(LAKH);
    expect(series.points.find((p) => p.key === '2026-05')!.target).toBeNull();
    expect(series.annualTarget).toBe(LAKH);
    expect(series.hasAnyTarget).toBe(true);
  });

  it('allows achievement above 100% of target', () => {
    const series = assembleTargetSeries(FY, MONTHS, targets(LAKH), { '2026-04': 1.5 * LAKH }, SEPT);
    expect(series.points.find((p) => p.key === '2026-04')!.achievementPercent).toBe(150);
  });

  it('ignores achievement keyed to a month outside the fiscal year', () => {
    const series = assembleTargetSeries(FY, MONTHS, targets(LAKH), { '2026-03': 9 * LAKH }, SEPT);
    expect(series.totals.achieved).toBe(0);
  });

  it('treats a fully elapsed fiscal year as having no future months', () => {
    const later = new Date(2028, 0, 1);
    const series = assembleTargetSeries(FY, MONTHS, targets(LAKH), {}, later);
    expect(series.points.every((p) => p.state === 'past')).toBe(true);
    expect(series.points.every((p) => p.achieved === 0)).toBe(true);
    expect(series.totals.target).toBe(12 * LAKH);
  });

  it('treats a fiscal year that has not begun as entirely future', () => {
    const earlier = new Date(2025, 0, 1);
    const series = assembleTargetSeries(FY, MONTHS, targets(LAKH), {}, earlier);
    expect(series.points.every((p) => p.state === 'future')).toBe(true);
    expect(series.totals.target).toBe(0);
    expect(series.totals.achievementPercent).toBe(0);
    expect(series.annualTarget).toBe(12 * LAKH);
  });
});
