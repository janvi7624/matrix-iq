'use client';

import { FormEvent, useEffect, useState } from 'react';
import { DemoScheduleRecord } from '@/lib/types';
import PortalHeader from './PortalHeader';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

const EMPTY_FORM = { clientName: '', productDomain: '', scheduledAt: '', assignedRep: '', notes: '' };

const STATUS_LABEL: Record<DemoScheduleRecord['status'], string> = { scheduled: 'Scheduled', done: 'Done', cancelled: 'Cancelled' };

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

export default function DemoScheduleView() {
  const [records, setRecords] = useState<DemoScheduleRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/demo-schedule');
      if (!response.ok) throw new Error(String(response.status));
      const data: DemoScheduleRecord[] = await response.json();
      setRecords(data);
      setStatus(data.length ? `${data.length} demo${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the demo schedule API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.clientName.trim() || !form.scheduledAt) {
      alert('Client name and scheduled date/time are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/demo-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      await load();
    } catch {
      alert('Could not save this demo. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(id: string, next: DemoScheduleRecord['status']) {
    try {
      const response = await fetch(`/api/demo-schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      if (!response.ok) throw new Error(String(response.status));
      const updated: DemoScheduleRecord = await response.json();
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      alert('Could not update status. Please try again.');
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this demo booking? This cannot be undone.')) return;
    try {
      const response = await fetch(`/api/demo-schedule/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      alert('Could not delete this demo booking.');
    }
  }

  return (
    <div className={historyStyles.body}>
      <PortalHeader title="Demo Schedule" subtitle="Book and track product demos." />
      <main className={historyStyles.main}>
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Schedule a demo</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client name *</label>
              <input className={calcStyles.formControl} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Product / domain</label>
              <input className={calcStyles.formControl} placeholder="e.g. AI Video Analytics, VisitIQ VMS" value={form.productDomain} onChange={(e) => setForm((f) => ({ ...f, productDomain: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Scheduled date &amp; time *</label>
              <input type="datetime-local" className={calcStyles.formControl} value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))} required />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Assigned rep</label>
              <input className={calcStyles.formControl} placeholder="Defaults to you" value={form.assignedRep} onChange={(e) => setForm((f) => ({ ...f, assignedRep: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Notes</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Saving…' : 'Schedule demo'}
          </button>
        </form>

        <div className={historyStyles.toolbar} style={{ marginTop: 24 }}>
          <button type="button" className={historyStyles.button} onClick={load}>
            Refresh
          </button>
        </div>
        <div className={historyStyles.status}>{status}</div>
        {loaded && (
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Scheduled</th>
                <th>Client</th>
                <th>Product / Domain</th>
                <th>Assigned Rep</th>
                <th>Status</th>
                <th>Notes</th>
                <th>Booked By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={8} className={historyStyles.empty}>
                    No demos scheduled yet.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTime(r.scheduled_at)}</td>
                    <td>{r.client_name}</td>
                    <td>{r.product_domain || '-'}</td>
                    <td>{r.assigned_rep || '-'}</td>
                    <td>
                      <select
                        value={r.status}
                        onChange={(e) => handleStatusChange(r.id, e.target.value as DemoScheduleRecord['status'])}
                        style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12.5 }}
                      >
                        {(Object.keys(STATUS_LABEL) as DemoScheduleRecord['status'][]).map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td>{r.notes || '-'}</td>
                    <td>{r.created_by}</td>
                    <td>
                      <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(r.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
