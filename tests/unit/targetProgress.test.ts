import { describe, it, expect } from 'vitest';
import { buildTargetProgress } from '../../lib/targetProgress';

// October 2026 — 31 days, so the arithmetic below is easy to check by hand.
const OCT_START = '2026-10-01';
const OCT_END = '2026-10-31';
const LAKH = 100000;

function on(day: number): Date {
  return new Date(2026, 9, day, 12, 0, 0);
}

describe('buildTargetProgress', () => {
  it('counts both ends of the period — October is 31 days, not 30', () => {
    const p = buildTargetProgress(LAKH, 0, OCT_START, OCT_END, on(1));
    expect(p.daysTotal).toBe(31);
    expect(p.daysElapsed).toBe(1);
    expect(p.daysLeft).toBe(30);
  });

  it('reports achievement, remaining and pace', () => {
    const p = buildTargetProgress(LAKH, 40000, OCT_START, OCT_END, on(16));
    expect(p.achievementPercent).toBe(40);
    expect(p.remainingAmount).toBe(60000);
    expect(p.daysElapsed).toBe(16);
    expect(p.expectedPercent).toBe(52); // 16/31
  });

  // The whole point of exposing expectedPercent: the same 40% reads
  // differently depending on when you look at it.
  it('calls the same 40% on-track early and at-risk late', () => {
    expect(buildTargetProgress(LAKH, 40000, OCT_START, OCT_END, on(3)).status).toBe('on_track');
    expect(buildTargetProgress(LAKH, 40000, OCT_START, OCT_END, on(27)).status).toBe('at_risk');
  });

  it('never reports negative remaining once the target is beaten', () => {
    const p = buildTargetProgress(LAKH, 150000, OCT_START, OCT_END, on(20));
    expect(p.achievementPercent).toBe(150);
    expect(p.remainingAmount).toBe(0);
    expect(p.status).toBe('exceeded');
  });

  it('marks an exactly-met target achieved, not exceeded', () => {
    expect(buildTargetProgress(LAKH, LAKH, OCT_START, OCT_END, on(20)).status).toBe('achieved');
  });

  it('is not_started with no target, without dividing by zero', () => {
    const p = buildTargetProgress(0, 25000, OCT_START, OCT_END, on(10));
    expect(p.achievementPercent).toBe(0);
    expect(p.remainingAmount).toBe(0);
    expect(p.status).toBe('not_started');
    expect(p.achievedAmount).toBe(25000);
  });

  it('clamps a finished period to zero days left rather than going negative', () => {
    const p = buildTargetProgress(LAKH, 20000, OCT_START, OCT_END, new Date(2026, 10, 15));
    expect(p.daysLeft).toBe(0);
    expect(p.daysElapsed).toBe(31);
    expect(p.expectedPercent).toBe(100);
    expect(p.status).toBe('at_risk');
  });

  it('treats a period that has not started yet as zero elapsed', () => {
    const p = buildTargetProgress(LAKH, 0, OCT_START, OCT_END, new Date(2026, 8, 20));
    expect(p.daysElapsed).toBe(0);
    expect(p.daysLeft).toBe(31);
    expect(p.expectedPercent).toBe(0);
  });

  it('handles a full fiscal year, April to March', () => {
    const p = buildTargetProgress(12 * LAKH, 3 * LAKH, '2026-04-01', '2027-03-31', new Date(2026, 9, 1));
    expect(p.daysTotal).toBe(365);
    expect(p.achievementPercent).toBe(25);
    expect(p.remainingAmount).toBe(900000);
  });
});
