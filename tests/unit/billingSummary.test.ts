import { describe, it, expect } from 'vitest';
import {
  BillingRow,
  billableValue,
  emptyTotals,
  mergeDeals,
  summariseBilling,
  summariseBillingByOwner
} from '../../lib/billingSummary';

// The two things that would make a Billing total wrong are double counting and
// picking the wrong number per deal, so both are pinned hard here.

const row = (over: Partial<BillingRow> = {}): BillingRow => ({
  id: 'p1',
  source: 'project',
  label: 'Kunal Jani',
  clientName: 'Kunal Jani',
  company: 'Acme',
  ownerUsername: 'manoj',
  closedOn: '2026-10-01',
  approxPrice: null,
  quotedValue: null,
  quotationNumber: '',
  poValue: null,
  poNumber: '',
  ...over
});

describe('billableValue', () => {
  // A purchase order is what the customer actually committed to, so it wins.
  it('prefers the purchase order', () => {
    const r = row({ poValue: 307980, quotedValue: 500000, approxPrice: 900000 });
    expect(billableValue(r)).toEqual({ value: 307980, basis: 'po' });
  });

  it('falls back to the approved quotation', () => {
    const r = row({ quotedValue: 5900000, approxPrice: 5000000 });
    expect(billableValue(r)).toEqual({ value: 5900000, basis: 'quotation' });
  });

  // An estimate somebody typed early on is the weakest of the three, but it
  // beats reporting nothing.
  it('falls back to the approx price last', () => {
    expect(billableValue(row({ approxPrice: 10000 }))).toEqual({ value: 10000, basis: 'estimate' });
  });

  // 3 of the 8 won projects have no price, no quotation and no PO amount.
  // Calling those zero would understate the total while looking like a number.
  it('reports unknown rather than zero when there is nothing to go on', () => {
    expect(billableValue(row())).toEqual({ value: null, basis: 'unknown' });
  });

  // A zero is not a value — it is the absence of one, and the live data has
  // won projects sitting at approx_price 0 alongside a real PO.
  it('skips a zero and keeps looking', () => {
    expect(billableValue(row({ poValue: 0, quotedValue: 191160 }))).toEqual({ value: 191160, basis: 'quotation' });
    expect(billableValue(row({ poValue: 0, approxPrice: 0 }))).toEqual({ value: null, basis: 'unknown' });
  });
});

describe('summariseBilling', () => {
  it('sums the billable values and reports what they rest on', () => {
    const totals = summariseBilling([
      row({ id: 'a', poValue: 307980 }),
      row({ id: 'b', quotedValue: 5900000, approxPrice: 5000000 }),
      row({ id: 'c', approxPrice: 10000 }),
      row({ id: 'd' })
    ]);
    expect(totals.count).toBe(4);
    expect(totals.value).toBe(307980 + 5900000 + 10000);
    expect(totals.unvalued).toBe(1);
    expect(totals.byBasis.po).toEqual({ count: 1, value: 307980 });
    expect(totals.byBasis.quotation).toEqual({ count: 1, value: 5900000 });
    expect(totals.byBasis.estimate).toEqual({ count: 1, value: 10000 });
    expect(totals.byBasis.unknown).toEqual({ count: 1, value: 0 });
  });

  // The basis breakdown is the point: a headline figure means something very
  // different if most of it rests on estimates rather than purchase orders.
  it('makes an estimate-heavy total visible as such', () => {
    const totals = summariseBilling([row({ id: 'a', approxPrice: 9000000 }), row({ id: 'b', poValue: 10000 })]);
    expect(totals.byBasis.estimate.value).toBeGreaterThan(totals.byBasis.po.value);
  });

  it('counts purchase orders separately from the billable total', () => {
    const totals = summariseBilling([
      row({ id: 'a', poValue: 450000 }),
      row({ id: 'b', quotedValue: 191160 })
    ]);
    expect(totals.withPurchaseOrder).toBe(1);
    expect(totals.purchaseOrderValue).toBe(450000);
    expect(totals.value).toBe(450000 + 191160);
  });

  it('is empty totals for no rows', () => {
    expect(summariseBilling([])).toEqual(emptyTotals());
  });
});

