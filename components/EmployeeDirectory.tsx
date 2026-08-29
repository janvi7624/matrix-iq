'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, ChevronsUpDown, Download, Search, Users, X } from 'lucide-react';
import { DepartmentRecord, PublicUser, RoleRecord, UserRole } from '@/lib/types';
import { toCsv } from '@/lib/csv';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import Button from './ui/Button';
import historyStyles from './quotationHistory.module.css';
import styles from './employeeDirectory.module.css';

export interface UserActivityItem { id: string; label: string; status: string; at: string; }
export interface UserActivitySection { total: number; recent: UserActivityItem[]; }
export interface LoginHistoryEntry { id: string; at: string; success: boolean; ip: string; }
export interface UserActivity {
  projects: UserActivitySection;
  siteVisits: UserActivitySection;
  quotations: UserActivitySection;
  demoRequests: UserActivitySection;
  loginHistory: LoginHistoryEntry[];
}

type SortKey = 'name' | 'employeeId' | 'department' | 'designation' | 'role' | 'status';
type SortDir = 'asc' | 'desc';
type StatusFilter = '' | PublicUser['status'] | 'pending';

interface EmployeeDirectoryProps {
  users: PublicUser[];
  roles: RoleRecord[];
  departments: DepartmentRecord[];
  loading: boolean;
  loadError: string;
  onRetry: () => void;
  /** Applies a status change to every selected employee at once. */
  onBulkStatus: (users: PublicUser[], next: PublicUser['status']) => Promise<void>;
  rowError: Record<string, string>;
  resendingIds: Record<string, boolean>;
  activity: Record<string, UserActivity>;
  activityLoadingId: string | null;
  activityOpenId: string | null;
  /** The per-row "⋮" menu. Owned by the caller because which actions a viewer
      may take (edit / reset password / delete) is a permission question the
      page already resolves, not a presentational one. */
  renderRowMenu: (user: PublicUser) => React.ReactNode;
}

const PAGE_SIZE_OPTIONS = [20, 50, 100];

// Known system roles keep their dedicated pill colours; an admin-created role
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
  const label = roles.find((r) => r.key === role)?.label || role;
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

