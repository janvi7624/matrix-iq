'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PublicUser, UserRole } from '@/lib/types';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';

const ROLE_LABELS: Record<UserRole, string> = { superadmin: 'Super Admin', admin: 'Admin', user: 'User' };
const ROLE_PILL_CLASS: Record<UserRole, string> = {
  superadmin: historyStyles.rolePillSuperadmin,
  admin: historyStyles.rolePillAdmin,
  user: historyStyles.rolePillUser
};

function RolePill({ role }: { role: UserRole }) {
  return <span className={`${historyStyles.rolePill} ${ROLE_PILL_CLASS[role]}`}>{ROLE_LABELS[role]}</span>;
}

function RoleOptions({ includeSuperadmin }: { includeSuperadmin: boolean }) {
  return (
    <>
      <option value="user">User</option>
      <option value="admin">Admin</option>
      {includeSuperadmin && <option value="superadmin">Super Admin</option>}
    </>
  );
}

interface NewUserForm {
  username: string;
  password: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
}

const BLANK_FORM: NewUserForm = { username: '', password: '', name: '', phone: '', email: '', role: 'user' };

interface EditState {
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  password: string;
}

export default function ManageUsersPage() {
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState<NewUserForm>(BLANK_FORM);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  async function loadUsers() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/admin/users');
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data: PublicUser[] = await response.json();
      setUsers(data);
      setStatus(`${data.length} user${data.length === 1 ? '' : 's'}.`);
    } catch {
      setStatus('Could not load users. Refresh to try again.');
    }
  }

  useEffect(() => {
    loadUsers();
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setCurrentRole(me?.role || null))
      .catch(() => setCurrentRole(null));
  }, []);

  const isSuperadmin = currentRole === 'superadmin';

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError('');
    setCreateBusy(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setCreateError(body?.error || 'Could not create user.');
        return;
      }
      setForm(BLANK_FORM);
      await loadUsers();
    } catch {
      setCreateError('Could not reach the server.');
    } finally {
      setCreateBusy(false);
    }
  }

  function startEdit(user: PublicUser) {
    setEditingId(user.id);
    setEditState({ name: user.name, phone: user.phone, email: user.email, role: user.role, password: '' });
    setRowError((prev) => ({ ...prev, [user.id]: '' }));
  }

  async function saveEdit(id: string) {
    if (!editState) return;
    setRowError((prev) => ({ ...prev, [id]: '' }));
    try {
      const payload: Record<string, unknown> = {
        name: editState.name,
        phone: editState.phone,
        email: editState.email,
        role: editState.role
      };
      if (editState.password) payload.password = editState.password;

      const response = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRowError((prev) => ({ ...prev, [id]: body?.error || 'Could not save changes.' }));
        return;
      }
      setEditingId(null);
      setEditState(null);
      await loadUsers();
    } catch {
      setRowError((prev) => ({ ...prev, [id]: 'Could not reach the server.' }));
    }
  }

  async function handleDelete(user: PublicUser) {
    if (!window.confirm(`Remove user "${user.username}"? This cannot be undone.`)) return;
    const response = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      alert(body?.error || 'Could not delete user.');
      return;
    }
    await loadUsers();
  }

  return (
    <div className={historyStyles.body}>
      <header className={historyStyles.header}>
        <div className={historyStyles.headerBrand}>
          <Image src="/NANTA.jpeg" alt="NANTA logo" width={38} height={38} className={historyStyles.headerLogo} unoptimized />
          <div>
            <h1>NANTA Admin — Manage Users</h1>
            <div className={historyStyles.sub}>Create and manage login accounts for the Sales Quotation Estimator.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className={historyStyles.button} href="/admin">
            &larr; Quotation History
          </Link>
          <Link className={historyStyles.button} href="/">
            Back to Calculator
          </Link>
        </div>
      </header>
      <main className={historyStyles.main}>
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Add user</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          {createError && <div className={historyStyles.loginError}>{createError}</div>}
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newUsername">Username</label>
              <input id="newUsername" className={calcStyles.formControl} type="text" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newPassword">Password</label>
              <input id="newPassword" className={calcStyles.formControl} type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} minLength={6} required />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newName">Full name</label>
              <input id="newName" className={calcStyles.formControl} type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newRole">Role</label>
              <select id="newRole" className={calcStyles.formControl} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}>
                <RoleOptions includeSuperadmin={isSuperadmin} />
              </select>
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newPhone">Phone</label>
              <input id="newPhone" className={calcStyles.formControl} type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newEmail">Email</label>
              <input id="newEmail" className={calcStyles.formControl} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
          <button type="submit" className={calcStyles.btn} disabled={createBusy}>
            {createBusy ? 'Adding...' : '+ Add user'}
          </button>
        </form>

        <h2 className={calcStyles.h2}>Users</h2>
        <div className={historyStyles.status}>{status}</div>
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Role</th>
              <th>New password</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isEditing = editingId === user.id;
              const canManage = isSuperadmin || user.role !== 'superadmin';
              return (
                <tr key={user.id}>
                  <td className={historyStyles.num}>{user.username}</td>
                  {isEditing && editState ? (
                    <>
                      <td>
                        <input className={calcStyles.formControl} value={editState.name} onChange={(e) => setEditState({ ...editState, name: e.target.value })} />
                      </td>
                      <td>
                        <input className={calcStyles.formControl} value={editState.phone} onChange={(e) => setEditState({ ...editState, phone: e.target.value })} />
                      </td>
                      <td>
                        <input className={calcStyles.formControl} value={editState.email} onChange={(e) => setEditState({ ...editState, email: e.target.value })} />
                      </td>
                      <td>
                        <select className={calcStyles.formControl} value={editState.role} onChange={(e) => setEditState({ ...editState, role: e.target.value as UserRole })}>
                          <RoleOptions includeSuperadmin={isSuperadmin} />
                        </select>
                      </td>
                      <td>
                        <input className={calcStyles.formControl} type="password" placeholder="Leave blank to keep" value={editState.password} onChange={(e) => setEditState({ ...editState, password: e.target.value })} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={() => saveEdit(user.id)}>Save</button>
                          <button type="button" className={historyStyles.button} onClick={() => { setEditingId(null); setEditState(null); }}>Cancel</button>
                        </div>
                        {rowError[user.id] && <div className={historyStyles.loginError}>{rowError[user.id]}</div>}
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{user.name}</td>
                      <td>{user.phone || '-'}</td>
                      <td>{user.email || '-'}</td>
                      <td><RolePill role={user.role} /></td>
                      <td>-</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {canManage && (
                            <button type="button" className={historyStyles.button} onClick={() => startEdit(user)}>Edit</button>
                          )}
                          {isSuperadmin && (
                            <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(user)}>Delete</button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>
    </div>
  );
}
