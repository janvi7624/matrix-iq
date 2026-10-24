import type { LineItem, ProductGroup } from './types';

// The saved shape of a quotation's products, and how to turn it back into
// the flat list + offsets the PDF wants.
//
// Extracted from lib/quotationPdfFromRecord.ts so the SERVER can use it too.
// That file imports lib/pdf.ts (jsPDF, and browser APIs for the logo), so a
// server store importing it would drag a client-only module into the server
// bundle. These two functions are pure and have no such dependency.
//
// One implementation, two callers: the internal browser download and the
// partner portal's server-side payload. Duplicating it would be the obvious
// shortcut and would drift the first time the saved shape changed.

/** The shape QuotationCalculator writes into products_json. */
export interface StoredProductGroup {
  label: string;
  lineItems: LineItem[];
  remark?: string;
}

/**
 * Normalise whatever `products_json` happens to be into product groups.
 *
 * Accepts a STRING or an already-parsed ARRAY, because the two callers get
 * different things and both are legitimate:
 *   - lib/quotationStore.ts's toRecord JSON.stringify()s the column, so the
 *     internal QuotationRecord carries a string;
 *   - a store reading the Sequelize row directly gets the parsed JSONB.
 *
 * Passing the array form to a string-only parser is exactly the bug this
 * signature prevents: JSON.parse(anArray) stringifies it to "[object Object]"
 * first, throws, and — because the throw is caught — silently yields no line
 * items rather than an error anyone can see.
 */
export function parseStoredProductGroups(productsJson: unknown): StoredProductGroup[] {
  let parsed: unknown = productsJson;
  if (typeof productsJson === 'string') {
    try {
      parsed = JSON.parse(productsJson || '[]');
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  // Older rows, or a row written by something else, may not match — a group
  // without its own line items cannot contribute to the document, and
  // dropping it is better than throwing on the whole download.
  return parsed.filter((g): g is StoredProductGroup => {
    const group = g as StoredProductGroup | null;
    return !!group && typeof group.label === 'string' && Array.isArray(group.lineItems);
  });
}

// Exact inverse of the save-time `composition.lineItems.slice(g.start, g.end)`:
// walk the groups in order, appending their items and recording the window
// each one occupies in the flattened list.
export function flattenStoredProductGroups(groups: StoredProductGroup[]): {
  lineItems: LineItem[];
  productGroups: ProductGroup[];
} {
  const lineItems: LineItem[] = [];
  const productGroups: ProductGroup[] = [];
  for (const group of groups) {
    const start = lineItems.length;
    lineItems.push(...group.lineItems);
    productGroups.push({ label: group.label, start, end: lineItems.length, remark: group.remark });
  }
  return { lineItems, productGroups };
}
