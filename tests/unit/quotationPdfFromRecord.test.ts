import { describe, it, expect } from 'vitest';
import type { LineItem } from '../../lib/types';
import {
  flattenStoredProductGroups,
  isProposalQuotation,
  parseStoredProductGroups,
  proposalAttachmentUrl
} from '../../lib/quotationPdfFromRecord';

// Re-downloading rebuilds the PDF from products_json, because no PDF was ever
// stored. These tests pin the round trip: QuotationCalculator saves
// `composition.lineItems.slice(g.start, g.end)` per group, and this must undo
// exactly that — if the offsets come back wrong, a quotation re-downloads with
// its items under the wrong product headings, which looks right at a glance.

const item = (description: string, amount: number): LineItem => ({
  description,
  qty: 1,
  rate: amount,
  amount,
  unit: 'no'
});

describe('parseStoredProductGroups', () => {
  it('reads the groups the calculator wrote', () => {
    const json = JSON.stringify([{ label: 'Cameras', lineItems: [item('Dome', 100)], remark: 'rooftop' }]);
    expect(parseStoredProductGroups(json)).toEqual([
      { label: 'Cameras', lineItems: [{ description: 'Dome', qty: 1, rate: 100, amount: 100, unit: 'no' }], remark: 'rooftop' }
    ]);
  });

  it('returns nothing for an empty, malformed or non-array value rather than throwing', () => {
    expect(parseStoredProductGroups('')).toEqual([]);
    expect(parseStoredProductGroups('not json')).toEqual([]);
    expect(parseStoredProductGroups('{"label":"x"}')).toEqual([]);
    expect(parseStoredProductGroups('null')).toEqual([]);
  });

  it('drops a group with no line items of its own, which cannot be laid out', () => {
    const json = JSON.stringify([{ label: 'Cameras', lineItems: [item('Dome', 100)] }, { label: 'Broken' }]);
    expect(parseStoredProductGroups(json)).toHaveLength(1);
  });
});

describe('flattenStoredProductGroups', () => {
  it('rebuilds offsets that slice back to each group’s own items', () => {
    const groups = [
      { label: 'Cameras', lineItems: [item('Dome', 100), item('Bullet', 200)] },
      { label: 'Switches', lineItems: [item('8-port', 300)] },
      { label: 'Cabling', lineItems: [item('Cat6', 40), item('Conduit', 50), item('Labour', 60)] }
    ];
    const { lineItems, productGroups } = flattenStoredProductGroups(groups);

    expect(lineItems).toHaveLength(6);
    expect(productGroups.map((g) => [g.label, g.start, g.end])).toEqual([
      ['Cameras', 0, 2],
      ['Switches', 2, 3],
      ['Cabling', 3, 6]
    ]);
    // The real contract: slicing by the rebuilt window returns what was saved.
    for (let i = 0; i < groups.length; i += 1) {
      expect(lineItems.slice(productGroups[i].start, productGroups[i].end)).toEqual(groups[i].lineItems);
    }
  });

  it('keeps a group remark, which carries the sales note onto the document', () => {
    const { productGroups } = flattenStoredProductGroups([{ label: 'Cameras', lineItems: [item('Dome', 1)], remark: 'rooftop only' }]);
    expect(productGroups[0].remark).toBe('rooftop only');
  });

  it('handles a group that saved with no items without shifting the ones after it', () => {
    const { lineItems, productGroups } = flattenStoredProductGroups([
      { label: 'Empty', lineItems: [] },
      { label: 'Real', lineItems: [item('Dome', 1)] }
    ]);
    expect(productGroups).toEqual([
      { label: 'Empty', start: 0, end: 0, remark: undefined },
      { label: 'Real', start: 0, end: 1, remark: undefined }
    ]);
    expect(lineItems.slice(0, 1)).toEqual([item('Dome', 1)]);
  });

  it('returns empty structures for no groups', () => {
    expect(flattenStoredProductGroups([])).toEqual({ lineItems: [], productGroups: [] });
  });
});

describe('proposal quotations', () => {
  it('recognises both proposal kinds and no other', () => {
    expect(isProposalQuotation({ proposal_kind: 'project' })).toBe(true);
    expect(isProposalQuotation({ proposal_kind: 'tender' })).toBe(true);
    expect(isProposalQuotation({ proposal_kind: '' })).toBe(false);
  });

  it('takes the first attached commercial as the thing to hand back', () => {
    expect(proposalAttachmentUrl({ proposal: { attachmentUrls: ['/api/uploads/file/a.pdf', '/b.pdf'] } as never })).toBe(
      '/api/uploads/file/a.pdf'
    );
  });

  it('reports no attachment rather than an undefined url', () => {
    expect(proposalAttachmentUrl({ proposal: { attachmentUrls: [] } as never })).toBe('');
    expect(proposalAttachmentUrl({ proposal: null })).toBe('');
  });
});
