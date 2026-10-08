'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, Layers, Paperclip, ShoppingCart, Check } from 'lucide-react';
import { DeadlineExtensionReason, DeadlineExtensionStatus, TmsBomRequestRecord, TmsDeadlineExtensionRecord, TmsPriority, TmsProcurementRecord, TmsProjectPhaseRecord, TmsProjectPhaseStatus, TmsProjectRecord, TmsProjectStatus, TmsTaskRecord, UserRole } from '@/lib/types';
import { TMS_BOM_STATUS_LABEL, TMS_BOM_STATUS_TONE, TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE, TMS_PROJECT_STATUS_LABEL, TMS_PROJECT_STATUS_TONE, TMS_PURCHASE_STATUS_LABEL, TMS_PURCHASE_STATUS_TONE, TMS_ROLE_LABEL, TMS_TASK_STATUS_LABEL, TMS_TASK_STATUS_TONE, todayIso } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import PersonPicker, { PersonPickerOption } from './ui/PersonPicker';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import EmptyState from './ui/EmptyState';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import ToolbarButton from './ui/ToolbarButton';
import TmsDeadlineExtendModal from './TmsDeadlineExtendModal';
import ActivityTimeline from './ui/ActivityTimeline';
import { TMS_MANAGER_TIER_ROLES } from '@/lib/tmsConstants';
import { classifyDeadline, DEADLINE_BUCKET_BAND, DEADLINE_BUCKET_LABEL } from '@/lib/deadlineBuckets';
import { BAND_COLOR } from './ui/HealthGauge';
import { AuditLogEntry } from '@/lib/types';
import styles from './tmsDetail.module.css';

const PHASE_LABEL: Record<TmsProjectPhaseStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed'
};
const PHASE_TONE: Record<TmsProjectPhaseStatus, StatusTone> = {
  pending: 'pending',
  in_progress: 'confirmed',
  completed: 'won'
};

const EXTENSION_STATUS_LABEL: Record<DeadlineExtensionStatus, string> = {
  pending_manager: 'Pending Manager Approval',
  pending_admin: 'Pending Admin Approval',
  approved: 'Approved',
  rejected: 'Rejected'
};
const EXTENSION_STATUS_TONE: Record<DeadlineExtensionStatus, StatusTone> = {
  pending_manager: 'pending',
  pending_admin: 'pending',
  approved: 'confirmed',
  rejected: 'rejected'
};
const EXTENSION_REASON_LABEL: Record<DeadlineExtensionReason, string> = { user_end: 'From User End', client_end: 'From Client End' };

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
    <div className={styles.pipelineRow}>
      {PROJECT_PIPELINE.map((step, i) => {
        const done = !isSideState && i < activeIndex;
        const current = !isSideState && i === activeIndex;
        return (
          <div key={step} className={styles.pipelineItem}>
            <div className={styles.pipelineStep}>
              <div className={`${styles.pipelineCircle} ${done ? styles.pipelineCircleDone : current ? styles.pipelineCircleCurrent : ''}`}>
                {done ? <Check size={13} /> : i + 1}
              </div>
              <span className={`${styles.pipelineLabel} ${current ? styles.pipelineLabelCurrent : ''}`}>
                {TMS_PROJECT_STATUS_LABEL[step]}
              </span>
            </div>
            {i < PROJECT_PIPELINE.length - 1 && (
              <div className={`${styles.pipelineConnector} ${done ? styles.pipelineConnectorDone : ''}`} />
            )}
          </div>
        );
      })}
      {isSideState && (
        <span className={styles.pipelineSideBadge}>
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
  deadlineExtensions: TmsDeadlineExtensionRecord[];
  activity: AuditLogEntry[];
  taskDerivedProgress: number | null;
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'phases', label: 'Phases' },
  { key: 'bom', label: 'BOM Requests' },
  { key: 'procurement', label: 'Procurement' },
  { key: 'team', label: 'Team' },
  { key: 'deadline', label: 'Deadline History' },
  { key: 'activity', label: 'Activity' },
  { key: 'attachments', label: 'Attachments' }
] as const;
type TabKey = (typeof TABS)[number]['key'];

