'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { CustomerResponseRecord, CustomerResponseType, ProjectRecord, UserRole } from '@/lib/types';
import { exportListToPdf } from '@/lib/exportPdf';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { todayDateInputValue } from '@/lib/dateHelpers';

const EMPTY_FORM = { projectId: '', demoId: '', feedback: '', responseType: '' as CustomerResponseType | '', expectedDecisionDate: '', remarks: '' };

const TYPE_LABEL: Record<CustomerResponseType, string> = {
  interested: 'Interested',
  not_interested: 'Not interested',
  need_revision: 'Need revision',
  need_new_quotation: 'Need new quotation',
  budget_issue: 'Budget issue',
  competitor: 'Competitor'
};

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

interface CustomerResponseViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function CustomerResponseView({ currentUser }: CustomerResponseViewProps) {
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const [records, setRecords] = useState<CustomerResponseRecord[]>([]);
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
      const [rRes, pRes] = await Promise.all([fetch('/api/customer-response'), fetch('/api/projects')]);
      if (!rRes.ok) throw new Error(String(rRes.status));
      const data: CustomerResponseRecord[] = await rRes.json();
      setRecords(data);
      setProjects(pRes.ok ? await pRes.json() : []);
      setStatus(data.length ? `${data.length} response${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the customer response API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.projectId) {
      toast.error('Project is required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/customer-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      await load();
    } catch {
      toast.error('Could not save this response. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Delete this response? This cannot be undone.', danger: true }))) return;
    try {
      const response = await fetch(`/api/customer-response/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error('Could not delete this response.');
    }
  }

  function handleExportPdf() {
    exportListToPdf(
      'Customer Responses',
      ['Date', 'Project', 'Type', 'Feedback', 'Expected Decision', 'Logged By'],
      records.map((r) => [formatDate(r.created_at), r.project_id, r.response_type ? TYPE_LABEL[r.response_type] : '-', r.feedback, formatDate(r.expected_decision_date), r.created_by]),
      `customer-responses-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  return (
    <AppShell title="Customer Response" subtitle="What clients said after the demo.">
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Log a customer response</h2>
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
              <label className={calcStyles.label}>Response type</label>
              <select className={calcStyles.formControl} value={form.responseType} onChange={(e) => setForm((f) => ({ ...f, responseType: e.target.value as CustomerResponseType | '' }))}>
                <option value="">-- Select --</option>
                {(Object.keys(TYPE_LABEL) as CustomerResponseType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Expected decision date</label>
              <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={form.expectedDecisionDate} onChange={(e) => setForm((f) => ({ ...f, expectedDecisionDate: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Feedback</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.feedback} onChange={(e) => setForm((f) => ({ ...f, feedback: e.target.value }))} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Remarks</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Saving…' : 'Log response'}
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
                <th>Type</th>
                <th>Feedback</th>
                <th>Expected Decision</th>
                <th>Logged By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className={historyStyles.empty}>No customer responses logged yet.</td>
                </tr>
              ) : (
                records.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDate(r.created_at)}</td>
                    <td><Link href={`/projects/${r.project_id}`}>{r.project_id}</Link></td>
                    <td>{r.response_type ? TYPE_LABEL[r.response_type] : '-'}</td>
                    <td>{r.feedback || '-'}</td>
                    <td>{formatDate(r.expected_decision_date)}</td>
                    <td>{r.created_by}</td>
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
