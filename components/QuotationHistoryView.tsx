'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { QuotationEffectiveStatus, QuotationRecord } from '@/lib/types';
import { needsFollowUp } from '@/lib/followUp';
import { BRAND } from '@/lib/branding';
import QuotationTable from './QuotationTable';
import { useToast } from './ui/ToastProvider';
import styles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

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
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<QuotationRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [loaded, setLoaded] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [canDelete, setCanDelete] = useState(false);
  const [followUpOnly, setFollowUpOnly] = useState(false);

  const [fSalesPerson, setFSalesPerson] = useState('');
  const [fStatus, setFStatus] = useState<QuotationEffectiveStatus | ''>('');
  const [fProjectId, setFProjectId] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setCanDelete(me?.role === 'superadmin'))
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

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    router.push('/login');
    router.refresh();
  }

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
    <div className={styles.body}>
      <header className={styles.header}>
        <Link href="/" className={styles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={styles.headerLogo} unoptimized />
          <div>
            <h1>{title}</h1>
            <div className={styles.sub}>{subtitle}</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className={styles.button} href="/">
            &larr; Back to Dashboard
          </Link>
          <button type="button" className={styles.button} onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.toolbar}>
          <input
            type="text"
            placeholder="Search by quotation number, prepared by, client name, company, or project vertical..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') loadQuotations();
            }}
          />
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fSalesPerson} onChange={(e) => setFSalesPerson(e.target.value)}>
            <option value="">All sales people</option>
            {salesPeople.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fStatus} onChange={(e) => setFStatus(e.target.value as QuotationEffectiveStatus | '')}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Project ID"
            value={fProjectId}
            onChange={(e) => setFProjectId(e.target.value)}
            style={{ maxWidth: 140 }}
          />
          <input type="date" className={calcStyles.formControl} style={{ width: 'auto' }} value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          <input type="date" className={calcStyles.formControl} style={{ width: 'auto' }} value={fTo} onChange={(e) => setFTo(e.target.value)} />
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => loadQuotations()}>
            Search
          </button>
          <button type="button" className={styles.button} onClick={() => loadQuotations()}>
            Refresh
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={followUpOnly} onChange={(e) => setFollowUpOnly(e.target.checked)} />
            Needs follow-up only
          </label>
          <a className={styles.button} href="/api/admin/quotations/export.csv">
            Export CSV
          </a>
          {showXlsxExport && (
            <a className={styles.button} href="/api/admin/quotations/export.xlsx">
              Export XLSX
            </a>
          )}
        </div>
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
      </main>
    </div>
  );
}
