'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import { DepartmentRecord, PublicUser, TmsPriority, TmsProjectRecord, TmsProjectStatus, UserRole } from '@/lib/types';
import { TMS_DEPARTMENTS } from '@/lib/tmsConstants';
import { TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE, TMS_PROJECT_STATUS_LABEL, TMS_PROJECT_STATUS_TONE } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';

const EMPTY_FORM = {
  name: '',
  clientName: '',
  clientContact: '',
  description: '',
  departmentId: '',
  projectManagerId: '',
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
  const [users, setUsers] = useState<PublicUser[]>([]);
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
      const [projectsRes, deptRes, usersRes] = await Promise.all([fetch('/api/tms/projects'), fetch('/api/departments'), fetch('/api/users/lite')]);
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

  return (
    <AppShell title="TMS Projects" subtitle="Technical execution projects — team, budget, status, and progress.">
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : '+ New Project'}
        </button>
        <button type="button" className={historyStyles.button} onClick={load}>
          Refresh
        </button>
      </div>

      {showForm && (
        <form className={calcStyles.sectionPanel} onSubmit={handleCreate} style={{ marginBottom: 20 }}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Project name</label>
              <input className={calcStyles.formControl} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Department</label>
              <select className={calcStyles.formControl} value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))} required>
                <option value="">Select department</option>
                {tmsDepartments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Project Manager / Technical Manager</label>
              <select className={calcStyles.formControl} value={form.projectManagerId} onChange={(e) => setForm((f) => ({ ...f, projectManagerId: e.target.value }))}>
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name || u.username}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client name</label>
              <input className={calcStyles.formControl} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client contact details</label>
              <input className={calcStyles.formControl} placeholder="Phone / email" value={form.clientContact} onChange={(e) => setForm((f) => ({ ...f, clientContact: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Priority</label>
              <select className={calcStyles.formControl} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as TmsPriority }))}>
                {(Object.keys(TMS_PRIORITY_LABEL) as TmsPriority[]).map((p) => (
                  <option key={p} value={p}>{TMS_PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Start date</label>
              <input type="date" className={calcStyles.formControl} value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Estimated close date</label>
              <input type="date" className={calcStyles.formControl} value={form.estimatedCloseDate} onChange={(e) => setForm((f) => ({ ...f, estimatedCloseDate: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Budget</label>
              <input type="number" min="0" className={calcStyles.formControl} value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Description</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Notes / Remarks</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </div>
          <button type="submit" className={calcStyles.btn} disabled={creating}>
            {creating ? 'Creating…' : 'Create project'}
          </button>
        </form>
      )}

      <div className={historyStyles.toolbar}>
        <input type="text" placeholder="Search project code, name, client…" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
        <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fDepartment} onChange={(e) => setFDepartment(e.target.value)}>
          <option value="">All departments</option>
          {TMS_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fStatus} onChange={(e) => setFStatus(e.target.value as TmsProjectStatus | '')}>
          <option value="">All statuses</option>
          {(Object.keys(TMS_PROJECT_STATUS_LABEL) as TmsProjectStatus[]).map((s) => (
            <option key={s} value={s}>{TMS_PROJECT_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fPriority} onChange={(e) => setFPriority(e.target.value as TmsPriority | '')}>
          <option value="">All priorities</option>
          {(Object.keys(TMS_PRIORITY_LABEL) as TmsPriority[]).map((p) => (
            <option key={p} value={p}>{TMS_PRIORITY_LABEL[p]}</option>
          ))}
        </select>
      </div>
      {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={8} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load TMS projects — check your connection and try again." onRetry={load} />
      ) : (
        <table className={historyStyles.table}>
          <thead>
            <tr>
              <th>Project</th>
              <th>Client</th>
              <th>Department</th>
              <th>Manager</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Progress</th>
              <th>Est. Close</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    icon={Layers}
                    title={projects.length === 0 ? 'No TMS projects yet' : 'No projects match your filters'}
                    message={projects.length === 0 ? 'Create your first technical project to start assigning tasks and tracking work.' : 'Try clearing a filter or search term.'}
                    action={projects.length === 0 ? <button type="button" className={calcStyles.btn} onClick={() => setShowForm(true)}>+ New Project</button> : undefined}
                  />
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id}>
                  <td className={historyStyles.num}>{p.project_code}<div>{p.name}</div></td>
                  <td>{p.client_name || '-'}</td>
                  <td>{p.department_name}</td>
                  <td>{p.project_manager_name || '-'}</td>
                  <td><StatusBadge tone={TMS_PROJECT_STATUS_TONE[p.status]} label={TMS_PROJECT_STATUS_LABEL[p.status]} /></td>
                  <td><PriorityBadge tone={TMS_PRIORITY_TONE[p.priority]} label={TMS_PRIORITY_LABEL[p.priority]} /></td>
                  <td>
                    <div className={historyStyles.progressTrack}>
                      <div className={historyStyles.progressFill} style={{ width: `${p.progress_percent}%` }} />
                    </div>
                    <div className={historyStyles.progressLabel}>{p.progress_percent}%</div>
                  </td>
                  <td>{formatDate(p.estimated_close_date)}</td>
                  <td>
                    <Link className={historyStyles.button} href={`/tms/projects/${p.id}`}>View</Link>
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
