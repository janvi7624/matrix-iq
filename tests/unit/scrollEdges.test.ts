import { describe, it, expect } from 'vitest';
import { scrollEdges } from '../../lib/scrollEdges';

describe('scrollEdges', () => {
  it('a table that fits has no cues (within rounding)', () => {
    expect(scrollEdges(0, 1000, 1000)).toEqual({ left: false, right: false });
    expect(scrollEdges(0, 1001, 1000)).toEqual({ left: false, right: false });
  });
  it('at the start of a wide table: more to the right only', () => {
    expect(scrollEdges(0, 1400, 1000)).toEqual({ left: false, right: true });
  });
  it('in the middle: more on both sides', () => {
    expect(scrollEdges(200, 1400, 1000)).toEqual({ left: true, right: true });
  });
  it('scrolled to the end: more to the left only', () => {
    expect(scrollEdges(400, 1400, 1000)).toEqual({ left: true, right: false });
    expect(scrollEdges(399, 1400, 1000)).toEqual({ left: true, right: false });
  });
  it('handles RTL negative scrollLeft', () => {
    expect(scrollEdges(-200, 1400, 1000)).toEqual({ left: true, right: true });
  });
});
