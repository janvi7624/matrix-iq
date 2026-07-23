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
    ...(cartCount > 0
      ? [
          { label: 'Products in quote', value: String(cartCount + 1) },
          { label: 'Products subtotal', value: formatMoney((activeResult?.subtotal || 0) + cartSubtotal) }
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
      {rows.map((entry, index) => (
        <Row key={`${entry.label}-${index}`} entry={entry} />
      ))}
    </div>
  );
}
