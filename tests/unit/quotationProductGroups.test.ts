import { describe, it, expect } from 'vitest';
import { flattenStoredProductGroups, parseStoredProductGroups } from '../../lib/quotationProductGroups';

// Regression guard for a real bug: the partner download reported "no line
// items" for every quotation because the parser accepted only a JSON string,
// and the server hands it already-parsed JSONB. JSON.parse(anArray) coerces
// to "[object Object]", throws, and the catch swallowed it — so the failure
// surfaced as an empty document rather than an error.

const GROUPS = [
  { label: 'LED Wall', lineItems: [{ description: 'Cabinet', qty: 4, rate: 1000, amount: 4000, unit: 'nos' }] },
  { label: 'Install', lineItems: [{ description: 'Labour', qty: 1, rate: 500, amount: 500, unit: 'lot' }] }
];

describe('parseStoredProductGroups', () => {
  it('reads the STRING form the internal record carries', () => {
    expect(parseStoredProductGroups(JSON.stringify(GROUPS))).toHaveLength(2);
  });

  it('reads the ARRAY form Sequelize hands back from JSONB', () => {
    // The case that was broken. Both callers are legitimate and the parser
    // must not silently prefer one.
    expect(parseStoredProductGroups(GROUPS)).toHaveLength(2);
  });

  it('agrees on both forms of the same data', () => {
    expect(parseStoredProductGroups(GROUPS)).toEqual(parseStoredProductGroups(JSON.stringify(GROUPS)));
  });

  it('returns empty for genuinely empty or malformed input, without throwing', () => {
    for (const input of ['', '[]', [], null, undefined, '{not json', {}, 42]) {
      expect(parseStoredProductGroups(input)).toEqual([]);
    }
  });

  it('drops groups that cannot contribute to a document', () => {
    const mixed = [...GROUPS, { label: 'Broken' }, { lineItems: [] }, null];
    expect(parseStoredProductGroups(mixed)).toHaveLength(2);
  });
});

describe('flattenStoredProductGroups', () => {
  it('produces a flat list with each group’s window recorded', () => {
    const { lineItems, productGroups } = flattenStoredProductGroups(parseStoredProductGroups(GROUPS));
    expect(lineItems).toHaveLength(2);
    expect(productGroups).toEqual([
      { label: 'LED Wall', start: 0, end: 1, remark: undefined },
      { label: 'Install', start: 1, end: 2, remark: undefined }
    ]);
  });

  it('round-trips the array form into a downloadable document', () => {
    // End to end for the partner path: raw JSONB in, PDF-ready items out.
    const { lineItems } = flattenStoredProductGroups(parseStoredProductGroups(GROUPS));
    expect(lineItems.length).toBeGreaterThan(0);
  });
});
