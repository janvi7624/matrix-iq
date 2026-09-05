import { describe, it, expect } from 'vitest';
import { ordinalDay } from '../../lib/format';

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
