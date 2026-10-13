import { describe, it, expect } from 'vitest';
import { formatMoney, formatMoneyWhole, ordinalDay } from '../../lib/format';

describe('ordinalDay', () => {
  it.each([
    [1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [5, '5th'],
    [10, '10th'], [11, '11th'], [12, '12th'], [13, '13th'], [14, '14th'],
    [20, '20th'], [21, '21st'], [22, '22nd'], [23, '23rd'], [24, '24th'],
    [30, '30th'], [31, '31st']
  ])('formats day %s as %s', (day, expected) => {
    expect(ordinalDay(day)).toBe(expected);
  });
});
// The HR Expense Report shows whole rupees; every other money surface keeps
// its paise. Both halves of that are pinned here, because the easy mistake
// is to widen formatMoney itself and silently round a quotation.
describe('formatMoneyWhole', () => {
  it.each([
    [0, '₹0'],
    [1234, '₹1,234'],
    [1234.49, '₹1,234'],
    [1234.5, '₹1,235'],
    [1234.99, '₹1,235'],
    [100000, '₹1,00,000'],
    [10570172.6, '₹1,05,70,173']
  ])('formats %s as %s', (value, expected) => {
    expect(formatMoneyWhole(value)).toBe(expected);
  });

  it('groups in the Indian system, not thousands', () => {
    expect(formatMoneyWhole(12500000)).toBe('₹1,25,00,000');
  });

  it('handles a blank or undefined amount as zero', () => {
    expect(formatMoneyWhole(undefined)).toBe('₹0');
    expect(formatMoneyWhole('')).toBe('₹0');
  });

  it('leaves formatMoney showing paise, so other modules are unaffected', () => {
    expect(formatMoney(1234.56)).toBe('₹1,234.56');
  });
});
