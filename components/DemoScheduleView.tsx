'use client';

import { FormEvent, useEffect, useState } from 'react';
import { DemoScheduleRecord, DomainKey, UserRole } from '@/lib/types';
import { TECHNICAL_TEAM } from '@/lib/teamMembers';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { domainLeadLabel } from '@/lib/domainLeads';
import PortalHeader from './PortalHeader';
import TeamCheckboxes from './TeamCheckboxes';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

const EMPTY_FORM = {
  clientName: '',
  productDomain: '' as DomainKey | '',
  technicalMembers: [] as string[],
  scheduledAt: '',
  assignedRep: '',
  notes: ''
};

const STATUS_LABEL: Record<DemoScheduleRecord['status'], string> = {
  pending: 'Pending approval',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  done: 'Done',
  cancelled: 'Cancelled'
};

const STATUS_CLASS: Record<DemoScheduleRecord['status'], string> = {
  pending: historyStyles.statusPending,
  confirmed: historyStyles.statusConfirmed,
  rejected: historyStyles.statusRejected,
  done: historyStyles.statusDone,
  cancelled: historyStyles.statusCancelled
};

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

interface DemoScheduleViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function DemoScheduleView({ currentUser }: DemoScheduleViewProps) {
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin';
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
      alert('Could not save this demo request. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function patchRecord(id: string, patch: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/demo-schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(String(response.status));
      const updated: DemoScheduleRecord = await response.json();
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      alert('Could not update this request. Please try again.');
    }
  }

  function handleApprove(id: string) {
    patchRecord(id, { status: 'confirmed' });
  }

  function handleReject(id: string) {
    const note = window.prompt('Reason for rejecting this demo request (optional):', '') || '';
    patchRecord(id, { status: 'rejected', decisionNote: note });
  }

  function handleCancel(id: string) {
    if (!window.confirm('Cancel this demo request?')) return;
    patchRecord(id, { status: 'cancelled' });
  }

  function handleMarkDone(id: string) {
    patchRecord(id, { status: 'done' });
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this demo request? This cannot be undone.')) return;
    try {
      const response = await fetch(`/api/demo-schedule/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      alert('Could not delete this demo request.');
    }
  }

  return (
    <div className={historyStyles.body}>
      <PortalHeader title="Demo Schedule" subtitle="Request a product demo — it's confirmed once the domain lead approves." />
      <main className={historyStyles.main}>
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Request a demo</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client name *</label>
              <input className={calcStyles.formControl} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Product</label>
              <select
                className={calcStyles.formControl}
                value={form.productDomain}
                onChange={(e) => setForm((f) => ({ ...f, productDomain: e.target.value as DomainKey | '' }))}
              >
                <option value="">-- Select product --</option>
                {(Object.keys(DOMAIN_DISPLAY_NAME) as DomainKey[]).map((k) => (
                  <option key={k} value={k}>{DOMAIN_DISPLAY_NAME[k]}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Scheduled date &amp; time *</label>
              <input type="datetime-local" className={calcStyles.formControl} value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))} required />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <TeamCheckboxes
              label="Technical team member(s) required"
              options={TECHNICAL_TEAM}
              selected={form.technicalMembers}
              onChange={(next) => setForm((f) => ({ ...f, technicalMembers: next }))}
            />
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Assigned rep</label>
              <input className={calcStyles.formControl} placeholder="Defaults to you" value={form.assignedRep} onChange={(e) => setForm((f) => ({ ...f, assignedRep: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Notes</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {form.productDomain && (
            <div className={calcStyles.small} style={{ marginBottom: 8 }}>
              This request will need approval from the {DOMAIN_DISPLAY_NAME[form.productDomain]} lead ({domainLeadLabel(form.productDomain)}).
            </div>
          )}
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Sending…' : 'Send request'}
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
                <th>Product</th>
                <th>Lead</th>
                <th>Technical Team</th>
                <th>Status</th>
                <th>Requested By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={8} className={historyStyles.empty}>
                    No demo requests yet.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTime(r.scheduled_at)}</td>
                    <td>{r.client_name}</td>
                    <td>{r.product_domain ? DOMAIN_DISPLAY_NAME[r.product_domain] : '-'}</td>
                    <td>{domainLeadLabel(r.product_domain)}</td>
                    <td>{r.technical_members.length ? r.technical_members.join(', ') : '-'}</td>
                    <td>
                      <span className={`${historyStyles.statusBadge} ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      {r.status === 'rejected' && r.decision_note && <div className={calcStyles.small}>{r.decision_note}</div>}
                      {r.approved_by && (r.status === 'confirmed' || r.status === 'rejected') && (
                        <div className={calcStyles.small}>by {r.approved_by}</div>
                      )}
                    </td>
                    <td>{r.created_by}</td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.status === 'pending' && isPrivileged && (
                        <>
                          <button type="button" className={historyStyles.primary} onClick={() => handleApprove(r.id)}>
                            Approve
                          </button>
                          <button type="button" className={historyStyles.deleteBtn} onClick={() => handleReject(r.id)}>
                            Reject
                          </button>
                        </>
                      )}
                      {(r.status === 'pending' || r.status === 'confirmed') && (r.created_by === currentUser.username || isPrivileged) && (
                        <button type="button" className={historyStyles.button} onClick={() => handleCancel(r.id)}>
                          Cancel
                        </button>
                      )}
                      {r.status === 'confirmed' && (
                        <button type="button" className={historyStyles.button} onClick={() => handleMarkDone(r.id)}>
                          Mark done
                        </button>
                      )}
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
