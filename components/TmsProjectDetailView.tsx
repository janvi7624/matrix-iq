'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FileText, Layers, Paperclip, ShoppingCart, Check } from 'lucide-react';
import { TmsBomRequestRecord, TmsPriority, TmsProcurementRecord, TmsProjectRecord, TmsProjectStatus, TmsTaskRecord, UserRole } from '@/lib/types';
import { TMS_BOM_STATUS_LABEL, TMS_BOM_STATUS_TONE, TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE, TMS_PROJECT_STATUS_LABEL, TMS_PROJECT_STATUS_TONE, TMS_PURCHASE_STATUS_LABEL, TMS_PURCHASE_STATUS_TONE, TMS_ROLE_LABEL, TMS_TASK_STATUS_LABEL, TMS_TASK_STATUS_TONE } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import PersonPicker, { PersonPickerOption } from './ui/PersonPicker';
import { useToast } from './ui/ToastProvider';
import EmptyState from './ui/EmptyState';

// The real pipeline every TMS project moves through (tms_projects.status —
// see lib/tmsLabels.ts's TMS_PROJECT_STATUS_LABEL for the source of truth).
// on_hold/cancelled are side-states, not sequential pipeline steps — a
// project can be "in_progress AND on_hold", so they're shown as a separate
// badge (already rendered above this stepper) rather than a step in it.
const PROJECT_PIPELINE: TmsProjectStatus[] = ['planning', 'not_started', 'in_progress', 'completed'];

function ProjectWorkflowStepper({ status }: { status: TmsProjectStatus }) {
  const isSideState = status === 'on_hold' || status === 'cancelled';
  const activeIndex = isSideState ? -1 : PROJECT_PIPELINE.indexOf(status);
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0, margin: '4px 0 16px' }}>
      {PROJECT_PIPELINE.map((step, i) => {
        const done = !isSideState && i < activeIndex;
        const current = !isSideState && i === activeIndex;
        return (
          <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 84 }}>
              <div
                style={{
                  width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11.5, fontWeight: 700,
                  background: done ? 'var(--mx-success)' : current ? 'var(--mx-brand)' : 'var(--mx-surface-sunken)',
                  color: done || current ? '#fff' : 'var(--mx-ink-faint)',
                  border: current ? '2px solid var(--mx-brand-hover)' : '1px solid var(--mx-border)'
                }}
              >
                {done ? <Check size={13} /> : i + 1}
              </div>
              <span style={{ fontSize: 11, fontWeight: current ? 700 : 500, color: current ? 'var(--mx-ink)' : 'var(--mx-ink-muted)', textAlign: 'center' }}>
                {TMS_PROJECT_STATUS_LABEL[step]}
              </span>
            </div>
            {i < PROJECT_PIPELINE.length - 1 && (
              <div style={{ width: 32, height: 2, background: done ? 'var(--mx-success)' : 'var(--mx-border)', marginBottom: 16 }} />
            )}
          </div>
        );
      })}
      {isSideState && (
        <span style={{ marginLeft: 12, marginBottom: 16 }}>
          <StatusBadge tone={TMS_PROJECT_STATUS_TONE[status]} label={`Currently: ${TMS_PROJECT_STATUS_LABEL[status]}`} />
        </span>
      )}
    </div>
  );
}

interface DetailResponse {
  project: TmsProjectRecord;
  tasks: TmsTaskRecord[];
  bomRequests: TmsBomRequestRecord[];
  procurements: TmsProcurementRecord[];
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'bom', label: 'BOM Requests' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'attachments', label: 'Attachments' }
] as const;
type TabKey = (typeof TABS)[number]['key'];

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function formatCurrency(value: number): string {
  return value ? `₹${value.toLocaleString('en-IN')}` : '-';
}

interface TmsProjectDetailViewProps {
  projectId: string;
  currentUser: { username: string; role: UserRole };
}

