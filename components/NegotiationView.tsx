'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { NegotiationRecord, ProjectRecord, UserRole } from '@/lib/types';
import { exportListToPdf } from '@/lib/exportPdf';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { todayDateInputValue } from '@/lib/dateHelpers';

const EMPTY_FORM = { projectId: '', discussionDate: '', person: '', discussion: '', offerGiven: '', discount: '', revisedPrice: '', expectedClosure: '' };

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

interface NegotiationViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function NegotiationView({ currentUser }: NegotiationViewProps) {
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const [records, setRecords] = useState<NegotiationRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  async function load() {
    setStatus('Loading...');
    try {
      const [rRes, pRes] = await Promise.all([fetch('/api/negotiation'), fetch('/api/projects')]);
      if (!rRes.ok) throw new Error(String(rRes.status));
      const data: NegotiationRecord[] = await rRes.json();
      setRecords(data);
      setProjects(pRes.ok ? await pRes.json() : []);
      setStatus(data.length ? `${data.length} entr${data.length === 1 ? 'y' : 'ies'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the negotiation API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.projectId || !form.discussionDate) {
      toast.error('Project and discussion date are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/negotiation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, revisedPrice: Number(form.revisedPrice) || 0 })
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      await load();
    } catch {
      toast.error('Could not save this entry. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Delete this negotiation entry? This cannot be undone.', danger: true }))) return;
    try {
      const response = await fetch(`/api/negotiation/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error('Could not delete this entry.');
    }
  }

  function handleExportPdf() {
    exportListToPdf(
      'Negotiation History',
      ['Date', 'Project', 'Person', 'Discussion', 'Offer', 'Discount', 'Revised Price', 'Expected Closure'],
      records.map((r) => [formatDate(r.discussion_date), r.project_id, r.person, r.discussion, r.offer_given, r.discount, r.revised_price, formatDate(r.expected_closure)]),
      `negotiations-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  return (
    <AppShell title="Negotiation" subtitle="Discussion history for every project — offers, discounts, revised pricing.">
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Log a discussion</h2>
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
              <label className={calcStyles.label}>Discussion date *</label>
              <input type="date" className={calcStyles.formControl} value={form.discussionDate} onChange={(e) => setForm((f) => ({ ...f, discussionDate: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Person</label>
              <input className={calcStyles.formControl} placeholder="Defaults to you" value={form.person} onChange={(e) => setForm((f) => ({ ...f, person: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Discussion</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.discussion} onChange={(e) => setForm((f) => ({ ...f, discussion: e.target.value }))} />
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Offer given</label>
              <input className={calcStyles.formControl} value={form.offerGiven} onChange={(e) => setForm((f) => ({ ...f, offerGiven: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Discount</label>
              <input className={calcStyles.formControl} value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Revised price</label>
              <input type="number" className={calcStyles.formControl} value={form.revisedPrice} onChange={(e) => setForm((f) => ({ ...f, revisedPrice: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Expected closure date</label>
            <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={form.expectedClosure} onChange={(e) => setForm((f) => ({ ...f, expectedClosure: e.target.value }))} />
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Saving…' : 'Log discussion'}
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
                <th>Date</th>
                <th>Project</th>
                <th>Person</th>
                <th>Discussion</th>
                <th>Offer</th>
                <th>Discount</th>
                <th>Revised Price</th>
                <th>Expected Closure</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={9} className={historyStyles.empty}>No negotiation entries logged yet.</td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.discussion_date)}</td>
                    <td><Link href={`/projects/${r.project_id}`}>{r.project_id}</Link></td>
                    <td>{r.person}</td>
                    <td>{r.discussion || '-'}</td>
                    <td>{r.offer_given || '-'}</td>
                    <td>{r.discount || '-'}</td>
                    <td className={historyStyles.amount}>{r.revised_price ? r.revised_price.toLocaleString('en-IN') : '-'}</td>
                    <td>{formatDate(r.expected_closure)}</td>
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
    </AppShell>
  );
}
