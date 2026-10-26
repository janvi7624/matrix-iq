'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  QUOTATION_REQUEST_STATUS_LABEL,
  QuotationRequestStatus,
  canTransition,
  isOpenRequest
} from '@/lib/partnerQuotationRequestStages';
import AppShell from './AppShell';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './quotationRequests.module.css';

// The sales-side queue of partner quotation requests.
//
// Deliberately a queue rather than a tab on the Quotations screen: these are
// asks with no document yet, and mixing them into a list of real quotations
// is how an unpriced request gets mistaken for one we have sent.

interface QuotationRequest {
  id: string;
  partner_id: string;
  partner_company: string;
  partner_code: string;
  project_id: string;
  project_label: string;
  requirements: string;
  products: string;
  quantity_note: string;
  needed_by: string;
  urgency: string;
  status: QuotationRequestStatus;
  created_at: string;
  response_note: string;
  quotation_id: string;
  quotation_number: string;
  requested_by: string;
  sales_person: string;
  handled_by: string;
  handled_at: string;
  // Comes down with the row — see the store. There is no GET on
  // /api/quotations to fetch this from.
  project_quotations: ProjectQuotation[];
}

interface ProjectQuotation {
  id: string;
  quotation_number: string;
  status: string;
  shareable: boolean;
  total: number;
  created_at: string;
  revision_number: number;
  revision_reason: string;
  prepared_by: string;
  client_company: string;
  validity_days: number;
  expired: boolean;
  already_shared: boolean;
}

