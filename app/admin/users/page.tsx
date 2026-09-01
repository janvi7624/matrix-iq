'use client';

import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChevronDown, MoreVertical, Plus, Upload } from 'lucide-react';
import { DepartmentRecord, PublicUser, RoleRecord, UserRole } from '@/lib/types';
import AppShell from '@/components/AppShell';
import EmployeeDirectory, { type UserActivity } from '@/components/EmployeeDirectory';
import EmployeeEditDialog, { type EmployeeEditPayload } from '@/components/ui/EmployeeEditDialog';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import PhoneInput from '@/components/ui/PhoneInput';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { usePrompt } from '@/components/ui/PromptDialog';
import pageStyles from './usersPage.module.css';

interface RowMenuAction {
  label: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
}

// Renders the "⋮" trigger inline, but the panel itself through a portal to
// document.body, fixed-positioned from the trigger's own bounding rect.
// Necessary because the table sits inside a horizontally-scrolling wrapper
// (overflow-x:auto) — per the CSS spec, setting overflow-x alone silently
// turns overflow-y into auto too, so a plain position:absolute panel would get
// clipped for any row near the bottom of the visible table area.
function RowActionsMenu({ actions, label }: { actions: RowMenuAction[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRectRef = useRef<{ top: number; bottom: number } | null>(null);
  const PANEL_WIDTH = 210;

  // Flip the panel above the trigger instead of below it when there isn't
  // enough room beneath — otherwise a row near the bottom of a long table
  // (e.g. the last employee) opens a menu that's partly or fully below the
  // viewport, and since scrolling the page closes the menu (see the close
  // handler below), there'd be no way to actually reach it. Runs after the
  // panel is in the DOM (so its real height is measurable) but before paint,
  // so the user never sees the below-viewport position flash first.
  useLayoutEffect(() => {
    if (!open || !panelRef.current || !triggerRectRef.current) return;
    const panelHeight = panelRef.current.getBoundingClientRect().height;
    const trigger = triggerRectRef.current;
    const fitsBelow = trigger.bottom + 4 + panelHeight <= window.innerHeight - 8;
    if (!fitsBelow) {
      const flippedTop = Math.max(8, trigger.top - panelHeight - 4);
      setCoords((prev) => (prev ? { ...prev, top: flippedTop } : prev));
    }
  }, [open]);

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
    // Escape closes the menu and returns focus to its trigger — without this a
    // keyboard user who opened the menu had no way to dismiss it.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  function toggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      triggerRectRef.current = { top: rect.top, bottom: rect.bottom };
      setCoords({ top: rect.bottom + 4, left: Math.max(8, rect.right - PANEL_WIDTH) });
    }
    setOpen((v) => !v);
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={historyStyles.rowMenuTrigger}
        onClick={toggle}
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreVertical size={18} />
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            className={`${historyStyles.notifPanel} ${historyStyles.rowMenuPanel} ${pageStyles.menuPanel}`}
            style={{ top: coords.top, left: coords.left, width: PANEL_WIDTH }}
            role="menu"
            aria-label={`Actions for ${label}`}
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

export default function ManageUsersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const promptText = usePrompt();
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // The create form is collapsed by default. Looking someone up is the common
  // task on this page and used to mean scrolling past a nine-field form to
  // reach the directory; creating an account is the occasional one.
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<NewUserForm>(BLANK_FORM);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editingUser, setEditingUser] = useState<PublicUser | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [resendingIds, setResendingIds] = useState<Record<string, boolean>>({});
  const [activityOpenId, setActivityOpenId] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, UserActivity>>({});
  const [activityLoadingId, setActivityLoadingId] = useState<string | null>(null);

  // No setState before the first await — `loading` already starts true, so the
  // mount effect below doesn't need to set it, and doing so synchronously
  // inside an effect is what triggers a cascading re-render.
  const loadUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/users');
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const data: PublicUser[] = await response.json();
      setUsers(data);
      setLoadError('');
    } catch {
      setLoadError('Could not load the employee list. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // The retry path does need the spinner back, since ErrorState has replaced
  // the list by then.
  const retryLoadUsers = useCallback(() => {
    setLoading(true);
    setLoadError('');
    loadUsers();
  }, [loadUsers]);

  const loadDepartments = useCallback(async () => {
    await fetch('/api/departments')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: DepartmentRecord[]) => setDepartments(data))
      .catch(() => setDepartments([]));
  }, []);

  useEffect(() => {
    // Fetching on mount is the intended use of an effect. The rule can't see
    // that loadUsers() has no synchronous prefix — every setState in it sits
    // after `await fetch(...)` — so it flags the call site anyway.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [loadUsers, loadDepartments]);

  const isSuperadmin = currentRole === 'superadmin';
  const isAdminTier = isSuperadmin || currentRole === 'admin';

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
      setAddOpen(false);
      toast.success(`Account created for ${form.name || form.username}.`);
      await loadUsers();
    } catch {
      setCreateError('Could not reach the server.');
    } finally {
      setCreateBusy(false);
    }
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
  // toggled from the edit dialog, including handling a department change:
  // dropping the manager relationship from the old department (if any) and
  // adding it to the new one when the checkbox is checked.
  async function syncDepartmentManager(userId: string, previousDepartmentName: string, next: EmployeeEditPayload) {
    const oldDept = departments.find((d) => d.name === previousDepartmentName);
    const newDept = departments.find((d) => d.name === next.department);

    if (oldDept && oldDept.id !== newDept?.id && oldDept.managerIds.includes(userId)) {
      await fetch(`/api/admin/departments/${oldDept.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerIds: oldDept.managerIds.filter((mid) => mid !== userId) })
      }).catch(() => null);
    }

    if (!newDept) return;
    const isManagerNow = newDept.managerIds.includes(userId);
    if (next.isDepartmentManager === isManagerNow) return;
    const nextManagerIds = next.isDepartmentManager ? [...newDept.managerIds, userId] : newDept.managerIds.filter((mid) => mid !== userId);
    await fetch(`/api/admin/departments/${newDept.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerIds: nextManagerIds })
    }).catch(() => null);
  }

  async function handleSaveEdit(next: EmployeeEditPayload) {
    if (!editingUser) return;
    setEditError('');
    setSavingEdit(true);
    try {
      const payload: Record<string, unknown> = {
        name: next.name,
        phone: next.phone,
        email: next.email,
        role: next.role,
        employeeId: next.employeeId,
        department: next.department,
        designation: next.designation
      };
      if (next.password) payload.password = next.password;

      const response = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setEditError(body?.error || 'Could not save changes.');
        return;
      }
      await syncDepartmentManager(editingUser.id, editingUser.department || '', next);
      await Promise.all([loadUsers(), loadDepartments()]);
      toast.success(`Saved changes to ${next.name || editingUser.username}.`);
      setEditingUser(null);
    } catch {
      setEditError('Could not reach the server.');
    } finally {
      setSavingEdit(false);
    }
  }

  async function toggleStatus(user: PublicUser) {
    const next = user.status === 'active' ? 'inactive' : 'active';
    if (next === 'inactive') {
      const ok = await confirm({
        title: 'Deactivate this employee?',
        message: `“${user.name || user.username}” will no longer be able to log in. Their records stay intact and you can reactivate them at any time.`,
        confirmLabel: 'Deactivate',
        danger: true
      });
      if (!ok) return;
    }
    const ok = await patchUser(user.id, { status: next });
    if (ok) toast.success(`${user.name || user.username} is now ${next}.`);
  }

  async function handleBulkStatus(selected: PublicUser[], next: PublicUser['status']) {
    if (selected.length === 0) return;
    const verb = next === 'active' ? 'Activate' : 'Deactivate';
    const ok = await confirm({
      title: `${verb} ${selected.length} employee${selected.length === 1 ? '' : 's'}?`,
      message:
        next === 'inactive'
          ? `${selected.length} account${selected.length === 1 ? '' : 's'} will no longer be able to log in. Their records stay intact.`
          : `${selected.length} account${selected.length === 1 ? '' : 's'} will be able to log in again.`,
      confirmLabel: verb,
      danger: next === 'inactive'
    });
    if (!ok) return;

    // Sequential rather than Promise.all — these are writes against the same
    // table and a burst of parallel PATCHes on a large selection is a good way
    // to get partial failures that are hard to report on.
    let failed = 0;
    for (const user of selected) {
      try {
        const response = await fetch(`/api/admin/users/${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next })
        });
        if (!response.ok) failed++;
      } catch {
        failed++;
      }
    }
    await loadUsers();
    const succeeded = selected.length - failed;
    if (failed === 0) {
      toast.success(`${succeeded} employee${succeeded === 1 ? '' : 's'} ${next === 'active' ? 'activated' : 'deactivated'}.`);
    } else if (succeeded === 0) {
      toast.error(`Could not update any of the ${selected.length} selected employees.`);
    } else {
      toast.error(`${succeeded} updated, ${failed} failed. Refresh to see the current state.`);
    }
  }

  async function resetPassword(user: PublicUser) {
    const next = await promptText({
      title: `New password for “${user.name || user.username}”`,
      message: 'Minimum 6 characters. Share it with them securely and ask them to change it after logging in.',
      type: 'password',
      confirmLabel: 'Set password',
      validate: (v) => (v.length < 6 ? 'Password must be at least 6 characters.' : null)
    });
    if (!next) return;
    const ok = await patchUser(user.id, { password: next });
    if (ok) toast.success(`Password reset for ${user.name || user.username}.`);
  }

  async function resendWelcomeEmail(user: PublicUser) {
    if (!user.email) {
      toast.error('This employee has no email address on file — add one first.');
      return;
    }
    // The endpoint awaits the actual send (can take a few seconds), so without
    // this guard a second click while the first request is still in flight
    // would silently issue and email a second temp password, orphaning the
    // first one.
    if (resendingIds[user.id]) return;
    const ok = await confirm({
      title: 'Resend welcome email?',
      message: `A new temporary password will be generated for “${user.name || user.username}” and emailed to ${user.email}. Their current password will stop working.`,
      confirmLabel: 'Send'
    });
    if (!ok) return;
    setRowError((prev) => ({ ...prev, [user.id]: '' }));
    setResendingIds((prev) => ({ ...prev, [user.id]: true }));
    try {
      const response = await fetch(`/api/admin/users/${user.id}/resend-welcome-email`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setRowError((prev) => ({ ...prev, [user.id]: body?.error || 'Could not resend the welcome email.' }));
        return;
      }
      toast.success(`New login details emailed to ${user.email}.`);
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
    const ok = await confirm({
      title: 'Delete this employee?',
      message: `“${user.name || user.username}” (@${user.username}) will be permanently removed. This cannot be undone — deactivate them instead if you only need to revoke access.`,
      confirmLabel: 'Delete permanently',
      danger: true
    });
    if (!ok) return;
    const response = await fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      toast.error(body?.error || 'Could not delete user.');
      return;
    }
    toast.success(`${user.name || user.username} was deleted.`);
    await loadUsers();
  }

  async function toggleActivity(user: PublicUser) {
    if (activityOpenId === user.id) {
      setActivityOpenId(null);
      return;
    }
    setActivityOpenId(user.id);
    if (activity[user.id]) return;
    setActivityLoadingId(user.id);
    try {
      const response = await fetch(`/api/admin/users/${user.id}/activity`);
      if (response.ok) {
        const data: UserActivity = await response.json();
        setActivity((prev) => ({ ...prev, [user.id]: data }));
      }
    } finally {
      setActivityLoadingId(null);
    }
  }

  function renderRowMenu(user: PublicUser) {
    const canManage = isSuperadmin || user.role !== 'superadmin';
    const isActivityOpen = activityOpenId === user.id;
    return (
      <RowActionsMenu
        label={user.name || user.username}
        actions={[
          { label: 'View profile', href: `/admin/users/${user.id}` },
          { label: isActivityOpen ? 'Hide activity' : 'View activity', onClick: () => toggleActivity(user) },
          ...(canManage
            ? [
                { label: 'Edit details', onClick: () => { setEditError(''); setEditingUser(user); } },
                { label: 'Reset password', onClick: () => resetPassword(user) },
                { label: 'Resend welcome email', onClick: () => resendWelcomeEmail(user) },
                { label: user.status === 'active' ? 'Deactivate' : 'Activate', onClick: () => toggleStatus(user) }
              ]
            : []),
          ...(isSuperadmin ? [{ label: 'Delete employee', onClick: () => handleDelete(user), danger: true }] : [])
        ]}
      />
    );
  }

  return (
    <AppShell title="Employee Directory" subtitle="Administration › find, manage and onboard login accounts.">
      {/* Page actions sit above everything so the two ways to add people are
          adjacent and discoverable, instead of one being a link at the top and
          the other the submit button of an always-expanded form. */}
      {isAdminTier && (
        <div className={pageStyles.pageActionsRow}>
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={() => setAddOpen((v) => !v)}
            aria-expanded={addOpen}
            aria-controls="addEmployeePanel"
          >
            Add employee
          </Button>
          <Link className={historyStyles.button} href="/admin/users/import">
            <Upload size={15} className={pageStyles.iconMr7} /> Import from Excel
          </Link>
        </div>
      )}

      {addOpen && (
        <form id="addEmployeePanel" className={`${calcStyles.sectionPanel} ${pageStyles.addFormPanel}`} onSubmit={handleCreate}>
          <div className={pageStyles.addFormHeader}>
            <ChevronDown size={16} />
            <strong className={pageStyles.addFormTitle}>New employee account</strong>
          </div>
          {createError && <div className={historyStyles.loginError}>{createError}</div>}
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newName">Full name</label>
              <input id="newName" className={calcStyles.formControl} type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newEmployeeId">Employee ID (optional)</label>
              <input id="newEmployeeId" className={calcStyles.formControl} type="text" value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newUsername">Username</label>
              <input id="newUsername" className={calcStyles.formControl} type="text" autoComplete="off" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newPassword">Password</label>
              <input id="newPassword" className={calcStyles.formControl} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} minLength={6} required />
              <span className={calcStyles.lockedHint}>Minimum 6 characters.</span>
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newEmail">Email</label>
              <input id="newEmail" className={calcStyles.formControl} type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newPhone">Phone</label>
              <PhoneInput id="newPhone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newDepartment">Department</label>
              <select id="newDepartment" className={calcStyles.formControl} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}>
                <option value="">Select department…</option>
                {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newDesignation">Designation</label>
              <input id="newDesignation" className={calcStyles.formControl} type="text" placeholder="e.g. Sales Executive" value={form.designation} onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="newRole">Role</label>
              <select id="newRole" className={calcStyles.formControl} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as UserRole }))}>
                {roles
                  .filter((r) => r.key !== 'superadmin' || isSuperadmin)
                  .map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
          </div>
          <div className={pageStyles.formActionsRowMt4}>
            <Button type="submit" variant="primary" loading={createBusy} loadingLabel="Adding…">Add employee</Button>
            <Button variant="ghost" onClick={() => { setAddOpen(false); setCreateError(''); }}>Cancel</Button>
          </div>
        </form>
      )}

      <EmployeeDirectory
        users={users}
        roles={roles}
        departments={departments}
        loading={loading}
        loadError={loadError}
        onRetry={retryLoadUsers}
        onBulkStatus={handleBulkStatus}
        rowError={rowError}
        resendingIds={resendingIds}
        activity={activity}
        activityLoadingId={activityLoadingId}
        activityOpenId={activityOpenId}
        renderRowMenu={renderRowMenu}
      />

      {editingUser && (
        <EmployeeEditDialog
          user={editingUser}
          roles={roles}
          departments={departments}
          includeSuperadmin={isSuperadmin}
          error={editError}
          saving={savingEdit}
          onSave={handleSaveEdit}
          onClose={() => { setEditingUser(null); setEditError(''); }}
        />
      )}
    </AppShell>
  );
}
