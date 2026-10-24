'use client';

import { FormEvent, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PartnerRecord, PartnerStatus } from '@/lib/types';
import { PROJECT_DEPARTMENTS, PROJECT_DEPARTMENT_LABEL } from '@/lib/projectDepartmentOptions';
import { PARTNER_ROLE_KEYS, PARTNER_ROLE_LABEL } from '@/lib/partnerRoles';
import AppShell from '@/components/AppShell';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import pageStyles from '../partnersPage.module.css';

interface PartnerUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string;
}

const STATUS_LABEL: Record<PartnerStatus, string> = {
  pending: 'Pending setup',
  active: 'Active',
  suspended: 'Suspended',
  inactive: 'Inactive'
};

// Mirrors ALLOWED_STATUS_TRANSITIONS in lib/partnerStore.ts. The server is
// the authority — an illegal transition is refused there with a 409 — this
// only decides which buttons are worth offering.
const NEXT_STATUSES: Record<PartnerStatus, PartnerStatus[]> = {
  pending: ['inactive'],
  active: ['suspended', 'inactive'],
  suspended: ['active', 'inactive'],
  inactive: ['active']
};

export default function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [partner, setPartner] = useState<PartnerRecord | null>(null);
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [staff, setStaff] = useState<{ id: string; username: string; name: string }[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<Partial<PartnerRecord>>({});
  const [showUserForm, setShowUserForm] = useState(false);
  const [userForm, setUserForm] = useState({ username: '', name: '', email: '', phone: '', role: 'partner-admin' });
  const [issuing, setIssuing] = useState(false);
  // Surfaced once, never stored — see the credentialBox comment in the CSS.
  const [credential, setCredential] = useState<{ username: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/partners/${id}`);
      if (!response.ok) {
        setStatus(response.status === 404 ? 'Partner not found.' : 'Could not load this partner.');
        return;
      }
      const data: { partner: PartnerRecord; users: PartnerUser[] } = await response.json();
      setPartner(data.partner);
      setUsers(data.users);
      setStatus('');
    } catch {
      setStatus('Could not reach the server.');
    }
  }, [id]);

  useEffect(() => {
    load();
    fetch('/api/users/lite')
      .then((r) => (r.ok ? r.json() : []))
      .then(setStaff)
      .catch(() => setStaff([]));
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setError('');
    const response = await fetch(`/api/admin/partners/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      setError(errBody?.error || 'Could not save changes.');
      return false;
    }
    await load();
    return true;
  }

  async function handleCreateUser(event: FormEvent) {
    event.preventDefault();
    setError('');
    setIssuing(true);
    try {
      const response = await fetch(`/api/admin/partners/${id}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userForm)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error || 'Could not create the login.');
        return;
      }
      setCredential({ username: body.user.username, password: body.tempPassword });
      setUserForm({ username: '', name: '', email: '', phone: '', role: 'partner-admin' });
      setShowUserForm(false);
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setIssuing(false);
    }
  }

  async function patchUser(userId: string, body: Record<string, unknown>) {
    setError('');
    const response = await fetch(`/api/admin/partners/${id}/users`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...body })
    });
    const resBody = await response.json().catch(() => null);
    if (!response.ok) {
      setError(resBody?.error || 'Could not update the login.');
      return;
    }
    if (resBody?.tempPassword) {
      setCredential({ username: resBody.record.username, password: resBody.tempPassword });
    }
    await load();
  }

  function startEdit() {
    if (!partner) return;
    setEdit({ ...partner });
    setEditing(true);
  }

  async function saveEdit() {
    const ok = await patch({
      company_name: edit.company_name,
      contact_person: edit.contact_person,
      email: edit.email,
      phone: edit.phone,
      address: edit.address,
      city: edit.city,
      state: edit.state,
      gst_number: edit.gst_number,
      departments: edit.departments,
      relationship_manager_id: edit.relationship_manager_id || '',
      notes: edit.notes
    });
    if (ok) setEditing(false);
  }

  if (!partner) {
    return (
      <AppShell title="Partner" subtitle="Sales › partner management">
        <div className={historyStyles.status}>{status}</div>
        <Link className={historyStyles.button} href="/admin/partners">← All partners</Link>
      </AppShell>
    );
  }

  return (
    <AppShell title={partner.company_name} subtitle={`Sales › partner ${partner.partner_code}`}>
      <div className={pageStyles.actionsRow}>
        <Link className={historyStyles.button} href="/admin/partners">← All partners</Link>
      </div>

      {error && <div className={historyStyles.loginError}>{error}</div>}

      {credential && (
        <div className={pageStyles.credentialBox}>
          <strong>Temporary password for {credential.username}</strong>
          <p className={calcStyles.small}>
            Shown once. It has also been emailed, but copy it now in case delivery fails — the partner must change it on
            first sign-in.
          </p>
          <code>{credential.password}</code>{' '}
          <button type="button" className={historyStyles.button} onClick={() => setCredential(null)}>Dismiss</button>
        </div>
      )}

      <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Company</h2>
      <div className={calcStyles.sectionPanel}>
        {editing ? (
          <>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Company name</label>
                <input className={calcStyles.formControl} value={edit.company_name ?? ''} onChange={(e) => setEdit({ ...edit, company_name: e.target.value })} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Contact person</label>
                <input className={calcStyles.formControl} value={edit.contact_person ?? ''} onChange={(e) => setEdit({ ...edit, contact_person: e.target.value })} />
              </div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Email</label>
                <input className={calcStyles.formControl} value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Phone</label>
                <input className={calcStyles.formControl} value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>GST number</label>
                <input className={calcStyles.formControl} value={edit.gst_number ?? ''} onChange={(e) => setEdit({ ...edit, gst_number: e.target.value })} />
              </div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>City</label>
                <input className={calcStyles.formControl} value={edit.city ?? ''} onChange={(e) => setEdit({ ...edit, city: e.target.value })} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>State</label>
                <input className={calcStyles.formControl} value={edit.state ?? ''} onChange={(e) => setEdit({ ...edit, state: e.target.value })} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Relationship manager</label>
                <select className={calcStyles.formControl} value={edit.relationship_manager_id ?? ''} onChange={(e) => setEdit({ ...edit, relationship_manager_id: e.target.value })}>
                  <option value="">Not assigned</option>
                  {staff.map((u) => (
                    <option key={u.id} value={u.id}>{u.name || u.username}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className={calcStyles.field}>
              <span className={calcStyles.label}>Departments</span>
              <div className={pageStyles.actionsRow}>
                {PROJECT_DEPARTMENTS.map((d) => (
                  <label key={d} className={calcStyles.small}>
                    <input
                      type="checkbox"
                      checked={(edit.departments ?? []).includes(d)}
                      onChange={() => {
                        const current = edit.departments ?? [];
                        setEdit({ ...edit, departments: current.includes(d) ? current.filter((x) => x !== d) : [...current, d] });
                      }}
                    />{' '}
                    {PROJECT_DEPARTMENT_LABEL[d]}
                  </label>
                ))}
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Internal notes</label>
              <textarea className={calcStyles.formControl} rows={3} value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
              <span className={calcStyles.small}>Internal only — never shown in the partner portal.</span>
            </div>
            <div className={pageStyles.actionsRow}>
              <button type="button" className={calcStyles.btn} onClick={saveEdit}>Save</button>
              <button type="button" className={historyStyles.button} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className={pageStyles.detailGrid}>
              <div className={pageStyles.detailItem}>
                <span className={pageStyles.detailLabel}>Partner code</span>
                <span className={`${pageStyles.detailValue} ${pageStyles.codeCell}`}>{partner.partner_code}</span>
              </div>
              <div className={pageStyles.detailItem}>
                <span className={pageStyles.detailLabel}>Status</span>
                <span className={pageStyles.detailValue}>{STATUS_LABEL[partner.status]}</span>
              </div>
              <div className={pageStyles.detailItem}>
                <span className={pageStyles.detailLabel}>Contact person</span>
                <span className={pageStyles.detailValue}>{partner.contact_person || '-'}</span>
              </div>
              <div className={pageStyles.detailItem}>
                <span className={pageStyles.detailLabel}>Email</span>
                <span className={pageStyles.detailValue}>{partner.email || '-'}</span>
              </div>
              <div className={pageStyles.detailItem}>
                <span className={pageStyles.detailLabel}>Phone</span>
                <span className={pageStyles.detailValue}>{partner.phone || '-'}</span>
              </div>
              <div className={pageStyles.detailItem}>
                <span className={pageStyles.detailLabel}>Location</span>
                <span className={pageStyles.detailValue}>{[partner.city, partner.state].filter(Boolean).join(', ') || '-'}</span>
              </div>
              <div className={pageStyles.detailItem}>
                <span className={pageStyles.detailLabel}>GST number</span>
                <span className={pageStyles.detailValue}>{partner.gst_number || '-'}</span>
              </div>
              <div className={pageStyles.detailItem}>
                <span className={pageStyles.detailLabel}>Relationship manager</span>
                <span className={pageStyles.detailValue}>{partner.relationship_manager_name || 'Not assigned'}</span>
              </div>
              <div className={pageStyles.detailItem}>
                <span className={pageStyles.detailLabel}>Departments</span>
                <span className={pageStyles.detailValue}>
                  {partner.departments.length ? partner.departments.map((d) => PROJECT_DEPARTMENT_LABEL[d as keyof typeof PROJECT_DEPARTMENT_LABEL] ?? d).join(', ') : '-'}
                </span>
              </div>
            </div>
            {partner.notes && (
              <div className={pageStyles.detailItem}>
                <span className={pageStyles.detailLabel}>Internal notes</span>
                <span className={pageStyles.detailValue}>{partner.notes}</span>
              </div>
            )}
            <div className={pageStyles.actionsRow}>
              <button type="button" className={calcStyles.btn} onClick={startEdit}>Edit details</button>
              {NEXT_STATUSES[partner.status].map((next) => (
                <button key={next} type="button" className={historyStyles.button} onClick={() => patch({ status: next })}>
                  {next === 'active' ? 'Reactivate' : next === 'suspended' ? 'Suspend' : 'Mark inactive'}
                </button>
              ))}
            </div>
            <p className={calcStyles.small}>
              Suspending takes effect immediately — every signed-in user of this partner is cut off on their next request.
              Nothing is deleted, and reactivating restores access.
            </p>
          </>
        )}
      </div>

      <h2 className={calcStyles.h2}>Portal logins</h2>
      <div className={historyStyles.tableWrap}>
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className={pageStyles.codeCell}>{u.username}</td>
                <td>{u.name}</td>
                <td>{u.email || <span className={pageStyles.muted}>-</span>}</td>
                <td>{PARTNER_ROLE_LABEL[u.role] ?? u.role}</td>
                <td>
                  <span className={`${historyStyles.statusPill} ${u.status === 'active' ? historyStyles.statusPillActive : historyStyles.statusPillInactive}`}>
                    {u.status === 'active' ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : <span className={pageStyles.muted}>{u.mustChangePassword ? 'Never — setup pending' : 'Never'}</span>}
                </td>
                <td>
                  <div className={pageStyles.actionsRow}>
                    <button type="button" className={historyStyles.button} onClick={() => patchUser(u.id, { status: u.status === 'active' ? 'inactive' : 'active' })}>
                      {u.status === 'active' ? 'Disable' : 'Enable'}
                    </button>
                    <button type="button" className={historyStyles.button} onClick={() => patchUser(u.id, { resetPassword: true })}>Reset password</button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={7} className={pageStyles.muted}>No logins yet — this partner cannot sign in.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showUserForm ? (
        <form className={calcStyles.sectionPanel} onSubmit={handleCreateUser}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="puUsername">Username *</label>
              <input id="puUsername" className={calcStyles.formControl} value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="puName">Full name *</label>
              <input id="puName" className={calcStyles.formControl} value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} required />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="puEmail">Email *</label>
              <input id="puEmail" type="email" className={calcStyles.formControl} value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="puPhone">Phone</label>
              <input id="puPhone" className={calcStyles.formControl} value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="puRole">Role</label>
              <select id="puRole" className={calcStyles.formControl} value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
                {PARTNER_ROLE_KEYS.map((r) => (
                  <option key={r} value={r}>{PARTNER_ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={pageStyles.actionsRow}>
            <button type="submit" className={calcStyles.btn} disabled={issuing}>{issuing ? 'Creating...' : 'Create login'}</button>
            <button type="button" className={historyStyles.button} onClick={() => setShowUserForm(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className={pageStyles.actionsRow}>
          <button type="button" className={calcStyles.btn} onClick={() => setShowUserForm(true)}>+ Create portal login</button>
        </div>
      )}
    </AppShell>
  );
}
