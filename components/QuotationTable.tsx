'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download, FilePlus2, FileText, Loader2, Trash2 } from 'lucide-react';
import { LineItem, ProductGroup, QuotationEffectiveStatus, QuotationRecord } from '@/lib/types';
import { formatMoney } from '@/lib/format';
import { daysSince, needsFollowUp, parseFollowUpNotes } from '@/lib/followUp';
import { computeEffectiveStatusClient } from '@/lib/quotationStatus';
import { downloadQuotationFromRecord } from '@/lib/quotationPdfFromRecord';
import { useConfirm } from './ui/ConfirmDialog';
import { useToast } from './ui/ToastProvider';
import EmptyState from './ui/EmptyState';
import { TableWrap } from './ui/Table';
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

function parseProductGroups(productsJson: string): ProductDetailGroup[] {
  try {
    return JSON.parse(productsJson) || [];
  } catch {
    return [];
  }
}

function formatDateOnly(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function formatTimeOnly(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <div className={styles.qdLabel}>{label}</div>
      <div className={styles.qdValue}>{value}</div>
    </div>
  );
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
    <table className={styles.versionTable}>
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
              <td className={delta > 0 ? styles.deltaPositive : delta < 0 ? styles.deltaNegative : styles.deltaNeutral}>
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
  highlight?: boolean;
}

