'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { PoRecord, ProjectRecord, UserRole } from '@/lib/types';
import { exportListToPdf } from '@/lib/exportPdf';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import SubmitButton from './ui/SubmitButton';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';

const EMPTY_FORM = { projectId: '', poNumber: '', poDate: '', amount: '', advanceReceived: '', paymentTerms: '', attachmentUrl: '' };

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

interface PoViewProps {
  currentUser: { username: string; role: UserRole; isPrivileged: boolean };
}

export default function PoView({ currentUser }: PoViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  // Role Management's isPrivileged flag, resolved server-side — NOT
  // re-derived from role name, since an admin can toggle a role's
  // privileged status independently of what the role is called.
  const isPrivileged = currentUser.isPrivileged;
  const [records, setRecords] = useState<PoRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function load() {
    setStatus('Loading...');
    try {
      const [rRes, pRes] = await Promise.all([fetch('/api/po'), fetch('/api/projects')]);
      if (!rRes.ok) throw new Error(String(rRes.status));
      const data: PoRecord[] = await rRes.json();
      setRecords(data);
      setProjects(pRes.ok ? await pRes.json() : []);
      setStatus(data.length ? `${data.length} PO${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the PO API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAttachment(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('folder', 'po');
      body.append('files', file);
      const response = await fetch('/api/uploads', { method: 'POST', body });
      if (!response.ok) throw new Error(String(response.status));
      const data: { urls: string[] } = await response.json();
      setForm((f) => ({ ...f, attachmentUrl: data.urls[0] || '' }));
    } catch {
      toast.error('Could not upload this attachment.');
    } finally {
      setUploading(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.projectId || !form.poNumber.trim()) {
      toast.error('Project and PO number are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount) || 0, advanceReceived: Number(form.advanceReceived) || 0 })
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      await load();
    } catch {
      toast.error('Could not save this PO. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Delete this PO? This cannot be undone.', danger: true }))) return;
    try {
      const response = await fetch(`/api/po/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error('Could not delete this PO.');
    }
  }

  function handleExportPdf() {
    exportListToPdf(
      'Purchase Orders',
      ['Project', 'PO Number', 'PO Date', 'Amount', 'Advance Received', 'Balance', 'Payment Terms'],
      records.map((r) => [r.project_id, r.po_number, formatDate(r.po_date), r.amount, r.advance_received, Math.max(0, r.amount - r.advance_received), r.payment_terms]),
      `purchase-orders-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  const columns: TableColumn<PoRecord>[] = [
    { key: 'project', header: 'Project', render: (r) => <Link href={`/projects/${r.project_id}`}>{r.project_id}</Link> },
    { key: 'poNumber', header: 'PO Number', render: (r) => r.po_number },
    { key: 'poDate', header: 'PO Date', render: (r) => formatDate(r.po_date) },
    { key: 'amount', header: 'Amount', cellClassName: historyStyles.amount, render: (r) => r.amount.toLocaleString('en-IN') },
    { key: 'advance', header: 'Advance', cellClassName: historyStyles.amount, render: (r) => r.advance_received.toLocaleString('en-IN') },
    { key: 'balance', header: 'Balance', cellClassName: historyStyles.amount, render: (r) => Math.max(0, r.amount - r.advance_received).toLocaleString('en-IN') },
    { key: 'paymentTerms', header: 'Payment Terms', render: (r) => r.payment_terms || '-' },
    { key: 'attachment', header: 'Attachment', render: (r) => (r.attachment_url ? <a href={r.attachment_url} target="_blank" rel="noreferrer">View</a> : '-') },
    {
      key: 'actions',
      header: '',
      render: (r) => isPrivileged && <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(r.id)}>Delete</button>
    }
  ];

  return (
    <AppShell title="Purchase Orders" subtitle="PO number, amount, advance received, and payment terms per project.">
        <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Log a PO</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          <FieldRow>
            <Field label="Project *">
              <Select value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))} required>
                <option value="">-- Select project --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} — {p.company || p.client_name}</option>
                ))}
              </Select>
            </Field>
            <Field label="PO number *">
              <Input value={form.poNumber} onChange={(e) => setForm((f) => ({ ...f, poNumber: e.target.value }))} required />
            </Field>
            <Field label="PO date">
              <Input type="date" value={form.poDate} onChange={(e) => setForm((f) => ({ ...f, poDate: e.target.value }))} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Amount">
              <Input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </Field>
            <Field label="Advance received">
              <Input type="number" value={form.advanceReceived} onChange={(e) => setForm((f) => ({ ...f, advanceReceived: e.target.value }))} />
            </Field>
            <Field label="Payment terms">
              <Input value={form.paymentTerms} onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))} />
            </Field>
          </FieldRow>
          <Field label="Attachment">
            <input type="file" disabled={uploading} onChange={(e) => handleAttachment(e.target.files?.[0] || null)} />
            {uploading && <div className={calcStyles.small}>Uploading…</div>}
            {form.attachmentUrl && <div className={calcStyles.small}><a href={form.attachmentUrl} target="_blank" rel="noreferrer">View uploaded file</a></div>}
          </Field>
          <SubmitButton disabled={creating}>{creating ? 'Saving…' : 'Log PO'}</SubmitButton>
        </form>

        <FilterBar className={historyStyles.toolbarSpaced}>
          <ToolbarButton onClick={handleExportPdf}>Export PDF</ToolbarButton>
          <ToolbarButton onClick={() => window.print()}>Print</ToolbarButton>
          <ToolbarButton onClick={load}>Refresh</ToolbarButton>
        </FilterBar>
        <div className={historyStyles.status}>{status}</div>
        {loaded && (
          <Table
            columns={columns}
            rows={records}
            rowKey={(r) => r.id}
            empty={<div className={historyStyles.empty}>No POs logged yet.</div>}
          />
        )}
    </AppShell>
  );
}
