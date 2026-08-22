'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { TravelScheduleRecord, UserRole } from '@/lib/types';
import { TRAVEL_STATUS_LABEL, TRAVEL_STATUS_TONE, travelPendingLabel } from '@/lib/travelLabels';
import AppShell from './AppShell';
import StatusBadge from './ui/StatusBadge';
import { useToast } from './ui/ToastProvider';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface ProjectOption {
  id: string;
  client_name?: string;
  company?: string;
}

const EMPTY_FORM = {
  origin: '', destination: '', startDate: '', endDate: '',
  requiredArrivalTime: '', expectedDepartureTime: '',
  purpose: '', linkedClient: '', expenseNote: '', projectId: ''
};

function formatDate(iso: string): string {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleDateString('en-IN'); } catch { return iso; }
}

interface TravelScheduleViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TravelScheduleView({ currentUser }: TravelScheduleViewProps) {
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const toast = useToast();
  const [records, setRecords] = useState<TravelScheduleRecord[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/travel-schedule');
      if (!response.ok) throw new Error(String(response.status));
      const data: TravelScheduleRecord[] = await response.json();
      setRecords(data);
      setStatus(data.length ? `${data.length} request${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the travel schedule API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
    fetch('/api/projects').then((r) => (r.ok ? r.json() : [])).then(setProjects).catch(() => setProjects([]));
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
      setShowForm(false);
      await load();
      toast.success('Travel request created.');
    } catch {
      toast.error('Could not save this travel request. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Travel Schedule" subtitle="Manage employee travel requests and approvals.">
      <div className={historyStyles.toolbar}>
        <button type="button" className={historyStyles.button} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New Travel Request'}
        </button>
        <button type="button" className={historyStyles.button} onClick={load}>Refresh</button>
      </div>

      {showForm && (
        <>
          <h2 className={calcStyles.h2} style={{ marginTop: 16 }}>New Travel Request</h2>
          <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Origin *</label>
                <input className={calcStyles.formControl} value={form.origin} onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value }))} required />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Destination *</label>
                <input className={calcStyles.formControl} value={form.destination} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))} required />
              </div>
            </div>
            <h3 className={calcStyles.label} style={{ marginTop: 12, marginBottom: 4, fontSize: '0.85rem', opacity: 0.7 }}>When do you need to reach the destination?</h3>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Arrival Date *</label>
                <input type="date" className={calcStyles.formControl} value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} required />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Arrival Time</label>
                <input type="time" className={calcStyles.formControl} value={form.requiredArrivalTime} onChange={(e) => setForm((f) => ({ ...f, requiredArrivalTime: e.target.value }))} />
              </div>
            </div>
            <h3 className={calcStyles.label} style={{ marginTop: 12, marginBottom: 4, fontSize: '0.85rem', opacity: 0.7 }}>When do you want to leave the destination?</h3>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Departure Date</label>
                <input type="date" className={calcStyles.formControl} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Departure Time</label>
                <input type="time" className={calcStyles.formControl} value={form.expectedDepartureTime} onChange={(e) => setForm((f) => ({ ...f, expectedDepartureTime: e.target.value }))} />
              </div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Project</label>
                  <select className={calcStyles.formControl} value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))}>
                    <option value="">— Select project —</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.client_name || ''}{p.company ? ` — ${p.company}` : ''}</option>
                  ))}
                </select>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Linked Client</label>
                <input className={calcStyles.formControl} value={form.linkedClient} onChange={(e) => setForm((f) => ({ ...f, linkedClient: e.target.value }))} />
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Purpose of Travel</label>
              <textarea className={calcStyles.formControl} rows={2} value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Expense Note</label>
              <textarea className={calcStyles.formControl} rows={2} value={form.expenseNote} onChange={(e) => setForm((f) => ({ ...f, expenseNote: e.target.value }))} />
            </div>
            <button type="submit" className={calcStyles.btn} disabled={creating}>
              {creating ? 'Saving...' : 'Create Travel Request'}
            </button>
          </form>
        </>
      )}

      <div className={historyStyles.status}>{status}</div>
      {loaded && (
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Dates</th>
              <th>Origin</th>
              <th>Destination</th>
              <th>Purpose</th>
              <th>Status</th>
              <th>Requested By</th>
              <th>Tickets</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={9} className={historyStyles.empty}>No travel requests yet.</td>
              </tr>
            ) : (
              records.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/travel-schedule/${r.id}`} style={{ color: 'var(--mx-brand)', textDecoration: 'none' }}>{r.request_code || '-'}</Link></td>
                  <td>
                    {formatDate(r.start_date)}
                    {r.end_date && r.end_date !== r.start_date ? ` - ${formatDate(r.end_date)}` : ''}
                  </td>
                  <td>{r.origin || '-'}</td>
                  <td>{r.destination}</td>
                  <td>{r.purpose || '-'}</td>
                  <td>
                    <StatusBadge
                      tone={TRAVEL_STATUS_TONE[r.status] || 'pending'}
                      label={travelPendingLabel(r.status)}
                    />
                  </td>
                  <td>{r.created_by}</td>
                  <td>
                    {r.ticket_documents && r.ticket_documents.length > 0 ? (
                      r.ticket_documents.map((url, i) => {
                        const ext = url.split('.').pop() || '';
                        const project = (r.project_name || '').replace(/[^a-zA-Z0-9]/g, '');
                        const person = (r.created_by || '').replace(/[^a-zA-Z0-9.]/g, '');
                        const from = (r.origin || '').replace(/[^a-zA-Z0-9]/g, '');
                        const to = (r.destination || '').replace(/[^a-zA-Z0-9]/g, '');
                        const fileName = `${project || 'NoProject'}_${person}_${from}_${to}_Ticket${r.ticket_documents.length > 1 ? i + 1 : ''}.${ext}`;
                        return (
                          <a key={url} href={url} target="_blank" rel="noreferrer" download={fileName} style={{ color: 'var(--mx-brand)', textDecoration: 'none', marginRight: 6 }}>
                            {r.ticket_documents.length === 1 ? 'Download' : `Ticket ${i + 1}`}
                          </a>
                        );
                      })
                    ) : (
                      <span style={{ opacity: 0.4 }}>-</span>
                    )}
                  </td>
                  <td>
                    <Link href={`/travel-schedule/${r.id}`} className={historyStyles.button}>View</Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
