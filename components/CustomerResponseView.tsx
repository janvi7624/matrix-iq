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
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';

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

  const columns: TableColumn<CustomerResponseRecord>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.created_at) },
    { key: 'project', header: 'Project', render: (r) => <Link href={`/projects/${r.project_id}`}>{r.project_id}</Link> },
    { key: 'type', header: 'Type', render: (r) => (r.response_type ? TYPE_LABEL[r.response_type] : '-') },
    { key: 'feedback', header: 'Feedback', render: (r) => r.feedback || '-' },
    { key: 'expectedDecision', header: 'Expected Decision', render: (r) => formatDate(r.expected_decision_date) },
    { key: 'loggedBy', header: 'Logged By', render: (r) => r.created_by },
    {
      key: 'actions',
      header: '',
      render: (r) => isPrivileged && <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(r.id)}>Delete</button>
    }
  ];

  return (
    <AppShell title="Customer Response" subtitle="What clients said after the demo.">
        <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Log a customer response</h2>
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
            <Field label="Response type">
              <Select value={form.responseType} onChange={(e) => setForm((f) => ({ ...f, responseType: e.target.value as CustomerResponseType | '' }))}>
                <option value="">-- Select --</option>
                {(Object.keys(TYPE_LABEL) as CustomerResponseType[]).map((t) => (
                  <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Expected decision date">
              <Input type="date" min={todayDateInputValue()} value={form.expectedDecisionDate} onChange={(e) => setForm((f) => ({ ...f, expectedDecisionDate: e.target.value }))} />
            </Field>
          </FieldRow>
          <Field label="Feedback">
            <Textarea rows={2} value={form.feedback} onChange={(e) => setForm((f) => ({ ...f, feedback: e.target.value }))} />
          </Field>
          <Field label="Remarks">
            <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </Field>
          <SubmitButton disabled={creating}>{creating ? 'Saving…' : 'Log response'}</SubmitButton>
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
            empty={<div className={historyStyles.empty}>No customer responses logged yet.</div>}
          />
        )}
    </AppShell>
  );
}
