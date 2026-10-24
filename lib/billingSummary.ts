// Billing: what has actually been won, and what it is worth.
//
// Pure — no DB, no React. lib/billingStore.ts does the querying and scoping;
// this file decides what a billable row IS and which number counts.
//
// TWO PROBLEMS THE SHAPE OF THIS SOLVES
//
// 1. DOUBLE COUNTING. A won project usually also has an approved quotation —
//    2 of the 3 approved quotations in the live data belong to projects that
//    are themselves won. Listing "won projects plus approved quotations" and
//    adding up the values reports Rs 1.23 crore where the real figure is about
//    62 lakh, because the same two deals are counted twice. So a row here is
//    ONE DEAL, keyed on the project, with its quotation folded into it. A
//    quotation with no project is its own row, since there is no deal to fold
//    it into.
//
// 2. THREE DISAGREEING NUMBERS. Every deal can carry an approx price (a sales
//    estimate), an approved quotation total (what was formally agreed) and a
//    purchase order amount (what the customer actually ordered) — and in the
//    live data they differ by a lot: one deal is 50 lakh estimated, 59 lakh
//    quoted; another is 0 estimated against a 3.08 lakh PO. Picking one and
//    calling it "value" would be arbitrary and quietly wrong, so all three are
//    carried, and the one used for totals is chosen by an explicit, stated
//    rule with the basis reported alongside it.

export type BillingBasis = 'po' | 'quotation' | 'estimate' | 'unknown';

export interface BillingRow {
  /** The deal's key: the project id, or the quotation id when unattached. */
  id: string;
  /** Where the row came from — a won project, or an orphan approved quote. */
  source: 'project' | 'quotation';
  label: string;
  clientName: string;
  company: string;
  /** Whose deal it is, for own-vs-team scoping and the salesperson column. */
  ownerUsername: string;
  /** IST date the deal closed, or '' when never stamped. */
  closedOn: string;
  /** A sales estimate. Often absent or stale. */
  approxPrice: number | null;
  /** The approved quotation total, if there is one. */
  quotedValue: number | null;
  quotationNumber: string;
  /** What the customer actually ordered. */
  poValue: number | null;
  poNumber: string;
}

/**
 * The number to bill against, and where it came from.
 *
 * Order is deliberate and is the whole argument of this module: a purchase
 * order is what the customer committed to, an approved quotation is what was
 * agreed before that, and approx price is a guess somebody typed early on.
 * Billing should prefer the most committed figure available.
 *
 * Returns 'unknown' with a null value rather than 0 when there is nothing to
 * go on — 3 of the 8 won projects have no price, no quotation and no PO
 * amount, and reporting those as zero would understate the total while looking
 * like a real number.
 */
export function billableValue(row: BillingRow): { value: number | null; basis: BillingBasis } {
  if (row.poValue !== null && row.poValue > 0) return { value: row.poValue, basis: 'po' };
  if (row.quotedValue !== null && row.quotedValue > 0) return { value: row.quotedValue, basis: 'quotation' };
  if (row.approxPrice !== null && row.approxPrice > 0) return { value: row.approxPrice, basis: 'estimate' };
  return { value: null, basis: 'unknown' };
}

export interface BillingTotals {
  count: number;
  /** Sum of the billable values that are known. */
  value: number;
  /**
   * How the total was arrived at. Published so the headline figure is
   * auditable: "62 lakh" means something different if most of it rests on
   * estimates rather than purchase orders.
   */
  byBasis: Record<BillingBasis, { count: number; value: number }>;
  /** Rows with nothing to value them by — counted, never summed as zero. */
  unvalued: number;
  /** Deals with a PO already raised, and their total. */
  withPurchaseOrder: number;
  purchaseOrderValue: number;
}

function emptyBasis(): Record<BillingBasis, { count: number; value: number }> {
  return {
    po: { count: 0, value: 0 },
    quotation: { count: 0, value: 0 },
    estimate: { count: 0, value: 0 },
    unknown: { count: 0, value: 0 }
  };
}

export function emptyTotals(): BillingTotals {
  return {
    count: 0,
    value: 0,
    byBasis: emptyBasis(),
    unvalued: 0,
    withPurchaseOrder: 0,
    purchaseOrderValue: 0
  };
}

export function summariseBilling(rows: BillingRow[]): BillingTotals {
  const totals = emptyTotals();
  for (const row of rows) {
    const { value, basis } = billableValue(row);
    totals.count += 1;
    totals.byBasis[basis].count += 1;
    if (value === null) {
      totals.unvalued += 1;
    } else {
      totals.value += value;
      totals.byBasis[basis].value += value;
    }
    if (row.poValue !== null && row.poValue > 0) {
      totals.withPurchaseOrder += 1;
      totals.purchaseOrderValue += row.poValue;
    }
  }
  return totals;
}

export interface OwnerBillingSummary extends BillingTotals {
  ownerUsername: string;
}

/**
 * Per-salesperson totals, biggest first — what a manager opens this for.
 *
 * Rows with no owner are grouped under '' rather than dropped, so the parts
 * still add up to the whole. A summary whose rows do not sum to its total is
 * worse than one with an awkward row in it.
 */
export function summariseBillingByOwner(rows: BillingRow[]): OwnerBillingSummary[] {
  const groups = new Map<string, BillingRow[]>();
  for (const row of rows) {
    const key = row.ownerUsername || '';
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.entries()]
    .map(([ownerUsername, list]) => ({ ownerUsername, ...summariseBilling(list) }))
    .sort((a, b) => b.value - a.value || b.count - a.count);
}

/**
 * Folds won projects and approved quotations into one row per deal.
 *
 * `quotationsByProject` is the approved quotation for each project id — the
 * newest one when a project has several, since a revision supersedes what came
 * before it. Any approved quotation whose project is NOT in the won list
 * becomes a row of its own: it is real agreed work, and dropping it would hide
 * revenue just because the project side was never closed.
 */
export function mergeDeals(
  wonProjects: Omit<BillingRow, 'source' | 'quotedValue' | 'quotationNumber'>[],
  approvedQuotations: {
    id: string;
    projectId: string;
    quotationNumber: string;
    total: number | null;
    clientName: string;
    company: string;
    ownerUsername: string;
    closedOn: string;
  }[]
): BillingRow[] {
  const quoteByProject = new Map<string, (typeof approvedQuotations)[number]>();
  for (const quote of approvedQuotations) {
    if (!quote.projectId) continue;
    // Later rows win: the caller supplies them newest-last for a project with
    // more than one approved quotation.
    quoteByProject.set(quote.projectId, quote);
  }

  const rows: BillingRow[] = wonProjects.map((project) => {
    const quote = quoteByProject.get(project.id);
    return {
      ...project,
      source: 'project' as const,
      quotedValue: quote?.total ?? null,
      quotationNumber: quote?.quotationNumber ?? ''
    };
  });

  const claimed = new Set(rows.map((r) => r.id));
  for (const quote of approvedQuotations) {
    if (quote.projectId && claimed.has(quote.projectId)) continue;
    rows.push({
      id: quote.id,
      source: 'quotation',
      label: quote.quotationNumber,
      clientName: quote.clientName,
      company: quote.company,
      ownerUsername: quote.ownerUsername,
      closedOn: quote.closedOn,
      approxPrice: null,
      quotedValue: quote.total,
      quotationNumber: quote.quotationNumber,
      poValue: null,
      poNumber: ''
    });
  }

  return rows;
}