// Day arithmetic on a plain YYYY-MM-DD, so the "closing soon" bound needs no
// second read of the clock. Same shape as TmsProjectsView's addDays.
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const next = new Date(y, m - 1, d + days);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

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
  // Anyone who can open the project can now REQUEST an extension — the
  // tiered approval chain (see lib/tmsAccess.ts's resolveTmsDeadlineTier)
  // decides what happens next, not a hard "Manager/Admin only" block.
  // Client-side only, for showing the right Approve/Reject controls — the
  // server re-resolves this independently and is the real authority.
  const isAdminTier = currentUser.role === 'admin' || currentUser.role === 'superadmin';
  const isManagerTier = TMS_MANAGER_TIER_ROLES.has(currentUser.role) && !isAdminTier;
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [showExtendDeadline, setShowExtendDeadline] = useState(false);
  const [status, setStatus] = useState('Loading...');
  const [tab, setTab] = useState<TabKey>('overview');

  // BOM states where somebody still owes a decision. 'draft' is deliberately
  // out — it is the requester's own unsent work, not a queue anyone is
  // blocking on. The terminal states (payment_done, received, rejected,
  // sent_for_procurement, completed) are out for the same reason.
  const BOM_AWAITING = ['submitted', 'under_review', 'approved', 'admin_approved', 'finance_approved'];
  // Everything before the goods are actually on order. 'cancelled' is not a
  // pending state, and 'ordered' means purchasing has done its part.
  const PROCUREMENT_PENDING = ['requested', 'quotation_required', 'quotation_received', 'approval_pending', 'approved', 'po_created'];
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<{ status: TmsProjectStatus; priority: TmsPriority; progressPercent: number; remarks: string; startDate: string; estimatedCloseDate: string; budget: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [assignableUsers, setAssignableUsers] = useState<PersonPickerOption[]>([]);

  // Phase-wise delivery. Loaded separately from the project detail rather
  // than folded into it, so adding or completing a phase refreshes just this
  // list instead of re-fetching tasks, BOM and procurement with it.
  const [phases, setPhases] = useState<TmsProjectPhaseRecord[] | null>(null);
  const [phaseForm, setPhaseForm] = useState({ name: '', description: '', expectedEndDate: '' });
  const [phaseBusy, setPhaseBusy] = useState(false);

  async function loadPhases() {
    try {
      const response = await fetch(`/api/tms/projects/${projectId}/phases`);
      setPhases(response.ok ? await response.json() : []);
    } catch {
      setPhases([]);
    }
  }

  async function addPhase() {
    if (!phaseForm.name.trim()) {
      toast.error('Phase name is required.');
      return;
    }
    setPhaseBusy(true);
    try {
      const response = await fetch(`/api/tms/projects/${projectId}/phases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(phaseForm)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || String(response.status));
      setPhaseForm({ name: '', description: '', expectedEndDate: '' });
      await loadPhases();
      toast.success('Phase added.');
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not add this phase.');
    } finally {
      setPhaseBusy(false);
    }
  }

  async function patchPhase(id: string, patch: Record<string, unknown>) {
    setPhaseBusy(true);
    try {
      const response = await fetch(`/api/tms/project-phases/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || String(response.status));
      await loadPhases();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not update this phase.');
    } finally {
      setPhaseBusy(false);
    }
  }

  async function deletePhase(phase: TmsProjectPhaseRecord) {
    if (!(await confirm({ message: `Delete phase "${phase.name}"? This cannot be undone.`, danger: true }))) return;
    setPhaseBusy(true);
    try {
      const response = await fetch(`/api/tms/project-phases/${phase.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      await loadPhases();
      toast.success('Phase deleted.');
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not delete this phase.');
    } finally {
      setPhaseBusy(false);
    }
  }
  const [editingTeam, setEditingTeam] = useState(false);
  const [teamEditIds, setTeamEditIds] = useState<string[]>([]);
  const [savingTeam, setSavingTeam] = useState(false);
  const [editingManager, setEditingManager] = useState(false);
  const [managerEditId, setManagerEditId] = useState<string[]>([]);
  const [savingManager, setSavingManager] = useState(false);
  const [decidingExtension, setDecidingExtension] = useState<{ id: string; decision: 'approve' | 'reject' } | null>(null);
  const [decisionRemark, setDecisionRemark] = useState('');
  const [deciding, setDeciding] = useState(false);

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
    loadPhases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleDecideExtension() {
    if (!decidingExtension) return;
    if (decidingExtension.decision === 'reject' && !decisionRemark.trim()) {
      toast.error('A remark is required to reject this request.');
      return;
    }
    setDeciding(true);
    try {
      const response = await fetch(`/api/tms/deadline-extensions/${decidingExtension.id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: decidingExtension.decision, decisionRemark: decisionRemark.trim() })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || String(response.status));
      }
      toast.success(decidingExtension.decision === 'approve' ? 'Extension approved.' : 'Extension rejected.');
      setDecidingExtension(null);
      setDecisionRemark('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record this decision.');
    } finally {
      setDeciding(false);
    }
  }

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
    setEditForm({
      status: data.project.status,
      priority: data.project.priority,
      progressPercent: data.project.progress_percent,
      remarks: data.project.remarks,
      // Start Date / Estimated Close / Budget were never editable from this
      // page at all (only settable, inconsistently, at creation) — a Sales
      // handoff always lands with these blank, with no way to fill them in
      // until now. Deadline is deliberately NOT here: it has its own
      // Set/Extend Deadline flow below (audited, tiered approval) and must
      // never be changed as a free-text field.
      startDate: data.project.start_date,
      estimatedCloseDate: data.project.estimated_close_date,
      budget: data.project.budget ? String(data.project.budget) : ''
    });
    setEditing(true);
  }

  async function saveEdit() {
    if (!editForm) return;
    setSaving(true);
    try {
      const budgetNum = Number(editForm.budget);
      const response = await fetch(`/api/tms/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: editForm.status,
          priority: editForm.priority,
          progressPercent: editForm.progressPercent,
          remarks: editForm.remarks,
          startDate: editForm.startDate,
          estimatedCloseDate: editForm.estimatedCloseDate,
          ...(editForm.budget.trim() && Number.isFinite(budgetNum) ? { budget: budgetNum } : {})
        })
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

  // Project Manager has never been editable from this page — only set once,
  // at creation (native TMS, or lib/tmsHandoff.ts's Sales handoff). A project
  // that landed here without one (or whose manager left) had no way to fix
  // that except a direct DB edit. Same single-select-via-PersonPicker pattern
  // as Assigned Engineers above, just capped at one id.
  function startEditManager() {
    if (!data) return;
    setManagerEditId(data.project.project_manager_id ? [data.project.project_manager_id] : []);
    setEditingManager(true);
  }

  async function saveManager() {
    setSavingManager(true);
    try {
      const response = await fetch(`/api/tms/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectManagerId: managerEditId[0] || '' })
      });
      if (!response.ok) throw new Error(String(response.status));
      setEditingManager(false);
      await load();
      toast.success('Project manager updated.');
    } catch {
      toast.error('Could not update the project manager.');
    } finally {
      setSavingManager(false);
    }
  }

  if (!data) {
    return (
      <AppShell title="Project" subtitle="" showBackLink>
        <div className={historyStyles.status}>{status || 'Loading...'}</div>
      </AppShell>
    );
  }

  const { project, tasks, bomRequests, procurements, deadlineExtensions, activity, taskDerivedProgress } = data;

  // What actually needs a human on this project, built from records the hub
  // has already fetched — no extra request, no extra query (section 21).
  // Only non-zero items appear; an all-clear project renders no strip at all
  // rather than a row of reassuring zeros.
  const attention: { key: string; label: string; tab: TabKey }[] = (() => {
    const today = todayIso();
    const open = tasks.filter((t) => t.status !== 'completed' && t.status !== 'cancelled');
    const overdue = open.filter((t) => t.due_date && t.due_date < today).length;
    const blocked = open.filter((t) => t.status === 'blocked').length;
    const bomPending = bomRequests.filter((b) => BOM_AWAITING.includes(b.status)).length;
    const procPending = procurements.filter((p) => PROCUREMENT_PENDING.includes(p.purchase_status)).length;
    const due = project.deadline || project.estimated_close_date || '';
    const weekOut = addDaysIso(today, 7);
    const finished = project.status === 'completed' || project.status === 'cancelled';

    const out: { key: string; label: string; tab: TabKey }[] = [];
    // A freshly handed-off project with nobody owning it and nothing broken
    // down yet looks "clean" by every check below — no overdue tasks, no
    // blocked tasks, because there ARE no tasks. These two catch exactly
    // that silence, which is the actual problem (see lib/tmsHandoff.ts).
    if (!finished && !project.project_manager_id) out.push({ key: 'noManager', label: 'No project manager assigned', tab: 'team' });
    if (!finished && tasks.length === 0) out.push({ key: 'noTasks', label: 'No tasks created yet', tab: 'tasks' });
    if (!finished && !project.deadline) out.push({ key: 'noDeadline', label: 'No deadline set', tab: 'overview' });
    if (overdue) out.push({ key: 'overdue', label: `${overdue} overdue task${overdue === 1 ? '' : 's'}`, tab: 'tasks' });
    if (blocked) out.push({ key: 'blocked', label: `${blocked} blocked task${blocked === 1 ? '' : 's'}`, tab: 'tasks' });
    if (bomPending) out.push({ key: 'bom', label: `${bomPending} BOM request${bomPending === 1 ? '' : 's'} awaiting approval`, tab: 'bom' });
    if (procPending) out.push({ key: 'proc', label: `${procPending} procurement request${procPending === 1 ? '' : 's'} not yet ordered`, tab: 'procurement' });
    // Only while the project can still act on it.
    if (due && due >= today && due <= weekOut && !finished) out.push({ key: 'due', label: `Deadline ${formatDate(due)}`, tab: 'overview' });
    return out;
  })();
  const deadlineBucket = classifyDeadline(project.deadline, project.status === 'completed');
  const deadlineBand = DEADLINE_BUCKET_BAND[deadlineBucket];

  // Assigned Engineers must only offer people from this project's own
  // department(s) — department_names covers both a single-department and a
  // combined project uniformly, so there's nothing project_type-specific to
  // branch on here (unlike the create form, which still has to build that
  // set live as the user picks departments).
  const projectDepartmentNames = new Set(project.department_names.length ? project.department_names : [project.department_name]);
  const scopedAssignableUsers = assignableUsers.filter((u) => projectDepartmentNames.has(u.department));

  return (
    <AppShell
      title={project.name}
      subtitle={`${project.project_code} · ${project.project_type === 'combined' && project.department_names.length ? project.department_names.join(', ') : project.department_name}`}
      showBackLink
    >
      <div className={styles.headerRow}>
        <StatusBadge tone={TMS_PROJECT_STATUS_TONE[project.status]} label={TMS_PROJECT_STATUS_LABEL[project.status]} />
        <PriorityBadge tone={TMS_PRIORITY_TONE[project.priority]} label={TMS_PRIORITY_LABEL[project.priority]} />
        {deadlineBand !== 'na' && (
          <span style={{ color: BAND_COLOR[deadlineBand], fontSize: 13, fontWeight: 600 }}>● {DEADLINE_BUCKET_LABEL[deadlineBucket]}</span>
        )}
        <span className={styles.mutedText}>
          Owner: {project.project_manager_name || 'no owner yet'}
        </span>
        <span className={styles.mutedText}>
          Progress: {taskDerivedProgress !== null ? taskDerivedProgress : project.progress_percent}%
          {taskDerivedProgress !== null ? ' (from tasks)' : ''}
        </span>
        <Link className={historyStyles.button} href="/tms/projects">Back to Projects</Link>
        {/* The deadline itself is never a free-text field (see editForm/
            saveEdit above) — it only ever moves through this one audited,
            tiered-approval flow. The FIRST move is a direct "Set Deadline"
            (TmsDeadlineExtendModal already accepts a blank currentDeadline
            fine); every move after that is explicitly "Extend", since a
            deadline that already exists must never look like a blank fill-in. */}
        <button
          type="button"
          className={project.deadline ? historyStyles.button : `${historyStyles.button} ${historyStyles.primary}`}
          onClick={() => setShowExtendDeadline(true)}
        >
          {project.deadline ? 'Extend Deadline' : 'Set Deadline'}
        </button>
        <button type="button" className={historyStyles.button} onClick={editing ? saveEdit : startEdit} disabled={saving}>
          {editing ? (saving ? 'Saving…' : 'Save changes') : 'Edit'}
        </button>
        {editing && <button type="button" className={historyStyles.button} onClick={() => setEditing(false)}>Cancel</button>}
      </div>

      {showExtendDeadline && (
        <TmsDeadlineExtendModal
          projectId={projectId}
          currentDeadline={project.deadline}
          onClose={() => setShowExtendDeadline(false)}
          onExtended={load}
        />
      )}

      {editing && editForm && (
        <div className={`${calcStyles.sectionPanel} ${styles.panelSpaced18}`}>
          <FieldRow>
            <Field label="Status">
              <Select value={editForm.status} onChange={(e) => setEditForm((f) => f && { ...f, status: e.target.value as TmsProjectStatus })}>
                {(Object.keys(TMS_PROJECT_STATUS_LABEL) as TmsProjectStatus[]).map((s) => (
                  <option key={s} value={s}>{TMS_PROJECT_STATUS_LABEL[s]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={editForm.priority} onChange={(e) => setEditForm((f) => f && { ...f, priority: e.target.value as TmsPriority })}>
                {(Object.keys(TMS_PRIORITY_LABEL) as TmsPriority[]).map((p) => (
                  <option key={p} value={p}>{TMS_PRIORITY_LABEL[p]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Progress %">
              <Input type="number" min="0" max="100" value={editForm.progressPercent} onChange={(e) => setEditForm((f) => f && { ...f, progressPercent: Number(e.target.value) })} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Start date">
              <Input type="date" value={editForm.startDate} onChange={(e) => setEditForm((f) => f && { ...f, startDate: e.target.value })} />
            </Field>
            <Field label="Estimated close">
              <Input type="date" value={editForm.estimatedCloseDate} onChange={(e) => setEditForm((f) => f && { ...f, estimatedCloseDate: e.target.value })} />
            </Field>
            <Field label="Budget (₹)">
              <Input type="number" min={0} step="0.01" placeholder="e.g. 1250000" value={editForm.budget} onChange={(e) => setEditForm((f) => f && { ...f, budget: e.target.value })} />
            </Field>
          </FieldRow>
          <Field label="Notes / Remarks">
            <Textarea rows={2} value={editForm.remarks} onChange={(e) => setEditForm((f) => f && { ...f, remarks: e.target.value })} />
          </Field>
        </div>
      )}

      <div className={styles.tabRow}>
        {TABS.map((t) => (
          <ToolbarButton
            key={t.key}
            primary={tab === t.key}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </ToolbarButton>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          {attention.length > 0 && (
            <div className={`${calcStyles.sectionPanel} ${styles.infoRowDanger}`}>
              <strong>Needs attention</strong>
              <div className={styles.actionButtonsRow}>
                {attention.map((a) => (
                  <button key={a.key} type="button" className={historyStyles.button} onClick={() => setTab(a.tab)}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className={calcStyles.sectionPanel}>
            <ProjectWorkflowStepper status={project.status} />
            {project.sales_project_id && (
              <div className={`${styles.infoRow} ${styles.salesHandoffRow}`}>
                <div>
                  <strong>Handed off from Sales:</strong> {project.sales_person_name || 'a sales person'} assigned this project to {project.project_manager_name || 'the project manager'} below.
                </div>
                <Link className={historyStyles.linkButtonSmall} href={`/projects/${project.sales_project_id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={13} /> View Sales Project
                </Link>
              </div>
            )}
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div><strong>Client:</strong> {project.client_name || '-'}</div>
              <div><strong>Client contact:</strong> {project.client_contact || '-'}</div>
              <div><strong>Project Manager:</strong> {project.project_manager_name || '-'}</div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div><strong>Start date:</strong> {formatDate(project.start_date)}</div>
              <div><strong>Estimated close:</strong> {formatDate(project.estimated_close_date)}</div>
              <div><strong>Actual close:</strong> {formatDate(project.actual_close_date)}</div>
              <div><strong>Deadline:</strong> {formatDate(project.deadline)}</div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div><strong>Budget:</strong> {formatCurrency(project.budget)}</div>
              <div><strong>Progress (manual):</strong> {project.progress_percent}%</div>
              {taskDerivedProgress !== null && <div><strong>Progress (from tasks):</strong> {taskDerivedProgress}%</div>}
            </div>
            <div className={styles.infoRow}><strong>Description:</strong> {project.description || '-'}</div>
            <div className={styles.infoRow}><strong>Notes / Remarks:</strong> {project.remarks || '-'}</div>
          </div>

          <div className={`${calcStyles.sectionPanel} ${styles.panelSpacedTop16}`}>
            <div className={`${calcStyles.h2} ${calcStyles.h2Reset}`}>BOQ &amp; Procurement</div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div><strong>BOQ Requests:</strong> {bomRequests.length}</div>
              <div><strong>Pending:</strong> {bomRequests.filter((b) => b.status === 'draft' || b.status === 'submitted' || b.status === 'under_review').length}</div>
              <div><strong>Approved:</strong> {bomRequests.filter((b) => b.status === 'approved' || b.status === 'admin_approved' || b.status === 'finance_approved').length}</div>
              <div><strong>Procurement Items:</strong> {procurements.length}</div>
              <div><strong>Completed:</strong> {bomRequests.filter((b) => b.status === 'completed' || b.status === 'received').length}</div>
            </div>
          </div>

          <div className={`${calcStyles.sectionPanel} ${styles.panelSpacedTop16}`}>
            <div className={`${styles.teamHeaderRow} ${editingTeam ? styles.teamHeaderRowEditing : ''}`}>
              <div className={`${calcStyles.h2} ${calcStyles.h2Reset}`}>Assigned Engineers</div>
              {!editingTeam && (
                <button type="button" className={historyStyles.button} onClick={startEditTeam}>
                  {project.team_member_ids.length ? 'Edit' : '+ Assign Engineer'}
                </button>
              )}
            </div>
            {editingTeam ? (
              <>
                <PersonPicker
                  options={scopedAssignableUsers}
                  selectedIds={teamEditIds}
                  onChange={setTeamEditIds}
                  multiple
                  placeholder="Search engineer…"
                  roleLabel={(role) => TMS_ROLE_LABEL[role] || role}
                  emptyMessage="No matching active Technical Team members found in this project's department."
                />
                <div className={`${styles.actionButtonsRow} ${calcStyles.mt10}`}>
                  <button type="button" className={calcStyles.btn} onClick={saveTeam} disabled={savingTeam}>
                    {savingTeam ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" className={historyStyles.button} onClick={() => setEditingTeam(false)}>Cancel</button>
                </div>
              </>
            ) : project.team_member_ids.length === 0 ? (
              <div className={styles.mutedText13}>No engineers assigned yet.</div>
            ) : (
              <div className={styles.pillRow}>
                {project.team_member_names.map((name) => (
                  <span key={name} className={styles.namePill}>
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
          <EmptyState
            icon={Layers}
            title="No tasks yet"
            message="Break the work on this project into tasks so the team can pick them up and report progress."
            action={<Link className={calcStyles.btn} href={`/tms/tasks?new=1&projectId=${project.id}`}>+ Add Task</Link>}
          />
        ) : (
          <>
          <div className={historyStyles.actionRow}>
            <Link className={calcStyles.btn} href={`/tms/tasks?new=1&projectId=${project.id}`}>+ Add Task</Link>
          </div>
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
          </>
        )
      )}

      {tab === 'phases' && (
        <div className={calcStyles.sectionPanel}>
          <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Delivery Phases</div>
          <div className={calcStyles.small}>
            For a project delivered in stages — each phase carries its own expected end date, separate from the project&apos;s overall deadline.
          </div>

          <FieldRow className={calcStyles.mt12}>
            <Field label="Phase name *">
              <Input
                value={phaseForm.name}
                disabled={phaseBusy}
                placeholder="e.g. Phase 1 — Site survey"
                onChange={(e) => setPhaseForm((f) => ({ ...f, name: e.target.value }))}
              />
            </Field>
            <Field label="Expected end date">
              <Input
                type="date"
                value={phaseForm.expectedEndDate}
                disabled={phaseBusy}
                onChange={(e) => setPhaseForm((f) => ({ ...f, expectedEndDate: e.target.value }))}
              />
            </Field>
          </FieldRow>
          <Field label="Description">
            <Textarea
              rows={2}
              value={phaseForm.description}
              disabled={phaseBusy}
              placeholder="What is delivered in this phase (optional)."
              onChange={(e) => setPhaseForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <button type="button" className={calcStyles.btn} disabled={phaseBusy} onClick={() => void addPhase()}>
            {phaseBusy ? 'Saving…' : '+ Add Phase'}
          </button>

          {phases === null ? (
            <div className={`${calcStyles.small} ${calcStyles.mt12}`}>Loading phases…</div>
          ) : phases.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No phases yet"
              message="Add a phase above if this project is delivered in stages."
            />
          ) : (
            <div className={calcStyles.mt12}>
              {phases.map((phase, index) => {
                // Overdue only matters while the phase is still open — a
                // completed phase that ran late is history, not an alarm.
                const overdue =
                  phase.status !== 'completed' &&
                  !!phase.expected_end_date &&
                  phase.expected_end_date < new Date().toISOString().slice(0, 10);
                return (
                  <div key={phase.id} className={styles.phaseRow}>
                    <div className={styles.phaseIndex}>{index + 1}</div>
                    <div className={styles.phaseBody}>
                      <div className={styles.phaseTop}>
                        <span className={styles.phaseName}>{phase.name}</span>
                        <StatusBadge tone={PHASE_TONE[phase.status]} label={PHASE_LABEL[phase.status]} />
                        {overdue && <StatusBadge tone="lost" label="Overdue" />}
                      </div>
                      {phase.description && <div className={styles.phaseDesc}>{phase.description}</div>}
                      <div className={styles.phaseMeta}>
                        {phase.expected_end_date ? `Expected ${formatDate(phase.expected_end_date)}` : 'No expected date set'}
                        {phase.completed_at ? ` · Completed ${formatDate(phase.completed_at)}` : ''}
                        {phase.created_by_name ? ` · Added by ${phase.created_by_name}` : ''}
                      </div>
                    </div>
                    <div className={styles.phaseActions}>
                      <Select
                        auto
                        value={phase.status}
                        disabled={phaseBusy}
                        onChange={(e) => void patchPhase(phase.id, { status: e.target.value as TmsProjectPhaseStatus })}
                      >
                        {(Object.keys(PHASE_LABEL) as TmsProjectPhaseStatus[]).map((st) => (
                          <option key={st} value={st}>{PHASE_LABEL[st]}</option>
                        ))}
                      </Select>
                      <Input
                        auto
                        type="date"
                        value={phase.expected_end_date}
                        disabled={phaseBusy}
                        onChange={(e) => void patchPhase(phase.id, { expectedEndDate: e.target.value })}
                      />
                      <ToolbarButton disabled={phaseBusy} onClick={() => void deletePhase(phase)}>
                        Delete
                      </ToolbarButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'bom' && (
        bomRequests.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No material requirements yet"
            message="Raise a BOM request for any part or material this project needs. Approved requests go on to procurement."
            action={<Link className={calcStyles.btn} href={`/tms/bom-requests?new=1&projectId=${project.id}`}>+ Create BOM Request</Link>}
          />
        ) : (
          <>
          <div className={historyStyles.actionRow}>
            <Link className={calcStyles.btn} href={`/tms/bom-requests?new=1&projectId=${project.id}`}>+ Create BOM Request</Link>
          </div>
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
          </>
        )
      )}

      {tab === 'procurement' && (
        procurements.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="Nothing being procured yet"
            message="Approved BOM requests come through here once they are sent to procurement. You can also raise a purchase for this project directly."
            action={<Link className={calcStyles.btn} href={`/tms/procurement?new=1&projectId=${project.id}`}>+ Create Procurement Request</Link>}
          />
        ) : (
          <>
          <div className={historyStyles.actionRow}>
            <Link className={calcStyles.btn} href={`/tms/procurement?new=1&projectId=${project.id}`}>+ Create Procurement Request</Link>
          </div>
          <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr><th>Procurement</th><th>Item</th><th>From BOM</th><th>Vendor</th><th>Purchase Status</th><th></th></tr>
            </thead>
            <tbody>
              {procurements.map((p) => (
                <tr key={p.id}>
                  <td className={historyStyles.num}>{p.procurement_code}</td>
                  <td>{p.item_name}</td>
                  {/* Where this purchase came from. Raised directly against
                      the project rather than from a requirement shows as a
                      dash, which is a real and different thing to say. */}
                  <td className={historyStyles.num}>
                    {p.bom_request_id
                      ? <Link href={`/tms/bom-requests/${p.bom_request_id}`}>{p.bom_request_code || 'View BOM'}</Link>
                      : '-'}
                  </td>
                  <td>{p.vendor || '-'}</td>
                  <td><StatusBadge tone={TMS_PURCHASE_STATUS_TONE[p.purchase_status]} label={TMS_PURCHASE_STATUS_LABEL[p.purchase_status]} /></td>
                  <td><Link className={historyStyles.button} href={`/tms/procurement/${p.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          </>
        )
      )}

      {tab === 'team' && (
        <div className={calcStyles.sectionPanel}>
          <div className={`${styles.teamHeaderRow} ${editingManager ? styles.teamHeaderRowEditing : ''}`}>
            <div className={styles.infoRow}><strong>Project Manager:</strong> {editingManager ? '' : (project.project_manager_name || 'Unassigned')}</div>
            {!editingManager && (
              <button type="button" className={historyStyles.button} onClick={startEditManager}>
                {project.project_manager_id ? 'Change' : '+ Assign Manager'}
              </button>
            )}
          </div>
          {editingManager && (
            <>
              <PersonPicker
                options={scopedAssignableUsers}
                selectedIds={managerEditId}
                onChange={setManagerEditId}
                placeholder="Search for a project manager…"
                roleLabel={(role) => TMS_ROLE_LABEL[role] || role}
                emptyMessage="No matching active Technical Team members found in this project's department."
              />
              <div className={`${styles.actionButtonsRow} ${calcStyles.mt10}`}>
                <button type="button" className={calcStyles.btn} onClick={saveManager} disabled={savingManager}>
                  {savingManager ? 'Saving…' : 'Save'}
                </button>
                <button type="button" className={historyStyles.button} onClick={() => setEditingManager(false)}>Cancel</button>
              </div>
            </>
          )}
          <div className={`${calcStyles.h2} ${calcStyles.mt10}`}>Assigned Engineers</div>
          {project.team_member_names.length === 0 ? (
            <div className={styles.mutedText13}>No engineers assigned yet.</div>
          ) : (
            <div className={styles.pillRow}>
              {project.team_member_names.map((name) => (
                <span key={name} className={styles.namePill}>{name}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div className={calcStyles.sectionPanel}>
          <ActivityTimeline
            entries={activity.map((a) => ({ id: a.id, label: a.action, by: a.by, at: a.at }))}
            empty="No activity recorded for this project yet."
          />
        </div>
      )}

      {tab === 'deadline' && (
        deadlineExtensions.length === 0 ? (
          <EmptyState icon={FileText} title="No deadline extensions yet" message="Extensions to this project's deadline will appear here." />
        ) : (
          <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr><th>Previous Deadline</th><th>New Deadline</th><th>Reason</th><th>Remark</th><th>Status</th><th>Requested By</th><th>Date</th><th></th></tr>
            </thead>
            <tbody>
              {deadlineExtensions.map((ext) => {
                const canDecide = ext.status === 'pending_manager' ? isManagerTier || isAdminTier : ext.status === 'pending_admin' ? isAdminTier : false;
                return (
                  <tr key={ext.id}>
                    <td>{formatDate(ext.previousDeadline)}</td>
                    <td>{formatDate(ext.newDeadline)}</td>
                    <td>{EXTENSION_REASON_LABEL[ext.reason]}</td>
                    <td>
                      {ext.remark}
                      {ext.decisionRemark && <div className={styles.mutedText13}>Decision note: {ext.decisionRemark}</div>}
                    </td>
                    <td><StatusBadge tone={EXTENSION_STATUS_TONE[ext.status]} label={EXTENSION_STATUS_LABEL[ext.status]} /></td>
                    <td>{ext.extendedByName || '-'}</td>
                    <td>{formatDate(ext.createdAt.slice(0, 10))}</td>
                    <td>
                      {canDecide && (
                        <div className={styles.actionButtonsRow}>
                          <button type="button" className={calcStyles.btn} onClick={() => { setDecidingExtension({ id: ext.id, decision: 'approve' }); setDecisionRemark(''); }}>Approve</button>
                          <ToolbarButton onClick={() => { setDecidingExtension({ id: ext.id, decision: 'reject' }); setDecisionRemark(''); }}>Reject</ToolbarButton>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )
      )}

      {decidingExtension && (
        <div className={`${calcStyles.sectionPanel} ${styles.panelSpaced16}`}>
          <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>{decidingExtension.decision === 'approve' ? 'Approve' : 'Reject'} Deadline Extension</div>
          <Textarea
            rows={2}
            placeholder={decidingExtension.decision === 'approve' ? 'Remark (optional)' : 'Remark (required)'}
            value={decisionRemark}
            onChange={(e) => setDecisionRemark(e.target.value)}
          />
          <div className={`${styles.actionButtonsRow} ${calcStyles.mt10}`}>
            <button type="button" className={calcStyles.btn} disabled={deciding} onClick={handleDecideExtension}>{deciding ? 'Saving…' : 'Confirm'}</button>
            <ToolbarButton disabled={deciding} onClick={() => setDecidingExtension(null)}>Cancel</ToolbarButton>
          </div>
        </div>
      )}

      {tab === 'attachments' && (
        <div className={calcStyles.sectionPanel}>
          <input type="file" multiple disabled={uploading} onChange={(e) => handleUpload(e.target.files)} />
          {uploading && <div className={historyStyles.status}>Uploading…</div>}
          {project.attachments.length === 0 ? (
            <EmptyState icon={Paperclip} title="No attachments yet" message="Upload project documents above." />
          ) : (
            <ul className={styles.attachmentList}>
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