describe('summariseBillingByOwner', () => {
  it('groups by salesperson, biggest first', () => {
    const rows = [
      row({ id: 'a', ownerUsername: 'manoj', poValue: 450000 }),
      row({ id: 'b', ownerUsername: 'manoj', quotedValue: 5900000 }),
      row({ id: 'c', ownerUsername: 'khushi.panchal', poValue: 307980 })
    ];
    const out = summariseBillingByOwner(rows);
    expect(out.map((o) => o.ownerUsername)).toEqual(['manoj', 'khushi.panchal']);
    expect(out[0].value).toBe(450000 + 5900000);
    expect(out[0].count).toBe(2);
  });

  // The parts have to add up to the whole, so an ownerless row is grouped
  // rather than dropped.
  it('keeps a row with no owner', () => {
    const out = summariseBillingByOwner([row({ id: 'a', ownerUsername: '', poValue: 1000 })]);
    expect(out).toHaveLength(1);
    expect(out[0].ownerUsername).toBe('');
    expect(out[0].value).toBe(1000);
  });
});

describe('mergeDeals', () => {
  const project = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    label: 'Project ' + id,
    clientName: 'Client ' + id,
    company: 'Co',
    ownerUsername: 'manoj',
    closedOn: '2026-10-01',
    approxPrice: 5000000,
    poValue: null,
    poNumber: '',
    ...over
  }) as Omit<BillingRow, 'source' | 'quotedValue' | 'quotationNumber'>;

  const quote = (id: string, projectId: string, total: number, number = 'NT-' + id) => ({
    id,
    projectId,
    quotationNumber: number,
    total,
    clientName: 'Client',
    company: 'Co',
    ownerUsername: 'manoj',
    closedOn: '2026-10-02'
  });

  // The headline bug this prevents. 2 of 3 approved quotations belong to won
  // projects; listing both and adding the values reported Rs 1.23 crore where
  // the truth was about 62 lakh.
  it('folds an approved quotation into its won project instead of adding a second row', () => {
    const rows = mergeDeals([project('p1')], [quote('q1', 'p1', 5900000)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'p1', source: 'project', quotedValue: 5900000, quotationNumber: 'NT-q1' });
    // One deal, counted once, at the quoted figure rather than the estimate.
    expect(summariseBilling(rows).value).toBe(5900000);
  });

  it('does not double count across several projects and quotations', () => {
    const rows = mergeDeals(
      [project('p1'), project('p2', { approxPrice: 162000 })],
      [quote('q1', 'p1', 5900000), quote('q2', 'p2', 191160)]
    );
    expect(rows).toHaveLength(2);
    expect(summariseBilling(rows).value).toBe(5900000 + 191160);
  });

  // Real agreed work. Dropping it would hide revenue purely because nobody
  // closed the project side.
  it('keeps an approved quotation that has no project as its own row', () => {
    const rows = mergeDeals([], [quote('q3', '', 458217.6, 'NT-GEN-003')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'q3', source: 'quotation', label: 'NT-GEN-003', quotedValue: 458217.6 });
  });

  it('keeps an approved quotation whose project is not won', () => {
    const rows = mergeDeals([project('p1')], [quote('q9', 'p-other', 250000)]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.source === 'quotation')?.id).toBe('q9');
  });

  // A revision supersedes what came before it, so the newest wins.
  it('takes the last approved quotation when a project has several', () => {
    const rows = mergeDeals([project('p1')], [quote('old', 'p1', 100000), quote('new', 'p1', 250000)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].quotedValue).toBe(250000);
    expect(rows[0].quotationNumber).toBe('NT-new');
  });

  it('leaves a won project with no quotation on its own figures', () => {
    const rows = mergeDeals([project('p1', { approxPrice: 10000, poValue: 0 })], []);
    expect(rows[0].quotedValue).toBeNull();
    expect(billableValue(rows[0]).basis).toBe('estimate');
  });

  it('returns nothing for no input', () => {
    expect(mergeDeals([], [])).toEqual([]);
  });
});