function initialsOf(name: string, fallback: string): string {
  const source = (name || fallback || '').trim();
  if (!source) return '?';
  return source.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

// One shared date shape for the directory — the page previously called
// toLocaleString('en-IN') with no options, which renders a long
// "29/8/2026, 4:32:07 pm" string in a space-constrained cell.
function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function EmployeeDirectory({
  users,
  roles,
  departments,
  loading,
  loadError,
  onRetry,
  onBulkStatus,
  rowError,
  resendingIds,
  activity,
  activityLoadingId,
  activityOpenId,
  renderRowMenu
}: EmployeeDirectoryProps) {
  const [q, setQ] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[0]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const designations = useMemo(
    () => [...new Set(users.map((u) => u.designation).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [users]
  );

  // Who manages what, resolved once instead of a departments.find() per row
  // per render (the old version did that inside the table body).
  const managerUserIds = useMemo(() => {
    const set = new Set<string>();
    departments.forEach((d) => d.managerIds.forEach((id) => set.add(id)));
    return set;
  }, [departments]);

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.status === 'active').length,
    inactive: users.filter((u) => u.status !== 'active').length,
    pending: users.filter((u) => u.mustChangePassword).length
  }), [users]);

  const filtered = useMemo(() => {
    let rows = users;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((u) =>
        `${u.name} ${u.employeeId} ${u.email} ${u.username} ${u.designation} ${u.department}`.toLowerCase().includes(needle)
      );
    }
    if (departmentFilter) rows = rows.filter((u) => u.department === departmentFilter);
    if (roleFilter) rows = rows.filter((u) => u.role === roleFilter);
    if (statusFilter === 'pending') rows = rows.filter((u) => u.mustChangePassword);
    else if (statusFilter) rows = rows.filter((u) => u.status === statusFilter);
    if (designationFilter) rows = rows.filter((u) => u.designation === designationFilter);
    return rows;
  }, [users, q, departmentFilter, roleFilter, statusFilter, designationFilter]);

  const sorted = useMemo(() => {
    const roleLabel = (key: string) => roles.find((r) => r.key === key)?.label || key;
    const valueOf = (u: PublicUser): string => {
      switch (sortKey) {
        case 'employeeId': return u.employeeId || '';
        case 'department': return u.department || '';
        case 'designation': return u.designation || '';
        case 'role': return roleLabel(u.role);
        case 'status': return u.status;
        default: return u.name || u.username || '';
      }
    };
    // Blanks always sort last regardless of direction — a column of "—" at the
    // top is never what someone sorting by Employee ID is looking for.
    return [...filtered].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir, roles]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const pageRows = sorted.slice(startIndex, startIndex + pageSize);

  // Page resets live in the event handlers that change a filter, not in an
  // effect watching them — an effect here would render one frame of "page 4 of
  // 1" before correcting itself (and trips react-hooks/set-state-in-effect).
  // Nothing prunes `selectedIds` when the filter set changes either: every
  // consumer below derives from `selectedUsers`, which is already the
  // intersection with the visible rows, so a stale id simply stops counting.
  // Every filter change also returns to page 1 — landing on page 4 of a
  // newly-narrowed 1-page list reads as "no results".
  const changeSearch = (value: string) => { setQ(value); setPage(1); };
  const changeDepartment = (value: string) => { setDepartmentFilter(value); setPage(1); };
  const changeRole = (value: string) => { setRoleFilter(value); setPage(1); };
  const changeStatus = (value: StatusFilter) => { setStatusFilter(value); setPage(1); };
  const changeDesignation = (value: string) => { setDesignationFilter(value); setPage(1); };
  const changePageSize = (value: number) => { setPageSize(value); setPage(1); };

  const activeFilters = [
    departmentFilter && { key: 'department', label: 'Department', value: departmentFilter, clear: () => changeDepartment('') },
    roleFilter && { key: 'role', label: 'Role', value: roles.find((r) => r.key === roleFilter)?.label || roleFilter, clear: () => changeRole('') },
    statusFilter && {
      key: 'status',
      label: 'Status',
      value: statusFilter === 'pending' ? 'Pending first login' : statusFilter === 'active' ? 'Active' : 'Inactive',
      clear: () => changeStatus('')
    },
    designationFilter && { key: 'designation', label: 'Designation', value: designationFilter, clear: () => changeDesignation('') },
    q.trim() && { key: 'q', label: 'Search', value: q.trim(), clear: () => changeSearch('') }
  ].filter(Boolean) as { key: string; label: string; value: string; clear: () => void }[];

  function clearAllFilters() {
    setQ('');
    setDepartmentFilter('');
    setRoleFilter('');
    setStatusFilter('');
    setDesignationFilter('');
    setPage(1);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const selectedUsers = useMemo(() => sorted.filter((u) => selectedIds.has(u.id)), [sorted, selectedIds]);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((u) => selectedIds.has(u.id));

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePageSelection() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((u) => next.delete(u.id));
      else pageRows.forEach((u) => next.add(u.id));
      return next;
    });
  }

  async function runBulk(next: PublicUser['status']) {
    setBulkBusy(true);
    try {
      await onBulkStatus(selectedUsers, next);
      setSelectedIds(new Set());
    } finally {
      setBulkBusy(false);
    }
  }

  // Exports exactly what the user is currently looking at (all filters and the
  // current sort applied, not just the visible page) — the whole point is to
  // hand off a narrowed list.
  function exportCsv() {
    const headers = ['Employee ID', 'Name', 'Username', 'Email', 'Phone', 'Department', 'Designation', 'Role', 'Status', 'Location', 'Date of Joining', 'Last Login'];
    const rows = sorted.map((u) => [
      u.employeeId || '',
      u.name || '',
      u.username || '',
      u.email || '',
      u.phone || '',
      u.department || '',
      u.designation || '',
      roles.find((r) => r.key === u.role)?.label || u.role,
      u.status,
      u.location || '',
      u.dateOfJoining || '',
      u.lastLoginAt || ''
    ]);
    const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `employee-directory-${sorted.length}-rows.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Column order, declared once so the <thead> can't drift out of step with
  // the <td>s in the body. `sort: null` is a presentational-only column.
  // Nine entries total, matching the colSpan on the activity row below.
  const COLUMNS: { label: string; sort: SortKey | null }[] = [
    { label: 'Employee', sort: 'name' },
    { label: 'Emp. ID', sort: 'employeeId' },
    { label: 'Contact', sort: null },
    { label: 'Department', sort: 'department' },
    { label: 'Designation', sort: 'designation' },
    { label: 'Role', sort: 'role' },
    { label: 'Status', sort: 'status' }
  ];
  const COLUMN_COUNT = COLUMNS.length + 2; // + the checkbox and actions columns

  function SortHeader({ column }: { column: { label: string; sort: SortKey | null } }) {
    if (!column.sort) return <th>{column.label}</th>;
    const key = column.sort;
    const active = sortKey === key;
    const Icon = !active ? ChevronsUpDown : sortDir === 'asc' ? ChevronUp : ChevronDown;
    return (
      <th aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={styles.sortBtn} onClick={() => toggleSort(key)}>
          {column.label}
          <span className={`${styles.sortIcon} ${active ? styles.sortIconActive : ''}`}><Icon size={13} /></span>
        </button>
      </th>
    );
  }

  function ActivityPanel({ user }: { user: PublicUser }) {
    const data = activity[user.id];
    if (activityLoadingId === user.id && !data) return <SkeletonRows rows={2} columns={4} />;
    if (!data) return <div className={styles.muted}>Could not load activity for this employee.</div>;
    const sections = [
      { label: 'Projects', value: data.projects.total },
      { label: 'Site Visits', value: data.siteVisits.total },
      { label: 'Quotations', value: data.quotations.total },
      { label: 'Demo Requests', value: data.demoRequests.total }
    ];
    return (
      <div className={styles.activityGrid}>
        {sections.map((s) => (
          <div key={s.label} className={styles.activityStat}>
            <div className={styles.activityStatValue}>{s.value}</div>
            <div className={styles.activityStatLabel}>{s.label}</div>
          </div>
        ))}
        <div className={styles.activityLogins}>
          <strong>Recent logins:</strong>{' '}
          {data.loginHistory.length === 0 ? (
            'None recorded yet.'
          ) : (
            data.loginHistory.slice(0, 5).map((h, i) => (
              <Fragment key={h.id}>
                {i > 0 && '  •  '}
                <span className={h.success ? styles.loginOk : styles.loginFail}>
                  {formatDateTime(h.at)}{h.success ? '' : ' (failed)'}
                </span>
              </Fragment>
            ))
          )}
        </div>
      </div>
    );
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={onRetry} />;
  }

  return (
    <>
      {/* Summary strip — also the fastest way to answer "who hasn't onboarded
          yet?", which the old directory had no way to surface at all. */}
      <div className={styles.statRow}>
        {([
          { key: '' as StatusFilter, label: 'Total employees', value: stats.total },
          { key: 'active' as StatusFilter, label: 'Active', value: stats.active },
          { key: 'inactive' as StatusFilter, label: 'Inactive', value: stats.inactive },
          { key: 'pending' as StatusFilter, label: 'Pending first login', value: stats.pending }
        ]).map((card) => (
          <button
            key={card.label}
            type="button"
            className={`${styles.statCardBtn} ${statusFilter === card.key ? styles.statCardActive : ''}`}
            aria-pressed={statusFilter === card.key}
            onClick={() => changeStatus(card.key)}
          >
            <div className={styles.statValue}>{loading ? '—' : card.value}</div>
            <div className={styles.statLabel}>{card.label}</div>
          </button>
        ))}
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}><Search size={16} /></span>
          <label className={styles.srOnly} htmlFor="empDirSearch">Search employees</label>
          <input
            id="empDirSearch"
            className={styles.searchInput}
            type="search"
            placeholder="Search name, ID, email, username, designation…"
            value={q}
            onChange={(e) => changeSearch(e.target.value)}
          />
          {q && (
            <button type="button" className={styles.searchClear} onClick={() => changeSearch('')} aria-label="Clear search">
              <X size={15} />
            </button>
          )}
        </div>

        <label className={styles.srOnly} htmlFor="empDirDept">Filter by department</label>
        <select
          id="empDirDept"
          className={`${styles.filterSelect} ${departmentFilter ? styles.filterSelectActive : ''}`}
          value={departmentFilter}
          onChange={(e) => changeDepartment(e.target.value)}
        >
          <option value="">All departments</option>
          {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>

        <label className={styles.srOnly} htmlFor="empDirRole">Filter by role</label>
        <select
          id="empDirRole"
          className={`${styles.filterSelect} ${roleFilter ? styles.filterSelectActive : ''}`}
          value={roleFilter}
          onChange={(e) => changeRole(e.target.value)}
        >
          <option value="">All roles</option>
          {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>

        <label className={styles.srOnly} htmlFor="empDirDesignation">Filter by designation</label>
        <select
          id="empDirDesignation"
          className={`${styles.filterSelect} ${designationFilter ? styles.filterSelectActive : ''}`}
          value={designationFilter}
          onChange={(e) => changeDesignation(e.target.value)}
        >
          <option value="">All designations</option>
          {designations.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        <Button variant="secondary" compact icon={<Download size={15} />} onClick={exportCsv} disabled={sorted.length === 0}>
          Export CSV
        </Button>
      </div>

      <div className={styles.metaRow}>
        <span className={styles.resultCount} role="status" aria-live="polite">
          {loading
            ? 'Loading employees…'
            : sorted.length === 0
              ? 'No employees match'
              : `Showing ${startIndex + 1}–${Math.min(startIndex + pageSize, sorted.length)} of ${sorted.length}${sorted.length !== users.length ? ` (filtered from ${users.length})` : ''}`}
        </span>
        {activeFilters.map((f) => (
          <span key={f.key} className={styles.chip}>
            <span className={styles.chipLabel}>{f.label}:</span>
            <span className={styles.chipValue} title={f.value}>{f.value}</span>
            <button type="button" className={styles.chipClear} onClick={f.clear} aria-label={`Clear ${f.label} filter`}>
              <X size={12} />
            </button>
          </span>
        ))}
        {activeFilters.length > 1 && (
          <button type="button" className={styles.clearAllBtn} onClick={clearAllFilters}>Clear all</button>
        )}
      </div>

      {selectedUsers.length > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{selectedUsers.length} selected</span>
          <Button variant="secondary" compact loading={bulkBusy} onClick={() => runBulk('active')}>Activate</Button>
          <Button variant="danger" compact loading={bulkBusy} onClick={() => runBulk('inactive')}>Deactivate</Button>
          <button type="button" className={styles.clearAllBtn} onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      )}

      {loading ? (
        <div className={styles.tableWrap} style={{ padding: 14 }}>
          <SkeletonRows rows={6} columns={5} />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={Users}
          title={users.length === 0 ? 'No employees yet' : 'No employees match these filters'}
          message={
            users.length === 0
              ? 'Add a user with the “Add employee” button above, or bulk-import your team from an Excel sheet.'
              : 'Try a different search term, or clear the filters to see everyone again.'
          }
          action={
            users.length > 0 && activeFilters.length > 0 ? (
              <Button variant="secondary" compact onClick={clearAllFilters}>Clear all filters</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.checkCell}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={allOnPageSelected}
                      onChange={togglePageSelection}
                      aria-label={allOnPageSelected ? 'Deselect all rows on this page' : 'Select all rows on this page'}
                    />
                  </th>
                  {COLUMNS.map((c) => <SortHeader key={c.label} column={c} />)}
                  <th className={styles.actionCell}><span className={styles.srOnly}>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((user) => {
                  const isSelected = selectedIds.has(user.id);
                  const isActivityOpen = activityOpenId === user.id;
                  return (
                    <Fragment key={user.id}>
                      <tr className={isSelected ? styles.rowSelected : ''}>
                        <td className={styles.checkCell}>
                          <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={isSelected}
                            onChange={() => toggleRow(user.id)}
                            aria-label={`Select ${user.name || user.username}`}
                          />
                        </td>
                        <td>
                          <Link href={`/admin/users/${user.id}`} className={styles.profileLink}>
                            <div className={styles.person}>
                              <span className={`${styles.avatar} ${user.status !== 'active' ? styles.avatarInactive : ''}`} aria-hidden="true">
                                {initialsOf(user.name, user.username)}
                              </span>
                              <span className={styles.personText}>
                                <span className={styles.personName}>{user.name || '—'}</span>
                                <span className={styles.personSub}>@{user.username}</span>
                              </span>
                            </div>
                          </Link>
                        </td>
                        <td className={user.employeeId ? historyStyles.num : styles.muted}>{user.employeeId || '—'}</td>
                        <td>
                          <div className={styles.contact}>
                            <span className={user.email ? styles.contactPrimary : styles.muted} title={user.email}>{user.email || '—'}</span>
                            {user.phone && <span className={styles.contactSecondary}>{user.phone}</span>}
                          </div>
                        </td>
                        <td>
                          {user.department || <span className={styles.muted}>—</span>}
                          {managerUserIds.has(user.id) && <span className={styles.managerBadge}>Manager</span>}
                        </td>
                        <td>{user.designation || <span className={styles.muted}>—</span>}</td>
                        <td><RolePill role={user.role} roles={roles} /></td>
                        <td>
                          <StatusPill status={user.status} />
                          {user.mustChangePassword && <div className={styles.pendingBadge}>Pending first login</div>}
                          {resendingIds[user.id] && <div className={styles.contactSecondary}>Sending email…</div>}
                          {rowError[user.id] && <div className={historyStyles.loginError}>{rowError[user.id]}</div>}
                        </td>
                        <td className={styles.actionCell}>{renderRowMenu(user)}</td>
                      </tr>
                      {isActivityOpen && (
                        <tr className={styles.activityRow}>
                          <td colSpan={COLUMN_COUNT}><ActivityPanel user={user} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards — the table above is display:none below 768px. */}
          <div className={styles.cardList}>
            {pageRows.map((user) => {
              const isSelected = selectedIds.has(user.id);
              const isActivityOpen = activityOpenId === user.id;
              return (
                <div key={user.id} className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}>
                  <div className={styles.cardHead}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={isSelected}
                      onChange={() => toggleRow(user.id)}
                      aria-label={`Select ${user.name || user.username}`}
                    />
                    <span className={`${styles.avatar} ${user.status !== 'active' ? styles.avatarInactive : ''}`} aria-hidden="true">
                      {initialsOf(user.name, user.username)}
                    </span>
                    <div className={styles.cardHeadText}>
                      <Link href={`/admin/users/${user.id}`} className={styles.profileLink}>
                        <div className={styles.personName}>{user.name || '—'}</div>
                      </Link>
                      <div className={styles.personSub}>@{user.username}</div>
                    </div>
                    {renderRowMenu(user)}
                  </div>

                  <div className={styles.cardPills}>
                    <RolePill role={user.role} roles={roles} />
                    <StatusPill status={user.status} />
                    {managerUserIds.has(user.id) && <span className={styles.managerBadge}>Manager</span>}
                    {user.mustChangePassword && <span className={styles.pendingBadge}>Pending first login</span>}
                  </div>

                  <div className={styles.cardMeta}>
                    <div>
                      <div className={styles.cardMetaLabel}>Emp. ID</div>
                      <div className={styles.cardMetaValue}>{user.employeeId || '—'}</div>
                    </div>
                    <div>
                      <div className={styles.cardMetaLabel}>Department</div>
                      <div className={styles.cardMetaValue}>{user.department || '—'}</div>
                    </div>
                    <div>
                      <div className={styles.cardMetaLabel}>Designation</div>
                      <div className={styles.cardMetaValue}>{user.designation || '—'}</div>
                    </div>
                    <div>
                      <div className={styles.cardMetaLabel}>Email</div>
                      <div className={styles.cardMetaValue}>{user.email || '—'}</div>
                    </div>
                    <div>
                      <div className={styles.cardMetaLabel}>Phone</div>
                      <div className={styles.cardMetaValue}>{user.phone || '—'}</div>
                    </div>
                  </div>

                  {resendingIds[user.id] && <div className={styles.contactSecondary}>Sending welcome email…</div>}
                  {rowError[user.id] && <div className={historyStyles.loginError}>{rowError[user.id]}</div>}

                  {isActivityOpen && (
                    <div className={styles.cardMeta}>
                      <div style={{ gridColumn: '1 / -1' }}><ActivityPanel user={user} /></div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className={`${styles.pager} ${totalPages > 1 ? styles.pagerSticky : ''}`}>
            <div className={styles.pageSizeWrap}>
              <label htmlFor="empDirPageSize">Rows<span className={styles.pageSizeLabelRest}> per page</span></label>
              <select
                id="empDirPageSize"
                className={styles.pageSizeSelect}
                value={pageSize}
                onChange={(e) => changePageSize(Number(e.target.value))}
              >
                {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {totalPages > 1 && (
              <div className={styles.pagerControls}>
                {/* Stepping from safePage, not page — if a delete shrinks the
                    list while the user sits on a high page, `page` can exceed
                    totalPages, and `page - 1` would then be a no-op click. */}
                <button type="button" className={`${styles.pageBtn} ${styles.pageBtnEdge}`} disabled={safePage === 1} onClick={() => setPage(1)} aria-label="First page">«</button>
                <button type="button" className={styles.pageBtn} disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>← Prev</button>
                <span className={styles.pageStatus}>Page {safePage} of {totalPages}</span>
                <button type="button" className={styles.pageBtn} disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>Next →</button>
                <button type="button" className={`${styles.pageBtn} ${styles.pageBtnEdge}`} disabled={safePage === totalPages} onClick={() => setPage(totalPages)} aria-label="Last page">»</button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
