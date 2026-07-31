'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { DepartmentRecord, PublicUser, RoleRecord, UserRole } from '@/lib/types';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import { BRAND } from '@/lib/branding';

// Known system roles keep their dedicated pill colors; any admin-created role
// falls back to a neutral pill so a brand-new role never breaks this lookup.
const KNOWN_ROLE_PILL_CLASS: Record<string, string> = {
  superadmin: historyStyles.rolePillSuperadmin,
  admin: historyStyles.rolePillAdmin,
  manager: historyStyles.rolePillManager,
  technical: historyStyles.rolePillTechnical,
  backoffice: historyStyles.rolePillBackoffice,
  user: historyStyles.rolePillUser
};

function RolePill({ role, roles }: { role: UserRole; roles: RoleRecord[] }) {
  const record = roles.find((r) => r.key === role);
  const label = record?.label || role;
  const cls = KNOWN_ROLE_PILL_CLASS[role] || historyStyles.rolePillUser;
  return <span className={`${historyStyles.rolePill} ${cls}`}>{label}</span>;
}

function StatusPill({ status }: { status: PublicUser['status'] }) {
  return (
    <span className={`${historyStyles.statusPill} ${status === 'active' ? historyStyles.statusPillActive : historyStyles.statusPillInactive}`}>
      {status === 'active' ? 'Active' : 'Inactive'}
    </span>
  );
}

