import { CartItem, CustomProduct, Discount, DomainResult, LineItem, ProductGroup, Totals } from './types';
import { GST_RATE_PERCENT } from './format';

export interface QuoteComposition {
  lineItems: LineItem[];
  productGroups: ProductGroup[];
  totals: Totals;
}

export function composeQuote(params: {
  activeResult: DomainResult | null;
  cartItems: CartItem[];
  customProducts: CustomProduct[];
  discounts: Discount[];
  markupPercent: number;
}): QuoteComposition {
  const { activeResult, cartItems, customProducts, discounts, markupPercent } = params;
  const lineItems: LineItem[] = [];
  const productGroups: ProductGroup[] = [];

  // Only fold the currently-open (not yet "added") product into the quote when
  // nothing has been explicitly added — so a quick single-product quote still
  // works with zero clicks. Once anything is in the cart, whatever the user
  // happens to have open in the estimator is just a live preview and must be
  // explicitly added via "Add to Quote" before it counts, otherwise switching
  // products to look at pricing would silently tack an extra line onto the PDF.
  const includeActiveResult = Boolean(activeResult) && cartItems.length === 0;

  if (includeActiveResult && activeResult) {
    lineItems.push(...activeResult.lineItems);
    productGroups.push({ label: activeResult.label, start: 0, end: lineItems.length });
  }

  let cartTotal = 0;
  cartItems.forEach((item) => {
    const start = lineItems.length;
    lineItems.push(...item.lineItems);
    productGroups.push({ label: item.label, start, end: lineItems.length, remark: item.remark });
    cartTotal += item.subtotal;
  });

  let customProductsTotal = 0;
  if (customProducts.length) {
    const start = lineItems.length;
    customProducts.forEach((item) => {
      const qty = Math.max(1, Math.round(item.qty) || 1);
      const price = Number(item.price) || 0;
      const amount = qty * price;
      customProductsTotal += amount;
      const name = item.name && item.name.trim() ? item.name.trim() : 'Custom product';
      const spec = item.description && item.description.trim() ? ` — ${item.description.trim()}` : '';
      const remark = item.remarks && item.remarks.trim() ? ` (${item.remarks.trim()})` : '';
      lineItems.push({
        description: `${name}${spec}${remark}`,
        qty,
        rate: price,
        amount,
        unit: item.unit && item.unit.trim() ? item.unit.trim() : 'Nos'
      });
    });
    productGroups.push({ label: 'Custom products', start, end: lineItems.length });
  }

  const subtotal = (includeActiveResult ? activeResult?.subtotal || 0 : 0) + cartTotal + customProductsTotal;
  const markedUpTotal = subtotal * (1 + markupPercent / 100);

  let discountTotal = 0;
  discounts.forEach((d) => {
    const value = Number(d.value) || 0;
    discountTotal += d.type === 'percent' ? markedUpTotal * (value / 100) : value;
  });

  const preGstTotal = Math.max(0, markedUpTotal - discountTotal);
  const gstAmount = preGstTotal * (GST_RATE_PERCENT / 100);
  const total = preGstTotal + gstAmount;

  const totals: Totals = {
    subtotal,
    markup: markupPercent,
    markupAmount: markedUpTotal - subtotal,
    discountTotal,
    preGstTotal,
    gstAmount,
    total
  };

  return { lineItems, productGroups, totals };
}
