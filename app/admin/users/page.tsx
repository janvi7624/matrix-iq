'use client';

import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import Image from 'next/image';
import { MoreVertical } from 'lucide-react';
import { DepartmentRecord, PublicUser, RoleRecord, UserRole } from '@/lib/types';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import { BRAND } from '@/lib/branding';
import PhoneInput from '@/components/ui/PhoneInput';

interface RowMenuAction {
  label: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
}

// Renders the "⋮" trigger inline, but the panel itself through a portal to
// document.body, fixed-positioned from the trigger's own bounding rect.
// Necessary because the table sits inside a horizontally-scrolling wrapper
// (historyStyles.tableWrap, overflow-x:auto) — per the CSS spec, setting
// overflow-x alone silently turns overflow-y into auto too, so a plain
// position:absolute panel would get clipped for any row near the bottom of
// the visible table area.
function RowActionsMenu({ actions }: { actions: RowMenuAction[] }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const PANEL_WIDTH = 200;

  useEffect(() => {
    if (!open) return;
    function close(e: Event) {
      if (e.type === 'scroll') {
        setOpen(false);
        return;
      }
      const target = (e as MouseEvent).target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  function toggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({ top: rect.bottom + 4, left: Math.max(8, rect.right - PANEL_WIDTH) });
    }
    setOpen((v) => !v);
  }

  return (
    <>
      <button type="button" ref={triggerRef} className={historyStyles.rowMenuTrigger} onClick={toggle} aria-label="Row actions" aria-haspopup="menu" aria-expanded={open}>
        <MoreVertical size={18} />
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            className={`${historyStyles.notifPanel} ${historyStyles.rowMenuPanel}`}
            style={{ position: 'fixed', top: coords.top, left: coords.left, width: PANEL_WIDTH, zIndex: 1000 }}
            role="menu"
          >
            {actions.map((action, i) =>
              action.href ? (
                <Link key={i} href={action.href} className={historyStyles.rowMenuItem} onClick={() => setOpen(false)} role="menuitem">
                  {action.label}
                </Link>
              ) : (
                <button
                  key={i}
                  type="button"
                  className={`${historyStyles.rowMenuItem} ${action.danger ? historyStyles.rowMenuItemDanger : ''}`}
                  onClick={() => {
                    setOpen(false);
                    action.onClick?.();
                  }}
                  role="menuitem"
                >
                  {action.label}
                </button>
              )
            )}
          </div>,
          document.body
        )}
    </>
  );
}

const PAGE_SIZE = 20;

