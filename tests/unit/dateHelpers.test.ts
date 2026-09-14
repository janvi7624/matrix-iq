import { describe, it, expect } from 'vitest';
import { closingDatePresetRange } from '../../lib/dateHelpers';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('closingDatePresetRange', () => {
  it("'all' has no bounds", () => {
    expect(closingDatePresetRange('all')).toEqual({ from: '', to: '' });
  });

  it("'custom' has no bounds (caller supplies its own inputs)", () => {
    expect(closingDatePresetRange('custom')).toEqual({ from: '', to: '' });
  });

  it("'today' bounds to just today", () => {
    const today = todayIso();
    expect(closingDatePresetRange('today')).toEqual({ from: today, to: today });
  });

  it("'next_7' starts today and ends 7 days later", () => {
    const { from, to } = closingDatePresetRange('next_7');
    expect(from).toBe(todayIso());
    const diffDays = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
    expect(diffDays).toBe(7);
  });

  it("'next_30' starts today and ends 30 days later", () => {
    const { from, to } = closingDatePresetRange('next_30');
    expect(from).toBe(todayIso());
    const diffDays = (new Date(to).getTime() - new Date(from).getTime()) / 86400000;
    expect(diffDays).toBe(30);
  });

  it("'this_month' spans the first to the last day of the current month", () => {
    const { from, to } = closingDatePresetRange('this_month');
    const now = new Date();
    expect(from).toBe(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    expect(to.endsWith(`-${String(lastDay).padStart(2, '0')}`)).toBe(true);
  });

  it("'this_week' spans exactly 7 days, Monday to Sunday", () => {
    const { from, to } = closingDatePresetRange('this_week');
    const start = new Date(from);
    const end = new Date(to);
    expect(start.getDay()).toBe(1); // Monday
    expect(end.getDay()).toBe(0); // Sunday
    const diffDays = (end.getTime() - start.getTime()) / 86400000;
    expect(diffDays).toBe(6);
  });
});
