'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { QuotationRecord } from '@/lib/types';
import QuotationTable from './QuotationTable';
import styles from './quotationHistory.module.css';

interface QuotationHistoryViewProps {
  title: string;
  subtitle: string;
  showXlsxExport?: boolean;
}

// Auth (login + admin role) is enforced by proxy.ts before this ever renders —
// this component only handles fetching and displaying the data.
export default function QuotationHistoryView({ title, subtitle, showXlsxExport = false }: QuotationHistoryViewProps) {
  const router = useRouter();
  const [rows, setRows] = useState<QuotationRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [loaded, setLoaded] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [canDelete, setCanDelete] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setCanDelete(me?.role === 'superadmin'))
      .catch(() => setCanDelete(false));
  }, []);

  const loadQuotations = useCallback(async (query: string) => {
    setStatus('Loading...');
    setLoaded(false);
    try {
      const url = '/api/admin/quotations' + (query ? `?q=${encodeURIComponent(query)}` : '');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data: QuotationRecord[] = await response.json();
      setRows(data);
      setStatus(data.length ? `${data.length} quotation${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the quotation API. Click Refresh to try again.');
      setLoaded(false);
    }
  }, []);

  useEffect(() => {
    loadQuotations('');
  }, [loadQuotations]);

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
      alert('Could not delete this quotation. Please try again.');
    }
  }

  return (
    <div className={styles.body}>
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          <Image src="/NANTA.png" alt="NANTA logo" width={38} height={38} className={styles.headerLogo} unoptimized />
          <div>
            <h1>{title}</h1>
            <div className={styles.sub}>{subtitle}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className={styles.button} href="/">
            &larr; Back to Calculator
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
              if (e.key === 'Enter') loadQuotations(searchValue.trim());
            }}
          />
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => loadQuotations(searchValue.trim())}>
            Search
          </button>
          <button type="button" className={styles.button} onClick={() => loadQuotations(searchValue.trim())}>
            Refresh
          </button>
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
        {loaded && <QuotationTable rows={rows} onDelete={canDelete ? handleDelete : undefined} />}
      </main>
    </div>
  );
}
