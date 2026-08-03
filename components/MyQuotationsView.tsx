'use client';

import { useCallback, useEffect, useState } from 'react';
import { QuotationEffectiveStatus, QuotationRecord } from '@/lib/types';
import QuotationTable from './QuotationTable';
import PortalHeader from './PortalHeader';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';

const STATUS_OPTIONS: { value: QuotationEffectiveStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' }
];

export default function MyQuotationsView() {
  const [rows, setRows] = useState<QuotationRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [loaded, setLoaded] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [fStatus, setFStatus] = useState<QuotationEffectiveStatus | ''>('');
  const [fProjectId, setFProjectId] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const toast = useToast();

  const load = useCallback(async () => {
    setStatus('Loading...');
    setLoaded(false);
    try {
      const params = new URLSearchParams();
      if (searchValue.trim()) params.set('q', searchValue.trim());
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    } catch {
      toast.error('Could not update the status. Please try again.');
    }
  }

  return (
    <div className={historyStyles.body}>
      <PortalHeader title="Existing Quotations" subtitle="Quotations you've created — visible only to you." />
      <main className={historyStyles.main}>
        <div className={historyStyles.toolbar}>
          <input
            type="text"
            placeholder="Search by quotation number, client, company..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') load();
            }}
          />
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fStatus} onChange={(e) => setFStatus(e.target.value as QuotationEffectiveStatus | '')}>
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <input type="text" placeholder="Project ID" value={fProjectId} onChange={(e) => setFProjectId(e.target.value)} style={{ maxWidth: 140 }} />
          <input type="date" className={calcStyles.formControl} style={{ width: 'auto' }} value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          <input type="date" className={calcStyles.formControl} style={{ width: 'auto' }} value={fTo} onChange={(e) => setFTo(e.target.value)} />
          <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={() => load()}>
            Search
          </button>
          <button type="button" className={historyStyles.button} onClick={() => load()}>
            Refresh
          </button>
        </div>
        <div className={historyStyles.status}>{status}</div>
        {loaded && <QuotationTable rows={rows} onLogFollowUp={handleLogFollowUp} onChangeStatus={handleChangeStatus} />}
      </main>
    </div>
  );
}