function QuotationRow({ row, onDelete, onLogFollowUp, showSalesPerson, onChangeStatus, highlight }: QuotationRowProps) {
  const confirm = useConfirm();
  // Arriving highlighted (from Dashboard's Recent Quotations) starts this row
  // already expanded, so the visitor sees its detail immediately rather than
  // having to find and open it themselves.
  const [expanded, setExpanded] = useState(!!highlight);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const toast = useToast();
  const flagged = needsFollowUp(row);
  const notes = parseFollowUpNotes(row.follow_up_notes_json);
  const isProposal = row.proposal_kind === 'project' || row.proposal_kind === 'tender';

  // The PDF is rebuilt from the saved record rather than fetched: nothing was
  // ever stored (see lib/quotationPdfFromRecord.ts). A Proposal has no line
  // items, so there it opens the uploaded commercial instead.
  async function handleDownload() {
    setDownloadBusy(true);
    try {
      const outcome = await downloadQuotationFromRecord(row);
      if (outcome === 'nothing-to-download') {
        toast.error(
          isProposal
            ? 'No document was attached to this proposal, so there is nothing to download.'
            : 'This quotation has no saved line items, so the PDF cannot be rebuilt.'
        );
      }
    } catch {
      toast.error('The PDF could not be generated. Check your connection and try again.');
    } finally {
      setDownloadBusy(false);
    }
  }
  const effectiveStatus = computeEffectiveStatusClient(row);
  const rowRef = useRef<HTMLTableRowElement>(null);
  // Built once so the visible text and its tooltip can't drift apart.
  const clientLabel =
    (row.client_name || row.client_company || '-') +
    (row.client_company && row.client_name ? ` (${row.client_company})` : '');

  useEffect(() => {
    if (highlight) rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlight]);

  async function handleStatusChange(next: QuotationRecord['status']) {
    if (!onChangeStatus) return;
    setStatusBusy(true);
    try {
      await onChangeStatus(row.id, next);
    } finally {
      setStatusBusy(false);
    }
  }

  const productGroups = parseProductGroups(row.products_json);

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
      <tr ref={rowRef} className={highlight ? styles.rowHighlighted : undefined}>
        <td>
          <button type="button" className={styles.toggleBtn} onClick={() => setExpanded((v) => !v)}>
            {expanded ? '−' : '+'}
          </button>
        </td>
        <td className={styles.num}>
          {row.quotation_number}
          {row.revision_number > 0 && (
            <span className={`${styles.rolePill} ${styles.rolePillBackoffice} ${styles.revisionTag}`}>Rev {row.revision_number}</span>
          )}
        </td>
        <td className={styles.cellDate}>
          {formatDateOnly(row.created_at)}
          <span className={styles.cellTime}>{formatTimeOnly(row.created_at)}</span>
        </td>
        <td>{row.prepared_by || '-'}</td>
        {showSalesPerson && <td>{row.created_by || '-'}</td>}
        <td>
          <span className={styles.quotationCellWide} title={clientLabel}>{clientLabel}</span>
        </td>
        <td><span className={styles.quotationCell} title={row.domain_summary || undefined}>{row.domain_summary || '-'}</span></td>
        <td><span className={styles.quotationCell} title={row.project_vertical || undefined}>{row.project_vertical || '-'}</span></td>
        <td><span className={styles.quotationCellWide} title={row.products_summary || undefined}>{row.products_summary || '-'}</span></td>
        <td className={styles.amount}>{formatMoney(row.total)}</td>
        <td>
          {onChangeStatus ? (
            <select
              className={styles.statusSelect}
              value={row.status}
              disabled={statusBusy}
              onChange={(e) => handleStatusChange(e.target.value as QuotationRecord['status'])}
            >
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          ) : (
            <span className={`${styles.statusBadge} ${STATUS_CLASS[effectiveStatus]}`}>{STATUS_LABEL[effectiveStatus]}</span>
          )}
          {effectiveStatus === 'expired' && onChangeStatus && <div className={styles.expiredNote}>(expired)</div>}
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
          <div className={styles.rowActionsInline}>
            {/* Revise leads: it's the action people come to a past quotation
                to perform, so it carries the brand tint and sits first.
                Download is the supporting action beside it. */}
            <Link
              href={`/quotation?reviseId=${row.id}`}
              className={`${styles.rowAction} ${styles.rowActionPrimary}`}
              title={`Create a new version of ${row.quotation_number}`}
            >
              <FilePlus2 size={14} aria-hidden />
              <span className={styles.rowActionLabel}>Revise</span>
            </Link>
            <button
              type="button"
              className={styles.rowAction}
              disabled={downloadBusy}
              title={isProposal ? 'Open the uploaded commercial document' : 'Rebuild and download this quotation as a PDF'}
              onClick={handleDownload}
            >
              {downloadBusy ? <Loader2 size={14} className={styles.rowActionSpin} aria-hidden /> : <Download size={14} aria-hidden />}
              {/* Fixed-width label: "Download" -> "Working…" used to resize
                  the button and shunt everything beside it sideways
                  mid-click. */}
              <span className={`${styles.rowActionLabel} ${styles.rowActionLabelFixed}`}>
                {downloadBusy ? 'Working…' : 'Download'}
              </span>
            </button>
            {onDelete && (
              <button
                type="button"
                /* Separated and danger-toned: a destructive action should not
                   sit flush against two routine ones at the same weight. */
                className={`${styles.rowAction} ${styles.rowActionDanger}`}
                title={`Delete ${row.quotation_number}`}
                onClick={async () => {
                  if (await confirm({ message: `Delete quotation ${row.quotation_number}? This cannot be undone.`, danger: true })) {
                    onDelete(row.id);
                  }
                }}
              >
                <Trash2 size={14} aria-hidden />
                <span className={styles.rowActionLabel}>Delete</span>
              </button>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className={styles.detailsRow}>
          <td colSpan={showSalesPerson ? 13 : 12}>
            <div className={styles.qdSection}>
              <div className={styles.qdSectionTitle}>Prepared By</div>
              <div className={styles.qdGrid}>
                <Field label="Name" value={row.prepared_by} />
                <Field label="Phone" value={row.prepared_by_phone} />
                <Field label="Email" value={row.prepared_by_email} />
              </div>
            </div>

            <div className={styles.qdSection}>
              <div className={styles.qdSectionTitle}>Client</div>
              <div className={styles.qdGrid}>
                <Field label="Contact" value={row.client_name} />
                <Field label="Company" value={row.client_company} />
                <Field label="Email" value={row.client_email} />
                <Field label="Phone" value={row.client_phone} />
                <Field label="Address" value={row.client_address} />
                <Field label="Project vertical" value={row.project_vertical} />
                <Field label="Validity" value={`${row.validity_days} days`} />
              </div>
            </div>

            <div className={styles.qdSection}>
              <div className={styles.qdSectionTitle}>Products</div>
              {productGroups.length === 0 ? (
                <div className={styles.qdEmpty}>No product detail recorded.</div>
              ) : (
                productGroups.map((group, gi) => (
                  <div key={`${group.label}-${gi}`} className={styles.qdGroup}>
                    <div className={styles.qdGroupName}>{group.label}</div>
                    {group.remark && group.remark.trim() && <div className={styles.qdGroupRemark}>{group.remark.trim()}</div>}
                    <table className={styles.qdItems}>
                      <thead>
                        <tr>
                          <th>Description</th>
                          <th className={styles.qdNum}>Qty</th>
                          <th className={styles.qdNum}>Rate</th>
                          <th className={styles.qdNum}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(group.lineItems || []).map((li, li_i) => (
                          <tr key={`${li.description}-${li_i}`}>
                            <td>{li.description}</td>
                            <td className={styles.qdNum}>{li.qty} {li.unit || ''}</td>
                            <td className={styles.qdNum}>{formatMoney(li.rate)}</td>
                            <td className={styles.qdNum}>{formatMoney(li.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))
              )}
              <div className={styles.qdTotals}>
                <span className={styles.qdTotalItem}>Subtotal <b>{formatMoney(row.subtotal)}</b></span>
                <span className={styles.qdTotalItem}>Markup <b>{row.markup_percent}%</b></span>
                <span className={styles.qdTotalItem}>Discount <b>{formatMoney(row.discount_total)}</b></span>
                <span className={styles.qdTotalItem}>GST <b>{formatMoney(row.gst_amount)}</b></span>
                <span className={styles.qdGrandTotal}>Total <b>{formatMoney(row.total)}</b></span>
              </div>
            </div>

            <div className={styles.qdSection}>
              <div className={styles.qdSectionTitle}>Follow-up History</div>
              {notes.length === 0 ? (
                <div className={styles.qdEmpty}>No follow-ups logged yet.</div>
              ) : (
                notes.map((n, ni) => (
                  <div key={`${n.at}-${ni}`} className={styles.qdFollowUp}>
                    <div>{n.note || <span className={styles.qdEmpty}>(no note)</span>}</div>
                    <div className={styles.qdFollowUpMeta}>{formatDate(n.at)} · {n.by}</div>
                  </div>
                ))
              )}
            </div>
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
            <div className={styles.versionTableWrap}>
              <VersionHistory quotationId={row.id} />
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
  showSalesPerson?: boolean;
  onChangeStatus?: (id: string, status: QuotationRecord['status']) => Promise<void>;
  highlightId?: string;
}

export default function QuotationTable({ rows, onDelete, onLogFollowUp, showSalesPerson, onChangeStatus, highlightId }: QuotationTableProps) {
  return (
    <TableWrap className={styles.quotationViewport}>
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
            <td colSpan={showSalesPerson ? 13 : 12}>
              <EmptyState icon={FileText} title="No quotations yet" message="Create a quotation to see it listed here, with status, versions, and follow-ups." />
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
              highlight={!!highlightId && row.id === highlightId}
            />
          ))
        )}
      </tbody>
    </table>
    </TableWrap>
  );
}
