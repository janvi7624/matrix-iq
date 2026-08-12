'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ModuleConfigRecord, ModulePermissionAction, RolePermissions, RoleRecord } from '@/lib/types';
import { BRAND } from '@/lib/branding';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';

const PERMISSION_ACTIONS: { key: ModulePermissionAction; label: string }[] = [
  { key: 'view', label: 'View' },
  { key: 'create', label: 'Create' },
  { key: 'edit', label: 'Edit' },
  { key: 'delete', label: 'Delete' },
  { key: 'export', label: 'Export' },
  { key: 'print', label: 'Print' },
  { key: 'approve', label: 'Approve' },
  { key: 'reject', label: 'Reject' },
  { key: 'assign', label: 'Assign' }
];

const GLOBAL_CAPABILITIES: { key: keyof Pick<RolePermissions, 'manageSettings' | 'manageUsers' | 'manageRoles' | 'manageDepartments'>; label: string }[] = [
  { key: 'manageUsers', label: 'Manage Users' },
  { key: 'manageRoles', label: 'Manage Roles' },
  { key: 'manageDepartments', label: 'Manage Departments' },
  { key: 'manageSettings', label: 'Manage Settings' }
];

function blankPermissions(): RolePermissions {
  return { modules: {}, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false };
}

export default function RoleManagementPage() {
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [modules, setModules] = useState<ModuleConfigRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivileged, setIsPrivileged] = useState(false);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<{ label: string; description: string } | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  async function load() {
    setStatus('Loading...');
    try {
      const [rolesRes, modulesRes] = await Promise.all([fetch('/api/admin/roles'), fetch('/api/admin/modules')]);
      if (!rolesRes.ok) throw new Error(String(rolesRes.status));
      const rolesData: RoleRecord[] = await rolesRes.json();
      const modulesData: ModuleConfigRecord[] = modulesRes.ok ? await modulesRes.json() : [];
      setRoles(rolesData);
      setModules(modulesData);
      setStatus(`${rolesData.length} role${rolesData.length === 1 ? '' : 's'}.`);
    } catch {
      setStatus('Could not load roles. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  const selectedRole = useMemo(() => roles.find((r) => r.id === selectedId) || null, [roles, selectedId]);

  const modulesBySection = useMemo(() => {
    const groups = new Map<string, ModuleConfigRecord[]>();
    modules.forEach((m) => {
      const list = groups.get(m.section) || [];
      list.push(m);
      groups.set(m.section, list);
    });
    for (const list of groups.values()) list.sort((a, b) => a.order - b.order);
    return groups;
  }, [modules]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const response = await fetch('/api/admin/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), description: description.trim(), isPrivileged, permissions: blankPermissions() })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setCreateError(body?.error || 'Could not create role.');
        return;
      }
      setLabel('');
      setDescription('');
      setIsPrivileged(false);
      await load();
    } catch {
      setCreateError('Could not reach the server.');
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    const response = await fetch(`/api/admin/roles/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      alert(errBody?.error || 'Could not save changes.');
      return false;
    }
    await load();
    return true;
  }

  function startEdit(r: RoleRecord) {
    setEditingId(r.id);
    setEditState({ label: r.label, description: r.description });
  }

  async function saveEdit(id: string) {
    if (!editState) return;
    const ok = await patch(id, { label: editState.label, description: editState.description });
    if (ok) {
      setEditingId(null);
      setEditState(null);
    }
  }

  async function togglePrivileged(r: RoleRecord) {
    await patch(r.id, { isPrivileged: !r.isPrivileged });
  }

  async function toggleStatus(r: RoleRecord) {
    await patch(r.id, { status: r.status === 'active' ? 'inactive' : 'active' });
  }

  async function handleClone(r: RoleRecord) {
    const newLabel = window.prompt(`New role name (cloned from "${r.label}"):`, `${r.label} (Copy)`);
    if (!newLabel) return;
    const response = await fetch(`/api/admin/roles/${r.id}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel.trim() })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      alert(body?.error || 'Could not clone role.');
      return;
    }
    await load();
  }

  async function handleDelete(r: RoleRecord) {
    if (!window.confirm(`Delete role "${r.label}"? This cannot be undone.`)) return;
    const response = await fetch(`/api/admin/roles/${r.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      alert(body?.error || 'Could not delete role.');
      return;
    }
    if (selectedId === r.id) setSelectedId(null);
    await load();
  }

  async function toggleGlobalCapability(r: RoleRecord, capability: (typeof GLOBAL_CAPABILITIES)[number]['key']) {
    const permissions: RolePermissions = { ...r.permissions, [capability]: !r.permissions[capability] };
    await patch(r.id, { permissions });
  }

  async function toggleModuleAction(r: RoleRecord, moduleKey: string, action: ModulePermissionAction) {
    const currentSet = r.permissions.modules[moduleKey] || {};
    const nextValue = !currentSet[action];
    const permissions: RolePermissions = {
      ...r.permissions,
      modules: { ...r.permissions.modules, [moduleKey]: { ...currentSet, [action]: nextValue } }
    };
    await patch(r.id, { permissions });
  }

  // "Select Entire Row" — every action for one module, in a single save.
  async function toggleModuleRow(r: RoleRecord, moduleKey: string) {
    const currentSet = r.permissions.modules[moduleKey] || {};
    const allOn = PERMISSION_ACTIONS.every((a) => currentSet[a.key]);
    const nextSet: RolePermissions['modules'][string] = {};
    PERMISSION_ACTIONS.forEach((a) => { nextSet[a.key] = !allOn; });
    const permissions: RolePermissions = { ...r.permissions, modules: { ...r.permissions.modules, [moduleKey]: nextSet } };
    await patch(r.id, { permissions });
  }

  // "Select Entire Column" — one action across every module in a section, in a single save.
  async function toggleActionColumn(r: RoleRecord, sectionModules: ModuleConfigRecord[], action: ModulePermissionAction) {
    const allOn = sectionModules.every((m) => !!(r.permissions.modules[m.key] || {})[action]);
    const modules = { ...r.permissions.modules };
    sectionModules.forEach((m) => {
      modules[m.key] = { ...(modules[m.key] || {}), [action]: !allOn };
    });
    await patch(r.id, { permissions: { ...r.permissions, modules } });
  }

  async function setAllPermissions(r: RoleRecord, value: boolean) {
    const modulesMap: RolePermissions['modules'] = {};
    modules.forEach((m) => {
      const set: RolePermissions['modules'][string] = {};
      PERMISSION_ACTIONS.forEach((a) => { set[a.key] = value; });
      modulesMap[m.key] = set;
    });
    await patch(r.id, { permissions: { modules: modulesMap, manageSettings: value, manageUsers: value, manageRoles: value, manageDepartments: value } });
  }

  function toggleGroup(section: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  return (
    <div className={historyStyles.body}>
      <header className={historyStyles.header}>
        <Link href="/" className={historyStyles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} unoptimized />
          <div>
            <h1>Role Management</h1>
            <div className={historyStyles.sub}>Administration &rsaquo; create roles and configure what each one can see and do — no code required.</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className={historyStyles.button} href="/admin/users">User Management</Link>
          <Link className={historyStyles.button} href="/admin/departments">Department Master</Link>
          <Link className={historyStyles.button} href="/">Back to Dashboard</Link>
        </div>
      </header>
      <main className={historyStyles.main}>
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Add role</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          {createError && <div className={historyStyles.loginError}>{createError}</div>}
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="roleLabel">Role name</label>
              <input id="roleLabel" className={calcStyles.formControl} type="text" value={label} onChange={(e) => setLabel(e.target.value)} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="roleDesc">Description (optional)</label>
              <input id="roleDesc" className={calcStyles.formControl} type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, marginBottom: 12 }}>
            <input type="checkbox" checked={isPrivileged} onChange={(e) => setIsPrivileged(e.target.checked)} />
            Privileged (reaches the Administration area and sees org-wide records, not just their own)
          </label>
          <button type="submit" className={calcStyles.btn} disabled={creating}>{creating ? 'Adding...' : '+ Add role'}</button>
        </form>

        <h2 className={calcStyles.h2}>Roles</h2>
        <div className={historyStyles.status}>{status}</div>
        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Role</th>
                <th>Description</th>
                <th>Privileged</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => {
                const isEditing = editingId === r.id;
                return (
                  <tr key={r.id} style={{ background: selectedId === r.id ? '#fef2f2' : undefined }}>
                    {isEditing && editState ? (
                      <>
                        <td>
                          <input className={calcStyles.formControl} value={editState.label} onChange={(e) => setEditState({ ...editState, label: e.target.value })} />
                        </td>
                        <td>
                          <input className={calcStyles.formControl} value={editState.description} onChange={(e) => setEditState({ ...editState, description: e.target.value })} />
                        </td>
                        <td colSpan={2}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={() => saveEdit(r.id)}>Save</button>
                            <button type="button" className={historyStyles.button} onClick={() => { setEditingId(null); setEditState(null); }}>Cancel</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          {r.label}
                          {r.isSystem && <span className={`${historyStyles.rolePill} ${historyStyles.rolePillBackoffice}`} style={{ marginLeft: 6 }}>Built-in</span>}
                        </td>
                        <td>{r.description || '-'}</td>
                        <td>
                          <input type="checkbox" checked={r.isPrivileged} onChange={() => togglePrivileged(r)} />
                        </td>
                        <td>
                          <span className={`${historyStyles.statusPill} ${r.status === 'active' ? historyStyles.statusPillActive : historyStyles.statusPillInactive}`}>
                            {r.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                      </>
                    )}
                    {!isEditing && (
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className={historyStyles.button} onClick={() => setSelectedId(r.id === selectedId ? null : r.id)}>
                            {selectedId === r.id ? 'Hide permissions' : 'Configure permissions'}
                          </button>
                          <button type="button" className={historyStyles.button} onClick={() => startEdit(r)}>Edit</button>
                          <button type="button" className={historyStyles.button} onClick={() => handleClone(r)}>Clone</button>
                          <button type="button" className={historyStyles.button} onClick={() => toggleStatus(r)}>
                            {r.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                          {!r.isSystem && <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(r)}>Delete</button>}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selectedRole && (
          <div style={{ marginTop: 24 }}>
            <h2 className={calcStyles.h2}>Permissions for &ldquo;{selectedRole.label}&rdquo;</h2>
            <div className={historyStyles.status} style={{ marginBottom: 12 }}>
              Changes save immediately. Actions left unchecked here fall back to the role&apos;s Privileged flag above for modules that don&apos;t have an explicit permission set yet.
            </div>

            <div className={historyStyles.permToolbar}>
              <button type="button" className={historyStyles.button} onClick={() => setCollapsedGroups(new Set())}>Expand All</button>
              <button type="button" className={historyStyles.button} onClick={() => setCollapsedGroups(new Set(modulesBySection.keys()))}>Collapse All</button>
              <span style={{ width: 1, alignSelf: 'stretch', background: '#e5e7eb' }} />
              <button type="button" className={historyStyles.button} onClick={() => setAllPermissions(selectedRole, true)}>Select All Permissions</button>
              <button type="button" className={historyStyles.button} onClick={() => setAllPermissions(selectedRole, false)}>Clear All Permissions</button>
            </div>

            <div className={calcStyles.sectionPanel} style={{ marginBottom: 18 }}>
              <div className={historyStyles.navGroupLabel} style={{ marginTop: 0 }}>Global capabilities</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {GLOBAL_CAPABILITIES.map((cap) => (
                  <label key={cap.key} className={historyStyles.permRowSelectLabel} style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 10 }}>
                    <input type="checkbox" checked={selectedRole.permissions[cap.key]} onChange={() => toggleGlobalCapability(selectedRole, cap.key)} />
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{cap.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {[...modulesBySection.entries()].map(([section, list]) => {
              const collapsed = collapsedGroups.has(section);
              return (
                <div key={section} className={historyStyles.permGroup}>
                  <button type="button" className={historyStyles.permGroupHeader} onClick={() => toggleGroup(section)}>
                    <span className={`${historyStyles.permGroupChevron} ${!collapsed ? historyStyles.permGroupChevronOpen : ''}`}>▶</span>
                    {section}
                    <span className={historyStyles.permGroupCount}>{list.length} module{list.length === 1 ? '' : 's'}</span>
                  </button>
                  {!collapsed && (
                    <div className={historyStyles.permTableScroll}>
                      <table className={historyStyles.permTable}>
                        <thead>
                          <tr>
                            <th>Module</th>
                            {PERMISSION_ACTIONS.map((a) => (
                              <th key={a.key}>
                                <button
                                  type="button"
                                  className={historyStyles.permColumnHeaderBtn}
                                  title={`Toggle "${a.label}" for every module in ${section}`}
                                  onClick={() => toggleActionColumn(selectedRole, list, a.key)}
                                >
                                  <input type="checkbox" readOnly checked={list.every((m) => !!(selectedRole.permissions.modules[m.key] || {})[a.key])} />
                                  {a.label}
                                </button>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((m) => {
                            const set = selectedRole.permissions.modules[m.key] || {};
                            const allOn = PERMISSION_ACTIONS.every((a) => set[a.key]);
                            return (
                              <tr key={m.key}>
                                <td className={historyStyles.permModuleCell}>
                                  <label className={historyStyles.permRowSelectLabel} title="Select entire row">
                                    <input type="checkbox" checked={allOn} onChange={() => toggleModuleRow(selectedRole, m.key)} />
                                    {m.label}
                                  </label>
                                </td>
                                {PERMISSION_ACTIONS.map((a) => (
                                  <td key={a.key}>
                                    <label className={historyStyles.permCheckboxLabel}>
                                      <input type="checkbox" checked={!!set[a.key]} onChange={() => toggleModuleAction(selectedRole, m.key, a.key)} />
                                    </label>
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
