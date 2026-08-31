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
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';

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

  const columns: TableColumn<NegotiationRecord>[] = [
    { key: 'date', header: 'Date', render: (r) => formatDate(r.discussion_date) },
    { key: 'project', header: 'Project', render: (r) => <Link href={`/projects/${r.project_id}`}>{r.project_id}</Link> },
    { key: 'person', header: 'Person', render: (r) => r.person },
    { key: 'discussion', header: 'Discussion', render: (r) => r.discussion || '-' },
    { key: 'offer', header: 'Offer', render: (r) => r.offer_given || '-' },
    { key: 'discount', header: 'Discount', render: (r) => r.discount || '-' },
    { key: 'revisedPrice', header: 'Revised Price', cellClassName: historyStyles.amount, render: (r) => (r.revised_price ? r.revised_price.toLocaleString('en-IN') : '-') },
    { key: 'expectedClosure', header: 'Expected Closure', render: (r) => formatDate(r.expected_closure) },
    {
      key: 'actions',
      header: '',
      render: (r) => isPrivileged && <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(r.id)}>Delete</button>
    }
  ];

  return (
    <AppShell title="Negotiation" subtitle="Discussion history for every project — offers, discounts, revised pricing.">
        <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Log a discussion</h2>
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
            <Field label="Discussion date *">
              <Input type="date" value={form.discussionDate} onChange={(e) => setForm((f) => ({ ...f, discussionDate: e.target.value }))} required />
            </Field>
            <Field label="Person">
              <Input placeholder="Defaults to you" value={form.person} onChange={(e) => setForm((f) => ({ ...f, person: e.target.value }))} />
            </Field>
          </FieldRow>
          <Field label="Discussion">
            <Textarea rows={2} value={form.discussion} onChange={(e) => setForm((f) => ({ ...f, discussion: e.target.value }))} />
          </Field>
          <FieldRow>
            <Field label="Offer given">
              <Input value={form.offerGiven} onChange={(e) => setForm((f) => ({ ...f, offerGiven: e.target.value }))} />
            </Field>
            <Field label="Discount">
              <Input value={form.discount} onChange={(e) => setForm((f) => ({ ...f, discount: e.target.value }))} />
            </Field>
            <Field label="Revised price">
              <Input type="number" value={form.revisedPrice} onChange={(e) => setForm((f) => ({ ...f, revisedPrice: e.target.value }))} />
            </Field>
          </FieldRow>
          <Field label="Expected closure date">
            <Input type="date" min={todayDateInputValue()} value={form.expectedClosure} onChange={(e) => setForm((f) => ({ ...f, expectedClosure: e.target.value }))} />
          </Field>
          <SubmitButton disabled={creating}>{creating ? 'Saving…' : 'Log discussion'}</SubmitButton>
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
            empty={<div className={historyStyles.empty}>No negotiation entries logged yet.</div>}
          />
        )}
    </AppShell>
  );
}
