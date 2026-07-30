'use client';

import { FormEvent, useEffect, useState } from 'react';
import { CrmRecord, UserRole } from '@/lib/types';
import PortalHeader from './PortalHeader';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

const EMPTY_FORM = { company: '', contactPerson: '', phone: '', email: '', source: '', notes: '' };

const STATUS_LABEL: Record<CrmRecord['status'], string> = { lead: 'Lead', prospect: 'Prospect', customer: 'Customer' };

interface CrmViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function CrmView({ currentUser }: CrmViewProps) {
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin';
  const [records, setRecords] = useState<CrmRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/crm');
      if (!response.ok) throw new Error(String(response.status));
      const data: CrmRecord[] = await response.json();
      setRecords(data);
      setStatus(data.length ? `${data.length} contact${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the CRM API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.company.trim() && !form.contactPerson.trim()) {
      alert('Company or contact person is required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/crm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      await load();
    } catch {
      alert('Could not save this contact. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleStatusChange(id: string, next: CrmRecord['status']) {
    try {
      const response = await fetch(`/api/crm/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      if (!response.ok) throw new Error(String(response.status));
      const updated: CrmRecord = await response.json();
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      alert('Could not update status. Please try again.');
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this contact? This cannot be undone.')) return;
    try {
      const response = await fetch(`/api/crm/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      alert('Could not delete this contact.');
    }
  }

  return (
    <div className={historyStyles.body}>
      <PortalHeader title="CRM" subtitle="Track leads, prospects, and customers." />
      <main className={historyStyles.main}>
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Add contact</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Company</label>
              <input className={calcStyles.formControl} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Contact person</label>
              <input className={calcStyles.formControl} value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Phone</label>
              <input className={calcStyles.formControl} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Email</label>
              <input type="email" className={calcStyles.formControl} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Source</label>
              <input className={calcStyles.formControl} placeholder="Referral, website, cold call…" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Notes</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Saving…' : 'Add contact'}
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
                <th>Company</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Source</th>
                <th>Status</th>
                <th>Notes</th>
                <th>Added By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={9} className={historyStyles.empty}>
                    No contacts recorded yet.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id}>
                    <td>{r.company || '-'}</td>
                    <td>{r.contact_person || '-'}</td>
                    <td>{r.phone || '-'}</td>
                    <td>{r.email || '-'}</td>
                    <td>{r.source || '-'}</td>
                    <td>
                      <select
                        value={r.status}
                        onChange={(e) => handleStatusChange(r.id, e.target.value as CrmRecord['status'])}
                        style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12.5 }}
                      >
                        {(Object.keys(STATUS_LABEL) as CrmRecord['status'][]).map((s) => (
                          <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td>{r.notes || '-'}</td>
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
