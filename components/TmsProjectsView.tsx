'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import { DepartmentRecord, TmsPriority, TmsProjectRecord, TmsProjectStatus, UserRole } from '@/lib/types';
import { TMS_DEPARTMENTS } from '@/lib/tmsConstants';
import { TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE, TMS_PROJECT_STATUS_LABEL, TMS_PROJECT_STATUS_TONE, TMS_ROLE_LABEL } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import PersonPicker, { PersonPickerOption } from './ui/PersonPicker';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import SubmitButton from './ui/SubmitButton';
import FilterBar from './ui/FilterBar';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';

const EMPTY_FORM = {
  name: '',
  clientName: '',
  clientContact: '',
  description: '',
  departmentId: '',
  projectManagerId: '',
  teamMemberIds: [] as string[],
  startDate: '',
  estimatedCloseDate: '',
  budget: '',
  priority: 'medium' as TmsPriority,
  remarks: ''
};

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

interface TmsProjectsViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TmsProjectsView({ currentUser }: TmsProjectsViewProps) {
  void currentUser;
  const toast = useToast();
  const [projects, setProjects] = useState<TmsProjectRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [users, setUsers] = useState<PersonPickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  const [fDepartment, setFDepartment] = useState('');
  const [fStatus, setFStatus] = useState<TmsProjectStatus | ''>('');
  const [fPriority, setFPriority] = useState<TmsPriority | ''>('');
  const [fSearch, setFSearch] = useState('');

  const tmsDepartments = useMemo(() => departments.filter((d) => (TMS_DEPARTMENTS as readonly string[]).includes(d.name)), [departments]);

