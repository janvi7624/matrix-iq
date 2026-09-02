'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FolderKanban } from 'lucide-react';
import { ProjectPriority, ProjectRecord, ProjectStage, ProjectStatus, UserRole } from '@/lib/types';
import { FORWARD_STAGES, STAGE_LABEL, stageProgressPercent } from '@/lib/projectStages';
import PhoneInput from '@/components/ui/PhoneInput';
import { exportListToPdf } from '@/lib/exportPdf';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { useToast } from './ui/ToastProvider';
import { todayDateInputValue } from '@/lib/dateHelpers';
import { useConfirm } from './ui/ConfirmDialog';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import StatusBadge from './ui/StatusBadge';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';

const EMPTY_FORM = {
  clientName: '',
  company: '',
  contactPerson: '',
  altContactPhone: '',
  phone: '',
  email: '',
  address: '',
  salesPersonId: '',
  source: '',
  priority: 'medium' as ProjectPriority,
  expectedClosingDate: '',
  remarks: ''
};

const STATUS_LABEL: Record<ProjectStatus, string> = { active: 'Active', on_hold: 'On Hold', won: 'Won', lost: 'Lost' };
const PRIORITY_LABEL: Record<ProjectPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

interface ProjectsViewProps {
  currentUser: { username: string; role: UserRole; isPrivileged: boolean };
}

