import { describe, it, expect } from 'vitest';
import { composeQuote } from '../../lib/calculations';
import type { CartItem, CustomProduct, Discount, DomainResult, LineItem } from '../../lib/types';

function makeLineItem(over: Partial<LineItem> = {}): LineItem {
  return { description: 'Item', qty: 1, rate: 100, amount: 100, unit: 'Nos', ...over };
}

function makeDomainResult(over: Partial<DomainResult> = {}): DomainResult {
  return {
    label: 'Preview',
    domainKey: 'av',
    lineItems: [makeLineItem()],
    subtotal: 100,
    ...over
  };
}

function makeCartItem(over: Partial<CartItem> = {}): CartItem {
  return {
    id: 1,
    label: 'Cart item',
    domainKey: 'av',
    lineItems: [makeLineItem()],
    subtotal: 100,
    ...over
  };
}

function makeCustomProduct(over: Partial<CustomProduct> = {}): CustomProduct {
  return { id: 1, name: '', description: '', unit: '', qty: 1, price: 10, remarks: '', ...over };
}

describe('composeQuote — active-result folding', () => {
  it('includes the active result when the cart is empty', () => {
    const activeResult = makeDomainResult();
    const result = composeQuote({ activeResult, cartItems: [], customProducts: [], discounts: [], markupPercent: 0 });
    expect(result.lineItems).toEqual(activeResult.lineItems);
    expect(result.productGroups).toEqual([{ label: 'Preview', start: 0, end: 1 }]);
    expect(result.totals.subtotal).toBe(100);
  });

  it('excludes the active result once anything is in the cart', () => {
    const activeResult = makeDomainResult({ label: 'Live preview', subtotal: 500 });
    const cartItems = [makeCartItem()];
    const result = composeQuote({ activeResult, cartItems, customProducts: [], discounts: [], markupPercent: 0 });
    expect(result.productGroups.some((g) => g.label === 'Live preview')).toBe(false);
    expect(result.lineItems).toHaveLength(1);
    expect(result.totals.subtotal).toBe(100); // only the cart item's subtotal, not +500
  });

  it('returns an all-zero result when everything is empty', () => {
    const result = composeQuote({ activeResult: null, cartItems: [], customProducts: [], discounts: [], markupPercent: 0 });
    expect(result.lineItems).toEqual([]);
    expect(result.productGroups).toEqual([]);
    expect(result.totals).toEqual({
      subtotal: 0,
      markup: 0,
      discountTotal: 0,
      preGstTotal: 0,
      gstAmount: 0,
      total: 0
    });
  });
});

describe('composeQuote — cart', () => {
  it('concatenates lineItems across cart items with non-overlapping group offsets', () => {
    const item1 = makeCartItem({ id: 1, label: 'A', lineItems: [makeLineItem(), makeLineItem()] });
    const item2 = makeCartItem({ id: 2, label: 'B', lineItems: [makeLineItem()], remark: 'note' });
    const result = composeQuote({ activeResult: null, cartItems: [item1, item2], customProducts: [], discounts: [], markupPercent: 0 });
    expect(result.lineItems).toHaveLength(3);
    expect(result.productGroups).toEqual([
      { label: 'A', start: 0, end: 2, remark: undefined },
      { label: 'B', start: 2, end: 3, remark: 'note' }
    ]);
  });

  it('sums cartTotal from item.subtotal, not from the item lineItems amounts', () => {
    const item = makeCartItem({ subtotal: 999, lineItems: [makeLineItem({ amount: 1 })] });
    const result = composeQuote({ activeResult: null, cartItems: [item], customProducts: [], discounts: [], markupPercent: 0 });
    expect(result.totals.subtotal).toBe(999);
  });
});

describe('composeQuote — custom products', () => {
  it('composes descriptions from name/description/remarks combinations', () => {
    const cases: [Partial<CustomProduct>, string][] = [
      [{ name: 'Widget' }, 'Widget'],
      [{ name: 'Widget', description: 'Spec A' }, 'Widget — Spec A'],
      [{ name: 'Widget', remarks: 'Note' }, 'Widget (Note)'],
      [{ name: 'Widget', description: 'Spec A', remarks: 'Note' }, 'Widget — Spec A (Note)']
    ];
    for (const [over, expected] of cases) {
      const result = composeQuote({ activeResult: null, cartItems: [], customProducts: [makeCustomProduct(over)], discounts: [], markupPercent: 0 });
      expect(result.lineItems[0].description).toBe(expected);
    }
  });

  it('defaults a blank name to "Custom product" and a blank unit to "Nos"', () => {
    const result = composeQuote({
      activeResult: null,
      cartItems: [],
      customProducts: [makeCustomProduct({ name: '   ', unit: '  ' })],
      discounts: [],
      markupPercent: 0
    });
    expect(result.lineItems[0].description).toBe('Custom product');
    expect(result.lineItems[0].unit).toBe('Nos');
  });

  it.each([
    [3, 3],
    [2.6, 3],
    [0.4, 1],
    [0, 1],
    [-5, 1],
    [NaN, 1]
  ])('coerces qty %s to %s', (qty, expected) => {
    const result = composeQuote({
      activeResult: null,
      cartItems: [],
      customProducts: [makeCustomProduct({ qty, price: 1 })],
      discounts: [],
      markupPercent: 0
    });
    expect(result.lineItems[0].qty).toBe(expected);
  });

  it.each([
    ['12.5', 12.5],
    [NaN, 0],
    [undefined, 0]
  ])('coerces price %s to %s', (price, expected) => {
    const result = composeQuote({
      activeResult: null,
      cartItems: [],
      customProducts: [makeCustomProduct({ price: price as number, qty: 1 })],
      discounts: [],
      markupPercent: 0
    });
    expect(result.lineItems[0].rate).toBe(expected);
    expect(result.lineItems[0].amount).toBe(expected);
  });

  it('emits one "Custom products" group covering all rows, and none when empty', () => {
    const result = composeQuote({
      activeResult: null,
      cartItems: [],
      customProducts: [makeCustomProduct(), makeCustomProduct({ id: 2 })],
      discounts: [],
      markupPercent: 0
    });
    expect(result.productGroups).toEqual([{ label: 'Custom products', start: 0, end: 2 }]);

    const emptyResult = composeQuote({ activeResult: null, cartItems: [], customProducts: [], discounts: [], markupPercent: 0 });
    expect(emptyResult.productGroups).toEqual([]);
  });
});

