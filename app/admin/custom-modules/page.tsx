'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Blocks, ExternalLink, LayoutGrid, ListPlus, Pencil, Plus, Power, ShieldCheck, Trash2 } from 'lucide-react';
import { CustomFieldDef, CustomFieldType, CustomModuleDef, RoleRecord, UserRole } from '@/lib/types';
import { MODULE_ICON_OPTIONS, resolveModuleIcon } from '@/lib/icons';
import AppShell from '@/components/AppShell';
import CommonButton from '@/components/ui/CommonButton';
import historyStyles from '@/components/quotationHistory.module.css';
import calcStyles from '@/components/calculator.module.css';
import { useToast } from '@/components/ui/ToastProvider';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import pageStyles from './customModulesPage.module.css';
import { SkeletonCards } from '@/components/ui/Skeleton';
import AppLink from '@/components/ui/AppLink';
import { refreshShellData } from '@/lib/shellDataStore';
import RowActions from '@/components/ui/RowActions';
import Select from '@/components/ui/Select';

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
  const toast = useToast();
  const confirm = useConfirm();

  // First load only: a reload after an edit keeps the current rows on screen.
  const firstLoad = status === 'Loading...' && modules.length === 0;
  const loadFailed = status.startsWith('Could not');

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
      // Custom modules appear in the sidebar — refresh the once-per-login menu.
      void refreshShellData();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(m: CustomModuleDef) {
    if (!(await confirm({ message: `Delete module "${m.name}"? Its records stay in storage but the module (and its menu entry) is removed.`, danger: true }))) return;
    const response = await fetch(`/api/admin/custom-modules/${m.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toast.error('Could not delete this module.');
      return;
    }
    await load();
    void refreshShellData();
  }

  async function toggleEnabled(m: CustomModuleDef) {
    await fetch(`/api/admin/custom-modules/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !m.enabled }) });
    await load();
    void refreshShellData();
  }

  return (
    <AppShell title="Custom Module Builder" subtitle="Administration › create new business modules — fields, approval, and permissions — without writing code.">
        {editingId ? (
          <form className={calcStyles.sectionPanel} onSubmit={handleSave}>
            <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>{editingId === 'new' ? 'New Module' : 'Edit Module'}</h2>
            {formError && <div className={historyStyles.loginError}>{formError}</div>}
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Module name</label>
                <input className={calcStyles.formControl} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Visitor Register" required />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Icon</label>
                <div className={calcStyles.inlineFlexGap8}>
                  {(() => {
                    const Icon = resolveModuleIcon(form.icon);
                    return Icon ? <Icon size={18} /> : null;
                  })()}
                  <Select className={pageStyles.iconSelectNarrow} value={form.icon} onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}>
                    {MODULE_ICON_OPTIONS.map((key) => (
                      <option key={key} value={key}>{iconOptionLabel(key)}</option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Sidebar section</label>
                <input className={calcStyles.formControl} value={form.section} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))} />
              </div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <label className={pageStyles.checkboxLabel13}>
                <input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm((f) => ({ ...f, requiresApproval: e.target.checked }))} />
                Requires approval before a record is considered final
              </label>
              {form.requiresApproval && (
                <div className={`${calcStyles.field} ${pageStyles.approverField}`}>
                  <label className={calcStyles.label}>Approver role</label>
                  <Select value={form.approverRole} onChange={(e) => setForm((f) => ({ ...f, approverRole: e.target.value as UserRole }))}>
                    <option value="">Select role...</option>
                    {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </Select>
                </div>
              )}
              <label className={pageStyles.checkboxLabel13}>
                <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
                Enabled (visible on Dashboard once saved)
              </label>
            </div>

            <h3 className={pageStyles.mt20}>Fields</h3>
            {form.fields.map((field, index) => (
              <div key={field.id} className={`${calcStyles.sectionPanel} ${calcStyles.mb10}`}>
                <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                  <div className={`${calcStyles.field} ${pageStyles.flex2}`}>
                    <label className={calcStyles.label}>Field label</label>
                    <input className={calcStyles.formControl} value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} required />
                  </div>
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Type</label>
                    <Select value={field.type} onChange={(e) => updateField(index, { type: e.target.value as CustomFieldType })}>
                      {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </div>
                  <label className={pageStyles.requiredCheckboxLabel}>
                    <input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} />
                    Required
                  </label>
                  <div className={pageStyles.fieldActionsRow}>
                    <CommonButton variant="outlined" size="sm" iconOnly leadingIcon={<ArrowUp />} aria-label="Move field up" disabled={index === 0} onClick={() => moveField(index, -1)} />
                    <CommonButton variant="outlined" size="sm" iconOnly leadingIcon={<ArrowDown />} aria-label="Move field down" disabled={index === form.fields.length - 1} onClick={() => moveField(index, 1)} />
                    <CommonButton variant="destructive" size="sm" onClick={() => removeField(index)}>Remove</CommonButton>
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
            <CommonButton variant="secondary" size="md" leadingIcon={<Plus />} onClick={addField}>Add Field</CommonButton>

            <div className={pageStyles.saveActionsRow}>
              <CommonButton type="submit" variant="primary" size="md" disabled={saving}>{saving ? 'Saving...' : 'Save Module'}</CommonButton>
              <CommonButton variant="secondary" size="md" onClick={cancelEdit}>Cancel</CommonButton>
            </div>
          </form>
        ) : (
          <>
            {/* Header: what this is, how many, and the one primary action. */}
            <div className={pageStyles.listHead}>
              <div>
                <h2 className={pageStyles.listTitle}>
                  Your modules
                  {!firstLoad && modules.length > 0 && <span className={pageStyles.countPill}>{modules.length}</span>}
                </h2>
                <p className={pageStyles.listSub}>Each module gets its own page in the sidebar, with the fields, approval step and access you set here.</p>
              </div>
              {modules.length > 0 && (
                <CommonButton variant="primary" size="md" leadingIcon={<Plus />} onClick={startCreate}>
                  Create New Module
                </CommonButton>
              )}
            </div>

            {loadFailed && <div className={historyStyles.loginError}>{status}</div>}

            {firstLoad ? (
              <SkeletonCards count={3} />
            ) : modules.length === 0 && !loadFailed ? (
              /* Empty: explain what a module is in three steps, then one clear call to action. */
              <div className={pageStyles.empty}>
                <span className={pageStyles.emptyIcon} aria-hidden="true">
                  <Blocks />
                </span>
                <h3 className={pageStyles.emptyTitle}>No custom modules yet</h3>
                <p className={pageStyles.emptyText}>Build a new business module — like a Visitor Register or Asset Tracker — without writing code.</p>
                <ol className={pageStyles.steps}>
                  <li>
                    <span className={pageStyles.stepIcon} aria-hidden="true"><ListPlus /></span>
                    <span className={pageStyles.stepText}><strong>Add fields</strong>Text, dates, dropdowns, files, people…</span>
                  </li>
                  <li>
                    <span className={pageStyles.stepIcon} aria-hidden="true"><ShieldCheck /></span>
                    <span className={pageStyles.stepText}><strong>Set approval</strong>Optionally route records to a role</span>
                  </li>
                  <li>
                    <span className={pageStyles.stepIcon} aria-hidden="true"><LayoutGrid /></span>
                    <span className={pageStyles.stepText}><strong>Publish</strong>It appears in the sidebar for its roles</span>
                  </li>
                </ol>
                <CommonButton variant="primary" size="lg" leadingIcon={<Plus />} onClick={startCreate}>
                  Create your first module
                </CommonButton>
              </div>
            ) : (
              <ul className={pageStyles.grid}>
                {modules.map((m) => {
                  const Icon = resolveModuleIcon(m.icon);
                  const approver = roles.find((r) => r.key === m.approverRole)?.label || m.approverRole;
                  return (
                    <li key={m.id} className={`${pageStyles.card} ${m.enabled ? '' : pageStyles.cardOff}`}>
                      <div className={pageStyles.cardTop}>
                        <span className={pageStyles.cardIcon} aria-hidden="true">
                          {Icon ? <Icon /> : m.icon}
                        </span>
                        <div className={pageStyles.cardName}>
                          <AppLink href={`/modules/${m.key}`} className={pageStyles.cardLink}>
                            {m.name}
                          </AppLink>
                          <span className={pageStyles.cardSection}>{m.section}</span>
                        </div>
                        <RowActions
                          label={`Actions for ${m.name}`}
                          actions={[
                            { key: 'open', label: 'Open', icon: <ExternalLink />, href: `/modules/${m.key}` },
                            { key: 'edit', label: 'Edit', icon: <Pencil />, onClick: () => startEdit(m) },
                            { key: 'toggle', label: m.enabled ? 'Disable' : 'Enable', icon: <Power />, onClick: () => toggleEnabled(m) },
                            { key: 'delete', label: 'Delete', icon: <Trash2 />, destructive: true, onClick: () => handleDelete(m) }
                          ]}
                        />
                      </div>
                      <div className={pageStyles.cardMeta}>
                        <span className={pageStyles.metaChip}>
                          <ListPlus aria-hidden="true" />
                          {m.fields.length} field{m.fields.length === 1 ? '' : 's'}
                        </span>
                        <span className={pageStyles.metaChip}>
                          <ShieldCheck aria-hidden="true" />
                          {m.requiresApproval ? `Approval: ${approver}` : 'No approval'}
                        </span>
                      </div>
                      <div className={pageStyles.cardFoot}>
                        <span className={`${pageStyles.state} ${m.enabled ? pageStyles.stateOn : ''}`}>
                          <span className={pageStyles.stateDot} aria-hidden="true" />
                          {m.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                        <CommonButton variant="ghost" size="sm" leadingIcon={<Pencil />} onClick={() => startEdit(m)}>
                          Edit
                        </CommonButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
    </AppShell>
  );
}
