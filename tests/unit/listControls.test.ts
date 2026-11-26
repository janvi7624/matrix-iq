import { describe, it, expect } from 'vitest';
import { inDateRange } from '../../components/ui/ListControls';

describe('inDateRange', () => {
  const none = { from: '', to: '' };
  it('an empty range matches everything, including undated rows', () => {
    expect(inDateRange('2026-11-25', none)).toBe(true);
    expect(inDateRange(null, none)).toBe(true);
  });
  it('is inclusive at both ends', () => {
    const r = { from: '2026-11-01', to: '2026-11-30' };
    expect(inDateRange('2026-11-01', r)).toBe(true);
    expect(inDateRange('2026-11-30', r)).toBe(true);
    expect(inDateRange('2026-10-31', r)).toBe(false);
    expect(inDateRange('2026-12-01', r)).toBe(false);
  });
  it('supports open-ended ranges', () => {
    expect(inDateRange('2027-01-01', { from: '2026-11-01', to: '' })).toBe(true);
    expect(inDateRange('2020-01-01', { from: '', to: '2026-11-30' })).toBe(true);
  });
  it('accepts timestamps and excludes undated rows once a range is set', () => {
    expect(inDateRange('2026-11-15T10:00:00Z', { from: '2026-11-15', to: '2026-11-15' })).toBe(true);
    expect(inDateRange('', { from: '2026-11-01', to: '' })).toBe(false);
  });
});
