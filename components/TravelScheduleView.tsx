'use client';

import { FormEvent, useEffect, useState } from 'react';
import { TravelScheduleRecord, UserRole } from '@/lib/types';
import PortalHeader from './PortalHeader';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

const EMPTY_FORM = { origin: '', destination: '', startDate: '', endDate: '', purpose: '', linkedClient: '', expenseNote: '' };

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

interface TravelScheduleViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TravelScheduleView({ currentUser }: TravelScheduleViewProps) {
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const toast = useToast();
  const confirm = useConfirm();
  const [records, setRecords] = useState<TravelScheduleRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/travel-schedule');
      if (!response.ok) throw new Error(String(response.status));
      const data: TravelScheduleRecord[] = await response.json();
      setRecords(data);
      setStatus(data.length ? `${data.length} trip${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the travel schedule API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.destination.trim() || !form.startDate) {
      toast.error('Destination and start date are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/travel-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      await load();
    } catch {
      toast.error('Could not save this travel entry. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Delete this travel entry? This cannot be undone.', danger: true }))) return;
    try {
      const response = await fetch(`/api/travel-schedule/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error('Could not delete this travel entry.');
    }
  }

  return (
    <div className={historyStyles.body}>
      <PortalHeader title="Travel Schedule" subtitle="Log rep travel for client visits." />
      <main className={historyStyles.main}>
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Add travel entry</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Origin</label>
              <input className={calcStyles.formControl} value={form.origin} onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Destination *</label>
              <input className={calcStyles.formControl} value={form.destination} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Start date *</label>
              <input type="date" className={calcStyles.formControl} value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>End date</label>
              <input type="date" className={calcStyles.formControl} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Purpose</label>
              <input className={calcStyles.formControl} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Linked client</label>
              <input className={calcStyles.formControl} value={form.linkedClient} onChange={(e) => setForm((f) => ({ ...f, linkedClient: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Expense note</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.expenseNote} onChange={(e) => setForm((f) => ({ ...f, expenseNote: e.target.value }))} />
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Saving…' : 'Add travel entry'}
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
                <th>Dates</th>
                <th>Origin</th>
                <th>Destination</th>
                <th>Purpose</th>
                <th>Linked Client</th>
                <th>Logged By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className={historyStyles.empty}>
                    No travel entries recorded yet.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {formatDate(r.start_date)}
                      {r.end_date && r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ''}
                    </td>
                    <td>{r.origin || '-'}</td>
                    <td>{r.destination}</td>
                    <td>{r.purpose || '-'}</td>
                    <td>{r.linked_client || '-'}</td>
                    <td>{r.created_by}</td>
                    <td>
                      {isPrivileged && (
                        <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(r.id)}>
                          Delete
                        </button>
                      )}
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
