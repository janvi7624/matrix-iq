'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { PoRecord, ProjectRecord, UserRole } from '@/lib/types';
import { exportListToPdf } from '@/lib/exportPdf';
import PortalHeader from './PortalHeader';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';

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
  currentUser: { username: string; role: UserRole };
}

export default function PoView({ currentUser }: PoViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
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

  return (
    <div className={historyStyles.body}>
      <PortalHeader title="Purchase Orders" subtitle="PO number, amount, advance received, and payment terms per project." />
      <main className={historyStyles.main}>
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Log a PO</h2>
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Project *</label>
              <select className={calcStyles.formControl} value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))} required>
                <option value="">-- Select project --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} — {p.company || p.client_name}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>PO number *</label>
              <input className={calcStyles.formControl} value={form.poNumber} onChange={(e) => setForm((f) => ({ ...f, poNumber: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>PO date</label>
              <input type="date" className={calcStyles.formControl} value={form.poDate} onChange={(e) => setForm((f) => ({ ...f, poDate: e.target.value }))} />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Amount</label>
              <input type="number" className={calcStyles.formControl} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Advance received</label>
              <input type="number" className={calcStyles.formControl} value={form.advanceReceived} onChange={(e) => setForm((f) => ({ ...f, advanceReceived: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Payment terms</label>
              <input className={calcStyles.formControl} value={form.paymentTerms} onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Attachment</label>
            <input type="file" disabled={uploading} onChange={(e) => handleAttachment(e.target.files?.[0] || null)} />
            {uploading && <div className={calcStyles.small}>Uploading…</div>}
            {form.attachmentUrl && <div className={calcStyles.small}><a href={form.attachmentUrl} target="_blank" rel="noreferrer">View uploaded file</a></div>}
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Saving…' : 'Log PO'}
          </button>
        </form>

        <div className={historyStyles.toolbar} style={{ marginTop: 24 }}>
          <button type="button" className={historyStyles.button} onClick={handleExportPdf}>Export PDF</button>
          <button type="button" className={historyStyles.button} onClick={() => window.print()}>Print</button>
          <button type="button" className={historyStyles.button} onClick={load}>Refresh</button>
        </div>
        <div className={historyStyles.status}>{status}</div>
        {loaded && (
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Project</th>
                <th>PO Number</th>
                <th>PO Date</th>
                <th>Amount</th>
                <th>Advance</th>
                <th>Balance</th>
                <th>Payment Terms</th>
                <th>Attachment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={9} className={historyStyles.empty}>No POs logged yet.</td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/projects/${r.project_id}`}>{r.project_id}</Link></td>
                    <td>{r.po_number}</td>
                    <td>{formatDate(r.po_date)}</td>
                    <td className={historyStyles.amount}>{r.amount.toLocaleString('en-IN')}</td>
                    <td className={historyStyles.amount}>{r.advance_received.toLocaleString('en-IN')}</td>
                    <td className={historyStyles.amount}>{Math.max(0, r.amount - r.advance_received).toLocaleString('en-IN')}</td>
                    <td>{r.payment_terms || '-'}</td>
                    <td>{r.attachment_url ? <a href={r.attachment_url} target="_blank" rel="noreferrer">View</a> : '-'}</td>
                    <td>
                      {isPrivileged && (
                        <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(r.id)}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
