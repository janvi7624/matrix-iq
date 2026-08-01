'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LineItem, ProductGroup, QuotationEffectiveStatus, QuotationRecord } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { daysSince, needsFollowUp, parseFollowUpNotes } from '@/lib/followUp';
import { computeEffectiveStatusClient } from '@/lib/quotationStatus';
import styles from './quotationHistory.module.css';

const STATUS_LABEL: Record<QuotationEffectiveStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired'
};

const STATUS_CLASS: Record<QuotationEffectiveStatus, string> = {
  draft: styles.statusCancelled,
  sent: styles.statusPending,
  approved: styles.statusConfirmed,
  rejected: styles.statusRejected,
  expired: styles.statusDone
};

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

// Version History — every revision of one quotation, oldest first, each row
// showing its price delta vs. the version right before it (the app's
// lightweight take on "compare versions": read down the column rather than
// picking two versions into a dedicated diff screen).
function VersionHistory({ quotationId }: { quotationId: string }) {
  const [versions, setVersions] = useState<QuotationRecord[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    fetch(`/api/quotations/${quotationId}/versions`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: QuotationRecord[]) => setVersions(data))
      .catch(() => setLoadError(true));
  }, [quotationId]);

  if (loadError) return <div className={styles.small}>Could not load version history.</div>;
  if (!versions) return <div className={styles.small}>Loading version history…</div>;
  if (versions.length <= 1) return <div className={styles.small}>No revisions yet — this is the only version.</div>;

  return (
    <table className={styles.table} style={{ marginTop: 10 }}>
      <thead>
        <tr>
          <th>Version</th>
          <th>Quotation No.</th>
          <th>Edited By</th>
          <th>Date</th>
          <th>Reason</th>
          <th>Products</th>
          <th>Total</th>
          <th>Δ vs previous</th>
        </tr>
      </thead>
      <tbody>
        {versions.map((v, i) => {
          const prev = i > 0 ? versions[i - 1] : null;
          const delta = prev ? v.total - prev.total : 0;
          return (
            <tr key={v.id}>
              <td>{v.revision_number === 0 ? 'Original' : `Rev ${v.revision_number}`}</td>
              <td className={styles.num}>{v.quotation_number}</td>
              <td>{v.created_by}</td>
              <td>{formatDate(v.created_at)}</td>
              <td>{v.revision_reason || '-'}</td>
              <td>{v.products_summary || '-'}</td>
              <td className={styles.amount}>{formatMoney(v.total)}</td>
              <td style={{ color: delta > 0 ? '#b91c1c' : delta < 0 ? '#15803d' : '#6b7280', fontWeight: 600 }}>
                {prev ? `${delta > 0 ? '+' : ''}${formatMoney(delta)}` : '-'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface QuotationRowProps {
  row: QuotationRecord;
  onDelete?: (id: string) => void;
  onLogFollowUp: (id: string, note: string) => Promise<void>;
  showSalesPerson?: boolean;
  onChangeStatus?: (id: string, status: QuotationRecord['status']) => Promise<void>;
}

function QuotationRow({ row, onDelete, onLogFollowUp, showSalesPerson, onChangeStatus }: QuotationRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const flagged = needsFollowUp(row);
  const notes = parseFollowUpNotes(row.follow_up_notes_json);
  const effectiveStatus = computeEffectiveStatusClient(row);

  async function handleStatusChange(next: QuotationRecord['status']) {
    if (!onChangeStatus) return;
    setStatusBusy(true);
    try {
      await onChangeStatus(row.id, next);
    } finally {
      setStatusBusy(false);
    }
  }

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
        <td className={styles.num}>
          {row.quotation_number}
          {row.revision_number > 0 && (
            <span className={`${styles.rolePill} ${styles.rolePillBackoffice}`} style={{ marginLeft: 6 }}>Rev {row.revision_number}</span>
          )}
        </td>
        <td>{formatDate(row.created_at)}</td>
        <td>{row.prepared_by || '-'}</td>
        {showSalesPerson && <td>{row.created_by || '-'}</td>}
        <td>
          {row.client_name || row.client_company || '-'}
          {row.client_company && row.client_name ? ` (${row.client_company})` : ''}
        </td>
        <td>{row.domain_summary || '-'}</td>
        <td>{row.project_vertical || '-'}</td>
        <td>{row.products_summary || '-'}</td>
        <td className={styles.amount}>{formatMoney(row.total)}</td>
        <td>
          {onChangeStatus ? (
            <select
              value={row.status}
              disabled={statusBusy}
              onChange={(e) => handleStatusChange(e.target.value as QuotationRecord['status'])}
              style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12.5 }}
            >
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          ) : (
            <span className={`${styles.statusBadge} ${STATUS_CLASS[effectiveStatus]}`}>{STATUS_LABEL[effectiveStatus]}</span>
          )}
          {effectiveStatus === 'expired' && onChangeStatus && <div style={{ fontSize: 11, color: '#9ca3af' }}>(expired)</div>}
        </td>
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Link href={`/quotation?reviseId=${row.id}`} className={styles.toggleBtn} title="Create a new version of this quotation">
              Revise
            </Link>
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
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className={styles.detailsRow}>
          <td colSpan={showSalesPerson ? 13 : 12}>
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
            <div className={styles.navGroupLabel}>Version History</div>
            <VersionHistory quotationId={row.id} />
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
  showSalesPerson?: boolean;
  onChangeStatus?: (id: string, status: QuotationRecord['status']) => Promise<void>;
}

export default function QuotationTable({ rows, onDelete, onLogFollowUp, showSalesPerson, onChangeStatus }: QuotationTableProps) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th></th>
          <th>Quotation No.</th>
          <th>Date</th>
          <th>Prepared By</th>
          {showSalesPerson && <th>Sales Person</th>}
          <th>Client</th>
          <th>Domain</th>
          <th>Vertical</th>
          <th>Products</th>
          <th>Total</th>
          <th>Status</th>
          <th>Follow-up</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={showSalesPerson ? 13 : 12} className={styles.empty}>
              No quotations recorded yet.
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <QuotationRow
              key={row.id}
              row={row}
              onDelete={onDelete}
              onLogFollowUp={onLogFollowUp}
              showSalesPerson={showSalesPerson}
              onChangeStatus={onChangeStatus}
            />
          ))
        )}
      </tbody>
    </table>
  );
}
