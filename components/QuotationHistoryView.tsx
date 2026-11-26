'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { QuotationEffectiveStatus, QuotationRecord } from '@/lib/types';
import { needsFollowUp } from '@/lib/followUp';
import { closedQuotationsVisible, isClosedQuotation } from '@/lib/quotationVisibility';
import { setListParam } from '@/lib/listParam';
import AppShell from './AppShell';
import CommonButton from './ui/CommonButton';
import QuotationTable from './QuotationTable';
import { SkeletonTable } from './ui/Skeleton';
import { useToast } from './ui/ToastProvider';
import styles from './quotationHistory.module.css';
import FilterBar from './ui/FilterBar';
import SearchInput from './ui/SearchInput';
import Dropdown from './ui/Dropdown';
import Input from './ui/Input';
import ToolbarButton, { ToolbarLink } from './ui/ToolbarButton';

interface QuotationHistoryViewProps {
  title: string;
  subtitle: string;
  showXlsxExport?: boolean;
}

const STATUS_OPTIONS: { value: QuotationEffectiveStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' }
];

// Auth (login + admin/manager role) is enforced by proxy.ts before this ever
// renders — this component only handles fetching, filtering, and displaying.
export default function QuotationHistoryView({ title, subtitle, showXlsxExport = false }: QuotationHistoryViewProps) {
  const toast = useToast();
  const [rows, setRows] = useState<QuotationRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [loaded, setLoaded] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [canDelete, setCanDelete] = useState(false);
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const [orgWide, setOrgWide] = useState(true);

  const [fSalesPerson, setFSalesPerson] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<QuotationEffectiveStatus[]>([]);
  // Every sales person seen in any load so far, so narrowing to one never
  // drops the others from the option list.
  const [seenSalesPeople, setSeenSalesPeople] = useState<string[]>([]);
  const [fProjectId, setFProjectId] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [includeClosed, setIncludeClosed] = useState(false);

  // Same three ways in as the Projects list: an explicit Status pick, any
  // date range, or the person asking outright.
  const showClosed = closedQuotationsVisible({
    // Any closed status among the picked ones lets closed quotations through.
    statusFilter: fStatus.find((st) => st === 'approved' || st === 'rejected' || st === 'expired') ?? '',
    dateFilterActive: Boolean(fFrom || fTo),
    userOverride: includeClosed
  });

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        setCanDelete(me?.role === 'superadmin');
        setOrgWide(me?.role === 'superadmin' || me?.role === 'admin');
      })
      .catch(() => setCanDelete(false));
  }, []);

  const loadQuotations = useCallback(async () => {
    setStatus('Loading...');
    setLoaded(false);
    try {
      const params = new URLSearchParams();
      if (searchValue.trim()) params.set('q', searchValue.trim());
      setListParam(params, 'salesPerson', fSalesPerson);
      setListParam(params, 'status', fStatus);
      if (fProjectId.trim()) params.set('projectId', fProjectId.trim());
      if (fFrom) params.set('dateFrom', fFrom);
      if (fTo) params.set('dateTo', fTo);
      const qs = params.toString();
      const response = await fetch('/api/admin/quotations' + (qs ? `?${qs}` : ''));
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data: QuotationRecord[] = await response.json();
      setRows(data);
      setSeenSalesPeople((prev) => {
        const next = new Set(prev);
        for (const r of data) if (r.created_by) next.add(r.created_by);
        return next.size === prev.length ? prev : Array.from(next).sort();
      });
      setStatus(data.length ? `${data.length} quotation${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the quotation API. Click Refresh to try again.');
      setLoaded(false);
    }
  }, [searchValue, fSalesPerson, fStatus, fProjectId, fFrom, fTo]);

  // Initial load only — later loads run on Search / Refresh, as before.
  useEffect(() => {
    loadQuotations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (followUpOnly && !needsFollowUp(r)) return false;
      // Finished work is out of the default view — approved, rejected or
      // expired. Not age-based: see lib/quotationVisibility.ts for why 90
      // days hid none of the 16 closed quotations.
      if (!showClosed && isClosedQuotation(r)) return false;
      return true;
    });
  }, [rows, followUpOnly, showClosed]);

  const hiddenClosedCount = useMemo(() => {
    if (showClosed) return 0;
    return rows.filter((r) => isClosedQuotation(r)).length;
  }, [rows, showClosed]);
  const salesPeople = useMemo(() => Array.from(new Set([...seenSalesPeople, ...fSalesPerson])).sort(), [seenSalesPeople, fSalesPerson]);

  async function handleDelete(id: string) {
    try {
      const response = await fetch(`/api/admin/quotations/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const next = rows.filter((r) => r.id !== id);
      setRows(next);
      setStatus(next.length ? `${next.length} quotation${next.length === 1 ? '' : 's'} found.` : '');
    } catch {
      toast.error('Could not delete this quotation. Please try again.');
    }
  }

  async function handleLogFollowUp(id: string, note: string) {
    try {
      const response = await fetch(`/api/admin/quotations/${id}/follow-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note })
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const updated: QuotationRecord = await response.json();
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      toast.error('Could not log this follow-up. Please try again.');
    }
  }

  async function handleChangeStatus(id: string, next: QuotationRecord['status']) {
    try {
      const response = await fetch(`/api/quotations/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const updated: QuotationRecord = await response.json();
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      toast.error('Could not update the status. Please try again.');
    }
  }

  return (
    <AppShell fillPage title={title} subtitle={orgWide ? subtitle : 'Every quotation in your department, with a guaranteed-unique quotation number.'}>
        <FilterBar>
          <SearchInput
            placeholder="Search by quotation number, prepared by, client name, company, or project vertical..."
            value={searchValue}
            onChange={(v) => setSearchValue(v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') loadQuotations();
            }}
          />
          <Dropdown
            multiselect
            value={fSalesPerson}
            onChange={setFSalesPerson}
            placeholder="All sales people"
            label="Sales person"
            options={salesPeople.map((s) => ({ value: s, label: s }))}
          />
          <Dropdown
            multiselect
            value={fStatus}
            onChange={(v) => setFStatus(v as QuotationEffectiveStatus[])}
            placeholder="All statuses"
            label="Status"
            options={STATUS_OPTIONS}
          />
          <input
            type="text"
            placeholder="Project ID"
            value={fProjectId}
            onChange={(e) => setFProjectId(e.target.value)}
            className={styles.projectIdInput}
          />
          <Input auto type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          <Input auto type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
          <ToolbarButton primary onClick={() => loadQuotations()}>
            Search
          </ToolbarButton>
          <ToolbarButton onClick={() => loadQuotations()}>
            Refresh
          </ToolbarButton>
          <label className={styles.followUpCheckboxLabel}>
            <input type="checkbox" checked={followUpOnly} onChange={(e) => setFollowUpOnly(e.target.checked)} />
            Needs follow-up only
          </label>
          <ToolbarLink href="/api/admin/quotations/export.csv">
            Export CSV
          </ToolbarLink>
          {showXlsxExport && (
            <ToolbarLink href="/api/admin/quotations/export.xlsx">
              Export XLSX
            </ToolbarLink>
          )}
        </FilterBar>
        {!loaded && status === 'Loading...' ? (
          <SkeletonTable rows={8} columns={10} />
        ) : (
          <div className={styles.status}>{status}</div>
        )}
        {loaded && hiddenClosedCount > 0 && (
          <div className={styles.status}>
            {hiddenClosedCount} closed quotation{hiddenClosedCount === 1 ? '' : 's'} (Approved/Rejected/Expired) {hiddenClosedCount === 1 ? 'is' : 'are'} hidden.{' '}
            <CommonButton variant="link" size="sm" onClick={() => setIncludeClosed(true)}>
              Show {hiddenClosedCount === 1 ? 'it' : 'them'}
            </CommonButton>
            {' '}— or pick a Status, or set any date range.
          </div>
        )}
        {loaded && includeClosed && (
          <div className={styles.status}>
            Closed quotations are shown.{' '}
            <CommonButton variant="link" size="sm" onClick={() => setIncludeClosed(false)}>Hide them again</CommonButton>
          </div>
        )}
        {loaded && (
          <QuotationTable
            rows={visibleRows}
            onDelete={canDelete ? handleDelete : undefined}
            onLogFollowUp={handleLogFollowUp}
            showSalesPerson
            onChangeStatus={handleChangeStatus}
            onRefresh={loadQuotations}
          />
        )}
    </AppShell>
  );
}