// Known system roles keep their dedicated pill colors; any admin-created role
// falls back to a neutral pill so a brand-new role never breaks this lookup.
const KNOWN_ROLE_PILL_CLASS: Record<string, string> = {
  superadmin: historyStyles.rolePillSuperadmin,
  admin: historyStyles.rolePillAdmin,
  manager: historyStyles.rolePillManager,
  engineer: historyStyles.rolePillTechnical,
  backoffice: historyStyles.rolePillBackoffice,
  user: historyStyles.rolePillUser,
  marketing: historyStyles.rolePillMarketing,
  accounts: historyStyles.rolePillAccounts,
  hr: historyStyles.rolePillHr
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
  isDepartmentManager: boolean;
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
  const [resendingIds, setResendingIds] = useState<Record<string, boolean>>({});
  const [activityOpenId, setActivityOpenId] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, UserActivity>>({});
  const [activityLoading, setActivityLoading] = useState(false);

  // Employee Directory — search/filters/pagination over the same user list
  // the add-user form already loads, same client-side pattern as LeadsView.
  const [q, setQ] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | PublicUser['status']>('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [page, setPage] = useState(1);

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

  async function loadDepartments() {
    await fetch('/api/departments')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: DepartmentRecord[]) => setDepartments(data))
      .catch(() => setDepartments([]));
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
    loadDepartments();
  }, []);

  const isSuperadmin = currentRole === 'superadmin';
  const isAdminTier = isSuperadmin || currentRole === 'admin';

  const designations = useMemo(
    () => [...new Set(users.map((u) => u.designation).filter(Boolean))].sort(),
    [users]
  );

  const visibleUsers = useMemo(() => {
    let rows = users;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((u) => `${u.name} ${u.employeeId} ${u.email} ${u.username}`.toLowerCase().includes(needle));
    }
    if (departmentFilter) rows = rows.filter((u) => u.department === departmentFilter);
    if (roleFilter) rows = rows.filter((u) => u.role === roleFilter);
    if (statusFilter) rows = rows.filter((u) => u.status === statusFilter);
    if (designationFilter) rows = rows.filter((u) => u.designation === designationFilter);
    return rows;
  }, [users, q, departmentFilter, roleFilter, statusFilter, designationFilter]);

  const totalPages = Math.max(1, Math.ceil(visibleUsers.length / PAGE_SIZE));
  const pageRows = visibleUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [q, departmentFilter, roleFilter, statusFilter, designationFilter]);

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
    const dept = departments.find((d) => d.name === user.department);
    setEditState({
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      employeeId: user.employeeId || '',
      department: user.department || '',
      designation: user.designation || '',
      password: '',
      isDepartmentManager: dept ? dept.managerIds.includes(user.id) : false
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

  // Department.managerIds stays the single source of truth (see
  // /admin/departments) — this just keeps it in sync when the checkbox is
  // toggled from the user's own edit row, including handling a department
  // change: dropping the manager relationship from the old department (if
  // any) and adding it to the new one when the checkbox is checked.
  async function syncDepartmentManager(userId: string, previousDepartmentName: string) {
    if (!editState) return;
    const oldDept = departments.find((d) => d.name === previousDepartmentName);
    const newDept = departments.find((d) => d.name === editState.department);

    if (oldDept && oldDept.id !== newDept?.id && oldDept.managerIds.includes(userId)) {
      await fetch(`/api/admin/departments/${oldDept.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerIds: oldDept.managerIds.filter((mid) => mid !== userId) })
      }).catch(() => null);
    }

    if (!newDept) return;
    const isManagerNow = newDept.managerIds.includes(userId);
    if (editState.isDepartmentManager === isManagerNow) return;
    const nextManagerIds = editState.isDepartmentManager ? [...newDept.managerIds, userId] : newDept.managerIds.filter((mid) => mid !== userId);
    await fetch(`/api/admin/departments/${newDept.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerIds: nextManagerIds })
    }).catch(() => null);
  }

  async function saveEdit(id: string, previousDepartmentName: string) {
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
      await syncDepartmentManager(id, previousDepartmentName);
      await loadDepartments();
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

  async function resendWelcomeEmail(user: PublicUser) {
    if (!user.email) {
      alert('This user has no email address on file — add one first.');
      return;
    }
    // The endpoint now awaits the actual send (can take a few seconds), so
    // without this guard a second click while the first request is still in
    // flight would silently issue and email a second temp password,
    // orphaning the first one.
    if (resendingIds[user.id]) return;
    if (!window.confirm(`Generate a new temporary password for "${user.username}" and email it to ${user.email}?`)) return;
    setRowError((prev) => ({ ...prev, [user.id]: '' }));
    setResendingIds((prev) => ({ ...prev, [user.id]: true }));
    try {
      const response = await fetch(`/api/admin/users/${user.id}/resend-welcome-email`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRowError((prev) => ({ ...prev, [user.id]: body?.error || 'Could not resend the welcome email.' }));
        return;
      }
      alert(`New login details emailed to ${user.email}.`);
    } catch {
      setRowError((prev) => ({ ...prev, [user.id]: 'Could not reach the server.' }));
    } finally {
      setResendingIds((prev) => {
        const next = { ...prev };
        delete next[user.id];
        return next;
      });
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isAdminTier && (
            <Link className={`${historyStyles.button} ${historyStyles.primary}`} href="/admin/users/import">
              Import Employees
            </Link>
          )}
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
              <PhoneInput id="newPhone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
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

        <h2 className={calcStyles.h2}>Employee Directory</h2>
        <div className={historyStyles.status}>{status}</div>
        <div className={historyStyles.toolbar}>
          <input
            type="text"
            placeholder="Search name, employee ID, email, or username..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | PublicUser['status'])}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={designationFilter} onChange={(e) => setDesignationFilter(e.target.value)}>
            <option value="">All designations</option>
            {designations.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
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
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24, color: '#9ca3af' }}>
                  {users.length === 0 ? 'No users yet.' : 'No employees match your filters.'}
                </td></tr>
              )}
              {pageRows.map((user) => {
                const isEditing = editingId === user.id;
                const canManage = isSuperadmin || user.role !== 'superadmin';
                const isActivityOpen = activityOpenId === user.id;
                const userActivity = activity[user.id];
                return (
                  <Fragment key={user.id}>
                    <tr>
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
                            <PhoneInput value={editState.phone} onChange={(v) => setEditState({ ...editState, phone: v })} />
                          </td>
                          <td>
                            <select className={calcStyles.formControl} value={editState.department} onChange={(e) => setEditState({ ...editState, department: e.target.value })}>
                              <option value="">Select department...</option>
                              {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                            </select>
                            {editState.department && (
                              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginTop: 4 }}>
                                <input
                                  type="checkbox"
                                  checked={editState.isDepartmentManager}
                                  onChange={(e) => setEditState({ ...editState, isDepartmentManager: e.target.checked })}
                                />
                                Manager of {editState.department}
                              </label>
                            )}
                          </td>
                          <td>
                            <input className={calcStyles.formControl} value={editState.designation} onChange={(e) => setEditState({ ...editState, designation: e.target.value })} />
                          </td>
                          <td>
                            <select className={calcStyles.formControl} value={editState.role} onChange={(e) => setEditState({ ...editState, role: e.target.value as UserRole })}>
                              <RoleOptions roles={roles} includeSuperadmin={isSuperadmin} />
                            </select>
                          </td>
                          <td>
                            <input className={calcStyles.formControl} type="password" placeholder="New password (optional)" value={editState.password} onChange={(e) => setEditState({ ...editState, password: e.target.value })} />
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={() => saveEdit(user.id, user.department || '')}>Save</button>
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
                          <td>
                            {user.department || '-'}
                            {departments.find((d) => d.name === user.department)?.managerIds.includes(user.id) && (
                              <span style={{ marginLeft: 6, fontSize: 10.5, opacity: 0.7 }}>(Manager)</span>
                            )}
                          </td>
                          <td>{user.designation || '-'}</td>
                          <td><RolePill role={user.role} roles={roles} /></td>
                          <td><StatusPill status={user.status} /></td>
                          <td>
                            <RowActionsMenu
                              actions={[
                                { label: 'View Profile', href: `/admin/users/${user.id}` },
                                { label: isActivityOpen ? 'Hide activity' : 'View activity', onClick: () => toggleActivity(user) },
                                ...(canManage
                                  ? [
                                      { label: 'Edit', onClick: () => startEdit(user) },
                                      { label: 'Reset Password', onClick: () => resetPassword(user) },
                                      { label: 'Resend Welcome Email', onClick: () => resendWelcomeEmail(user) },
                                      { label: user.status === 'active' ? 'Deactivate' : 'Activate', onClick: () => toggleStatus(user) }
                                    ]
                                  : []),
                                ...(isSuperadmin ? [{ label: 'Delete', onClick: () => handleDelete(user), danger: true }] : [])
                              ]}
                            />
                            {resendingIds[user.id] && <div style={{ fontSize: 11.5, opacity: 0.7, marginTop: 4 }}>Sending welcome email…</div>}
                            {rowError[user.id] && <div className={historyStyles.loginError}>{rowError[user.id]}</div>}
                          </td>
                        </>
                      )}
                    </tr>
                    {isActivityOpen && (
                      <tr className={historyStyles.detailsRow}>
                        <td colSpan={10}>
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
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', marginTop: 14 }}>
            <button type="button" className={historyStyles.button} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
            <span className={calcStyles.small}>Page {page} of {totalPages}</span>
            <button type="button" className={historyStyles.button} disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
          </div>
        )}
      </main>
    </div>
  );
}
