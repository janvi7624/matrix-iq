'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import AppShell from './AppShell';
import StatTile from './ui/StatTile';
import Select from './ui/Select';
import Table from './ui/Table';
import Drawer from './ui/Drawer';
import Modal from './ui/Modal';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import { useToast } from './ui/ToastProvider';
import { PaymentQueueItem, PaymentSource, PaymentSummary, UserRole } from '@/lib/types';
import { BRAND } from '@/lib/branding';
import styles from './accountsPayments.module.css';
import calcStyles from './calculator.module.css';

interface Props {
  currentUser: { username: string; name: string; role: UserRole; isPrivileged: boolean };
}

const SOURCE_LABELS: Record<PaymentSource, string> = {
  reimbursement_sheet: 'Reimbursement',
  admin_expense: 'Admin Expense',
  office_expense: 'Office Operation Expense',
  bom_request: 'BOM Request',
  travel_schedule: 'Travel Booking'
};

const SOURCE_ORIGINAL_HREF: Record<PaymentSource, string> = {
  reimbursement_sheet: '/reimbursement',
  admin_expense: '/admin-expenses',
  office_expense: '/office-operation-expenses',
  bom_request: '/tms/bom-requests',
  travel_schedule: '/travel-schedule'
};

const STATUS_LABEL: Record<string, string> = {
  payment_required: 'Payment Required',
  on_hold: 'On Hold',
  paid: 'Paid'
};

const STATUS_TONE: Record<string, StatusTone> = {
  payment_required: 'pending',
  on_hold: 'at_risk',
  paid: 'done'
};

