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

  if (activeResult) {
    lineItems.push(...activeResult.lineItems);
    productGroups.push({ label: activeResult.label, start: 0, end: lineItems.length });
  }

  let cartTotal = 0;
  cartItems.forEach((item) => {
    const start = lineItems.length;
    lineItems.push(...item.lineItems);
    productGroups.push({ label: item.label, start, end: lineItems.length });
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
      lineItems.push({
        description: item.name && item.name.trim() ? item.name.trim() : 'Custom product',
        qty,
        rate: price,
        amount,
        unit: 'Nos'
      });
    });
    productGroups.push({ label: 'Custom products', start, end: lineItems.length });
  }

  const subtotal = (activeResult?.subtotal || 0) + cartTotal + customProductsTotal;
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
