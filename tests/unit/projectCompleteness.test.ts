import { describe, it, expect } from 'vitest';
import { checkProjectCompleteness } from '../../lib/projectCompleteness';

describe('checkProjectCompleteness', () => {
  it('is complete when price, closing date, and remarks are all present', () => {
    const result = checkProjectCompleteness({ approx_price: 100000, expected_closing_date: '2026-10-01', remarks: 'Some notes' });
    expect(result).toEqual({ isComplete: true, missingFields: [] });
  });

  it('flags a missing approx_price', () => {
    const result = checkProjectCompleteness({ approx_price: '', expected_closing_date: '2026-10-01', remarks: 'Some notes' });
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toContain('approx_price');
  });

  it('flags a missing expected_closing_date', () => {
    const result = checkProjectCompleteness({ approx_price: 100000, expected_closing_date: '', remarks: 'Some notes' });
    expect(result.missingFields).toContain('expected_closing_date');
  });

  it('flags remarks that are blank or only whitespace', () => {
    expect(checkProjectCompleteness({ approx_price: 100000, expected_closing_date: '2026-10-01', remarks: '' }).missingFields).toContain('remarks');
    expect(checkProjectCompleteness({ approx_price: 100000, expected_closing_date: '2026-10-01', remarks: '   ' }).missingFields).toContain('remarks');
  });

  it('lists every missing field at once when nothing has been filled in', () => {
    const result = checkProjectCompleteness({ approx_price: '', expected_closing_date: '', remarks: '' });
    expect(result.isComplete).toBe(false);
    expect(result.missingFields).toEqual(['approx_price', 'expected_closing_date', 'remarks']);
  });
});