export default function TmsProjectDetailView({ projectId, currentUser }: TmsProjectDetailViewProps) {
  void currentUser;
  const toast = useToast();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [status, setStatus] = useState('Loading...');
  const [tab, setTab] = useState<TabKey>('overview');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{ status: TmsProjectStatus; priority: TmsPriority; progressPercent: number; remarks: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<PersonPickerOption[]>([]);
  const [editingTeam, setEditingTeam] = useState(false);
  const [teamEditIds, setTeamEditIds] = useState<string[]>([]);
  const [savingTeam, setSavingTeam] = useState(false);

  useEffect(() => {
    fetch('/api/tms/assignable-users')
      .then((r) => (r.ok ? r.json() : []))
      .then((users: PersonPickerOption[]) => setAssignableUsers(users))
      .catch(() => setAssignableUsers([]));
  }, []);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch(`/api/tms/projects/${projectId}`);
      if (response.status === 404) {
        setStatus('This project could not be found — it may have been deleted.');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const body: DetailResponse = await response.json();
      setData(body);
      setStatus('');
    } catch {
      setStatus('Could not load this project.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length || !data) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('folder', 'tms-projects');
      Array.from(files).forEach((f) => formData.append('files', f));
      const uploadRes = await fetch('/api/uploads', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error(String(uploadRes.status));
      const { urls } = await uploadRes.json();
      const patchRes = await fetch(`/api/tms/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addAttachment', urls })
      });
      if (!patchRes.ok) throw new Error(String(patchRes.status));
      await load();
      toast.success('Attachment uploaded.');
    } catch {
      toast.error('Could not upload the attachment.');
    } finally {
      setUploading(false);
    }
  }

  function startEdit() {
    if (!data) return;
    setEditForm({ status: data.project.status, priority: data.project.priority, progressPercent: data.project.progress_percent, remarks: data.project.remarks });
    setEditing(true);
  }

  async function saveEdit() {
    if (!editForm) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/tms/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: editForm.status, priority: editForm.priority, progressPercent: editForm.progressPercent, remarks: editForm.remarks })
      });
      if (!response.ok) throw new Error(String(response.status));
      setEditing(false);
      await load();
      toast.success('Project updated.');
    } catch {
      toast.error('Could not update this project.');
    } finally {
      setSaving(false);
    }
  }

  function startEditTeam() {
    if (!data) return;
    setTeamEditIds(data.project.team_member_ids);
    setEditingTeam(true);
  }

  async function saveTeam() {
    setSavingTeam(true);
    try {
      const response = await fetch(`/api/tms/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamMemberIds: teamEditIds })
      });
      if (!response.ok) throw new Error(String(response.status));
      setEditingTeam(false);
      await load();
      toast.success('Assigned engineers updated.');
    } catch {
      toast.error('Could not update the assigned engineers.');
    } finally {
      setSavingTeam(false);
    }
  }

  if (!data) {
    return (
      <AppShell title="Project" subtitle="" showBackLink>
        <div className={historyStyles.status}>{status || 'Loading...'}</div>
      </AppShell>
    );
  }

  const { project, tasks, bomRequests, procurements } = data;

  return (
    <AppShell title={project.name} subtitle={`${project.project_code} · ${project.department_name}`} showBackLink>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusBadge tone={TMS_PROJECT_STATUS_TONE[project.status]} label={TMS_PROJECT_STATUS_LABEL[project.status]} />
        <PriorityBadge tone={TMS_PRIORITY_TONE[project.priority]} label={TMS_PRIORITY_LABEL[project.priority]} />
        <Link className={historyStyles.button} href="/tms/projects">Back to Projects</Link>
        <button type="button" className={historyStyles.button} onClick={editing ? saveEdit : startEdit} disabled={saving}>
          {editing ? (saving ? 'Saving…' : 'Save changes') : 'Edit'}
        </button>
        {editing && <button type="button" className={historyStyles.button} onClick={() => setEditing(false)}>Cancel</button>}
      </div>

      {editing && editForm && (
        <div className={calcStyles.sectionPanel} style={{ marginBottom: 18 }}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Status</label>
              <select className={calcStyles.formControl} value={editForm.status} onChange={(e) => setEditForm((f) => f && { ...f, status: e.target.value as TmsProjectStatus })}>
                {(Object.keys(TMS_PROJECT_STATUS_LABEL) as TmsProjectStatus[]).map((s) => (
                  <option key={s} value={s}>{TMS_PROJECT_STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Priority</label>
              <select className={calcStyles.formControl} value={editForm.priority} onChange={(e) => setEditForm((f) => f && { ...f, priority: e.target.value as TmsPriority })}>
                {(Object.keys(TMS_PRIORITY_LABEL) as TmsPriority[]).map((p) => (
                  <option key={p} value={p}>{TMS_PRIORITY_LABEL[p]}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Progress %</label>
              <input type="number" min="0" max="100" className={calcStyles.formControl} value={editForm.progressPercent} onChange={(e) => setEditForm((f) => f && { ...f, progressPercent: Number(e.target.value) })} />
            </div>
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Notes / Remarks</label>
            <textarea className={calcStyles.formControl} rows={2} value={editForm.remarks} onChange={(e) => setEditForm((f) => f && { ...f, remarks: e.target.value })} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={historyStyles.button}
            style={tab === t.key ? { background: 'var(--mx-brand)', borderColor: 'var(--mx-brand)', color: '#fff' } : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className={calcStyles.sectionPanel}>
            <ProjectWorkflowStepper status={project.status} />
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div><strong>Client:</strong> {project.client_name || '-'}</div>
              <div><strong>Client contact:</strong> {project.client_contact || '-'}</div>
              <div><strong>Project Manager:</strong> {project.project_manager_name || '-'}</div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div><strong>Start date:</strong> {formatDate(project.start_date)}</div>
              <div><strong>Estimated close:</strong> {formatDate(project.estimated_close_date)}</div>
              <div><strong>Actual close:</strong> {formatDate(project.actual_close_date)}</div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div><strong>Budget:</strong> {formatCurrency(project.budget)}</div>
              <div><strong>Progress:</strong> {project.progress_percent}%</div>
            </div>
            <div style={{ marginTop: 12 }}><strong>Description:</strong> {project.description || '-'}</div>
            <div style={{ marginTop: 12 }}><strong>Notes / Remarks:</strong> {project.remarks || '-'}</div>
          </div>

          <div className={calcStyles.sectionPanel} style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: editingTeam ? 12 : 0 }}>
              <div className={calcStyles.h2} style={{ margin: 0 }}>Assigned Engineers</div>
              {!editingTeam && (
                <button type="button" className={historyStyles.button} onClick={startEditTeam}>
                  {project.team_member_ids.length ? 'Edit' : '+ Assign Engineer'}
                </button>
              )}
            </div>
            {editingTeam ? (
              <>
                <PersonPicker
                  options={assignableUsers}
                  selectedIds={teamEditIds}
                  onChange={setTeamEditIds}
                  multiple
                  placeholder="Search engineer…"
                  roleLabel={(role) => TMS_ROLE_LABEL[role] || role}
                  emptyMessage="No matching active Technical Team members found."
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button type="button" className={calcStyles.btn} onClick={saveTeam} disabled={savingTeam}>
                    {savingTeam ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" className={historyStyles.button} onClick={() => setEditingTeam(false)}>Cancel</button>
                </div>
              </>
            ) : project.team_member_ids.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--mx-ink-muted)' }}>No engineers assigned yet.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {project.team_member_names.map((name) => (
                  <span key={name} style={{ fontSize: 12.5, fontWeight: 600, padding: '5px 12px', borderRadius: 'var(--mx-radius-full)', background: 'var(--mx-brand-subtle)', color: 'var(--mx-brand-hover)' }}>
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'tasks' && (
        tasks.length === 0 ? (
          <EmptyState icon={Layers} title="No tasks yet" message="Tasks created for this project will appear here." />
        ) : (
          <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr><th>Task</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Due</th><th></th></tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.assignee_name || 'Unassigned'}</td>
                  <td><StatusBadge tone={TMS_TASK_STATUS_TONE[t.status]} label={TMS_TASK_STATUS_LABEL[t.status]} /></td>
                  <td><PriorityBadge tone={TMS_PRIORITY_TONE[t.priority]} label={TMS_PRIORITY_LABEL[t.priority]} /></td>
                  <td>{formatDate(t.due_date)}</td>
                  <td><Link className={historyStyles.button} href={`/tms/tasks/${t.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )
      )}

      {tab === 'bom' && (
        bomRequests.length === 0 ? (
          <EmptyState icon={FileText} title="No BOM requests yet" message="Material requests for this project will appear here." />
        ) : (
          <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr><th>Request</th><th>Item</th><th>Qty</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {bomRequests.map((b) => (
                <tr key={b.id}>
                  <td className={historyStyles.num}>{b.bom_request_code}</td>
                  <td>{b.item_name}</td>
                  <td>{b.quantity}</td>
                  <td><StatusBadge tone={TMS_BOM_STATUS_TONE[b.status]} label={TMS_BOM_STATUS_LABEL[b.status]} /></td>
                  <td><Link className={historyStyles.button} href={`/tms/bom-requests/${b.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )
      )}

      {tab === 'procurement' && (
        procurements.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="No procurement records yet" message="Procurement generated from approved BOM requests will appear here." />
        ) : (
          <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr><th>Procurement</th><th>Item</th><th>Vendor</th><th>Purchase Status</th><th></th></tr>
            </thead>
            <tbody>
              {procurements.map((p) => (
                <tr key={p.id}>
                  <td className={historyStyles.num}>{p.procurement_code}</td>
                  <td>{p.item_name}</td>
                  <td>{p.vendor || '-'}</td>
                  <td><StatusBadge tone={TMS_PURCHASE_STATUS_TONE[p.purchase_status]} label={TMS_PURCHASE_STATUS_LABEL[p.purchase_status]} /></td>
                  <td><Link className={historyStyles.button} href={`/tms/procurement/${p.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )
      )}

      {tab === 'attachments' && (
        <div className={calcStyles.sectionPanel}>
          <input type="file" multiple disabled={uploading} onChange={(e) => handleUpload(e.target.files)} />
          {uploading && <div className={historyStyles.status}>Uploading…</div>}
          {project.attachments.length === 0 ? (
            <EmptyState icon={Paperclip} title="No attachments yet" message="Upload project documents above." />
          ) : (
            <ul style={{ marginTop: 12 }}>
              {project.attachments.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer">{url.split('/').pop()}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </AppShell>
  );
}