describe('composeQuote — totals arithmetic', () => {
  const discounts = (list: Discount[]) => list;

  it('applies zero markup as a no-op', () => {
    const item = makeCartItem({ subtotal: 1000 });
    const result = composeQuote({ activeResult: null, cartItems: [item], customProducts: [], discounts: [], markupPercent: 0 });
    expect(result.totals.preGstTotal).toBe(1000);
    expect(result.lineItems[0].rate).toBe(100);
    expect(result.lineItems[0].amount).toBe(100);
  });

  it('computes markup, GST and total correctly, and bakes markup into each line item', () => {
    const item = makeCartItem({ subtotal: 1000 });
    const result = composeQuote({ activeResult: null, cartItems: [item], customProducts: [], discounts: [], markupPercent: 20 });
    expect(result.totals.subtotal).toBeCloseTo(1200);
    expect(result.totals.preGstTotal).toBeCloseTo(1200);
    expect(result.totals.gstAmount).toBeCloseTo(216);
    expect(result.totals.total).toBeCloseTo(1416);
    // The line item's own rate/amount already reflect the 20% markup —
    // there's no separate "markup" line anywhere in the output.
    expect(result.lineItems[0].rate).toBeCloseTo(120);
    expect(result.lineItems[0].amount).toBeCloseTo(120);
  });

  it('computes a percent discount on the marked-up total, not the raw subtotal', () => {
    const item = makeCartItem({ subtotal: 1000 });
    const result = composeQuote({
      activeResult: null,
      cartItems: [item],
      customProducts: [],
      discounts: discounts([{ id: 1, label: '10% off', type: 'percent', value: 10 }]),
      markupPercent: 20 // markedUpTotal = 1200
    });
    expect(result.totals.discountTotal).toBeCloseTo(120); // 10% of 1200, not of 1000
  });

  it('subtracts a flat discount literally and accumulates mixed discounts', () => {
    const item = makeCartItem({ subtotal: 1000 });
    const result = composeQuote({
      activeResult: null,
      cartItems: [item],
      customProducts: [],
      discounts: discounts([
        { id: 1, label: 'Flat', type: 'flat', value: 50 },
        { id: 2, label: '10%', type: 'percent', value: 10 }
      ]),
      markupPercent: 0
    });
    expect(result.totals.discountTotal).toBeCloseTo(150); // 50 + 10% of 1000
  });

  it('treats a non-numeric discount value as 0', () => {
    const item = makeCartItem({ subtotal: 1000 });
    const result = composeQuote({
      activeResult: null,
      cartItems: [item],
      customProducts: [],
      discounts: discounts([{ id: 1, label: 'Bad', type: 'flat', value: NaN }]),
      markupPercent: 0
    });
    expect(result.totals.discountTotal).toBe(0);
  });

  // Flagged finding: an over-large flat discount clamps preGstTotal/gst/total
  // to 0 but discountTotal still reports the full unrealizable amount, so a
  // rendered quote's numbers won't reconcile. Locking current behavior, not
  // asserting it's correct.
  it('locks current over-discount behavior: totals clamp to 0 but discountTotal does not', () => {
    const item = makeCartItem({ subtotal: 1000 });
    const result = composeQuote({
      activeResult: null,
      cartItems: [item],
      customProducts: [],
      discounts: discounts([{ id: 1, label: 'Huge', type: 'flat', value: 5000 }]),
      markupPercent: 0
    });
    expect(result.totals.preGstTotal).toBe(0);
    expect(result.totals.gstAmount).toBe(0);
    expect(result.totals.total).toBe(0);
    expect(result.totals.discountTotal).toBe(5000);
  });

  it('echoes the input markupPercent verbatim onto totals.markup', () => {
    const item = makeCartItem({ subtotal: 1000 });
    const result = composeQuote({ activeResult: null, cartItems: [item], customProducts: [], discounts: [], markupPercent: 37 });
    expect(result.totals.markup).toBe(37);
  });
});
