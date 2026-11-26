import { describe, it, expect } from 'vitest';
import { getListParam, setListParam, matchesList } from '../../lib/listParam';

describe('getListParam', () => {
  it('reads repeated keys, trims, de-dupes and drops empty / "all"', () => {
    const p = new URLSearchParams('s=open&s=%20done%20&s=&s=open&s=all');
    expect(getListParam(p, 's')).toEqual(['open', 'done']);
  });
  it('a single legacy value still works', () => {
    expect(getListParam(new URLSearchParams('priority=hot'), 'priority')).toEqual(['hot']);
  });
  it('keeps commas inside a value (company names)', () => {
    expect(getListParam(new URLSearchParams('company=Acme%2C%20Inc'), 'company')).toEqual(['Acme, Inc']);
  });
  it('missing param → empty list', () => {
    expect(getListParam(new URLSearchParams(''), 'x')).toEqual([]);
  });
});

describe('setListParam / matchesList', () => {
  it('writes one pair per value and replaces old ones', () => {
    const p = new URLSearchParams('s=old');
    setListParam(p, 's', ['a', 'b']);
    expect(p.toString()).toBe('s=a&s=b');
    setListParam(p, 's', []);
    expect(p.has('s')).toBe(false);
  });
  it('empty list matches everything', () => {
    expect(matchesList('x', [])).toBe(true);
    expect(matchesList('a', ['a', 'b'])).toBe(true);
    expect(matchesList('c', ['a', 'b'])).toBe(false);
    expect(matchesList(null, ['a'])).toBe(false);
  });
});
