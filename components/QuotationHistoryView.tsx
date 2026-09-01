'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { QuotationEffectiveStatus, QuotationRecord } from '@/lib/types';
import { needsFollowUp } from '@/lib/followUp';
import AppShell from './AppShell';
import QuotationTable from './QuotationTable';
import { useToast } from './ui/ToastProvider';
import styles from './quotationHistory.module.css';
import FilterBar from './ui/FilterBar';
import Select from './ui/Select';
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

  const [fSalesPerson, setFSalesPerson] = useState('');
  const [fStatus, setFStatus] = useState<QuotationEffectiveStatus | ''>('');
  const [fProjectId, setFProjectId] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

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
      if (fSalesPerson) params.set('salesPerson', fSalesPerson);
      if (fStatus) params.set('status', fStatus);
      if (fProjectId.trim()) params.set('projectId', fProjectId.trim());
      if (fFrom) params.set('dateFrom', fFrom);
      if (fTo) params.set('dateTo', fTo);
      const qs = params.toString();
      const response = await fetch('/api/admin/quotations' + (qs ? `?${qs}` : ''));
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data: QuotationRecord[] = await response.json();
      setRows(data);
      setStatus(data.length ? `${data.length} quotation${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the quotation API. Click Refresh to try again.');
      setLoaded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadQuotations();
  }, [loadQuotations]);

  const visibleRows = useMemo(() => (followUpOnly ? rows.filter((r) => needsFollowUp(r)) : rows), [rows, followUpOnly]);
  const salesPeople = useMemo(() => Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean))).sort(), [rows]);

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
    <AppShell title={title} subtitle={orgWide ? subtitle : 'Every quotation in your department, with a guaranteed-unique quotation number.'}>
        <FilterBar>
          <input
            type="text"
            placeholder="Search by quotation number, prepared by, client name, company, or project vertical..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') loadQuotations();
            }}
          />
          <Select auto value={fSalesPerson} onChange={(e) => setFSalesPerson(e.target.value)}>
            <option value="">All sales people</option>
            {salesPeople.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select auto value={fStatus} onChange={(e) => setFStatus(e.target.value as QuotationEffectiveStatus | '')}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
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
        <div className={styles.status}>{status}</div>
        {loaded && (
          <QuotationTable
            rows={visibleRows}
            onDelete={canDelete ? handleDelete : undefined}
            onLogFollowUp={handleLogFollowUp}
            showSalesPerson
            onChangeStatus={handleChangeStatus}
          />
        )}
    </AppShell>
  );
}
