'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PartnerRecord, PartnerStatus } from '@/lib/types';
import { PROJECT_DEPARTMENTS, PROJECT_DEPARTMENT_LABEL } from '@/lib/projectDepartmentOptions';
import AppShell from '@/components/AppShell';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import pageStyles from './partnersPage.module.css';

const STATUS_LABEL: Record<PartnerStatus, string> = {
  pending: 'Pending setup',
  active: 'Active',
  suspended: 'Suspended',
  inactive: 'Inactive'
};

function statusClass(status: PartnerStatus): string {
  if (status === 'active') return historyStyles.statusPillActive;
  if (status === 'pending') return pageStyles.statusPillPending;
  if (status === 'suspended') return pageStyles.statusPillSuspended;
  return historyStyles.statusPillInactive;
}

export default function PartnerManagementPage() {
  const [partners, setPartners] = useState<PartnerRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PartnerStatus>('all');
  const [users, setUsers] = useState<{ id: string; username: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    company_name: '',
    contact_person: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    gst_number: '',
    relationship_manager_id: '',
    departments: [] as string[]
  });

  // No synchronous setState here: the initial `status` already reads
  // "Loading...", and every re-load follows a user action that has already
  // repainted. Setting it at the top of this function would fire a cascading
  // render straight out of the mount effect below.
  async function load() {
    try {
      const response = await fetch('/api/admin/partners');
      if (!response.ok) throw new Error(String(response.status));
      const data: PartnerRecord[] = await response.json();
      setPartners(data);
      setStatus(data.length ? `${data.length} partner${data.length === 1 ? '' : 's'}.` : 'No partners yet. Add the first one above.');
    } catch {
      setStatus('Could not load partners. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
    fetch('/api/users/lite')
      .then((r) => (r.ok ? r.json() : []))
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return partners.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        p.company_name.toLowerCase().includes(needle) ||
        p.partner_code.toLowerCase().includes(needle) ||
        p.contact_person.toLowerCase().includes(needle) ||
        p.city.toLowerCase().includes(needle)
      );
    });
  }, [partners, q, statusFilter]);

  function toggleDepartment(key: string) {
    setForm((prev) => ({
      ...prev,
      departments: prev.departments.includes(key) ? prev.departments.filter((d) => d !== key) : [...prev.departments, key]
    }));
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const response = await fetch('/api/admin/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setCreateError(body?.error || 'Could not add partner.');
        return;
      }
      setForm({ company_name: '', contact_person: '', email: '', phone: '', city: '', state: '', gst_number: '', relationship_manager_id: '', departments: [] });
      setShowForm(false);
      await load();
    } catch {
      setCreateError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell title="Partner Management" subtitle="Sales › channel partners, distributors and dealers who collaborate with us through MatrixIQ.">
      <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Add partner</h2>
      {!showForm ? (
        <div className={calcStyles.sectionPanel}>
          <p className={calcStyles.small}>
            Creating a partner records the company only. Issue their login from the partner&apos;s own page — the account stays
            in <strong>Pending setup</strong> until you do, and partners can never register themselves.
          </p>
          <button type="button" className={calcStyles.btn} onClick={() => setShowForm(true)}>+ New partner</button>
        </div>
      ) : (
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          {createError && <div className={historyStyles.loginError}>{createError}</div>}
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="companyName">Company name *</label>
              <input id="companyName" className={calcStyles.formControl} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="contactPerson">Contact person</label>
              <input id="contactPerson" className={calcStyles.formControl} value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="partnerEmail">Email</label>
              <input id="partnerEmail" type="email" className={calcStyles.formControl} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="partnerPhone">Phone</label>
              <input id="partnerPhone" className={calcStyles.formControl} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="partnerCity">City</label>
              <input id="partnerCity" className={calcStyles.formControl} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="partnerState">State</label>
              <input id="partnerState" className={calcStyles.formControl} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="partnerGst">GST number</label>
              <input id="partnerGst" className={calcStyles.formControl} value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="partnerRm">Relationship manager</label>
              <select id="partnerRm" className={calcStyles.formControl} value={form.relationship_manager_id} onChange={(e) => setForm({ ...form, relationship_manager_id: e.target.value })}>
                <option value="">Not assigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.username}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <span className={calcStyles.label}>Departments</span>
              <div className={pageStyles.actionsRow}>
                {PROJECT_DEPARTMENTS.map((d) => (
                  <label key={d} className={calcStyles.small}>
                    <input type="checkbox" checked={form.departments.includes(d)} onChange={() => toggleDepartment(d)} /> {PROJECT_DEPARTMENT_LABEL[d]}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className={pageStyles.actionsRow}>
            <button type="submit" className={calcStyles.btn} disabled={creating}>{creating ? 'Adding...' : 'Add partner'}</button>
            <button type="button" className={historyStyles.button} onClick={() => { setShowForm(false); setCreateError(''); }}>Cancel</button>
          </div>
        </form>
      )}

      <h2 className={calcStyles.h2}>Partners</h2>
      <div className={historyStyles.toolbar}>
        <input type="text" placeholder="Search by company, code, contact or city..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | PartnerStatus)}>
          <option value="all">All statuses</option>
          {(Object.keys(STATUS_LABEL) as PartnerStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>
      <div className={historyStyles.status}>{status}</div>
      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Code</th>
              <th>Company</th>
              <th>Contact</th>
              <th>Location</th>
              <th>Relationship manager</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.id}>
                <td className={pageStyles.codeCell}>{p.partner_code}</td>
                <td>{p.company_name}</td>
                <td>{p.contact_person || <span className={pageStyles.muted}>-</span>}</td>
                <td>{[p.city, p.state].filter(Boolean).join(', ') || <span className={pageStyles.muted}>-</span>}</td>
                <td>{p.relationship_manager_name || <span className={pageStyles.muted}>Not assigned</span>}</td>
                <td>
                  <span className={`${historyStyles.statusPill} ${statusClass(p.status)}`}>{STATUS_LABEL[p.status]}</span>
                </td>
                <td>
                  <Link className={historyStyles.button} href={`/admin/partners/${p.id}`}>Open</Link>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className={pageStyles.muted}>
                  {partners.length ? 'No partners match this filter.' : 'No partners yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