function formatMoney(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function dueTone(item: PaymentQueueItem): string {
  if (!item.dueDate || item.status === 'paid') return '';
  const due = new Date(item.dueDate).getTime();
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  if (due < now - oneDay) return styles.dueOverdue;
  if (due <= now + oneDay) return styles.dueToday;
  return '';
}

const PAGE_SIZE = 20;

export default function AccountsPaymentsView({ currentUser }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [items, setItems] = useState<PaymentQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [selected, setSelected] = useState<PaymentQueueItem | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const [payForm, setPayForm] = useState({ paymentMethod: 'Bank Transfer', paymentDate: new Date().toISOString().slice(0, 10), paymentReference: '', remarks: '' });
  const [holdReason, setHoldReason] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const fetchSummary = useCallback(() => {
    fetch('/api/accounts/payments/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSummary(data))
      .catch(() => setSummary(null));
  }, []);

  const fetchList = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (source !== 'all') params.set('source', source);
    if (tab === 'queue' && status !== 'all') params.set('status', status);
    if (debouncedSearch) params.set('search', debouncedSearch);
    const endpoint = tab === 'queue' ? '/api/accounts/payments' : '/api/accounts/payments/history';
    fetch(`${endpoint}?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setItems(data?.items ?? []);
        setTotal(data?.total ?? 0);
      })
      .catch(() => { setItems([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [tab, source, status, debouncedSearch, page]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchList(); }, [fetchList]);
  useEffect(() => { setPage(1); }, [tab, source, status, debouncedSearch]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns = useMemo(
    () => [
      {
        key: 'source',
        header: 'Source',
        render: (r: PaymentQueueItem) => SOURCE_LABELS[r.source]
      },
      { key: 'payee', header: 'Payee', render: (r: PaymentQueueItem) => r.payee },
      { key: 'description', header: 'Description', render: (r: PaymentQueueItem) => r.description },
      { key: 'amount', header: 'Amount', render: (r: PaymentQueueItem) => <span className={styles.amountCell}>{formatMoney(r.amount)}</span> },
      { key: 'requestedBy', header: 'Requested By', render: (r: PaymentQueueItem) => r.requestedBy },
      {
        key: 'due',
        header: tab === 'queue' ? 'Due Date' : 'Paid Date',
        render: (r: PaymentQueueItem) =>
          tab === 'queue' ? (
            <span className={`${styles.dueCell} ${dueTone(r)}`}>{formatDate(r.dueDate)}</span>
          ) : (
            <span className={styles.dueCell}>{formatDate(r.paidAt)}</span>
          )
      },
      {
        key: 'status',
        header: 'Status',
        render: (r: PaymentQueueItem) => <StatusBadge tone={STATUS_TONE[r.status]} label={STATUS_LABEL[r.status]} />
      },
      {
        key: 'action',
        header: 'Action',
        render: (r: PaymentQueueItem) =>
          r.status === 'payment_required' ? (
            <button type="button" className={styles.payBtn} onClick={(e) => { e.stopPropagation(); openPay(r); }}>
              Pay
            </button>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--mx-ink-faint)' }}>View</span>
          )
      }
    ],
    [tab]
  );

  function openDetail(item: PaymentQueueItem) {
    setSelected(item);
  }

  function openPay(item: PaymentQueueItem) {
    setSelected(item);
    setPayForm({ paymentMethod: 'Bank Transfer', paymentDate: new Date().toISOString().slice(0, 10), paymentReference: '', remarks: '' });
    setConfirming(false);
    setPayOpen(true);
  }

  function openHold(item: PaymentQueueItem) {
    setSelected(item);
    setHoldReason('');
    setHoldOpen(true);
  }

  async function submitPay() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/payments/${encodeURIComponent(selected.paymentId)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payForm)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not complete the payment.');
        return;
      }
      toast.success('Payment recorded.');
      setPayOpen(false);
      setSelected(null);
      fetchList();
      fetchSummary();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function submitHold() {
    if (!selected || !holdReason.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/payments/${encodeURIComponent(selected.paymentId)}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: holdReason.trim() })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not put this payment on hold.');
        return;
      }
      toast.success('Payment put on hold.');
      setHoldOpen(false);
      setSelected(null);
      fetchList();
      fetchSummary();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function resumePayment(item: PaymentQueueItem) {
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/payments/${encodeURIComponent(item.paymentId)}/resume`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Could not resume this payment.');
        return;
      }
      toast.success('Payment resumed.');
      setSelected(null);
      fetchList();
      fetchSummary();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title={BRAND.appName} subtitle={`Accounts — Payments · ${currentUser.name}`} showBackLink={false}>
      <div className={styles.kpiGrid}>
        <StatTile label="Pending" value={summary ? formatMoney(summary.pendingAmount) : '—'} tone="info" />
        <StatTile label="Due Today" value={summary ? formatMoney(summary.dueTodayAmount) : '—'} tone="warning" />
        <StatTile label="Overdue" value={summary ? formatMoney(summary.overdueAmount) : '—'} tone="danger" />
        <StatTile label="Paid This Month" value={summary ? formatMoney(summary.paidThisMonthAmount) : '—'} tone="success" />
      </div>

      <div className={styles.tabRow}>
        <button type="button" className={`${styles.tabBtn} ${tab === 'queue' ? styles.tabActive : ''}`} onClick={() => setTab('queue')}>
          Payment Queue{summary ? ` (${summary.pendingCount})` : ''}
        </button>
        <button type="button" className={`${styles.tabBtn} ${tab === 'history' ? styles.tabActive : ''}`} onClick={() => setTab('history')}>
          Payment History
        </button>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <div className={calcStyles.formControl} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={15} color="var(--mx-ink-faint)" />
            <input
              type="text"
              placeholder="Search payee, description, requester…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ border: 'none', outline: 'none', flex: 1, fontSize: 14, background: 'transparent' }}
            />
          </div>
        </div>
        <Select auto value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="all">All Sources</option>
          {Object.entries(SOURCE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </Select>
        {tab === 'queue' && (
          <Select auto value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All Statuses</option>
            <option value="payment_required">Payment Required</option>
            <option value="on_hold">On Hold</option>
          </Select>
        )}
        <a className={styles.exportLink} href="/api/accounts/payments/export.csv">Export CSV</a>
      </div>

      <div className={styles.tableSection}>
        <Table
          columns={columns}
          rows={items}
          rowKey={(r) => r.paymentId}
          onRowClick={openDetail}
          empty={<div className={styles.emptyState}>{loading ? 'Loading…' : tab === 'queue' ? 'Nothing needs payment right now. You\'re all caught up.' : 'No paid payments yet.'}</div>}
        />
      </div>

      <div className={styles.cardList}>
        {items.map((r) => (
          <div key={r.paymentId} className={styles.card} onClick={() => openDetail(r)}>
            <div className={styles.cardHead}>
              <div>
                <div className={styles.cardSource}>{SOURCE_LABELS[r.source]}</div>
                <div className={styles.cardPayee}>{r.payee}</div>
              </div>
              <div className={styles.cardAmount}>{formatMoney(r.amount)}</div>
            </div>
            <div className={styles.cardMeta}>{r.description}</div>
            <div className={styles.cardMeta}>
              {tab === 'queue' ? `Due: ${formatDate(r.dueDate)}` : `Paid: ${formatDate(r.paidAt)}`} · <StatusBadge tone={STATUS_TONE[r.status]} label={STATUS_LABEL[r.status]} />
            </div>
            {r.status === 'payment_required' && (
              <div className={styles.cardActions}>
                <button type="button" onClick={(e) => { e.stopPropagation(); openDetail(r); }}>View</button>
                <button type="button" onClick={(e) => { e.stopPropagation(); openPay(r); }}>Pay</button>
              </div>
            )}
          </div>
        ))}
        {!items.length && <div className={styles.emptyState}>{loading ? 'Loading…' : 'Nothing here.'}</div>}
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button type="button" className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" className={styles.pageBtn} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}

      {selected && !payOpen && !holdOpen && (
        <Drawer title={`Payment — ${SOURCE_LABELS[selected.source]}`} ariaLabel="Payment detail" onClose={() => setSelected(null)}>
          <div className={styles.detailGrid}>
            {selected.status === 'on_hold' && selected.holdReason && (
              <div className={styles.holdBanner}>On hold: {selected.holdReason}</div>
            )}
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Amount</span>
              <span className={styles.detailAmount}>{formatMoney(selected.amount)}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Payee</span>
              <span className={styles.detailValue}>{selected.payee}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Description</span>
              <span className={styles.detailValue}>{selected.description}</span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Requested By</span>
              <span className={styles.detailValue}>{selected.requestedBy}</span>
            </div>
            {selected.approvedBy && (
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Approved By</span>
                <span className={styles.detailValue}>{selected.approvedBy}{selected.approvedAt ? ` — ${formatDate(selected.approvedAt)}` : ''}</span>
              </div>
            )}
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Due Date (SLA target)</span>
              <span className={styles.detailValue}>{formatDate(selected.dueDate)}</span>
            </div>
            <div className={styles.detailDivider} />
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Source</span>
              <span className={styles.detailValue}>
                {SOURCE_LABELS[selected.source]} — <a className={styles.originalLink} href={SOURCE_ORIGINAL_HREF[selected.source]}>Open Original Request</a>
              </span>
            </div>
            {selected.status === 'paid' && (
              <>
                <div className={styles.detailDivider} />
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Paid</span>
                  <span className={styles.detailValue}>{formatDate(selected.paidAt)} by {selected.paidBy || '—'}</span>
                </div>
                {selected.paymentMethod && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Method</span>
                    <span className={styles.detailValue}>{selected.paymentMethod}</span>
                  </div>
                )}
                {selected.paymentReference && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Reference</span>
                    <span className={styles.detailValue}>{selected.paymentReference}</span>
                  </div>
                )}
              </>
            )}
            {selected.status === 'payment_required' && (
              <div className={styles.detailActions}>
                <button type="button" className={styles.holdBtn} onClick={() => openHold(selected)}>Put On Hold</button>
                <button type="button" className={styles.payBtn} style={{ padding: 12 }} onClick={() => openPay(selected)}>Make Payment</button>
              </div>
            )}
            {selected.status === 'on_hold' && (
              <div className={styles.detailActions}>
                <button type="button" className={styles.resumeBtn} disabled={busy} onClick={() => resumePayment(selected)}>Resume Payment</button>
              </div>
            )}
          </div>
        </Drawer>
      )}

      {payOpen && selected && (
        <Modal
          title={confirming ? 'Confirm Payment' : 'Make Payment'}
          ariaLabel="Make payment"
          onClose={() => { setPayOpen(false); setSelected(null); }}
        >
          {!confirming ? (
            <div className={styles.form}>
              <div className={styles.formRow}>
                <label>Amount</label>
                <div className={styles.detailAmount}>{formatMoney(selected.amount)}</div>
              </div>
              <div className={styles.formGrid}>
                <div className={styles.formRow}>
                  <label>Payment Date</label>
                  <input type="date" className={styles.formInput} value={payForm.paymentDate} onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))} />
                </div>
                <div className={styles.formRow}>
                  <label>Payment Method</label>
                  <Select value={payForm.paymentMethod} onChange={(e) => setPayForm((f) => ({ ...f, paymentMethod: e.target.value }))}>
                    <option>Bank Transfer</option>
                    <option>UPI</option>
                    <option>Cash</option>
                    <option>Cheque</option>
                    <option>Other</option>
                  </Select>
                </div>
              </div>
              <div className={styles.formRow}>
                <label>Transaction / Reference No.</label>
                <input type="text" className={styles.formInput} value={payForm.paymentReference} onChange={(e) => setPayForm((f) => ({ ...f, paymentReference: e.target.value }))} />
              </div>
              <div className={styles.formRow}>
                <label>Remarks (optional)</label>
                <input type="text" className={styles.formInput} value={payForm.remarks} onChange={(e) => setPayForm((f) => ({ ...f, remarks: e.target.value }))} />
              </div>
              <div className={styles.detailActions}>
                <button type="button" className={styles.holdBtn} onClick={() => { setPayOpen(false); setSelected(null); }}>Cancel</button>
                <button type="button" className={styles.payBtn} style={{ padding: 12 }} onClick={() => setConfirming(true)}>Continue</button>
              </div>
            </div>
          ) : (
            <div className={styles.form}>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Payee</span>
                <span className={styles.detailValue}>{selected.payee}</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Amount</span>
                <span className={styles.detailAmount}>{formatMoney(selected.amount)}</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Method</span>
                <span className={styles.detailValue}>{payForm.paymentMethod}</span>
              </div>
              <p style={{ fontSize: 13.5, color: 'var(--mx-ink-muted)' }}>Are you sure this payment has been completed?</p>
              <div className={styles.detailActions}>
                <button type="button" className={styles.holdBtn} disabled={busy} onClick={() => setConfirming(false)}>Back</button>
                <button type="button" className={styles.payBtn} style={{ padding: 12 }} disabled={busy} onClick={submitPay}>Confirm Payment</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {holdOpen && selected && (
        <Modal title="Put On Hold" ariaLabel="Put payment on hold" onClose={() => { setHoldOpen(false); setSelected(null); }}>
          <div className={styles.form}>
            <div className={styles.formRow}>
              <label>Reason for Hold</label>
              <textarea
                className={styles.formInput}
                rows={3}
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
                placeholder="e.g. Missing bank details, invoice missing, amount mismatch…"
              />
            </div>
            <div className={styles.detailActions}>
              <button type="button" className={styles.holdBtn} onClick={() => { setHoldOpen(false); setSelected(null); }}>Cancel</button>
              <button type="button" className={styles.payBtn} style={{ padding: 12 }} disabled={busy || !holdReason.trim()} onClick={submitHold}>Put On Hold</button>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}
