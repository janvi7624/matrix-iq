'use client';

import { useState } from 'react';
import { LineItem, ProductGroup, QuotationRecord } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { daysSince, needsFollowUp, parseFollowUpNotes } from '@/lib/followUp';
import styles from './quotationHistory.module.css';

interface ProductDetailGroup extends Pick<ProductGroup, 'label' | 'remark'> {
  lineItems: LineItem[];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

function renderProductDetail(productsJson: string): string {
  let products: ProductDetailGroup[] = [];
  try {
    products = JSON.parse(productsJson) || [];
  } catch {
    /* ignore */
  }
  if (!products.length) return 'No product detail recorded.';
  return products
    .map((group) => {
      const lines = (group.lineItems || [])
        .map(
          (li) =>
            `  - ${li.description}  |  Qty: ${li.qty} ${li.unit || ''}  |  Rate: ${formatMoney(li.rate)}  |  Amount: ${formatMoney(li.amount)}`
        )
        .join('\n');
      const remarkLine = group.remark && group.remark.trim() ? `\n  Remark: ${group.remark.trim()}` : '';
      return `${group.label}\n${lines}${remarkLine}`;
    })
    .join('\n\n');
}

interface QuotationRowProps {
  row: QuotationRecord;
  onDelete?: (id: string) => void;
  onLogFollowUp: (id: string, note: string) => Promise<void>;
}

function QuotationRow({ row, onDelete, onLogFollowUp }: QuotationRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const flagged = needsFollowUp(row);
  const notes = parseFollowUpNotes(row.follow_up_notes_json);

  const detailText = [
    `Prepared by: ${row.prepared_by || '-'}  |  Phone: ${row.prepared_by_phone || '-'}  |  Email: ${row.prepared_by_email || '-'}`,
    `Client: ${row.client_name || '-'}  |  Company: ${row.client_company || '-'}  |  Email: ${row.client_email || '-'}  |  Phone: ${row.client_phone || '-'}`,
    row.client_address ? `Address: ${row.client_address}` : '',
    row.project_vertical ? `Project vertical: ${row.project_vertical}` : '',
    `Validity: ${row.validity_days} days`,
    '',
    'Products:',
    renderProductDetail(row.products_json),
    '',
    `Subtotal: ${formatMoney(row.subtotal)}  |  Markup: ${row.markup_percent}%  |  Discount: ${formatMoney(row.discount_total)}  |  GST: ${formatMoney(row.gst_amount)}  |  Total: ${formatMoney(row.total)}`,
    '',
    notes.length ? 'Follow-up history:' : 'Follow-up history: none yet',
    ...notes.map((n) => `  - ${formatDate(n.at)} by ${n.by}: ${n.note || '(no note)'}`)
  ]
    .filter(Boolean)
    .join('\n');

  async function handleLogFollowUp() {
    setBusy(true);
    try {
      await onLogFollowUp(row.id, note.trim());
      setNote('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          <button type="button" className={styles.toggleBtn} onClick={() => setExpanded((v) => !v)}>
            {expanded ? '−' : '+'}
          </button>
        </td>
        <td className={styles.num}>{row.quotation_number}</td>
        <td>{formatDate(row.created_at)}</td>
        <td>{row.prepared_by || '-'}</td>
        <td>
          {row.client_name || row.client_company || '-'}
          {row.client_company && row.client_name ? ` (${row.client_company})` : ''}
        </td>
        <td>{row.domain_summary || '-'}</td>
        <td>{row.project_vertical || '-'}</td>
        <td>{row.products_summary || '-'}</td>
        <td className={styles.amount}>{formatMoney(row.total)}</td>
        <td>
          {flagged ? (
            <span className={styles.followUpBadge} title="No follow-up logged recently">
              Needs follow-up ({daysSince(row.last_follow_up_at || row.created_at)}d)
            </span>
          ) : row.last_follow_up_at ? (
            <span className={styles.followUpOk}>Followed up {daysSince(row.last_follow_up_at)}d ago</span>
          ) : (
            <span className={styles.followUpOk}>—</span>
          )}
        </td>
        <td>
          {onDelete && (
            <button
              type="button"
              className={styles.deleteBtn}
              title="Delete this quotation"
              onClick={() => {
                if (window.confirm(`Delete quotation ${row.quotation_number}? This cannot be undone.`)) {
                  onDelete(row.id);
                }
              }}
            >
              Delete
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className={styles.detailsRow}>
          <td colSpan={11}>
            <pre>{detailText}</pre>
            <div className={styles.followUpForm}>
              <input
                type="text"
                placeholder="Follow-up note (optional) — e.g. called client, awaiting PO"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button type="button" disabled={busy} onClick={handleLogFollowUp}>
                {busy ? 'Logging…' : 'Log follow-up'}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

interface QuotationTableProps {
  rows: QuotationRecord[];
  onDelete?: (id: string) => void;
  onLogFollowUp: (id: string, note: string) => Promise<void>;
}

export default function QuotationTable({ rows, onDelete, onLogFollowUp }: QuotationTableProps) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th></th>
          <th>Quotation No.</th>
          <th>Date</th>
          <th>Prepared By</th>
          <th>Client</th>
          <th>Domain</th>
          <th>Vertical</th>
          <th>Products</th>
          <th>Total</th>
          <th>Follow-up</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={10} className={styles.empty}>
              No quotations recorded yet.
            </td>
          </tr>
        ) : (
          rows.map((row) => <QuotationRow key={row.id} row={row} onDelete={onDelete} onLogFollowUp={onLogFollowUp} />)
        )}
      </tbody>
    </table>
  );
}