function RoleOptions({ roles, includeSuperadmin }: { roles: RoleRecord[]; includeSuperadmin: boolean }) {
  return (
    <>
      {roles
        .filter((r) => r.key !== 'superadmin' || includeSuperadmin)
        .map((r) => (
          <option key={r.key} value={r.key}>{r.label}</option>
        ))}
    </>
  );
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

interface NewUserForm {
  username: string;
  password: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  employeeId: string;
  department: string;
  designation: string;
}

const BLANK_FORM: NewUserForm = { username: '', password: '', name: '', phone: '', email: '', role: 'user', employeeId: '', department: '', designation: '' };

interface EditState {
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  employeeId: string;
  department: string;
  designation: string;
  password: string;
}

interface ActivityItem { id: string; label: string; status: string; at: string; }
interface ActivitySection { total: number; recent: ActivityItem[]; }
interface LoginHistoryEntry { id: string; at: string; success: boolean; ip: string; }
interface UserActivity {
  projects: ActivitySection;
  siteVisits: ActivitySection;
  quotations: ActivitySection;
  demoRequests: ActivitySection;
  loginHistory: LoginHistoryEntry[];
}

export default function ManageUsersPage() {
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState<NewUserForm>(BLANK_FORM);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [activityOpenId, setActivityOpenId] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, UserActivity>>({});
  const [activityLoading, setActivityLoading] = useState(false);

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
    fetch('/api/admin/roles')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: RoleRecord[]) => setRoles(data.filter((r) => r.status === 'active')))
      .catch(() => setRoles([]));
    fetch('/api/departments')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: DepartmentRecord[]) => setDepartments(data))
      .catch(() => setDepartments([]));
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
    setEditState({
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId || '',
      department: user.department || '',
      designation: user.designation || '',
      password: ''
    });
    setRowError((prev) => ({ ...prev, [user.id]: '' }));
  }

  async function patchUser(id: string, payload: Record<string, unknown>): Promise<boolean> {
    setRowError((prev) => ({ ...prev, [id]: '' }));
    try {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRowError((prev) => ({ ...prev, [id]: body?.error || 'Could not save changes.' }));
        return false;
      }
      await loadUsers();
      return true;
    } catch {
      setRowError((prev) => ({ ...prev, [id]: 'Could not reach the server.' }));
      return false;
    }
  }

  async function saveEdit(id: string) {
    if (!editState) return;
    const payload: Record<string, unknown> = {
      name: editState.name,
      phone: editState.phone,
      email: editState.email,
      role: editState.role,
      employeeId: editState.employeeId,
      department: editState.department,
      designation: editState.designation
    };
    if (editState.password) payload.password = editState.password;
    const ok = await patchUser(id, payload);
    if (ok) {
      setEditingId(null);
      setEditState(null);
    }
  }

  async function toggleStatus(user: PublicUser) {
    const next = user.status === 'active' ? 'inactive' : 'active';
    if (next === 'inactive' && !window.confirm(`Deactivate "${user.username}"? They will no longer be able to log in.`)) return;
    await patchUser(user.id, { status: next });
  }

  async function resetPassword(user: PublicUser) {
    const next = window.prompt(`New password for "${user.username}" (min 6 characters):`);
    if (!next) return;
    if (next.length < 6) {
      alert('Password must be at least 6 characters.');
      return;
    }
    const ok = await patchUser(user.id, { password: next });
    if (ok) alert(`Password reset for "${user.username}".`);
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

  async function toggleActivity(user: PublicUser) {
    if (activityOpenId === user.id) {
      setActivityOpenId(null);
      return;
    }
    setActivityOpenId(user.id);
    if (activity[user.id]) return;
    setActivityLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/activity`);
      if (response.ok) {
        const data: UserActivity = await response.json();
        setActivity((prev) => ({ ...prev, [user.id]: data }));
      }
    } finally {
      setActivityLoading(false);
    }
  }

  return (
    <div className={historyStyles.body}>
      <header className={historyStyles.header}>
        <Link href="/" className={historyStyles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} unoptimized />
          <div>
            <h1>{BRAND.appName} — User Management</h1>
            <div className={historyStyles.sub}>Administration &rsaquo; create and manage login accounts.</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className={historyStyles.button} href="/admin/roles">
            Role Management
          </Link>
          <Link className={historyStyles.button} href="/admin/audit-log">
            Audit Log
          </Link>
          <Link className={historyStyles.button} href="/">
            Back to Dashboard
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
                <RoleOptions roles={roles} includeSuperadmin={isSuperadmin} />
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
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newEmployeeId">Employee ID (optional)</label>
              <input id="newEmployeeId" className={calcStyles.formControl} type="text" value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newDepartment">Department</label>
              <select id="newDepartment" className={calcStyles.formControl} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}>
                <option value="">Select department...</option>
                {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newDesignation">Designation</label>
              <input id="newDesignation" className={calcStyles.formControl} type="text" placeholder="e.g. Sales Executive" value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
            </div>
          </div>
          <button type="submit" className={calcStyles.btn} disabled={createBusy}>
            {createBusy ? 'Adding...' : '+ Add user'}
          </button>
        </form>

        <h2 className={calcStyles.h2}>Users</h2>
        <div className={historyStyles.status}>{status}</div>
        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Username</th>
                <th>Name</th>
                <th>Employee ID</th>
                <th>Email</th>
                <th>Mobile</th>
                <th>Department</th>
                <th>Designation</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isEditing = editingId === user.id;
                const canManage = isSuperadmin || user.role !== 'superadmin';
                const isActivityOpen = activityOpenId === user.id;
                const userActivity = activity[user.id];
                return (
                  <>
                    <tr key={user.id}>
                      <td className={historyStyles.num}>{user.username}</td>
                      {isEditing && editState ? (
                        <>
                          <td>
                            <input className={calcStyles.formControl} value={editState.name} onChange={(e) => setEditState({ ...editState, name: e.target.value })} />
                          </td>
                          <td>
                            <input className={calcStyles.formControl} value={editState.employeeId} onChange={(e) => setEditState({ ...editState, employeeId: e.target.value })} />
                          </td>
                          <td>
                            <input className={calcStyles.formControl} value={editState.email} onChange={(e) => setEditState({ ...editState, email: e.target.value })} />
                          </td>
                          <td>
                            <input className={calcStyles.formControl} value={editState.phone} onChange={(e) => setEditState({ ...editState, phone: e.target.value })} />
                          </td>
                          <td>
                            <select className={calcStyles.formControl} value={editState.department} onChange={(e) => setEditState({ ...editState, department: e.target.value })}>
                              <option value="">Select department...</option>
                              {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                            </select>
                          </td>
                          <td>
                            <input className={calcStyles.formControl} value={editState.designation} onChange={(e) => setEditState({ ...editState, designation: e.target.value })} />
                          </td>
                          <td>
                            <select className={calcStyles.formControl} value={editState.role} onChange={(e) => setEditState({ ...editState, role: e.target.value as UserRole })}>
                              <RoleOptions roles={roles} includeSuperadmin={isSuperadmin} />
                            </select>
                          </td>
                          <td colSpan={3}>
                            <input className={calcStyles.formControl} type="password" placeholder="New password (optional)" value={editState.password} onChange={(e) => setEditState({ ...editState, password: e.target.value })} />
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
                          <td>{user.employeeId || '-'}</td>
                          <td>{user.email || '-'}</td>
                          <td>{user.phone || '-'}</td>
                          <td>{user.department || '-'}</td>
                          <td>{user.designation || '-'}</td>
                          <td><RolePill role={user.role} roles={roles} /></td>
                          <td><StatusPill status={user.status} /></td>
                          <td>{formatDateTime(user.lastLoginAt)}</td>
                          <td>{formatDateTime(user.createdAt)}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button type="button" className={historyStyles.toggleBtn} onClick={() => toggleActivity(user)}>
                                {isActivityOpen ? 'Hide activity' : 'View activity'}
                              </button>
                              {canManage && (
                                <>
                                  <button type="button" className={historyStyles.button} onClick={() => startEdit(user)}>Edit</button>
                                  <button type="button" className={historyStyles.button} onClick={() => resetPassword(user)}>Reset Password</button>
                                  <button type="button" className={historyStyles.button} onClick={() => toggleStatus(user)}>
                                    {user.status === 'active' ? 'Deactivate' : 'Activate'}
                                  </button>
                                </>
                              )}
                              {isSuperadmin && (
                                <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(user)}>Delete</button>
                              )}
                            </div>
                            {rowError[user.id] && <div className={historyStyles.loginError}>{rowError[user.id]}</div>}
                          </td>
                        </>
                      )}
                    </tr>
                    {isActivityOpen && (
                      <tr className={historyStyles.detailsRow}>
                        <td colSpan={12}>
                          {activityLoading && !userActivity ? (
                            'Loading activity...'
                          ) : userActivity ? (
                            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
                              <div><strong>{userActivity.projects.total}</strong> Projects</div>
                              <div><strong>{userActivity.siteVisits.total}</strong> Site Visits</div>
                              <div><strong>{userActivity.quotations.total}</strong> Quotations</div>
                              <div><strong>{userActivity.demoRequests.total}</strong> Demo Requests</div>
                              <div style={{ flexBasis: '100%' }}>
                                <strong>Recent logins:</strong>{' '}
                                {userActivity.loginHistory.length === 0
                                  ? 'None recorded yet.'
                                  : userActivity.loginHistory
                                      .slice(0, 5)
                                      .map((h) => `${formatDateTime(h.at)}${h.success ? '' : ' (failed)'}`)
                                      .join('  •  ')}
                              </div>
                            </div>
                          ) : (
                            'Could not load activity.'
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