function money(value: number): string {
  return `₹${(Number(value) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/**
 * Why a quotation cannot be sent, or '' when it can.
 *
 * Stated per row rather than by hiding the row: "it isn't in the list" and
 * "it's a draft" look identical to someone hunting for a quotation they know
 * they created.
 */
function blockedReason(q: ProjectQuotation): string {
  if (!q.shareable) return 'Draft — finalise it before it can be sent';
  return '';
}

function date(value: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

/**
 * `embedded` drops the AppShell chrome so this can sit as a tab inside
 * components/QuotationsView.tsx — same arrangement MyQuotationsView already
 * uses, so the page keeps one header rather than nesting two.
 */
export default function QuotationRequestsView({ embedded }: { embedded?: boolean } = {}) {
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const highlight = params.get('highlight');

  const [rows, setRows] = useState<QuotationRequest[]>([]);
  const [status, setStatus] = useState('Loading…');
  const [openOnly, setOpenOnly] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [acting, setActing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [quotationId, setQuotationId] = useState('');
  const [quotations, setQuotations] = useState<ProjectQuotation[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/quotation-requests${openOnly ? '?open=1' : ''}`);
        if (!response.ok) throw new Error(String(response.status));
        const data: QuotationRequest[] = await response.json();
        if (cancelled) return;
        setRows(data);
        setStatus(data.length ? '' : openOnly ? 'No open requests.' : 'No partner quotation requests yet.');
      } catch {
        if (!cancelled) setStatus('Could not load the queue. Refresh to try again.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [openOnly, reloadKey]);

  // The quotations on this request's project arrive WITH the row, so the
  // picker is populated the instant it opens. An earlier version fetched
  // /api/quotations?projectId=… here — that route is POST-only, so the
  // request always failed and the dropdown was always empty.
  function openAction(row: QuotationRequest, next: QuotationRequestStatus) {
    setActing(`${row.id}|${next}`);
    setNote('');
    // Preselect when exactly one quotation can actually be sent: that is
    // overwhelmingly the case, and it turns the common path into one click.
    const shareable = row.project_quotations.filter((q) => q.shareable);
    setQuotationId(next === 'quoted' && shareable.length === 1 ? shareable[0].id : '');
    setQuotations(row.project_quotations);
  }

  async function send(row: QuotationRequest, next: QuotationRequestStatus) {
    setBusy(true);
    try {
      const response = await fetch(`/api/quotation-requests/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, note, quotationId: next === 'quoted' ? quotationId : undefined })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error(body?.error || 'Could not update this request.');
        return;
      }
      toast.success(
        next === 'quoted' ? 'Marked as quoted — the partner has been notified.' : next === 'declined' ? 'Request declined.' : 'Request updated.'
      );
      setActing(null);
      setReloadKey((k) => k + 1);
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => {
    const open = rows.filter((r) => isOpenRequest(r.status)).length;
    return { open, total: rows.length };
  }, [rows]);

  const body = (
    <>
      <div className={historyStyles.toolbar}>
        <label className={calcStyles.small} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          Open requests only
        </label>
        <span className={calcStyles.small}>
          {counts.open} open · {counts.total} shown
        </span>
        <button type="button" className={historyStyles.button} onClick={() => setReloadKey((k) => k + 1)}>
          Refresh
        </button>
      </div>

      {status && <div className={historyStyles.status}>{status}</div>}

      {rows.map((row) => {
        const activeNext = acting?.startsWith(`${row.id}|`) ? (acting.split('|')[1] as QuotationRequestStatus) : null;
        const hasSendable = row.project_quotations.some((q) => q.shareable);
        return (
          <div
            key={row.id}
            className={`${historyStyles.detailPanel} ${historyStyles.detailPanelFlush}`}
            style={{
              marginBottom: 14,
              borderLeft: `4px solid ${row.urgency === 'high' ? '#b91c1c' : row.status === 'open' ? '#d97706' : '#1a4a8a'}`,
              ...(highlight === row.id ? { outline: '2px solid #1a4a8a' } : {})
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <strong>{row.partner_company}</strong> {row.partner_code ? `(${row.partner_code})` : ''} —{' '}
                <Link href={`/projects/${row.project_id}`}>{row.project_label || 'project'}</Link>
              </div>
              <span className={calcStyles.small}>
                {QUOTATION_REQUEST_STATUS_LABEL[row.status]} · asked {date(row.created_at)}
                {row.urgency === 'high' ? ' · URGENT' : ''}
              </span>
            </div>

            <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>{row.requirements}</p>

            <div className={calcStyles.small}>
              {row.products && <>Products: {row.products}. </>}
              {row.quantity_note && <>Quantity: {row.quantity_note}. </>}
              {row.needed_by && <>Needed by {date(row.needed_by)}. </>}
              {row.sales_person ? <>Owner: {row.sales_person}.</> : <>No sales owner assigned yet.</>}
              {row.requested_by && <> Asked by {row.requested_by}.</>}
            </div>

            {row.quotation_number && (
              <div className={calcStyles.small} style={{ marginTop: 6 }}>
                Answered by quotation <strong>{row.quotation_number}</strong>.
              </div>
            )}
            {row.response_note && (
              <div className={calcStyles.small} style={{ marginTop: 6 }}>
                Our reply: {row.response_note}
              </div>
            )}

            {!activeNext ? (
              <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                {canTransition(row.status, 'in_progress') && (
                  <button type="button" className={historyStyles.button} onClick={() => openAction(row, 'in_progress')}>
                    Start preparing
                  </button>
                )}
                {/* Which of these two leads depends on whether anything is
                    ready to send. With a shareable quotation on the project,
                    sending it IS the next step; without one, there is
                    nothing to send and the builder is. */}
                {canTransition(row.status, 'quoted') && (
                  <button
                    type="button"
                    className={hasSendable ? calcStyles.btn : historyStyles.button}
                    onClick={() => openAction(row, 'quoted')}
                    disabled={row.project_quotations.length === 0}
                    title={row.project_quotations.length === 0 ? 'No quotations on this project yet' : undefined}
                  >
                    Send quotation to partner
                  </button>
                )}
                {/* Straight into the builder with the project already
                    selected — the calculator reads ?projectId= on mount, so
                    the customer, company and on-behalf options come with it. */}
                {isOpenRequest(row.status) && (
                  <button
                    type="button"
                    className={hasSendable ? historyStyles.button : calcStyles.btn}
                    onClick={() => router.push(`/quotation?projectId=${encodeURIComponent(row.project_id)}`)}
                  >
                    Create quotation
                  </button>
                )}
                {canTransition(row.status, 'declined') && (
                  <button type="button" className={historyStyles.button} onClick={() => openAction(row, 'declined')}>
                    Decline
                  </button>
                )}
                {/* A quoted request is finished — the quotation has its own
                    lifecycle from here, so there is nothing left to do. */}
                {row.status === 'quoted' && (
                  <span className={calcStyles.small}>Sent to the partner — they can open it in their portal.</span>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                {activeNext === 'quoted' && (
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Which quotation answers this? *</label>

                    {/* Radio cards, not a <select>. A dropdown can only show
                        one line per option, and a number plus a status is not
                        enough to choose between revisions of the same
                        quotation or several quotes for different scopes —
                        the amount and the date are what people actually
                        recognise them by. */}
                    {quotations.length > 0 && (
                      <div className={styles.pickList}>
                        {quotations.map((q) => {
                          const blocked = blockedReason(q);
                          const selected = quotationId === q.id;
                          return (
                            <label
                              key={q.id}
                              className={`${styles.pickRow} ${selected ? styles.pickRowSelected : ''} ${blocked ? styles.pickRowBlocked : ''}`}
                            >
                              <input
                                type="radio"
                                name={`quotation-${row.id}`}
                                value={q.id}
                                checked={selected}
                                disabled={Boolean(blocked)}
                                onChange={() => setQuotationId(q.id)}
                              />
                              <span className={styles.pickBody}>
                                <span className={styles.pickTop}>
                                  <strong>{q.quotation_number}</strong>
                                  {q.revision_number > 0 && (
                                    <span className={styles.pickTag}>Revision {q.revision_number}</span>
                                  )}
                                  <span className={styles.pickAmount}>{money(q.total)}</span>
                                </span>
                                <span className={styles.pickMeta}>
                                  {q.status}
                                  {q.expired && ' · validity lapsed'}
                                  {' · created '}
                                  {date(q.created_at)}
                                  {q.prepared_by && ` · by ${q.prepared_by}`}
                                  {q.client_company && ` · ${q.client_company}`}
                                </span>
                                {q.revision_reason && (
                                  <span className={styles.pickMeta}>Revised because: {q.revision_reason}</span>
                                )}
                                {blocked && <span className={styles.pickBlockedNote}>{blocked}</span>}
                                {q.already_shared && (
                                  <span className={styles.pickMeta}>Already shared with this partner.</span>
                                )}
                                {/* Sending a lapsed quote means the partner
                                    opens something we no longer stand behind,
                                    so it is flagged — but still allowed,
                                    since re-dating is a separate decision. */}
                                {q.expired && !blocked && (
                                  <span className={styles.pickBlockedNote}>
                                    Validity of {q.validity_days} days has passed — consider revising it first.
                                  </span>
                                )}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    )}

                    <span className={calcStyles.small}>
                      {quotations.length === 0
                        ? 'No quotations exist on this project yet — use “Create quotation”, then come back here to send it.'
                        : hasSendable
                          ? 'Confirming sends the selected quotation to the partner straight away — there is no need to share it again from Existing Quotations.'
                          : 'Every quotation on this project is still a draft. Finalise one before it can be sent.'}
                    </span>
                  </div>
                )}
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>
                    {activeNext === 'declined' ? 'Why are we not quoting? The partner will see this *' : 'Note for the partner (optional)'}
                  </label>
                  <textarea className={calcStyles.formControl} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={calcStyles.btn}
                    disabled={busy || (activeNext === 'quoted' && !quotationId) || (activeNext === 'declined' && !note.trim())}
                    onClick={() => send(row, activeNext)}
                  >
                    {busy ? 'Saving…' : 'Confirm'}
                  </button>
                  <button type="button" className={historyStyles.button} disabled={busy} onClick={() => setActing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  if (embedded) return body;
  return (
    <AppShell title="Partner Quotation Requests" subtitle="Partners asking us to price something">
      {body}
    </AppShell>
  );
}