  async function load() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const [projectsRes, deptRes, usersRes] = await Promise.all([fetch('/api/tms/projects'), fetch('/api/departments'), fetch('/api/tms/assignable-users')]);
      if (!projectsRes.ok) throw new Error(String(projectsRes.status));
      const data: TmsProjectRecord[] = await projectsRes.json();
      setProjects(data);
      if (deptRes.ok) setDepartments(await deptRes.json());
      if (usersRes.ok) setUsers(await usersRes.json());
      setStatus(data.length ? `${data.length} project${data.length === 1 ? '' : 's'} found.` : '');
    } catch {
      setStatus('Could not reach the TMS API. Try refreshing.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return projects.filter((p) => {
      if (fDepartment && p.department_name !== fDepartment) return false;
      if (fStatus && p.status !== fStatus) return false;
      if (fPriority && p.priority !== fPriority) return false;
      if (q && ![p.project_code, p.name, p.client_name].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [projects, fDepartment, fStatus, fPriority, fSearch]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Project name is required.');
      return;
    }
    if (!form.departmentId) {
      toast.error('Department is required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/tms/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, budget: Number(form.budget) || 0 })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
      toast.success('Project created.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create this project.');
    } finally {
      setCreating(false);
    }
  }

  const columns: TableColumn<TmsProjectRecord>[] = [
    { key: 'project', header: 'Project', cellClassName: historyStyles.num, render: (p) => <>{p.project_code}<div>{p.name}</div></> },
    { key: 'client', header: 'Client', render: (p) => p.client_name || '-' },
    { key: 'department', header: 'Department', render: (p) => p.department_name },
    { key: 'manager', header: 'Manager', render: (p) => p.project_manager_name || '-' },
    { key: 'engineers', header: 'Engineers', render: (p) => (p.team_member_names.length ? p.team_member_names.join(', ') : '-') },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge tone={TMS_PROJECT_STATUS_TONE[p.status]} label={TMS_PROJECT_STATUS_LABEL[p.status]} /> },
    { key: 'priority', header: 'Priority', render: (p) => <PriorityBadge tone={TMS_PRIORITY_TONE[p.priority]} label={TMS_PRIORITY_LABEL[p.priority]} /> },
    {
      key: 'progress',
      header: 'Progress',
      render: (p) => (
        <>
          <div className={historyStyles.progressTrack}>
            <div className={historyStyles.progressFill} style={{ width: `${p.progress_percent}%` }} />
          </div>
          <div className={historyStyles.progressLabel}>{p.progress_percent}%</div>
        </>
      )
    },
    { key: 'estClose', header: 'Est. Close', render: (p) => formatDate(p.estimated_close_date) },
    { key: 'actions', header: '', render: (p) => <Link className={historyStyles.button} href={`/tms/projects/${p.id}`}>View</Link> }
  ];

  return (
    <AppShell title="TMS Projects" subtitle="Technical execution projects — team, budget, status, and progress.">
      <div className={historyStyles.actionRow}>
        <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New Project'}
        </button>
        <ToolbarButton onClick={load}>
          Refresh
        </ToolbarButton>
      </div>

      {showForm && (
        <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`} onSubmit={handleCreate}>
          <FieldRow>
            <Field label="Project name">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label="Department">
              <Select value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))} required>
                <option value="">Select department</option>
                {tmsDepartments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Project Manager / Technical Manager">
              <Select value={form.projectManagerId} onChange={(e) => setForm((f) => ({ ...f, projectManagerId: e.target.value }))}>
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.username}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <Field label={`Assign Technical Person${form.teamMemberIds.length ? ` (${form.teamMemberIds.length} selected)` : ''}`}>
            <PersonPicker
              options={users}
              selectedIds={form.teamMemberIds}
              onChange={(ids) => setForm((f) => ({ ...f, teamMemberIds: ids }))}
              multiple
              placeholder="Search engineer…"
              roleLabel={(role) => TMS_ROLE_LABEL[role] || role}
              emptyMessage="No matching active Technical Team members found."
            />
          </Field>
          <FieldRow>
            <Field label="Client name">
              <Input value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
            </Field>
            <Field label="Client contact details">
              <Input placeholder="Phone / email" value={form.clientContact} onChange={(e) => setForm((f) => ({ ...f, clientContact: e.target.value }))} />
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TmsPriority }))}>
                {(Object.keys(TMS_PRIORITY_LABEL) as TmsPriority[]).map((p) => (
                  <option key={p} value={p}>{TMS_PRIORITY_LABEL[p]}</option>
                ))}
              </Select>
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Start date">
              <Input type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <Field label="Estimated close date">
              <Input type="date" value={form.estimatedCloseDate} onChange={(e) => setForm((f) => ({ ...f, estimatedCloseDate: e.target.value }))} />
            </Field>
            <Field label="Budget">
              <Input type="number" min="0" value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} />
            </Field>
          </FieldRow>
          <Field label="Description">
            <Textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label="Notes / Remarks">
            <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </Field>
          <SubmitButton disabled={creating}>{creating ? 'Creating…' : 'Create project'}</SubmitButton>
        </form>
      )}

      <FilterBar>
        <input type="text" placeholder="Search project code, name, client…" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
        <Select auto value={fDepartment} onChange={(e) => setFDepartment(e.target.value)}>
          <option value="">All departments</option>
          {TMS_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </Select>
        <Select auto value={fStatus} onChange={(e) => setFStatus(e.target.value as TmsProjectStatus | '')}>
          <option value="">All statuses</option>
          {(Object.keys(TMS_PROJECT_STATUS_LABEL) as TmsProjectStatus[]).map((s) => (
            <option key={s} value={s}>{TMS_PROJECT_STATUS_LABEL[s]}</option>
          ))}
        </Select>
        <Select auto value={fPriority} onChange={(e) => setFPriority(e.target.value as TmsPriority | '')}>
          <option value="">All priorities</option>
          {(Object.keys(TMS_PRIORITY_LABEL) as TmsPriority[]).map((p) => (
            <option key={p} value={p}>{TMS_PRIORITY_LABEL[p]}</option>
          ))}
        </Select>
      </FilterBar>
      {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={8} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load TMS projects — check your connection and try again." onRetry={load} />
      ) : (
        <Table
          columns={columns}
          rows={filtered}
          rowKey={(p) => p.id}
          empty={
            <EmptyState
              icon={Layers}
              title={projects.length === 0 ? 'No TMS projects yet' : 'No projects match your filters'}
              message={projects.length === 0 ? 'Create your first technical project to start assigning tasks and tracking work.' : 'Try clearing a filter or search term.'}
              action={projects.length === 0 ? <button type="button" className={calcStyles.btn} onClick={() => setShowForm(true)}>+ New Project</button> : undefined}
            />
          }
        />
      )}
    </AppShell>
  );
}
