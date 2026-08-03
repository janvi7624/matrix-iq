'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { CustomModuleDef, CustomModuleRecord, UserRole } from '@/lib/types';
import { BRAND } from '@/lib/branding';
import CustomFieldInput from './CustomFieldInput';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';

const STATUS_LABEL: Record<CustomModuleRecord['status'], string> = {
  active: 'Active',
  pending_approval: 'Pending Approval',
  approved: 'Approved',
  rejected: 'Rejected'
};
const STATUS_CLASS: Record<CustomModuleRecord['status'], string> = {
  active: historyStyles.statusPillActive,
  pending_approval: historyStyles.rolePillManager,
  approved: historyStyles.statusPillActive,
  rejected: historyStyles.rolePillSuperadmin
};

interface CustomModuleViewProps {
  moduleKey: string;
}

export default function CustomModuleView({ moduleKey }: CustomModuleViewProps) {
  const [module_, setModule] = useState<CustomModuleDef | null>(null);
  const [records, setRecords] = useState<CustomModuleRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [loadError, setLoadError] = useState(false);
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);
  const [currentUsername, setCurrentUsername] = useState('');
  const [q, setQ] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const toast = useToast();
  const confirm = useConfirm();

  async function load() {
    setStatus('Loading...');
    try {
      const [defRes, recordsRes] = await Promise.all([fetch(`/api/custom-modules/${moduleKey}`), fetch(`/api/custom-modules/${moduleKey}/records`)]);
      if (!defRes.ok) {
        setLoadError(true);
        setStatus('This module was not found, is disabled, or you do not have access to it.');
        return;
      }
      const def: CustomModuleDef = await defRes.json();
      const recs: CustomModuleRecord[] = recordsRes.ok ? await recordsRes.json() : [];
      setModule(def);
      setRecords(recs);
      setStatus(recs.length ? `${recs.length} record(s).` : 'No records yet.');
    } catch {
      setLoadError(true);
      setStatus('Could not reach the server.');
    }
  }

  useEffect(() => {
    load();
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        setCurrentRole(me?.role || null);
        setCurrentUsername(me?.username || '');
      })
      .catch(() => setCurrentRole(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey]);

  const isPrivileged = currentRole === 'admin' || currentRole === 'superadmin' || currentRole === 'manager';
  const isApprover = Boolean(module_?.requiresApproval && module_.approverRole && currentRole === module_.approverRole);

  const visibleRecords = useMemo(() => {
    if (!q.trim()) return records;
    const needle = q.trim().toLowerCase();
    return records.filter((r) => JSON.stringify(r.values).toLowerCase().includes(needle) || r.created_by.toLowerCase().includes(needle));
  }, [records, q]);

  function openCreate() {
    if (!module_) return;
    setEditingRecordId(null);
    setFormValues({});
    setFormError('');
    setFormOpen(true);
  }

  function openEdit(record: CustomModuleRecord) {
    setEditingRecordId(record.id);
    setFormValues(record.values);
    setFormError('');
    setFormOpen(true);
  }

  async function handleSubmit() {
    if (!module_) return;
    setFormError('');
    const missing = module_.fields.filter((f) => f.required && (formValues[f.id] === undefined || formValues[f.id] === '' || (Array.isArray(formValues[f.id]) && (formValues[f.id] as unknown[]).length === 0)));
    if (missing.length > 0) {
      setFormError(`Required: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    setSaving(true);
    try {
      const url = editingRecordId ? `/api/custom-modules/${moduleKey}/records/${editingRecordId}` : `/api/custom-modules/${moduleKey}/records`;
      const response = await fetch(url, {
        method: editingRecordId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: formValues })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setFormError(body?.error || 'Could not save this record.');
        return;
      }
      setFormOpen(false);
      await load();
    } catch {
      setFormError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDecision(record: CustomModuleRecord, action: 'approve' | 'reject') {
    const response = await fetch(`/api/custom-modules/${moduleKey}/records/${record.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    if (!response.ok) {
      toast.error('Could not record your decision.');
      return;
    }
    await load();
  }

  async function handleDelete(record: CustomModuleRecord) {
    if (!(await confirm({ message: 'Delete this record? This cannot be undone.', danger: true }))) return;
    const response = await fetch(`/api/custom-modules/${moduleKey}/records/${record.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toast.error('Could not delete this record.');
      return;
    }
    await load();
  }

  if (loadError) {
    return (
      <div className={historyStyles.body}>
        <header className={historyStyles.header}>
          <Link href="/" className={historyStyles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} unoptimized />
            <div><h1>{BRAND.appName}</h1></div>
          </Link>
        </header>
        <main className={historyStyles.main}>
          <div className={historyStyles.status}>{status}</div>
          <Link className={historyStyles.button} href="/">&larr; Back to Dashboard</Link>
        </main>
      </div>
    );
  }

  return (
    <div className={historyStyles.body}>
      <header className={historyStyles.header}>
        <Link href="/" className={historyStyles.headerBrand} style={{ textDecoration: 'none', color: 'inherit' }}>
          <Image src="/NANTA.png" alt={`${BRAND.companyName} logo`} width={38} height={38} className={historyStyles.headerLogo} unoptimized />
          <div>
            <h1>{module_?.icon} {module_?.name || '...'}</h1>
            <div className={historyStyles.sub}>Custom module — created from the UI, no code involved.</div>
          </div>
        </Link>
        <div style={{ display: 'flex', gap: 10 }}>
          <Link className={historyStyles.button} href="/">Back to Dashboard</Link>
        </div>
      </header>
      <main className={historyStyles.main}>
        {module_ && (
          <>
            <div className={historyStyles.toolbar}>
              <input type="text" placeholder="Search..." value={q} onChange={(e) => setQ(e.target.value)} />
              <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={openCreate}>+ New</button>
              <a className={historyStyles.button} href={`/api/custom-modules/${moduleKey}/records/export.csv`}>Export CSV</a>
              <button type="button" className={historyStyles.button} onClick={() => window.print()}>Print</button>
              <button type="button" className={historyStyles.button} onClick={load}>Refresh</button>
            </div>
            <div className={historyStyles.status}>{status}</div>

            {formOpen && (
              <div className={calcStyles.sectionPanel} style={{ marginBottom: 20 }}>
                <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>{editingRecordId ? 'Edit record' : 'New record'}</h2>
                {formError && <div className={historyStyles.loginError}>{formError}</div>}
                {module_.fields.map((field) => (
                  <div className={calcStyles.field} key={field.id}>
                    <label className={calcStyles.label}>{field.label}{field.required && ' *'}</label>
                    <CustomFieldInput field={field} value={formValues[field.id]} onChange={(v) => setFormValues((prev) => ({ ...prev, [field.id]: v }))} />
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <button type="button" className={calcStyles.btn} disabled={saving} onClick={handleSubmit}>{saving ? 'Saving...' : 'Save'}</button>
                  <button type="button" className={historyStyles.button} onClick={() => setFormOpen(false)}>Cancel</button>
                </div>
              </div>
            )}

            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    {module_.fields.map((f) => <th key={f.id}>{f.label}</th>)}
                    {module_.requiresApproval && <th>Status</th>}
                    <th>Created By</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRecords.map((r) => {
                    const canEdit = isPrivileged || r.created_by === currentUsername;
                    const canDecide = r.status === 'pending_approval' && (isPrivileged || isApprover);
                    return (
                      <tr key={r.id}>
                        {module_.fields.map((f) => {
                          const v = r.values[f.id];
                          return <td key={f.id}>{Array.isArray(v) ? v.join(', ') : String(v ?? '-')}</td>;
                        })}
                        {module_.requiresApproval && (
                          <td><span className={`${historyStyles.rolePill} ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span></td>
                        )}
                        <td>{r.created_by}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {canEdit && <button type="button" className={historyStyles.button} onClick={() => openEdit(r)}>Edit</button>}
                            {canDecide && (
                              <>
                                <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={() => handleDecision(r, 'approve')}>Approve</button>
                                <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDecision(r, 'reject')}>Reject</button>
                              </>
                            )}
                            {isPrivileged && <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(r)}>Delete</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {visibleRecords.length === 0 && (
                    <tr><td colSpan={module_.fields.length + 2} className={historyStyles.empty}>No records match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
