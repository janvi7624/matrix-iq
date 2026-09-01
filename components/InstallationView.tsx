'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { InstallationRecord, ProjectRecord, UserRole } from '@/lib/types';
import { exportListToPdf } from '@/lib/exportPdf';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import { TableWrap } from './ui/Table';

const EMPTY_FORM = { projectId: '', installationDate: '', assignedEngineer: '' };

const STATUS_LABEL: Record<InstallationRecord['status'], string> = { scheduled: 'Scheduled', in_progress: 'In Progress', completed: 'Completed' };

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function InstallationRow({
  record,
  isPrivileged,
  onUpdate,
  onDelete
}: {
  record: InstallationRecord;
  isPrivileged: boolean;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [statusValue, setStatusValue] = useState(record.status);
  const [report, setReport] = useState(record.completion_report);
  const [signature, setSignature] = useState(record.client_signature);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setBusy(true);
    try {
      await onUpdate(record.id, { status: statusValue, completionReport: report, clientSignature: signature });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          <button type="button" className={historyStyles.toggleBtn} onClick={() => setExpanded((v) => !v)}>{expanded ? '−' : '+'}</button>
        </td>
        <td><Link href={`/projects/${record.project_id}`}>{record.project_id}</Link></td>
        <td>{formatDate(record.installation_date)}</td>
        <td>{record.assigned_engineer || '-'}</td>
        <td>{STATUS_LABEL[record.status]}</td>
        <td>
          {isPrivileged && (
            <button type="button" className={historyStyles.deleteBtn} onClick={() => onDelete(record.id)}>Delete</button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className={historyStyles.detailsRow}>
          <td colSpan={6}>
            <Field label="Status">
              <Select value={statusValue} onChange={(e) => setStatusValue(e.target.value as InstallationRecord['status'])}>
                {(Object.keys(STATUS_LABEL) as InstallationRecord['status'][]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Completion report">
              <Textarea rows={2} value={report} onChange={(e) => setReport(e.target.value)} />
            </Field>
            <Field label="Client signature (typed name)">
              <Input value={signature} onChange={(e) => setSignature(e.target.value)} />
            </Field>
            <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleSave}>
              {busy ? 'Saving…' : 'Save update'}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

interface InstallationViewProps {
  currentUser: { username: string; role: UserRole; isPrivileged: boolean };
}

export default function InstallationView({ currentUser }: InstallationViewProps) {
  // Role Management's isPrivileged flag, resolved server-side — NOT
  // re-derived from role name, since an admin can toggle a role's
  // privileged status independently of what the role is called.
  const isPrivileged = currentUser.isPrivileged;
  const [records, setRecords] = useState<InstallationRecord[]>([]);
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
      const [rRes, pRes] = await Promise.all([fetch('/api/installation'), fetch('/api/projects')]);
      if (!rRes.ok) throw new Error(String(rRes.status));
      const data: InstallationRecord[] = await rRes.json();
      setRecords(data);
      setProjects(pRes.ok ? await pRes.json() : []);
      setStatus(data.length ? `${data.length} installation${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the installation API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.projectId || !form.installationDate) {
      toast.error('Project and installation date are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/installation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      await load();
    } catch {
      toast.error('Could not save this installation. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(id: string, patch: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/installation/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch {
      toast.error('Could not save this update.');
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Delete this installation? This cannot be undone.', danger: true }))) return;
    try {
      const response = await fetch(`/api/installation/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error('Could not delete this installation.');
    }
  }

  function handleExportPdf() {
    exportListToPdf(
      'Installations',
      ['Project', 'Installation Date', 'Engineer', 'Status', 'Completion Report'],
      records.map((r) => [r.project_id, formatDate(r.installation_date), r.assigned_engineer, STATUS_LABEL[r.status], r.completion_report]),
      `installations-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  return (
    <AppShell title="Installation" subtitle="Schedule installs, assign an engineer, and close out with a completion report.">
        <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Schedule an installation</h2>
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
            <Field label="Installation date *">
              <Input type="date" value={form.installationDate} onChange={(e) => setForm((f) => ({ ...f, installationDate: e.target.value }))} required />
            </Field>
            <Field label="Assigned engineer">
              <Input value={form.assignedEngineer} onChange={(e) => setForm((f) => ({ ...f, assignedEngineer: e.target.value }))} />
            </Field>
          </FieldRow>
          <SubmitButton disabled={creating}>{creating ? 'Saving…' : 'Schedule installation'}</SubmitButton>
        </form>

        <FilterBar className={historyStyles.toolbarSpaced}>
          <ToolbarButton onClick={handleExportPdf}>Export PDF</ToolbarButton>
          <ToolbarButton onClick={() => window.print()}>Print</ToolbarButton>
          <ToolbarButton onClick={load}>Refresh</ToolbarButton>
        </FilterBar>
        <div className={historyStyles.status}>{status}</div>
        {loaded && (
          <TableWrap>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th></th>
                <th>Project</th>
                <th>Installation Date</th>
                <th>Engineer</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={6} className={historyStyles.empty}>No installations scheduled yet.</td>
                </tr>
              ) : (
                records.map((r) => <InstallationRow key={r.id} record={r} isPrivileged={isPrivileged} onUpdate={handleUpdate} onDelete={handleDelete} />)
              )}
            </tbody>
          </table>
          </TableWrap>
        )}
    </AppShell>
  );
}
