'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, SlidersHorizontal, X } from 'lucide-react';
import CommonButton from './ui/CommonButton';
import AppShell from './AppShell';
import StatTile from './ui/StatTile';
import SearchInput from './ui/SearchInput';
import Dropdown from './ui/Dropdown';
import Table from './ui/Table';
import TablePager from './ui/TablePager';
import { Skeleton, SkeletonList, SkeletonTable } from './ui/Skeleton';
import Drawer from './ui/Drawer';
import Modal from './ui/Modal';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import { useToast } from './ui/ToastProvider';
import { AdminExpenseSheetEntry, OfficeExpenseSheetEntry, PaymentQueueItem, PaymentSource, PaymentSummary, UserRole } from '@/lib/types';
import type { ReimbursementPivot } from '@/lib/reimbursementSheetStore';
import { BRAND } from '@/lib/branding';
import { friendlyFileName } from '@/lib/format';
import { VoucherData } from '@/lib/expenseVoucherPdf';
import { currentFiscalYear, fiscalYearOptions, listPeriodOptions, periodContainingDate, TargetPeriodType } from '@/lib/targetPeriod';
import styles from './accountsPayments.module.css';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import { useAutoRefresh } from '@/lib/useAutoRefresh';
import { setListParam } from '@/lib/listParam';

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

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_CHOICES = [10, 20, 50, 100] as const;

