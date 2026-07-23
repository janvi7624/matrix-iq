export const GST_RATE_PERCENT = 18;

export function formatMoney(value: number | string | undefined): string {
  return '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function formatMoneyPdf(value: number | string | undefined): string {
  return 'Rs. ' + Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Same numeric formatting as formatMoneyPdf but without the "Rs." prefix —
// used everywhere in the PDF except the Grand Total line.
export function formatNumberPdf(value: number | string | undefined): string {
  return Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function slugify(text: string): string {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
