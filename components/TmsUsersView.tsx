'use client';

import { FormEvent, useEffect, useState } from 'react';
import { User as UserIcon } from 'lucide-react';
import { PublicUser, UserRole } from '@/lib/types';
import { TMS_DEPARTMENTS, TMS_ROLE_KEYS } from '@/lib/tmsConstants';
import { TMS_ROLE_LABEL } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';

const EMPTY_FORM = {
  username: '',
  password: '',
  name: '',
  phone: '',
  email: '',
  employeeId: '',
  designation: '',
  location: '',
  role: 'engineer',
  department: 'Robotics'
};

interface TmsUsersViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TmsUsersView({ currentUser }: TmsUsersViewProps) {
  void currentUser;
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  async function load() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/tms/users');
      if (!response.ok) throw new Error(String(response.status));
      const data: PublicUser[] = await response.json();
      setUsers(data);
      setStatus(`${data.length} technical team member${data.length === 1 ? '' : 's'}.`);
    } catch {
      setStatus('Could not reach the TMS API. Try refreshing.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.username.trim() || !form.password || !form.name.trim()) {
      toast.error('Username, password, and name are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/tms/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
      toast.success('Technical user created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create this user.');
    } finally {
      setCreating(false);
    }
  }

  async function toggleStatus(u: PublicUser) {
    const next = u.status === 'active' ? 'inactive' : 'active';
    if (next === 'inactive' && !(await confirm({ message: `Deactivate ${u.name}? They will no longer be able to log in.`, danger: true }))) return;
    try {
      const response = await fetch(`/api/tms/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch {
      toast.error('Could not update this user.');
    }
  }

  async function changeRole(u: PublicUser, role: string) {
    try {
      const response = await fetch(`/api/tms/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch {
      toast.error('Could not update this user\'s role.');
    }
  }

  return (
    <AppShell title="TMS Users" subtitle="Manage technical team accounts, department, role, and access.">
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New User'}
        </button>
        <button type="button" className={historyStyles.button} onClick={load}>Refresh</button>
      </div>

      {showForm && (
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate} style={{ marginBottom: 20 }}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Username</label>
              <input className={calcStyles.formControl} value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Password</label>
              <input type="password" className={calcStyles.formControl} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Name</label>
              <input className={calcStyles.formControl} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Phone</label>
              <input className={calcStyles.formControl} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Email</label>
              <input type="email" className={calcStyles.formControl} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Employee ID</label>
              <input className={calcStyles.formControl} value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Department</label>
              <select className={calcStyles.formControl} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}>
                {TMS_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Role</label>
              <select className={calcStyles.formControl} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                {TMS_ROLE_KEYS.map((r) => (
                  <option key={r} value={r}>{TMS_ROLE_LABEL[r]}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Designation</label>
              <input className={calcStyles.formControl} value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
            </div>
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </form>
      )}

      {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={6} columns={6} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load TMS users — check your connection and try again." onRetry={load} />
      ) : users.length === 0 ? (
        <EmptyState icon={UserIcon} title="No technical users yet" message="Create your first Technical Manager, Team Lead, Engineer, or Technician account." />
      ) : (
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Department</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.username}</td>
                <td>{u.department}</td>
                <td>
                  <select className={calcStyles.formControl} style={{ width: 'auto' }} value={u.role} onChange={(e) => changeRole(u, e.target.value)}>
                    {TMS_ROLE_KEYS.map((r) => (
                      <option key={r} value={r}>{TMS_ROLE_LABEL[r]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <span className={`${historyStyles.statusPill} ${u.status === 'active' ? historyStyles.statusPillActive : historyStyles.statusPillInactive}`}>
                    {u.status === 'active' ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button type="button" className={historyStyles.button} onClick={() => toggleStatus(u)}>
                    {u.status === 'active' ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}
