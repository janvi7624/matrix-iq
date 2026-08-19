'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { QuotationEffectiveStatus, QuotationRecord } from '@/lib/types';
import { needsFollowUp } from '@/lib/followUp';
import QuotationTable from './QuotationTable';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import ErrorState from './ui/ErrorState';

const STATUS_OPTIONS: { value: QuotationEffectiveStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' }
];

interface CurrentViewer {
  username: string;
  role: string;
  isPrivileged: boolean;
}

export default function MyQuotationsView() {
  const [viewer, setViewer] = useState<CurrentViewer | null>(null);
  const [rows, setRows] = useState<QuotationRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [fSalesPerson, setFSalesPerson] = useState('');
  const [fStatus, setFStatus] = useState<QuotationEffectiveStatus | ''>('');
  const [fProjectId, setFProjectId] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (me) {
          setViewer({
            username: me.username,
            role: me.role,
            isPrivileged: !!me.isPrivileged
          });
        }
      })
      .catch(() => setViewer(null));
  }, []);

  const isPrivileged = viewer?.isPrivileged ?? false;
  const canDelete = viewer?.role === 'superadmin';

  const load = useCallback(async () => {
    setStatus('Loading...');
    setLoaded(false);
    setLoading(true);
    setLoadFailed(false);
    try {
      const params = new URLSearchParams();
      if (searchValue.trim()) params.set('q', searchValue.trim());
      if (fSalesPerson.trim()) params.set('salesPerson', fSalesPerson.trim());
      if (fStatus) params.set('status', fStatus);
      if (fProjectId.trim()) params.set('projectId', fProjectId.trim());
      if (fFrom) params.set('dateFrom', fFrom);
      if (fTo) params.set('dateTo', fTo);
      const qs = params.toString();
      const response = await fetch('/api/quotations/mine' + (qs ? `?${qs}` : ''));
      if (!response.ok) throw new Error(String(response.status));
      const data: QuotationRecord[] = await response.json();
      setRows(data);
      setStatus(data.length ? `${data.length} quotation${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the quotation API. Try refreshing.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [searchValue, fSalesPerson, fStatus, fProjectId, fFrom, fTo]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleRows = useMemo(() => (followUpOnly ? rows.filter((r) => needsFollowUp(r)) : rows), [rows, followUpOnly]);

  const salesPeople = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.created_by) set.add(r.created_by);
      else if (r.prepared_by) set.add(r.prepared_by);
    }
    return Array.from(set).sort();
  }, [rows]);

  async function handleDelete(id: string) {
    try {
      const response = await fetch(`/api/admin/quotations/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const next = rows.filter((r) => r.id !== id);
      setRows(next);
      setStatus(next.length ? `${next.length} quotation${next.length === 1 ? '' : 's'} found.` : '');
      toast.success('Quotation deleted successfully.');
    } catch {
      toast.error('Could not delete this quotation. Please try again.');
    }
  }

  async function handleLogFollowUp(id: string, note: string) {
    try {
      const response = await fetch(`/api/quotations/${id}/follow-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note })
      });
      if (!response.ok) throw new Error(String(response.status));
      const updated: QuotationRecord = await response.json();
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      toast.success('Follow-up logged.');
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
      if (!response.ok) throw new Error(String(response.status));
      const updated: QuotationRecord = await response.json();
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      toast.success('Status updated.');
    } catch {
      toast.error('Could not update the status. Please try again.');
    }
  }

  const subtitle = isPrivileged
    ? 'All quotations across the organization — with versions, status, and follow-ups.'
    : "Quotations you've created — with versions, status, and follow-ups.";

  return (
    <AppShell title="Existing Quotations" subtitle={subtitle}>
      <div className={historyStyles.toolbar}>
        <input
          type="text"
          placeholder="Search by quotation number, client, company, prepared by..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load();
          }}
        />
        {isPrivileged && (
          <select
            className={calcStyles.formControl}
            style={{ width: 'auto' }}
            value={fSalesPerson}
            onChange={(e) => setFSalesPerson(e.target.value)}
          >
            <option value="">All sales people</option>
            {salesPeople.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <select
          className={calcStyles.formControl}
          style={{ width: 'auto' }}
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value as QuotationEffectiveStatus | '')}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Project ID"
          value={fProjectId}
          onChange={(e) => setFProjectId(e.target.value)}
          style={{ maxWidth: 140 }}
        />
        <input
          type="date"
          className={calcStyles.formControl}
          style={{ width: 'auto' }}
          value={fFrom}
          onChange={(e) => setFFrom(e.target.value)}
        />
        <input
          type="date"
          className={calcStyles.formControl}
          style={{ width: 'auto' }}
          value={fTo}
          onChange={(e) => setFTo(e.target.value)}
        />
        <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={() => load()}>
          Search
        </button>
        <button type="button" className={historyStyles.button} onClick={() => load()}>
          Refresh
        </button>
        {isPrivileged && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={followUpOnly} onChange={(e) => setFollowUpOnly(e.target.checked)} />
              Needs follow-up only
            </label>
            <a className={historyStyles.button} href="/api/admin/quotations/export.csv">
              Export CSV
            </a>
            <a className={historyStyles.button} href="/api/admin/quotations/export.xlsx">
              Export XLSX
            </a>
          </>
        )}
      </div>
      {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}
      {loading ? (
        <div className={historyStyles.tableWrap}>
          <SkeletonRows rows={8} columns={12} />
        </div>
      ) : loadFailed ? (
        <ErrorState message="Could not load quotations — check your connection and try again." onRetry={load} />
      ) : (
        loaded && (
          <QuotationTable
            rows={visibleRows}
            showSalesPerson={isPrivileged}
            onDelete={canDelete ? handleDelete : undefined}
            onLogFollowUp={handleLogFollowUp}
            onChangeStatus={handleChangeStatus}
          />
        )
      )}
    </AppShell>
  );
}
