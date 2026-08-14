'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CustomFieldDef, CustomFieldType, CustomModuleDef, RoleRecord, UserRole } from '@/lib/types';
import { BRAND } from '@/lib/branding';
import { MODULE_ICON_OPTIONS, resolveModuleIcon } from '@/lib/icons';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';

function iconOptionLabel(key: string): string {
  return key.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'date', label: 'Date' },
  { value: 'time', label: 'Time' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'multiselect', label: 'Multi Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'radio', label: 'Radio Button' },
  { value: 'textarea', label: 'Text Area' },
  { value: 'richtext', label: 'Rich Text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'file', label: 'File Upload' },
  { value: 'image', label: 'Image Upload' },
  { value: 'user', label: 'User Selector' },
  { value: 'project', label: 'Project Selector' },
  { value: 'product', label: 'Product Selector' }
];

const OPTION_TYPES: CustomFieldType[] = ['dropdown', 'multiselect', 'radio'];

interface ModuleFormState {
  name: string;
  icon: string;
  section: string;
  requiresApproval: boolean;
  approverRole: UserRole | '';
  enabled: boolean;
  fields: CustomFieldDef[];
}

function blankField(): CustomFieldDef {
  return { id: `f-${Date.now()}-${Math.floor(Math.random() * 10000)}`, label: '', type: 'text', required: false, options: [], order: 0 };
}

function blankModuleForm(): ModuleFormState {
  return { name: '', icon: 'wrench', section: 'Custom Modules', requiresApproval: false, approverRole: '', enabled: true, fields: [blankField()] };
}

export default function CustomModuleBuilderPage() {
  const [modules, setModules] = useState<CustomModuleDef[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ModuleFormState>(blankModuleForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/admin/custom-modules');
      if (!response.ok) throw new Error(String(response.status));
      const data: CustomModuleDef[] = await response.json();
      setModules(data);
      setStatus(data.length ? `${data.length} custom module(s).` : 'No custom modules yet — build one below.');
    } catch {
      setStatus('Could not load custom modules. Refresh to try again.');
    }
  }

  useEffect(() => {
    load();
    fetch('/api/admin/roles')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: RoleRecord[]) => setRoles(data.filter((r) => r.status === 'active')))
      .catch(() => setRoles([]));
  }, []);

  function startCreate() {
    setEditingId('new');
    setForm(blankModuleForm());
    setFormError('');
  }

  function startEdit(m: CustomModuleDef) {
    setEditingId(m.id);
    setForm({ name: m.name, icon: m.icon, section: m.section, requiresApproval: m.requiresApproval, approverRole: m.approverRole, enabled: m.enabled, fields: m.fields.length ? m.fields : [blankField()] });
    setFormError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(blankModuleForm());
  }

  function updateField(index: number, patch: Partial<CustomFieldDef>) {
    setForm((f) => ({ ...f, fields: f.fields.map((field, i) => (i === index ? { ...field, ...patch } : field)) }));
  }

  function addField() {
    setForm((f) => ({ ...f, fields: [...f.fields, blankField()] }));
  }

  function removeField(index: number) {
    setForm((f) => ({ ...f, fields: f.fields.filter((_, i) => i !== index) }));
  }

  function moveField(index: number, direction: -1 | 1) {
    setForm((f) => {
      const next = [...f.fields];
      const swapWith = index + direction;
      if (swapWith < 0 || swapWith >= next.length) return f;
      [next[index], next[swapWith]] = [next[swapWith], next[index]];
      return { ...f, fields: next };
    });
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setFormError('');
    if (!form.name.trim()) {
      setFormError('Module name is required.');
      return;
    }
    if (form.fields.some((f) => !f.label.trim())) {
      setFormError('Every field needs a label.');
      return;
    }
    if (form.requiresApproval && !form.approverRole) {
      setFormError('Pick an approver role, or turn off "Requires Approval".');
      return;
    }

    setSaving(true);
    try {
      const isNew = editingId === 'new';
      const response = await fetch(isNew ? '/api/admin/custom-modules' : `/api/admin/custom-modules/${editingId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setFormError(body?.error || 'Could not save this module.');
        return;
      }
      cancelEdit();
      await load();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(m: CustomModuleDef) {
    if (!window.confirm(`Delete module "${m.name}"? Its records stay in storage but the module (and its menu entry) is removed.`)) return;
    const response = await fetch(`/api/admin/custom-modules/${m.id}`, { method: 'DELETE' });
    if (!response.ok) {
      alert('Could not delete this module.');
      return;
    }
    await load();
  }

  async function toggleEnabled(m: CustomModuleDef) {
    await fetch(`/api/admin/custom-modules/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !m.enabled }) });
    await load();
  }

  return (
    <div className={historyStyles.body}>
      <header className={historyStyles.header}>
        <Link href="/" className={historyStyles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} unoptimized />
          <div>
            <h1>Custom Module Builder</h1>
            <div className={historyStyles.sub}>Administration &rsaquo; create new business modules — fields, approval, and permissions — without writing code.</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className={historyStyles.button} href="/admin/modules">Module Manager</Link>
          <Link className={historyStyles.button} href="/">Back to Dashboard</Link>
        </div>
      </header>
      <main className={historyStyles.main}>
        <div className={historyStyles.status}>{status}</div>

        {editingId ? (
          <form className={calcStyles.sectionPanel} onSubmit={handleSave}>
            <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>{editingId === 'new' ? 'New Module' : 'Edit Module'}</h2>
            {formError && <div className={historyStyles.loginError}>{formError}</div>}
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Module name</label>
                <input className={calcStyles.formControl} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Visitor Register" required />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Icon</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {(() => {
                    const Icon = resolveModuleIcon(form.icon);
                    return Icon ? <Icon size={18} /> : null;
                  })()}
                  <select className={calcStyles.formControl} value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))} style={{ maxWidth: 160 }}>
                    {MODULE_ICON_OPTIONS.map((key) => (
                      <option key={key} value={key}>{iconOptionLabel(key)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Sidebar section</label>
                <input className={calcStyles.formControl} value={form.section} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))} />
              </div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                <input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm((f) => ({ ...f, requiresApproval: e.target.checked }))} />
                Requires approval before a record is considered final
              </label>
              {form.requiresApproval && (
                <div className={calcStyles.field} style={{ maxWidth: 220 }}>
                  <label className={calcStyles.label}>Approver role</label>
                  <select className={calcStyles.formControl} value={form.approverRole} onChange={(e) => setForm((f) => ({ ...f, approverRole: e.target.value as UserRole }))}>
                    <option value="">Select role...</option>
                    {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
                Enabled (visible on Dashboard once saved)
              </label>
            </div>

            <h3 style={{ marginTop: 20 }}>Fields</h3>
            {form.fields.map((field, index) => (
              <div key={field.id} className={calcStyles.sectionPanel} style={{ marginBottom: 10 }}>
                <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                  <div className={calcStyles.field} style={{ flex: 2 }}>
                    <label className={calcStyles.label}>Field label</label>
                    <input className={calcStyles.formControl} value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} required />
                  </div>
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Type</label>
                    <select className={calcStyles.formControl} value={field.type} onChange={(e) => updateField(index, { type: e.target.value as CustomFieldType })}>
                      {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap' }}>
                    <input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} />
                    Required
                  </label>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
                    <button type="button" className={historyStyles.toggleBtn} disabled={index === 0} onClick={() => moveField(index, -1)}>↑</button>
                    <button type="button" className={historyStyles.toggleBtn} disabled={index === form.fields.length - 1} onClick={() => moveField(index, 1)}>↓</button>
                    <button type="button" className={historyStyles.deleteBtn} onClick={() => removeField(index)}>Remove</button>
                  </div>
                </div>
                {OPTION_TYPES.includes(field.type) && (
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Options (one per line)</label>
                    <textarea
                      className={calcStyles.formControl}
                      rows={3}
                      value={field.options.join('\n')}
                      onChange={(e) => updateField(index, { options: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean) })}
                    />
                  </div>
                )}
              </div>
            ))}
            <button type="button" className={historyStyles.button} onClick={addField}>+ Add Field</button>

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button type="submit" className={calcStyles.btn} disabled={saving}>{saving ? 'Saving...' : 'Save Module'}</button>
              <button type="button" className={historyStyles.button} onClick={cancelEdit}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" className={calcStyles.btn} onClick={startCreate}>+ Create New Module</button>
        )}

        <h2 className={calcStyles.h2}>Your modules</h2>
        <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Icon</th>
                <th>Name</th>
                <th>Section</th>
                <th>Fields</th>
                <th>Approval</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => {
                const Icon = resolveModuleIcon(m.icon);
                return (
                <tr key={m.id}>
                  <td>{Icon ? <Icon size={16} /> : m.icon}</td>
                  <td>{m.name}</td>
                  <td>{m.section}</td>
                  <td>{m.fields.length}</td>
                  <td>{m.requiresApproval ? `Yes (${m.approverRole})` : 'No'}</td>
                  <td>
                    <span className={`${historyStyles.statusPill} ${m.enabled ? historyStyles.statusPillActive : historyStyles.statusPillInactive}`}>{m.enabled ? 'Enabled' : 'Disabled'}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Link className={historyStyles.button} href={`/modules/${m.key}`}>Open</Link>
                      <button type="button" className={historyStyles.button} onClick={() => startEdit(m)}>Edit</button>
                      <button type="button" className={historyStyles.button} onClick={() => toggleEnabled(m)}>{m.enabled ? 'Disable' : 'Enable'}</button>
                      <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(m)}>Delete</button>
                    </div>
                  </td>
                </tr>
                );
              })}
              {modules.length === 0 && <tr><td colSpan={7} className={historyStyles.empty}>No custom modules yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
