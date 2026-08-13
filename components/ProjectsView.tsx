'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ProjectPriority, ProjectRecord, ProjectStage, ProjectStatus, UserRole } from '@/lib/types';
import { FORWARD_STAGES, STAGE_LABEL, stageProgressPercent } from '@/lib/projectStages';
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

const EMPTY_FORM = {
  clientName: '',
  company: '',
  contactPerson: '',
  phone: '',
  email: '',
  address: '',
  salesPerson: '',
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
  currentUser: { username: string; role: UserRole };
}

export default function ProjectsView({ currentUser }: ProjectsViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);

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
      ['Project ID', 'Client', 'Company', 'Sales Person', 'Stage', 'Status', 'Priority', 'Last Updated', 'Next Follow-up'],
      filtered.map((p) => [p.id, p.client_name, p.company, p.sales_person, STAGE_LABEL[p.stage], STATUS_LABEL[p.status], PRIORITY_LABEL[p.priority], formatDateTime(p.updated_at), formatDate(p.next_follow_up_date)]),
      `projects-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  return (
    <AppShell title="Project Dashboard" subtitle="Every sales project, site visit to close, in one pipeline.">
        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New Project'}
          </button>
          <button type="button" className={historyStyles.button} onClick={handleExportPdf}>
            Export PDF
          </button>
          <button type="button" className={historyStyles.button} onClick={() => window.print()}>
            Print
          </button>
          <button type="button" className={historyStyles.button} onClick={load}>
            Refresh
          </button>
        </div>

        {showForm && (
          <form className={calcStyles.sectionPanel} onSubmit={handleCreate} style={{ marginBottom: 20 }}>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Client name</label>
                <input className={calcStyles.formControl} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Company</label>
                <input className={calcStyles.formControl} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Contact person</label>
                <input className={calcStyles.formControl} value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} />
              </div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Phone</label>
                <input className={calcStyles.formControl} value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Email</label>
                <input type="email" className={calcStyles.formControl} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Address</label>
                <input className={calcStyles.formControl} value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Sales person</label>
                <input className={calcStyles.formControl} placeholder="Defaults to you" value={form.salesPerson} onChange={(e) => setForm((f) => ({ ...f, salesPerson: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Source</label>
                <input className={calcStyles.formControl} placeholder="Referral, website, cold call…" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Priority</label>
                <select className={calcStyles.formControl} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as ProjectPriority }))}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Expected closing date</label>
                <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={form.expectedClosingDate} onChange={(e) => setForm((f) => ({ ...f, expectedClosingDate: e.target.value }))} />
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Remarks</label>
              <textarea className={calcStyles.formControl} rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
            </div>
            <button type="submit" className={calcStyles.btn} disabled={creating}>
              {creating ? 'Creating…' : 'Create project'}
            </button>
          </form>
        )}

        <div className={historyStyles.toolbar}>
          <input type="text" placeholder="Search client, company, project ID…" value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
          {isPrivileged && (
            <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fSalesPerson} onChange={(e) => setFSalesPerson(e.target.value)}>
              <option value="">All sales people</option>
              {salesPeople.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fStage} onChange={(e) => setFStage(e.target.value as ProjectStage | '')}>
            <option value="">All stages</option>
            {FORWARD_STAGES.concat('closed_lost').map((s) => (
              <option key={s} value={s}>{STAGE_LABEL[s]}</option>
            ))}
          </select>
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fStatus} onChange={(e) => setFStatus(e.target.value as ProjectStatus | '')}>
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <select className={calcStyles.formControl} style={{ width: 'auto' }} value={fPriority} onChange={(e) => setFPriority(e.target.value as ProjectPriority | '')}>
            <option value="">All priorities</option>
            {(Object.keys(PRIORITY_LABEL) as ProjectPriority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
            ))}
          </select>
          <input type="date" className={calcStyles.formControl} style={{ width: 'auto' }} value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
          <input type="date" className={calcStyles.formControl} style={{ width: 'auto' }} value={fTo} onChange={(e) => setFTo(e.target.value)} />
        </div>
        {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

        {loading ? (
          <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={9} /></div>
        ) : loadFailed ? (
          <ErrorState message="Could not load projects — check your connection and try again." onRetry={load} />
        ) : (
        loaded && (
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th>Project ID</th>
                <th>Client</th>
                <th>Sales Person</th>
                <th>Stage</th>
                <th>Status</th>
                <th>Last Updated</th>
                <th>Next Follow-up</th>
                <th>Progress</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      icon="📁"
                      title={projects.length === 0 ? 'No projects yet' : 'No projects match your filters'}
                      message={projects.length === 0 ? 'Create your first project to start tracking it through the pipeline.' : 'Try clearing a filter or search term.'}
                      action={projects.length === 0 ? <button type="button" className={calcStyles.btn} onClick={() => setShowForm((v) => !v)}>+ New Project</button> : undefined}
                    />
                  </td>
                </tr>
              ) : (
                filtered.map((p) => (
                  <tr key={p.id}>
                    <td className={historyStyles.num}>{p.id}</td>
                    <td>
                      {p.client_name || p.company || '-'}
                      {p.company && p.client_name ? ` (${p.company})` : ''}
                    </td>
                    <td>{p.sales_person}</td>
                    <td>{STAGE_LABEL[p.stage]}</td>
                    <td>{STATUS_LABEL[p.status]}</td>
                    <td>{formatDateTime(p.updated_at)}</td>
                    <td>{formatDate(p.next_follow_up_date)}</td>
                    <td>
                      <div className={historyStyles.progressTrack}>
                        <div
                          className={`${historyStyles.progressFill} ${p.status === 'lost' ? historyStyles.progressFillLost : ''}`}
                          style={{ width: `${p.status === 'lost' ? 100 : stageProgressPercent(p.stage)}%` }}
                        />
                      </div>
                      <div className={historyStyles.progressLabel}>{p.status === 'lost' ? 'Closed Lost' : `${stageProgressPercent(p.stage)}%`}</div>
                    </td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <Link className={historyStyles.button} href={`/projects/${p.id}`}>
                        View
                      </Link>
                      {isPrivileged && (
                        <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(p.id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )
        )}
    </AppShell>
  );
}