export default function AccountsPaymentsView({ currentUser }: Props) {
  const toast = useToast();
  const [tab, setTab] = useState<'queue' | 'history' | 'reimbursement-report'>('queue');
  const [pivot, setPivot] = useState<ReimbursementPivot | null>(null);
  const [pivotLoading, setPivotLoading] = useState(false);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const [items, setItems] = useState<PaymentQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);

  // Multi-select filters: an empty list means "all".
  const [source, setSource] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Period filter — the same fiscal calendar the Targets module uses
  // (lib/targetPeriod.ts), so "Q2" means the same three months everywhere in
  // MatrixIQ. 'none' is the default: a date filter nobody asked for would
  // hide payments on first load.
  const [periodType, setPeriodType] = useState<TargetPeriodType | 'none'>('none');
  const [fiscalYear, setFiscalYear] = useState(currentFiscalYear());
  const [periodKey, setPeriodKey] = useState(() => periodContainingDate('monthly').periodKey);
  const [department, setDepartment] = useState<string[]>([]);
  const [employee, setEmployee] = useState<string[]>([]);
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  // The secondary filters stay folded away until asked for — source and
  // search cover most days, and eight controls on permanent display is a
  // wall, not a toolbar.
  const [showFilters, setShowFilters] = useState(false);
  const [totals, setTotals] = useState<{ count: number; amount: number; overdueCount: number; overdueAmount: number } | null>(null);
  const [facets, setFacets] = useState<{ departments: string[]; employees: string[] }>({ departments: [], employees: [] });

  const periodOptions = useMemo(
    () => (periodType === 'none' || periodType === 'annual' ? [] : listPeriodOptions(periodType, fiscalYear)),
    [periodType, fiscalYear]
  );

  // Switching period type resets to the period containing today rather than
  // leaving a stale key from the previous type (a quarter key under
  // 'monthly' would resolve to nothing).
  function handlePeriodTypeChange(next: TargetPeriodType | 'none') {
    setPeriodType(next);
    if (next !== 'none' && next !== 'annual') setPeriodKey(periodContainingDate(next).periodKey);
  }

  const [selected, setSelected] = useState<PaymentQueueItem | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [payForm, setPayForm] = useState({ paymentMethod: 'Bank Transfer', paymentDate: new Date().toISOString().slice(0, 10), paymentReference: '', remarks: '' });
  const [holdReason, setHoldReason] = useState('');

  // Itemized line items for a Reimbursement source's detail Drawer — same
  // data the manager saw at approval time (app/api/reimbursement/sheet/[id]/
  // voucher/route.ts already assembles exactly this, also used by the
  // existing "download voucher PDF" flow in components/ReimbursementView.tsx,
  // so it's reused as-is rather than adding a second endpoint).
  const [voucherData, setVoucherData] = useState<VoucherData | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [mergingBills, setMergingBills] = useState(false);
  const [downloadingVoucher, setDownloadingVoucher] = useState(false);

  useEffect(() => {
    if (!selected || selected.source !== 'reimbursement_sheet') {
      setVoucherData(null);
      return;
    }
    let cancelled = false;
    setVoucherLoading(true);
    fetch(`/api/reimbursement/sheet/${encodeURIComponent(selected.sourceId)}/voucher`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: VoucherData | null) => {
        if (cancelled || !data) return;
        // The voucher route includes admin-added entries in `records` for
        // an accounts/admin/hr/superadmin viewer (originally meant for a
        // different reviewer's fuller view of an employee's month), but its
        // own `total`/`totalInWords` already always exclude them — an
        // admin-added expense is paid through the separate Admin Expense
        // queue (its own PaymentQueueItem), not this Reimbursement one, so
        // showing it here too would double-display the same expense under
        // two payment entries. Filtering here keeps the displayed line
        // items, the expense-sheet PDF, and the merged bills download all
        // consistent with the total actually payable on this sheet.
        setVoucherData({ ...data, records: data.records.filter((r) => !r.is_admin_entry) });
      })
      .catch(() => { if (!cancelled) setVoucherData(null); })
      .finally(() => { if (!cancelled) setVoucherLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  // Line items for an Office Operation Expense monthly sheet's detail
  // Drawer — the sheet is one queue row per month, these are what it's
  // made of. Served by the Accounts-gated detail route, not the module's
  // own HR/Admin-only API.
  // Tagged with the paymentId it was fetched for, so "loading" and "which
  // sheet's entries" are derived rather than reset inside the effect — a
  // previously opened sheet's entries can never flash under a different one.
  const [officeSheet, setOfficeSheet] = useState<{ paymentId: string; entries: OfficeExpenseSheetEntry[] | null } | null>(null);

  useEffect(() => {
    if (!selected || selected.source !== 'office_expense') return;
    let cancelled = false;
    const paymentId = selected.paymentId;
    fetch(`/api/accounts/payments/${encodeURIComponent(paymentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { entries?: OfficeExpenseSheetEntry[] } | null) => {
        if (!cancelled) setOfficeSheet({ paymentId, entries: data?.entries ?? null });
      })
      .catch(() => { if (!cancelled) setOfficeSheet({ paymentId, entries: null }); });
    return () => { cancelled = true; };
  }, [selected]);

  const officeEntriesLoading = selected?.source === 'office_expense' && officeSheet?.paymentId !== selected.paymentId;
  const officeEntries = officeSheet && selected && officeSheet.paymentId === selected.paymentId ? officeSheet.entries : null;

  // Line items for an Admin Expense monthly sheet's detail Drawer — same
  // pattern as officeSheet above (the sheet is one queue row per month).
  const [adminSheet, setAdminSheet] = useState<{ paymentId: string; entries: AdminExpenseSheetEntry[] | null } | null>(null);

  useEffect(() => {
    if (!selected || selected.source !== 'admin_expense') return;
    let cancelled = false;
    const paymentId = selected.paymentId;
    fetch(`/api/accounts/payments/${encodeURIComponent(paymentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { entries?: AdminExpenseSheetEntry[] } | null) => {
        if (!cancelled) setAdminSheet({ paymentId, entries: data?.entries ?? null });
      })
      .catch(() => { if (!cancelled) setAdminSheet({ paymentId, entries: null }); });
    return () => { cancelled = true; };
  }, [selected]);

  const adminEntriesLoading = selected?.source === 'admin_expense' && adminSheet?.paymentId !== selected.paymentId;
  const adminEntries = adminSheet && selected && adminSheet.paymentId === selected.paymentId ? adminSheet.entries : null;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const fetchSummary = useCallback(() => {
    fetch('/api/accounts/payments/summary')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setSummary(data))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoaded(true));
  }, []);

  // Built once and reused by both the list fetch and the CSV export link, so
  // a download can never carry different filters from the list on screen.
  const filterParams = useCallback(() => {
    const params = new URLSearchParams();
    setListParam(params, 'source', source);
    if (tab === 'queue') setListParam(params, 'status', status);
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (periodType !== 'none') {
      params.set('periodType', periodType);
      params.set('fiscalYear', fiscalYear);
      if (periodType !== 'annual') params.set('periodKey', periodKey);
    }
    setListParam(params, 'department', department);
    setListParam(params, 'employee', employee);
    if (minAmount.trim()) params.set('minAmount', minAmount.trim());
    if (maxAmount.trim()) params.set('maxAmount', maxAmount.trim());
    if (tab === 'queue' && overdueOnly) params.set('overdueOnly', 'true');
    return params;
  }, [tab, source, status, debouncedSearch, periodType, fiscalYear, periodKey, department, employee, minAmount, maxAmount, overdueOnly]);

  const fetchList = useCallback(() => {
    if (tab === 'reimbursement-report') return;
    setLoading(true);
    const params = filterParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    const endpoint = tab === 'queue' ? '/api/accounts/payments' : '/api/accounts/payments/history';
    fetch(`${endpoint}?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setItems(data?.items ?? []);
        setTotal(data?.total ?? 0);
        setTotals(data?.totals ?? null);
        if (data?.facets) setFacets(data.facets);
      })
      .catch(() => { setItems([]); setTotal(0); setTotals(null); })
      .finally(() => setLoading(false));
  }, [tab, filterParams, page, pageSize]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchList(); }, [fetchList]);

  // Refetched on focus / slow interval (lib/useAutoRefresh.ts). Both together,
  // so the summary tiles cannot report a different moment than the list.
  // fetchList closes over the current filters and is held in a ref by the
  // hook, so a background refresh always re-runs the query actually on screen
  // rather than the one in force when the page mounted.
  useAutoRefresh(async () => {
    await Promise.all([fetchSummary(), fetchList()]);
  });
  // Any filter change returns to page 1 — staying on page 4 of a result set
  // that now has two pages shows an empty table that looks like "no results".
  useEffect(() => { setPage(1); }, [tab, source, status, debouncedSearch, periodType, fiscalYear, periodKey, department, employee, minAmount, maxAmount, overdueOnly]);

  // Loaded once per visit to the tab, not on every render — the pivot has no
  // filters of its own (it's a single all-time month×employee summary), so
  // there's nothing else to re-fetch on.
  useEffect(() => {
    if (tab !== 'reimbursement-report' || pivot || pivotLoading) return;
    setPivotLoading(true);
    fetch('/api/accounts/reimbursement-report')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setPivot(data))
      .catch(() => setPivot(null))
      .finally(() => setPivotLoading(false));
  }, [tab, pivot, pivotLoading]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Counted so the Filters button can say how many are on without the panel
  // being open — otherwise a filter set yesterday silently narrows today's
  // list and reads as missing data. Source and status are excluded: they sit
  // in the toolbar where they're already visible.
  const activeFilterCount =
    (periodType !== 'none' ? 1 : 0) +
    (department.length > 0 ? 1 : 0) +
    (employee.length > 0 ? 1 : 0) +
    (minAmount.trim() ? 1 : 0) +
    (maxAmount.trim() ? 1 : 0) +
    (overdueOnly ? 1 : 0);

  function clearFilters() {
    setPeriodType('none');
    setFiscalYear(currentFiscalYear());
    setPeriodKey(periodContainingDate('monthly').periodKey);
    setDepartment([]);
    setEmployee([]);
    setMinAmount('');
    setMaxAmount('');
    setOverdueOnly(false);
  }

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
            <CommonButton variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); openPay(r); }}>
              Pay
            </CommonButton>
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
    // Method/reference/remarks are still fixed defaults, but the payment
    // DATE is now asked for and required — it is the one field only the
    // payer knows, and it is rarely the day they get round to ticking the
    // payment off here. Seeded with today as the common case. Required both
    // in this dialog and in app/api/accounts/payments/[paymentId]/pay, and
    // honoured by every payment source (see paidAtFrom in
    // lib/accountsPaymentStore.ts).
    setPayForm({ paymentMethod: 'Bank Transfer', paymentDate: new Date().toISOString().slice(0, 10), paymentReference: '', remarks: '' });
    setPayOpen(true);
  }

  function openHold(item: PaymentQueueItem) {
    setSelected(item);
    setHoldReason('');
    setHoldOpen(true);
  }

  async function submitPay() {
    if (!selected) return;
    if (!payForm.paymentDate) {
      toast.error('Enter the date this payment was made.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/accounts/payments/${encodeURIComponent(selected.paymentId)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // expectedAmount: the total the payer was shown — the server rejects
        // the payment if a sheet has grown since (e.g. HR logged another
        // office expense for that month after this was opened).
        body: JSON.stringify({ ...payForm, expectedAmount: selected.amount })
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

  // Same client-side PDF components/ReimbursementView.tsx's own voucher
  // download already uses — reused as-is (not rebuilt) since it already
  // produces exactly the "expense sheet" document Accounts asked for.
  async function downloadVoucherPdf() {
    if (!voucherData) return;
    setDownloadingVoucher(true);
    try {
      const { generateExpenseVoucherPdf } = await import('@/lib/expenseVoucherPdf');
      await generateExpenseVoucherPdf(voucherData);
    } catch {
      toast.error('Could not generate the expense sheet PDF.');
    } finally {
      setDownloadingVoucher(false);
    }
  }

  async function downloadAllBills() {
    if (!voucherData) return;
    const urls = voucherData.records.flatMap((r) => r.attachment_urls || []);
    if (!urls.length) {
      toast.error('No bills attached to this sheet.');
      return;
    }
    setMergingBills(true);
    try {
      const { mergeBillsIntoPdf, downloadMergedPdf } = await import('@/lib/mergeBillsPdf');
      const { bytes, succeeded, failed } = await mergeBillsIntoPdf(urls);
      if (!succeeded) {
        toast.error('Could not read any of the attached bills.');
        return;
      }
      downloadMergedPdf(bytes, `Bills_${voucherData.sheet.code}.pdf`);
      if (failed) toast.error(`${failed} bill${failed === 1 ? '' : 's'} could not be included.`);
    } catch {
      toast.error('Could not merge the bills into one PDF.');
    } finally {
      setMergingBills(false);
    }
  }

  return (
    <AppShell title={BRAND.appName} subtitle={`Accounts — Payments · ${currentUser.name}`}>
      {/* Payment Queue / History fill the screen: the page doesn't scroll, the
          table does (app/globals.css → .mx-fill-page). The long report tab
          flows normally. */}
      <div className={tab === 'reimbursement-report' ? undefined : 'mx-fill-page'}>
      <div className={styles.kpiGrid}>
        <StatTile label="Pending" value={summary ? formatMoney(summary.pendingAmount) : summaryLoaded ? '—' : <Skeleton width={64} height={24} />} tone="info" />
        <StatTile label="Due Today" value={summary ? formatMoney(summary.dueTodayAmount) : summaryLoaded ? '—' : <Skeleton width={64} height={24} />} tone="warning" />
        <StatTile label="Overdue" value={summary ? formatMoney(summary.overdueAmount) : summaryLoaded ? '—' : <Skeleton width={64} height={24} />} tone="danger" />
        <StatTile label="Paid This Month" value={summary ? formatMoney(summary.paidThisMonthAmount) : summaryLoaded ? '—' : <Skeleton width={64} height={24} />} tone="success" />
      </div>

      <div className={styles.tabRow}>
        <button type="button" className={`${styles.tabBtn} ${tab === 'queue' ? styles.tabActive : ''}`} onClick={() => setTab('queue')}>
          Payment Queue{summary ? ` (${summary.pendingCount})` : ''}
        </button>
        <button type="button" className={`${styles.tabBtn} ${tab === 'history' ? styles.tabActive : ''}`} onClick={() => setTab('history')}>
          Payment History
        </button>
        <button type="button" className={`${styles.tabBtn} ${tab === 'reimbursement-report' ? styles.tabActive : ''}`} onClick={() => setTab('reimbursement-report')}>
          Reimbursement Report
        </button>
      </div>

      {tab === 'reimbursement-report' ? (
        <ReimbursementPivotTable pivot={pivot} loading={pivotLoading} />
      ) : (
        <>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchInput
            placeholder="Search payee, description, requester…"
            value={search}
            onChange={(v) => setSearch(v)}
          />
        </div>
        <Dropdown
          multiselect
          value={source}
          onChange={setSource}
          placeholder="All Sources"
          label="Source"
          options={Object.entries(SOURCE_LABELS).map(([key, label]) => ({ value: key, label }))}
        />
        {tab === 'queue' && (
          <Dropdown
            multiselect
            value={status}
            onChange={setStatus}
            placeholder="All Statuses"
            label="Status"
            options={[
              { value: 'payment_required', label: 'Payment Required' },
              { value: 'on_hold', label: 'On Hold' }
            ]}
          />
        )}
        <CommonButton
          variant="secondary"
          size="md"
          leadingIcon={<SlidersHorizontal size={14} />}
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
        >
          Filters
          {activeFilterCount > 0 && <span className={styles.filterBadge}>{activeFilterCount}</span>}
        </CommonButton>
        {/* Carries the current filters, so the download matches the screen. */}
        <CommonButton variant="secondary" size="md" native leadingIcon={<Download />} href={`/api/accounts/payments/export.csv?scope=${tab}&${filterParams().toString()}`}>
          Export CSV
        </CommonButton>
      </div>

      {showFilters && (
        <div className={styles.filterPanel}>
          <div className={styles.filterGrid}>
            <label className={styles.filterField}>
              <span className={styles.filterLabel}>{tab === 'queue' ? 'Raised in' : 'Paid in'}</span>
              <Dropdown<TargetPeriodType>
                fullWidth
                value={periodType === 'none' ? '' : periodType}
                onChange={(v) => handlePeriodTypeChange(v || 'none')}
                placeholder="Any time"
                options={[
                  { value: 'monthly', label: 'Month' },
                  { value: 'quarterly', label: 'Quarter' },
                  { value: 'half_yearly', label: 'Half-Year' },
                  { value: 'annual', label: 'Full Year' }
                ]}
              />
            </label>

            {periodType !== 'none' && (
              <label className={styles.filterField}>
                <span className={styles.filterLabel}>Financial Year</span>
                <Dropdown
                  fullWidth
                  value={fiscalYear}
                  onChange={(v) => { if (v) setFiscalYear(v); }}
                  clearable={false}
                  ariaLabel="Financial Year"
                  options={fiscalYearOptions().map((fy) => ({ value: fy, label: `FY ${fy}` }))}
                />
              </label>
            )}

            {periodOptions.length > 0 && (
              <label className={styles.filterField}>
                <span className={styles.filterLabel}>Period</span>
                <Dropdown
                  fullWidth
                  value={periodKey}
                  onChange={(v) => { if (v) setPeriodKey(v); }}
                  clearable={false}
                  ariaLabel="Period"
                  options={periodOptions.map((p) => ({ value: p.key, label: p.label }))}
                />
              </label>
            )}

            <label className={styles.filterField}>
              <span className={styles.filterLabel}>Department</span>
              <Dropdown
                fullWidth
                multiselect
                value={department}
                onChange={setDepartment}
                placeholder="All departments"
                ariaLabel="Department"
                options={facets.departments.map((d) => ({ value: d, label: d }))}
              />
            </label>

            <label className={styles.filterField}>
              <span className={styles.filterLabel}>Employee</span>
              <Dropdown
                fullWidth
                multiselect
                value={employee}
                onChange={setEmployee}
                placeholder="Everyone"
                ariaLabel="Employee"
                options={facets.employees.map((p) => ({ value: p, label: p }))}
              />
            </label>

            <label className={styles.filterField}>
              <span className={styles.filterLabel}>Amount (₹)</span>
              <div className={styles.amountRange}>
                <input
                  type="number"
                  className={calcStyles.formControl}
                  placeholder="Min"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  aria-label="Minimum amount"
                />
                <span className={styles.rangeDash}>–</span>
                <input
                  type="number"
                  className={calcStyles.formControl}
                  placeholder="Max"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  aria-label="Maximum amount"
                />
              </div>
            </label>

            {tab === 'queue' && (
              <label className={`${styles.filterField} ${styles.filterCheck}`}>
                <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
                <span>Overdue only</span>
              </label>
            )}
          </div>

          {activeFilterCount > 0 && (
            <CommonButton variant="ghost" size="sm" leadingIcon={<X size={13} />} onClick={clearFilters}>
              Clear all filters
            </CommonButton>
          )}
        </div>
      )}

      {/* What the current filter adds up to across EVERY match, not just the
          20 rows on this page — the figure an accounts person is actually
          after ("how much does Sales need paying this quarter"). */}
      {totals && (activeFilterCount > 0 || totals.count > 0) && (
        <div className={styles.resultBar}>
          <span>
            <strong>{totals.count}</strong> {totals.count === 1 ? 'payment' : 'payments'} ·{' '}
            <strong>{formatMoney(totals.amount)}</strong>
          </span>
          {tab === 'queue' && totals.overdueCount > 0 && (
            <span className={styles.resultOverdue}>
              {totals.overdueCount} overdue · {formatMoney(totals.overdueAmount)}
            </span>
          )}
        </div>
      )}

      <div className={styles.tableSection}>
        {/* Skeleton only while there is nothing to show yet — a refetch keeps
            the current rows on screen. */}
        {loading && !items.length ? (
          <SkeletonTable rows={6} columns={columns.length} />
        ) : (
          <Table
            columns={columns}
            rows={items}
            rowKey={(r) => r.paymentId}
            onRowClick={openDetail}
            empty={<div className={styles.emptyState}>{tab === 'queue' ? 'Nothing needs payment right now. You\'re all caught up.' : 'No paid payments yet.'}</div>}
          />
        )}
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
                <CommonButton variant="secondary" size="sm" fullWidth onClick={(e) => { e.stopPropagation(); openDetail(r); }}>View</CommonButton>
                <CommonButton variant="primary" size="sm" fullWidth onClick={(e) => { e.stopPropagation(); openPay(r); }}>Pay</CommonButton>
              </div>
            )}
          </div>
        ))}
        {!items.length && (loading ? <SkeletonList rows={4} avatar={false} /> : <div className={styles.emptyState}>Nothing here.</div>)}
      </div>

      {/* Same footer as every list: how many, rows per page, page buttons.
          Server-paged, so no "All" option. */}
      <TablePager
        page={Math.min(page, totalPages)}
        pageSize={pageSize}
        total={total}
        noun="payments"
        sizes={PAGE_SIZE_CHOICES}
        allowAll={false}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
      />
        </>
      )}
      </div>

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
              {/* Reimbursements are due on a fixed pay date (the 20th of the
                  month the expenses belong to), not the generic approval+SLA
                  target every other source uses. */}
              <span className={styles.detailLabel}>
                {selected.source === 'reimbursement_sheet' ? 'Due Date (20th of expense month)' : 'Due Date (SLA target)'}
              </span>
              <span className={styles.detailValue}>{formatDate(selected.dueDate)}</span>
            </div>
            <div className={styles.detailDivider} />
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Source</span>
              <span className={styles.detailValue}>
                {SOURCE_LABELS[selected.source]} — <a className={styles.originalLink} href={SOURCE_ORIGINAL_HREF[selected.source]}>Open Original Request</a>
              </span>
            </div>

            {selected.source === 'reimbursement_sheet' && (
              <>
                <div className={styles.detailDivider} />
                {voucherLoading ? (
                  <SkeletonList rows={3} avatar={false} boxed={false} />
                ) : voucherData ? (
                  <>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Expense entries ({voucherData.records.length}) — same breakdown the manager approved</span>
                    </div>
                    <div className={styles.entryList}>
                      {voucherData.records.map((r) => (
                        <div key={r.id} className={styles.entryRow}>
                          <div className={styles.entryHead}>
                            <span>{formatDate(r.date)} — {r.description}</span>
                            <span className={styles.amountCell}>{formatMoney(r.amount)}</span>
                          </div>
                          {(r.from_location || r.to_location) && (
                            <div className={styles.entryMeta}>{r.from_location}{r.to_location ? ` → ${r.to_location}` : ''}{r.kilometers ? ` · ${r.kilometers} km` : ''}</div>
                          )}
                          {r.attachment_urls.length > 0 && (
                            <div className={styles.entryActions}>
                              {r.attachment_urls.map((url, i) => (
                                <a key={i} href={url} target="_blank" rel="noopener noreferrer" className={styles.billLink} title={friendlyFileName(url)}>
                                  View Bill{r.attachment_urls.length > 1 ? ` ${i + 1}` : ''}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className={styles.detailActions}>
                      <CommonButton variant="secondary" size="md" disabled={downloadingVoucher} onClick={downloadVoucherPdf}>
                        {downloadingVoucher ? 'Preparing…' : 'Download Expense Sheet (PDF)'}
                      </CommonButton>
                      <CommonButton variant="secondary" size="md" disabled={mergingBills} onClick={downloadAllBills}>
                        {mergingBills ? 'Merging…' : 'Download All Bills (PDF)'}
                      </CommonButton>
                    </div>
                  </>
                ) : (
                  <div className={styles.detailValue}>Could not load the expense entries for this sheet.</div>
                )}
              </>
            )}

            {selected.source === 'office_expense' && (
              <>
                <div className={styles.detailDivider} />
                {officeEntriesLoading ? (
                  <SkeletonList rows={3} avatar={false} boxed={false} />
                ) : officeEntries ? (
                  <>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Expense entries ({officeEntries.length}) — paid together as one sheet</span>
                    </div>
                    <div className={styles.entryList}>
                      {officeEntries.map((entry) => {
                        const meta = [
                          entry.itemSubNames.length ? entry.itemSubNames.join(', ') : '',
                          entry.itemQty !== null ? `Qty ${entry.itemQty}` : '',
                          entry.description,
                          entry.remarks
                        ].filter(Boolean);
                        return (
                          <div key={entry.id} className={styles.entryRow}>
                            <div className={styles.entryHead}>
                              <span>
                                {formatDate(entry.date)} — {entry.usecase}{entry.usecaseDetail ? ` (${entry.usecaseDetail})` : ''}{entry.itemName ? ` · ${entry.itemName}` : ''}
                              </span>
                              <span className={styles.amountCell}>{formatMoney(entry.amount)}</span>
                            </div>
                            {meta.length > 0 && <div className={styles.entryMeta}>{meta.join(' · ')}</div>}
                            {entry.createdBy && <div className={styles.entryMeta}>Logged by {entry.createdBy}</div>}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className={styles.detailValue}>Could not load the expense entries for this sheet.</div>
                )}
              </>
            )}

            {selected.source === 'admin_expense' && (
              <>
                <div className={styles.detailDivider} />
                {adminEntriesLoading ? (
                  <SkeletonList rows={3} avatar={false} boxed={false} />
                ) : adminEntries ? (
                  <>
                    <div className={styles.detailRow}>
                      <span className={styles.detailLabel}>Expense entries ({adminEntries.length}) — paid together as one sheet</span>
                    </div>
                    <div className={styles.entryList}>
                      {adminEntries.map((entry) => (
                        <div key={entry.id} className={styles.entryRow}>
                          <div className={styles.entryHead}>
                            <span>{formatDate(entry.date)} — {entry.expenseType}</span>
                            <span className={styles.amountCell}>{formatMoney(entry.amount)}</span>
                          </div>
                          {entry.employeeName && <div className={styles.entryMeta}>For {entry.employeeName}</div>}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className={styles.detailValue}>Could not load the expense entries for this sheet.</div>
                )}
              </>
            )}

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
                <CommonButton variant="secondary" size="md" onClick={() => openHold(selected)}>Put On Hold</CommonButton>
                <CommonButton variant="primary" size="md" onClick={() => openPay(selected)}>Make Payment</CommonButton>
              </div>
            )}
            {selected.status === 'on_hold' && (
              <div className={styles.detailActions}>
                <CommonButton variant="warning" size="md" disabled={busy} onClick={() => resumePayment(selected)}>Resume Payment</CommonButton>
              </div>
            )}
          </div>
        </Drawer>
      )}

      {payOpen && selected && (
        <Modal title="Confirm Payment" ariaLabel="Confirm payment" onClose={() => { setPayOpen(false); setSelected(null); }}>
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
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="paymentDate">Payment date *</label>
              <input
                id="paymentDate"
                type="date"
                className={calcStyles.formControl}
                value={payForm.paymentDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setPayForm((f) => ({ ...f, paymentDate: e.target.value }))}
              />
              <span className={calcStyles.small}>The day the money actually moved — not necessarily today.</span>
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--mx-ink-muted)' }}>Are you sure this payment has been completed?</p>
            <div className={styles.detailActions}>
              <CommonButton variant="secondary" size="md" disabled={busy} onClick={() => { setPayOpen(false); setSelected(null); }}>Back</CommonButton>
              <CommonButton variant="primary" size="md" disabled={busy || !payForm.paymentDate} onClick={submitPay}>Confirm Payment</CommonButton>
            </div>
          </div>
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
              <CommonButton variant="secondary" size="md" onClick={() => { setHoldOpen(false); setSelected(null); }}>Cancel</CommonButton>
              <CommonButton variant="primary" size="md" disabled={busy || !holdReason.trim()} onClick={submitHold}>Put On Hold</CommonButton>
            </div>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

// One row per month, one column per employee — the same shape Accounts
// already keeps by hand in a spreadsheet. "Paid" sums only the employees/
// months whose ReimbursementSheet has actually reached payment_done; the rest
// of that month's total is still outstanding even once Accounts has seen it.
function ReimbursementPivotTable({ pivot, loading }: { pivot: ReimbursementPivot | null; loading: boolean }) {
  function downloadCsv() {
    if (!pivot) return;
    const header = ['Month', ...pivot.employees.map((e) => e.name), 'Total Expense', 'Paid'];
    const csvRows = [header, ...pivot.rows.map((row) => [
      row.monthLabel,
      ...pivot.employees.map((e) => (row.perEmployee[e.id] ?? 0).toFixed(2)),
      row.totalExpense.toFixed(2),
      row.paid.toFixed(2)
    ])];
    const csv = csvRows.map((r) => r.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reimbursement-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) {
    return <SkeletonTable rows={8} columns={6} />;
  }
  if (!pivot) {
    return <div className={styles.emptyState}>Could not load the report. Refresh to try again.</div>;
  }
  if (!pivot.rows.length) {
    return <div className={styles.emptyState}>No reimbursements recorded yet.</div>;
  }

  return (
    <div className={styles.tableSection}>
      <div className={styles.toolbar}>
        <CommonButton variant="secondary" size="md" leadingIcon={<Download />} onClick={downloadCsv}>Export CSV</CommonButton>
      </div>
      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Month</th>
              {pivot.employees.map((e) => <th key={e.id}>{e.name}</th>)}
              <th>Total Expense</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            {pivot.rows.map((row) => (
              <tr key={row.monthKey}>
                <td>{row.monthLabel}</td>
                {pivot.employees.map((e) => (
                  <td key={e.id} className={styles.amountCell}>{row.perEmployee[e.id] ? formatMoney(row.perEmployee[e.id]) : ''}</td>
                ))}
                <td className={styles.amountCell}><strong>{formatMoney(row.totalExpense)}</strong></td>
                <td className={styles.amountCell}>{row.paid ? formatMoney(row.paid) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
