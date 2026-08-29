'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { TravelScheduleRecord, UserRole } from '@/lib/types';
import { TRAVEL_STATUS_LABEL, TRAVEL_STATUS_TONE, travelPendingLabel } from '@/lib/travelLabels';
import AppShell from './AppShell';
import StatusBadge from './ui/StatusBadge';
import { useToast } from './ui/ToastProvider';
import TravelScheduleForm, { EMPTY_TRAVEL_EXTRA_FIELDS, travelExtraFieldsToPayload } from './TravelScheduleForm';
import ProjectSelect from './ui/ProjectSelect';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface UserOption {
  id: string;
  username: string;
  name: string;
}

const EMPTY_FORM = {
  origin: '', destination: '', startDate: '', endDate: '',
  requiredArrivalTime: '', expectedDepartureTime: '',
  linkedClient: '', projectId: '',
  companionIds: [] as string[],
  ...EMPTY_TRAVEL_EXTRA_FIELDS
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
  const [users, setUsers] = useState<UserOption[]>([]);
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
    fetch('/api/users/lite').then((r) => (r.ok ? r.json() : [])).then(setUsers).catch(() => setUsers([]));
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
        body: JSON.stringify({ ...form, ...travelExtraFieldsToPayload(form) })
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
                <ProjectSelect
                  value={form.projectId}
                  onChange={(projectId, project) => setForm((f) => ({ ...f, projectId, linkedClient: project?.company || project?.client_name || f.linkedClient }))}
                />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Linked Client</label>
                <input className={calcStyles.formControl} value={form.linkedClient} onChange={(e) => setForm((f) => ({ ...f, linkedClient: e.target.value }))} />
              </div>
            </div>
            <TravelScheduleForm
              value={form}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              requesterOrigin={form.origin}
              requesterDestination={form.destination}
              requesterTravelDate={form.startDate}
            />
            <div className={calcStyles.field} style={{ marginTop: 12 }}>
              <label className={calcStyles.label}>Travel Companions</label>
              <select
                className={calcStyles.formControl}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id && !form.companionIds.includes(id)) {
                    setForm((f) => ({ ...f, companionIds: [...f.companionIds, id] }));
                  }
                  e.target.value = '';
                }}
              >
                <option value="">— Add companion —</option>
                {users.filter((u) => u.username !== currentUser.username && !form.companionIds.includes(u.id)).map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.username}</option>
                ))}
              </select>
              {form.companionIds.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {form.companionIds.map((id) => {
                    const user = users.find((u) => u.id === id);
                    return (
                      <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, background: 'var(--mx-surface-alt, #e5e7eb)', fontSize: '0.85rem' }}>
                        {user?.name || user?.username || id}
                        <button type="button" onClick={() => setForm((f) => ({ ...f, companionIds: f.companionIds.filter((c) => c !== id) }))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1, opacity: 0.6 }}>&times;</button>
                      </span>
                    );
                  })}
                </div>
              )}
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
              <th>Companions</th>
              <th>Tickets</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr>
                <td colSpan={10} className={historyStyles.empty}>No travel requests yet.</td>
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
                  <td>{r.companion_names && r.companion_names.length > 0 ? r.companion_names.join(', ') : <span style={{ opacity: 0.4 }}>-</span>}</td>
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
