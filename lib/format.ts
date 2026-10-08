export const GST_RATE_PERCENT = 18;

export function formatMoney(value: number | string | undefined): string {
  return '₹' + Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

// Short Indian form for stat tiles. The full string for a large total runs
// to eighteen characters ("₹1,05,70,17,260.27"), which overflows a ~150px
// tile at the 24px stat size — and the paise on a figure that size are noise
// anyway. Units follow how the number is actually spoken here: crore, lakh,
// thousand. Callers pair this with the exact formatMoney value as a tooltip,
// and every table row still shows the precise figure.
export function formatMoneyCompact(value: number | string | undefined): string {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  if (abs < 1000) return formatMoney(n);
  const [divisor, suffix] = abs >= 10000000 ? [10000000, 'Cr'] : abs >= 100000 ? [100000, 'L'] : [1000, 'K'];
  const scaled = n / divisor;
  // Always one decimal. Dropping it above 100 turned a ₹105.70 Cr total into
  // "₹106 Cr", which rounds UP past the real figure — not something to show
  // a finance reader, and the two saved characters bought nothing.
  // maximumFractionDigits does not pad, so a round number still reads
  // "₹45 K" rather than "₹45.0 K".
  return `₹${scaled.toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${suffix}`;
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

// "1st", "2nd", "3rd", "4th"... with the 11th/12th/13th exception (all "th",
// not "st"/"nd"/"rd", despite ending in 1/2/3).
export function ordinalDay(day: number): string {
  const suffix = ['th', 'st', 'nd', 'rd'][day % 10 > 3 || Math.floor(day / 10) === 1 ? 0 : day % 10];
  return `${day}${suffix}`;
}

// Strips the "<timestamp>-<uuid>-" prefix lib/uploads.ts adds to every
// uploaded filename, leaving just the human-typed original name for display.
export function friendlyFileName(url: string): string {
  const parts = url.split('/');
  const raw = decodeURIComponent(parts[parts.length - 1] || 'file');
  const match = raw.match(/^\d+-[a-f0-9]+-(.+)$/);
  return match?.[1] || raw;
}
