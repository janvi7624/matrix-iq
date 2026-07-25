'use client';

import { GST_RATE_PERCENT, formatMoney } from '@/lib/format';
import { DomainResult, SummaryEntry, Totals } from '@/lib/types';
import styles from './calculator.module.css';

interface SummaryPanelProps {
  activeResult: DomainResult | null;
  cartCount: number;
  cartSubtotal: number;
  customProductsTotal: number;
  totals: Totals;
}

function Row({ entry }: { entry: SummaryEntry }) {
  return (
    <div className={`${styles.summaryItem} ${entry.highlight ? styles.summaryItemHighlight : ''}`}>
      <strong>{entry.label}</strong>
      <span>{entry.value}</span>
    </div>
  );
}

export default function SummaryPanel({ activeResult, cartCount, cartSubtotal, customProductsTotal, totals }: SummaryPanelProps) {
  const rows: SummaryEntry[] = [
    ...(activeResult?.summary || []),
    // Once anything has been explicitly added to the cart, the currently-open
    // estimator is just a live preview (see composeQuote) — it's not counted
    // here either, so this total matches what actually lands in the PDF.
    ...(cartCount > 0
      ? [
          { label: 'Products in quote', value: String(cartCount) },
          { label: 'Products subtotal', value: formatMoney(cartSubtotal) }
        ]
      : []),
    ...(customProductsTotal ? [{ label: 'Custom products', value: formatMoney(customProductsTotal) }] : []),
    { label: 'Subtotal', value: formatMoney(totals.subtotal) },
    { label: 'Markup', value: `${totals.markup}%` },
    ...(totals.discountTotal ? [{ label: 'Discount', value: `− ${formatMoney(totals.discountTotal)}` }] : []),
    { label: 'Total before GST', value: formatMoney(totals.preGstTotal) },
    { label: `GST (${GST_RATE_PERCENT}%)`, value: formatMoney(totals.gstAmount) },
    { label: 'Estimated total (incl. GST)', value: formatMoney(totals.total), highlight: true }
  ];

  return (
    <div className={styles.summaryGrid}>
      {cartCount > 0 && activeResult && (
        <div className={styles.small} style={{ gridColumn: '1 / -1', marginBottom: 4 }}>
          Currently configuring (preview only — click &quot;Add configured product to quote&quot; to include it):
        </div>
      )}
      {rows.map((entry, index) => (
        <Row key={`${entry.label}-${index}`} entry={entry} />
      ))}
    </div>
  );
}