export default function ProjectsView({ currentUser }: ProjectsViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  // Role Management's isPrivileged flag, resolved server-side — NOT
  // re-derived from role name, since an admin can toggle a role's
  // privileged status independently of what the role is called.
  const isPrivileged = currentUser.isPrivileged;
  const isSuperAdmin = currentUser.role === 'superadmin';
  const isTechnical = currentUser.role === 'engineer';
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; username: string; name: string }[]>([]);

  useEffect(() => {
    if (!isPrivileged) return;
    fetch('/api/users/list')
      .then((r) => (r.ok ? r.json() : []))
      .then((users: { id: string; username: string; name: string }[]) => setAssignableUsers(users))
      .catch(() => setAssignableUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [fSalesPerson, setFSalesPerson] = useState('');
  const [fStage, setFStage] = useState<ProjectStage | ''>('');
  const [fStatus, setFStatus] = useState<ProjectStatus | ''>('');
  const [fPriority, setFPriority] = useState<ProjectPriority | ''>('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fSearch, setFSearch] = useState('');

  async function load() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error(String(response.status));
      const data: ProjectRecord[] = await response.json();
      setProjects(data);
      setStatus(data.length ? `${data.length} project${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the projects API. Try refreshing.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const salesPeople = useMemo(() => Array.from(new Set(projects.map((p) => p.sales_person).filter(Boolean))).sort(), [projects]);

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return projects.filter((p) => {
      if (fSalesPerson && p.sales_person !== fSalesPerson) return false;
      if (fStage && p.stage !== fStage) return false;
      if (fStatus && p.status !== fStatus) return false;
      if (fPriority && p.priority !== fPriority) return false;
      if (fFrom && p.created_at.slice(0, 10) < fFrom) return false;
      if (fTo && p.created_at.slice(0, 10) > fTo) return false;
      if (q && ![p.id, p.client_name, p.company, p.contact_person].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [projects, fSalesPerson, fStage, fStatus, fPriority, fFrom, fTo, fSearch]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.clientName.trim() && !form.company.trim()) {
      toast.error('Client name or company is required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch {
      toast.error('Could not create this project. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Delete this project? This cannot be undone.', danger: true }))) return;
    try {
      const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch {
      toast.error('Could not delete this project.');
    }
  }

  function handleExportPdf() {
    exportListToPdf(
      'Project Dashboard',
      ['Client', 'Company', 'Sales Person', 'Stage', 'Status', 'Priority', 'Last Updated', 'Next Follow-up'],
      filtered.map((p) => [p.client_name, p.company, p.sales_person, STAGE_LABEL[p.stage], STATUS_LABEL[p.status], PRIORITY_LABEL[p.priority], formatDateTime(p.updated_at), formatDate(p.next_follow_up_date)]),
      `projects-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  const columns: TableColumn<ProjectRecord>[] = [
    {
      key: 'client',
      header: 'Client',
      render: (p) => (
        <>
          {p.client_name || p.company || '-'}
          {p.company && p.client_name ? ` (${p.company})` : ''}
        </>
      )
    },
    { key: 'salesPerson', header: 'Sales Person', render: (p) => p.sales_person },
    { key: 'stage', header: 'Stage', render: (p) => STAGE_LABEL[p.stage] },
    {
      key: 'status',
      header: 'Status',
      render: (p) =>
        p.status === 'won' || p.status === 'lost' ? (
          <StatusBadge tone={p.status} label={p.status === 'lost' ? 'Closed Lost' : STATUS_LABEL[p.status]} />
        ) : (
          STATUS_LABEL[p.status]
        )
    },
    { key: 'updated', header: 'Last Updated', render: (p) => formatDateTime(p.updated_at) },
    { key: 'nextFollowUp', header: 'Next Follow-up', render: (p) => formatDate(p.next_follow_up_date) },
    {
      key: 'progress',
      header: 'Progress',
      render: (p) => (
        <>
          <div className={historyStyles.progressTrack}>
            <div
              className={`${historyStyles.progressFill} ${p.status === 'lost' ? historyStyles.progressFillLost : p.status === 'won' ? historyStyles.progressFillWon : historyStyles.progressFillActive}`}
              style={{ width: `${p.status === 'lost' || p.status === 'won' ? 100 : stageProgressPercent(p.stage)}%` }}
            />
          </div>
          <div className={historyStyles.progressLabel}>
            {p.status === 'lost' ? 'Closed Lost' : p.status === 'won' ? 'Won' : `${stageProgressPercent(p.stage)}%`}
          </div>
        </>
      )
    },
    {
      key: 'actions',
      header: '',
      cellClassName: historyStyles.rowActionsInline,
      render: (p) => (
        <>
          <Link className={historyStyles.button} href={`/projects/${p.id}`}>
            View
          </Link>
          {isSuperAdmin && (
            <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(p.id)}>
              Delete
            </button>
          )}
        </>
      )
    }
  ];

  return (
    <AppShell title="Project Dashboard" subtitle="Every sales project, site visit to close, in one pipeline.">
        <div className={historyStyles.actionRow}>
          {!isTechnical && (
            <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : '+ New Project'}
            </button>
          )}
          <ToolbarButton onClick={handleExportPdf}>
            Export PDF
          </ToolbarButton>
          <ToolbarButton onClick={() => window.print()}>
            Print
          </ToolbarButton>
          <ToolbarButton onClick={load}>
            Refresh
          </ToolbarButton>
        </div>

        {showForm && (
          <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`} onSubmit={handleCreate}>
            <FieldRow>
              <Field label="Client Representative Name">
                <Input value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
              </Field>
              <Field label="Company">
                <Input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Phone">
                <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </Field>
              <Field label="Address">
                <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Alternate Contact Name (optional)">
                <Input value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
              </Field>
              <Field label="Alternate Contact Phone (optional)">
                <PhoneInput value={form.altContactPhone} onChange={(v) => setForm((f) => ({ ...f, altContactPhone: v }))} />
              </Field>
            </FieldRow>
            <FieldRow>
              {isPrivileged && (
                <Field label="Sales person">
                  <Select value={form.salesPersonId} onChange={(e) => setForm((f) => ({ ...f, salesPersonId: e.target.value }))}>
                    <option value="">Defaults to you</option>
                    {assignableUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.name || u.username}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Source">
                <Input placeholder="Referral, website, cold call…" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
              </Field>
              <Field label="Priority">
                <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as ProjectPriority }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </Select>
              </Field>
              <Field label="Expected closing date">
                <Input type="date" min={todayDateInputValue()} value={form.expectedClosingDate} onChange={(e) => setForm((f) => ({ ...f, expectedClosingDate: e.target.value }))} />
              </Field>
            </FieldRow>
            <Field label="Remarks">
              <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
            </Field>
            <SubmitButton disabled={creating}>{creating ? 'Creating…' : 'Create project'}</SubmitButton>
          </form>
        )}

        <FilterBar>
          <input type="text" placeholder="Search client, company, project ID…" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
          {isPrivileged && (
            <Select auto value={fSalesPerson} onChange={(e) => setFSalesPerson(e.target.value)}>
              <option value="">All sales people</option>
              {salesPeople.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          )}
          <Select auto value={fStage} onChange={(e) => setFStage(e.target.value as ProjectStage | '')}>
            <option value="">All stages</option>
            {FORWARD_STAGES.concat('closed_lost').map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </Select>
          <Select auto value={fStatus} onChange={(e) => setFStatus(e.target.value as ProjectStatus | '')}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </Select>
          <Select auto value={fPriority} onChange={(e) => setFPriority(e.target.value as ProjectPriority | '')}>
            <option value="">All priorities</option>
            {(Object.keys(PRIORITY_LABEL) as ProjectPriority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </Select>
          <Input auto type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          <Input auto type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
        </FilterBar>
        {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

        {loading ? (
          <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={9} /></div>
        ) : loadFailed ? (
          <ErrorState message="Could not load projects — check your connection and try again." onRetry={load} />
        ) : (
        loaded && (
          <Table
            columns={columns}
            rows={filtered}
            rowKey={(p) => p.id}
            empty={
              <EmptyState
                icon={FolderKanban}
                title={projects.length === 0 ? (isTechnical ? 'No projects assigned to you yet' : 'No projects yet') : 'No projects match your filters'}
                message={projects.length === 0 ? (isTechnical ? "You'll see a project here once someone assigns you as its technical lead." : 'Create your first project to start tracking it through the pipeline.') : 'Try clearing a filter or search term.'}
                action={projects.length === 0 && !isTechnical ? <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>+ New Project</button> : undefined}
              />
            }
          />
        )
        )}
    </AppShell>
  );
}
