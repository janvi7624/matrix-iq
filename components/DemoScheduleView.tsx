'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DemoOutcome, DemoPriority, DemoProductLine, DemoRequestStatus, DemoScheduleRecord, DomainKey, ProjectRecord, QuotationRecord, UserRole } from '@/lib/types';
import { TechnicalRosterEntry } from '@/lib/technicalRoster';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { useDomainLeadLabels } from '@/lib/domainLeads';
import { getDomainProducts } from '@/lib/domainProducts';
import { selectAllOnFocusIfZero } from '@/lib/numberInputHelpers';
import AppShell from './AppShell';
import TeamCheckboxes from './TeamCheckboxes';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { nowDatetimeInputValue, todayDateInputValue } from '@/lib/dateHelpers';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import Button from './ui/Button';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import WorkflowStepper, { StepperStep } from './ui/WorkflowStepper';

const ALL_DOMAINS = Object.keys(DOMAIN_DISPLAY_NAME) as DomainKey[];

const EMPTY_FORM = {
  projectId: '',
  quotationId: '',
  clientName: '',
  company: '',
  location: '',
  productDomains: [] as DomainKey[],
  productsRequired: [] as DemoProductLine[],
  priority: 'medium' as DemoPriority,
  assignedTechnicalPersonId: '',
  technicalMembers: [] as string[],
  scheduledAt: '',
  assignedRep: '',
  demoObjective: '',
  notes: ''
};

const STATUS_LABEL: Record<DemoRequestStatus, string> = {
  draft: 'Draft',
  pending_technical: 'Pending Technical Approval',
  pending_manager: 'Pending Manager Approval',
  pending_backoffice: 'Pending Back Office',
  dc_generated: 'DC Generated',
  material_dispatched: 'Material Dispatched',
  demo_completed: 'Demo Completed',
  material_returned: 'Material Returned',
  dc_closed: 'DC Closed',
  cancelled: 'Cancelled'
};

const STATUS_TONE: Record<DemoRequestStatus, StatusTone> = {
  draft: 'cancelled',
  pending_technical: 'pending',
  pending_manager: 'pending',
  pending_backoffice: 'pending',
  dc_generated: 'confirmed',
  material_dispatched: 'confirmed',
  demo_completed: 'done',
  material_returned: 'done',
  dc_closed: 'done',
  cancelled: 'rejected'
};

// The approval chain has never had a visual representation beyond this flat
// status badge — each named status IS a reached milestone once the record
// is at or past it, so "done" is simply "index <= current index."
const DEMO_STAGES: { key: DemoRequestStatus; label: string }[] = [
  { key: 'pending_technical', label: 'Sales Request Submitted' },
  { key: 'pending_manager', label: 'Technical Approval' },
  { key: 'pending_backoffice', label: 'Manager Approval' },
  { key: 'dc_generated', label: 'Back Office — DC Generated' },
  { key: 'material_dispatched', label: 'Material Dispatched' },
  { key: 'demo_completed', label: 'Demo Completed' },
  { key: 'material_returned', label: 'Material Returned' },
  { key: 'dc_closed', label: 'DC Closed' }
];

// Cancellation can happen from any status and doesn't record which stage it
// was cancelled at, so a cancelled demo gets a plain badge instead of a
// fabricated stepper position.
function buildDemoSteps(record: DemoScheduleRecord): StepperStep[] | null {
  if (record.status === 'cancelled') return null;
  const idx = record.status === 'draft' ? -1 : DEMO_STAGES.findIndex((s) => s.key === record.status);
  return DEMO_STAGES.map((s, i) => {
    let meta: string | undefined;
    if (s.key === 'pending_manager' && record.technical_approval.decision) {
      meta = `${record.technical_approval.decision} by ${record.technical_approval.decided_by}`;
    } else if (s.key === 'pending_backoffice' && record.manager_approval.decision) {
      meta = `${record.manager_approval.decision} by ${record.manager_approval.decided_by}`;
    }
    return { key: s.key, label: s.label, state: i <= idx ? 'done' : i === idx + 1 ? 'current' : 'upcoming', meta };
  });
}

const PRIORITY_LABEL: Record<DemoPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };

const OUTCOME_LABEL: Record<Exclude<DemoOutcome, ''>, string> = {
  successful: 'Successful',
  need_followup: 'Need Follow-up',
  pending_decision: 'Pending Decision',
  cancelled: 'Cancelled'
};

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

function TechnicalApprovalForm({ demoId, onDone }: { demoId: string; onDone: (updated: DemoScheduleRecord) => void }) {
  const [availability, setAvailability] = useState<'available' | 'not_available' | ''>('');
  const [remarks, setRemarks] = useState('');
  const [expectedArrivalTime, setExpectedArrivalTime] = useState('');
  const [newScheduledAt, setNewScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function decide(decision: 'approved' | 'rejected' | 'reschedule') {
    setBusy(true);
    try {
      const response = await fetch(`/api/demo-schedule/${demoId}/technical-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, availability, remarks, expectedArrivalTime, newScheduledAt })
      });
      if (!response.ok) throw new Error(String(response.status));
      onDone(await response.json());
    } catch {
      toast.error('Could not save the technical approval decision.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={historyStyles.detailPanel} style={{ marginTop: 10 }}>
      <h3 style={{ marginTop: 0 }}>Technical availability</h3>
      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Availability</label>
          <select className={calcStyles.formControl} value={availability} onChange={(e) => setAvailability(e.target.value as 'available' | 'not_available' | '')}>
            <option value="">-- Select --</option>
            <option value="available">Available</option>
            <option value="not_available">Not available</option>
          </select>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Expected arrival time</label>
          <input className={calcStyles.formControl} placeholder="e.g. 10:30 AM" value={expectedArrivalTime} onChange={(e) => setExpectedArrivalTime(e.target.value)} />
        </div>
      </div>
      <div className={calcStyles.field}>
        <label className={calcStyles.label}>Remarks</label>
        <textarea className={calcStyles.formControl} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      <div className={calcStyles.field}>
        <label className={calcStyles.label}>Reschedule to (only used for Reschedule)</label>
        <input type="datetime-local" className={calcStyles.formControl} min={nowDatetimeInputValue()} value={newScheduledAt} onChange={(e) => setNewScheduledAt(e.target.value)} />
      </div>
      <div className={historyStyles.actionGroupButtons}>
        <Button variant="success" icon="✓" loading={busy} loadingLabel="Approving…" onClick={() => decide('approved')}>Approve</Button>
        <Button variant="danger" icon="✕" loading={busy} loadingLabel="Rejecting…" onClick={() => decide('rejected')}>Reject</Button>
        <Button variant="secondary" loading={busy} onClick={() => decide('reschedule')}>Reschedule</Button>
      </div>
    </div>
  );
}

function ManagerApprovalForm({ demoId, technicalRoster, onDone }: { demoId: string; technicalRoster: TechnicalRosterEntry[]; onDone: (updated: DemoScheduleRecord) => void }) {
  const [remarks, setRemarks] = useState('');
  const [reassignedEngineerId, setReassignedEngineerId] = useState('');
  const [newScheduledAt, setNewScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function decide(decision: 'approved' | 'rejected' | 'modified') {
    setBusy(true);
    try {
      const response = await fetch(`/api/demo-schedule/${demoId}/manager-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, remarks, reassignedEngineerId, newScheduledAt })
      });
      if (!response.ok) throw new Error(String(response.status));
      onDone(await response.json());
    } catch {
      toast.error('Could not save the manager approval decision.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={historyStyles.detailPanel} style={{ marginTop: 10 }}>
      <h3 style={{ marginTop: 0 }}>Manager review</h3>
      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Assign different engineer (optional)</label>
          <select className={calcStyles.formControl} value={reassignedEngineerId} onChange={(e) => setReassignedEngineerId(e.target.value)}>
            <option value="">-- Keep as assigned --</option>
            {technicalRoster.map((person) => (
              <option key={person.id} value={person.id}>{person.name}</option>
            ))}
          </select>
        </div>
        <div className={calcStyles.field}>
          <label className={calcStyles.label}>Modify schedule (optional)</label>
          <input type="datetime-local" className={calcStyles.formControl} min={nowDatetimeInputValue()} value={newScheduledAt} onChange={(e) => setNewScheduledAt(e.target.value)} />
        </div>
      </div>
      <div className={calcStyles.field}>
        <label className={calcStyles.label}>Remarks</label>
        <textarea className={calcStyles.formControl} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </div>
      <div className={historyStyles.actionGroupButtons}>
        <Button variant="success" icon="✓" loading={busy} loadingLabel="Approving…" onClick={() => decide('approved')}>Approve</Button>
        <Button variant="danger" icon="✕" loading={busy} loadingLabel="Rejecting…" onClick={() => decide('rejected')}>Reject</Button>
        <Button variant="secondary" loading={busy} onClick={() => decide('modified')}>Save Changes (Modify)</Button>
      </div>
    </div>
  );
}

function DemoRow({
  record,
  currentUser,
  technicalRoster,
  managersByDepartment,
  onCancel,
  onSubmitDraft,
  onMarkCompleted,
  onDelete,
  onSaveReport,
  onApprovalDone
}: {
  record: DemoScheduleRecord;
  currentUser: { username: string; role: UserRole };
  technicalRoster: TechnicalRosterEntry[];
  managersByDepartment: Record<string, { id: string; username: string; name: string }[]>;
  onCancel: (id: string) => void;
  onSubmitDraft: (id: string) => void;
  onMarkCompleted: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveReport: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onApprovalDone: (updated: DemoScheduleRecord) => void;
}) {
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const isTechnical = currentUser.role === 'technical' || isPrivileged;
  const isOwner = record.created_by === currentUser.username;

  // Strict routing: once a real person is assigned, only they (or an
  // admin/superadmin override) can act on the technical step; only their
  // domain manager (or the override) can act on the manager step. A demo
  // with no resolvable assignee/domain manager falls back to the old broad
  // rule so nothing gets stuck.
  const isAdminOverride = currentUser.role === 'admin' || currentUser.role === 'superadmin';
  const assignedRosterEntry = technicalRoster.find((p) => p.id === record.assigned_technical_person_id);
  const canActTechnical = record.assigned_technical_person_id
    ? assignedRosterEntry?.username === currentUser.username || isAdminOverride
    : isTechnical;
  const domainManagers = assignedRosterEntry?.department ? managersByDepartment[assignedRosterEntry.department] || [] : [];
  const canActManager = domainManagers.length ? domainManagers.some((m) => m.username === currentUser.username) || isAdminOverride : isPrivileged;
  const [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState({
    outcome: record.outcome,
    customerRating: record.customer_rating,
    keyQueries: record.key_queries,
    technicalChallenges: record.technical_challenges,
    unansweredQueries: record.unanswered_queries,
    suggestedNextAction: record.suggested_next_action,
    nextFollowUpDate: record.next_follow_up_date,
    attachments: record.attachments
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const toast = useToast();

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('folder', 'demo');
      Array.from(fileList).forEach((f) => body.append('files', f));
      const response = await fetch('/api/uploads', { method: 'POST', body });
      if (!response.ok) throw new Error(String(response.status));
      const data: { urls: string[] } = await response.json();
      setReport((r) => ({ ...r, attachments: [...r.attachments, ...data.urls] }));
    } catch {
      toast.error('Could not upload one or more attachments.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveReport() {
    setSaving(true);
    try {
      await onSaveReport(record.id, report);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          <button type="button" className={historyStyles.toggleBtn} onClick={() => setExpanded((v) => !v)}>{expanded ? '−' : '+'}</button>
        </td>
        <td>{formatDateTime(record.scheduled_at)}</td>
        <td>{record.client_name}{record.company ? ` (${record.company})` : ''}</td>
        <td>{record.project_id ? <Link href={`/projects/${record.project_id}`}>{record.project_id}</Link> : '-'}</td>
        <td>
          {record.product_domains.length ? record.product_domains.map((d) => DOMAIN_DISPLAY_NAME[d]).join(', ') : '-'}
          {record.products_required.length > 0 && (
            <div className={calcStyles.small}>{record.products_required.map((p) => `${p.product} ×${p.quantity}`).join(', ')}</div>
          )}
        </td>
        <td>{PRIORITY_LABEL[record.priority]}</td>
        <td>{record.assigned_technical_person || '-'}</td>
        <td>
          <StatusBadge tone={STATUS_TONE[record.status]} label={STATUS_LABEL[record.status]} />
          {record.outcome && <div className={calcStyles.small}>Outcome: {OUTCOME_LABEL[record.outcome]}</div>}
        </td>
        <td>{record.created_by}</td>
        <td className={historyStyles.actionGroupButtons}>
          {record.status === 'draft' && isOwner && (
            <Button variant="primary" compact onClick={() => onSubmitDraft(record.id)}>Submit for Approval</Button>
          )}
          {record.status === 'pending_backoffice' && (
            <Link className={`${historyStyles.actionBtn} ${historyStyles.actionBtnPrimary} ${historyStyles.actionBtnCompact}`} href={`/backoffice?demoId=${record.id}`}>Generate DC →</Link>
          )}
          {(record.status === 'dc_generated' || record.status === 'material_dispatched' || record.status === 'material_returned') && (
            <Link className={`${historyStyles.actionBtn} ${historyStyles.actionBtnSecondary} ${historyStyles.actionBtnCompact}`} href={`/backoffice?demoId=${record.id}`}>View DC →</Link>
          )}
          {record.status === 'material_dispatched' && (isTechnical || currentUser.role === 'backoffice') && (
            <Button variant="success" compact onClick={() => onMarkCompleted(record.id)}>Mark Demo Completed</Button>
          )}
          {!['cancelled', 'dc_closed', 'material_returned', 'demo_completed'].includes(record.status) && (isOwner || isPrivileged) && (
            <Button variant="ghost" compact onClick={() => onCancel(record.id)}>Cancel</Button>
          )}
          {isPrivileged && (
            <Button variant="danger" compact onClick={() => onDelete(record.id)}>Delete</Button>
          )}
        </td>
      </tr>

      {record.status === 'pending_technical' && canActTechnical && (
        <tr>
          <td colSpan={10}>
            <div className={historyStyles.wideCellPin}>
              <TechnicalApprovalForm demoId={record.id} onDone={onApprovalDone} />
            </div>
          </td>
        </tr>
      )}
      {record.status === 'pending_manager' && canActManager && (
        <tr>
          <td colSpan={10}>
            <div className={historyStyles.wideCellPin}>
              <ManagerApprovalForm demoId={record.id} technicalRoster={technicalRoster} onDone={onApprovalDone} />
            </div>
          </td>
        </tr>
      )}

      {expanded && (
        <tr className={historyStyles.detailsRow}>
          <td colSpan={10}>
           <div className={historyStyles.wideCellPin}>
            {record.demo_objective && (
              <div className={calcStyles.field} style={{ marginBottom: 8 }}>
                <label className={calcStyles.label}>Demo objective</label>
                <div className={calcStyles.small}>{record.demo_objective}</div>
              </div>
            )}
            {(() => {
              const steps = buildDemoSteps(record);
              return steps ? (
                <div className={calcStyles.field} style={{ marginBottom: 12 }}>
                  <label className={calcStyles.label}>Workflow progress</label>
                  <WorkflowStepper steps={steps} />
                </div>
              ) : null;
            })()}
            {record.technical_approval.decision && (
              <div className={calcStyles.field} style={{ marginBottom: 8 }}>
                <label className={calcStyles.label}>Technical approval</label>
                <div className={calcStyles.small}>
                  {record.technical_approval.decision} by {record.technical_approval.decided_by} — {record.technical_approval.availability || 'n/a'}
                  {record.technical_approval.expected_arrival_time ? `, ETA ${record.technical_approval.expected_arrival_time}` : ''}
                  {record.technical_approval.remarks ? `. ${record.technical_approval.remarks}` : ''}
                </div>
              </div>
            )}
            {record.manager_approval.decision && (
              <div className={calcStyles.field} style={{ marginBottom: 8 }}>
                <label className={calcStyles.label}>Manager approval</label>
                <div className={calcStyles.small}>
                  {record.manager_approval.decision} by {record.manager_approval.decided_by}
                  {record.manager_approval.reassigned_engineer ? `, reassigned to ${record.manager_approval.reassigned_engineer}` : ''}
                  {record.manager_approval.remarks ? `. ${record.manager_approval.remarks}` : ''}
                </div>
              </div>
            )}
            <h3 style={{ marginTop: 0 }}>Demo outcome &amp; report</h3>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Outcome</label>
                <select className={calcStyles.formControl} value={report.outcome} onChange={(e) => setReport((r) => ({ ...r, outcome: e.target.value as DemoOutcome }))}>
                  <option value="">-- Select outcome --</option>
                  {(Object.keys(OUTCOME_LABEL) as Exclude<DemoOutcome, ''>[]).map((o) => (
                    <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
                  ))}
                </select>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Customer rating (1-5)</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  placeholder="Rate 1-5"
                  className={calcStyles.formControl}
                  value={report.customerRating === 0 ? '' : report.customerRating}
                  onFocus={selectAllOnFocusIfZero}
                  onChange={(e) => setReport((r) => ({ ...r, customerRating: Number(e.target.value) || 0 }))}
                />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Next follow-up date</label>
                <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={report.nextFollowUpDate} onChange={(e) => setReport((r) => ({ ...r, nextFollowUpDate: e.target.value }))} />
              </div>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Key queries</label>
              <textarea className={calcStyles.formControl} rows={2} value={report.keyQueries} onChange={(e) => setReport((r) => ({ ...r, keyQueries: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Technical challenges</label>
              <textarea className={calcStyles.formControl} rows={2} value={report.technicalChallenges} onChange={(e) => setReport((r) => ({ ...r, technicalChallenges: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Unanswered queries</label>
              <textarea className={calcStyles.formControl} rows={2} value={report.unansweredQueries} onChange={(e) => setReport((r) => ({ ...r, unansweredQueries: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Suggested next action</label>
              <textarea className={calcStyles.formControl} rows={2} value={report.suggestedNextAction} onChange={(e) => setReport((r) => ({ ...r, suggestedNextAction: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Attachments</label>
              <input type="file" multiple disabled={uploading} onChange={(e) => handleUpload(e.target.files)} />
              {uploading && <div className={calcStyles.small}>Uploading…</div>}
              {report.attachments.length > 0 && (
                <div className={calcStyles.small}>
                  {report.attachments.map((url) => (
                    <div key={url}><a href={url} target="_blank" rel="noreferrer">{url.split('/').pop()}</a></div>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className={calcStyles.btn} disabled={saving} onClick={handleSaveReport}>
              {saving ? 'Saving…' : 'Save report'}
            </button>
           </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DemoScheduleContent({ currentUser }: { currentUser: { username: string; role: UserRole } }) {
  const searchParams = useSearchParams();
  const [records, setRecords] = useState<DemoScheduleRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [projectQuotations, setProjectQuotations] = useState<QuotationRecord[]>([]);
  const [technicalRoster, setTechnicalRoster] = useState<TechnicalRosterEntry[]>([]);
  const [managersByDepartment, setManagersByDepartment] = useState<Record<string, { id: string; username: string; name: string }[]>>({});
  const [loaded, setLoaded] = useState(false);
  const domainLeadLabels = useDomainLeadLabels();
  const [status, setStatus] = useState('Loading...');
  const [form, setForm] = useState({ ...EMPTY_FORM, projectId: searchParams.get('projectId') || '' });
  const [creating, setCreating] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  async function load() {
    setStatus('Loading...');
    try {
      const [dRes, pRes] = await Promise.all([fetch('/api/demo-schedule'), fetch('/api/projects')]);
      if (!dRes.ok) throw new Error(String(dRes.status));
      const data: DemoScheduleRecord[] = await dRes.json();
      setRecords(data);
      setProjects(pRes.ok ? await pRes.json() : []);
      setStatus(data.length ? `${data.length} demo${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the demo schedule API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
    fetch('/api/technical-roster')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TechnicalRosterEntry[]) => setTechnicalRoster(data))
      .catch(() => setTechnicalRoster([]));
    fetch('/api/departments/managers')
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, { id: string; username: string; name: string }[]>) => setManagersByDepartment(data))
      .catch(() => setManagersByDepartment({}));
  }, []);

  useEffect(() => {
    if (!form.projectId) {
      setProjectQuotations([]);
      return;
    }
    fetch(`/api/projects/${form.projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!json) return;
        setProjectQuotations(json.quotations || []);
        setForm((f) => ({
          ...f,
          company: f.company || json.project.company,
          location: f.location || json.project.address,
          clientName: f.clientName || json.project.client_name
        }));
      })
      .catch(() => setProjectQuotations([]));
  }, [form.projectId]);

  function toggleProduct(tag: string) {
    setForm((f) => {
      const exists = f.productsRequired.find((p) => p.product === tag);
      return {
        ...f,
        productsRequired: exists ? f.productsRequired.filter((p) => p.product !== tag) : [...f.productsRequired, { product: tag, quantity: 1 }]
      };
    });
  }

  function setProductQty(tag: string, quantity: number) {
    setForm((f) => ({ ...f, productsRequired: f.productsRequired.map((p) => (p.product === tag ? { ...p, quantity: Math.max(1, quantity) } : p)) }));
  }

  async function handleCreate(e: FormEvent, submit: boolean) {
    e.preventDefault();
    if (!form.projectId || !form.clientName.trim() || !form.scheduledAt) {
      toast.error('Project, client name, and scheduled date/time are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/demo-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, submit })
      });
      if (!response.ok) throw new Error(String(response.status));
      setForm(EMPTY_FORM);
      await load();
    } catch {
      toast.error('Could not save this demo request. Please try again.');
    } finally {
      setCreating(false);
    }
  }

  async function patchRecord(id: string, patch: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/demo-schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(String(response.status));
      const updated: DemoScheduleRecord = await response.json();
      setRecords((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch {
      toast.error('Could not update this request. Please try again.');
    }
  }

  function handleSubmitDraft(id: string) {
    patchRecord(id, { status: 'pending_technical' });
  }

  async function handleCancel(id: string) {
    if (!(await confirm({ message: 'Cancel this demo request?' }))) return;
    patchRecord(id, { status: 'cancelled' });
  }

  function handleMarkCompleted(id: string) {
    patchRecord(id, { status: 'demo_completed' });
  }

  function handleApprovalDone(updated: DemoScheduleRecord) {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function handleDelete(id: string) {
    if (!(await confirm({ message: 'Delete this demo request? This cannot be undone.', danger: true }))) return;
    try {
      const response = await fetch(`/api/demo-schedule/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(String(response.status));
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error('Could not delete this demo request.');
    }
  }

  return (
    <AppShell title="Demo Schedule" subtitle="Request a demo — technical availability, then manager approval, then Back Office handles materials.">
        <h2 className={calcStyles.h2} style={{ marginTop: 0 }}>Request a demo</h2>
        <form className={calcStyles.sectionPanel} onSubmit={(e) => handleCreate(e, true)}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Project *</label>
              <select className={calcStyles.formControl} value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value, quotationId: '' }))} required>
                <option value="">-- Select project --</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} — {p.company || p.client_name}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Quotation</label>
              <select className={calcStyles.formControl} value={form.quotationId} onChange={(e) => setForm((f) => ({ ...f, quotationId: e.target.value }))} disabled={!form.projectId}>
                <option value="">-- None / not linked yet --</option>
                {projectQuotations.map((q) => (
                  <option key={q.id} value={q.id}>{q.quotation_number} — ₹{q.total.toLocaleString('en-IN')}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Client name *</label>
              <input className={calcStyles.formControl} value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} required />
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Company</label>
              <input className={calcStyles.formControl} value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Location</label>
              <input className={calcStyles.formControl} value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
          </div>

          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Domain(s) demonstrated</label>
            <div className={historyStyles.teamGrid}>
              {ALL_DOMAINS.map((d) => (
                <label key={d}>
                  <input
                    type="checkbox"
                    checked={form.productDomains.includes(d)}
                    onChange={() =>
                      setForm((f) => {
                        const has = f.productDomains.includes(d);
                        const nextDomains = has ? f.productDomains.filter((x) => x !== d) : [...f.productDomains, d];
                        const nextProducts = has ? f.productsRequired.filter((p) => !p.product.startsWith(`${DOMAIN_DISPLAY_NAME[d]}: `)) : f.productsRequired;
                        return { ...f, productDomains: nextDomains, productsRequired: nextProducts };
                      })
                    }
                  />
                  {DOMAIN_DISPLAY_NAME[d]}
                </label>
              ))}
            </div>
          </div>

          {form.productDomains.map((d) => {
            const catalog = getDomainProducts(d);
            if (!catalog.length) {
              return (
                <div key={d} className={calcStyles.small} style={{ marginBottom: 8 }}>
                  No fixed product catalog for {DOMAIN_DISPLAY_NAME[d]} — describe what's required in Notes below.
                </div>
              );
            }
            return (
              <div key={d} className={calcStyles.field}>
                <label className={calcStyles.label}>{DOMAIN_DISPLAY_NAME[d]} products required</label>
                <div className={historyStyles.teamGrid}>
                  {catalog.map((product) => {
                    const tag = `${DOMAIN_DISPLAY_NAME[d]}: ${product}`;
                    const line = form.productsRequired.find((p) => p.product === tag);
                    return (
                      <label key={tag} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={!!line} onChange={() => toggleProduct(tag)} />
                        {product}
                        {line && (
                          <input
                            type="number"
                            min={1}
                            className={calcStyles.formControl}
                            style={{ width: 56, padding: '2px 6px' }}
                            value={line.quantity}
                            onClick={(e) => e.preventDefault()}
                            onChange={(e) => setProductQty(tag, parseInt(e.target.value, 10) || 1)}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Demo date &amp; time *</label>
              <input type="datetime-local" className={calcStyles.formControl} min={nowDatetimeInputValue()} value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))} required />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Location</label>
              <input className={calcStyles.formControl} value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Priority</label>
              <select className={calcStyles.formControl} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as DemoPriority }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Assigned technical person</label>
              <select className={calcStyles.formControl} value={form.assignedTechnicalPersonId} onChange={(e) => setForm((f) => ({ ...f, assignedTechnicalPersonId: e.target.value }))}>
                <option value="">-- Select --</option>
                {technicalRoster.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </div>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Assigned rep</label>
              <input className={calcStyles.formControl} placeholder="Defaults to you" value={form.assignedRep} onChange={(e) => setForm((f) => ({ ...f, assignedRep: e.target.value }))} />
            </div>
          </div>
          <TeamCheckboxes
            label="Technical team member(s) attending"
            options={technicalRoster.map((person) => person.name)}
            selected={form.technicalMembers}
            onChange={(next) => setForm((f) => ({ ...f, technicalMembers: next }))}
          />
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Demo objective</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.demoObjective} onChange={(e) => setForm((f) => ({ ...f, demoObjective: e.target.value }))} />
          </div>
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>Notes</label>
            <textarea className={calcStyles.formControl} rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
          {form.productDomains.length > 0 && (
            <div className={calcStyles.small} style={{ marginBottom: 8 }}>
              This request will need approval from: {domainLeadLabels(form.productDomains)} (technical), then a manager.
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="submit" className={calcStyles.btn} disabled={creating}>
              {creating ? 'Sending…' : 'Submit for Technical Approval'}
            </button>
            <button type="button" className={calcStyles.secondaryButton} disabled={creating} onClick={(e) => handleCreate(e, false)}>
              Save as Draft
            </button>
          </div>
        </form>

        <div className={historyStyles.toolbar} style={{ marginTop: 24 }}>
          <button type="button" className={historyStyles.button} onClick={load}>
            Refresh
          </button>
        </div>
        <div className={historyStyles.status}>{status}</div>
        {loaded && (
          <div className={historyStyles.tableWrap}>
          <table className={historyStyles.table}>
            <thead>
              <tr>
                <th></th>
                <th>Scheduled</th>
                <th>Client</th>
                <th>Project</th>
                <th>Domain(s) / Products</th>
                <th>Priority</th>
                <th>Assigned Technical</th>
                <th>Status</th>
                <th>Requested By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={10} className={historyStyles.empty}>
                    No demo requests yet.
                  </td>
                </tr>
              ) : (
                records.map((r) => (
                  <DemoRow
                    key={r.id}
                    record={r}
                    currentUser={currentUser}
                    technicalRoster={technicalRoster}
                    managersByDepartment={managersByDepartment}
                    onCancel={handleCancel}
                    onSubmitDraft={handleSubmitDraft}
                    onMarkCompleted={handleMarkCompleted}
                    onDelete={handleDelete}
                    onSaveReport={patchRecord}
                    onApprovalDone={handleApprovalDone}
                  />
                ))
              )}
            </tbody>
          </table>
          </div>
        )}
    </AppShell>
  );
}

export default function DemoScheduleView({ currentUser }: { currentUser: { username: string; role: UserRole } }) {
  return (
    <Suspense fallback={<AppShell title="Demo Schedule" subtitle="Request and approve product demos.">{null}</AppShell>}>
      <DemoScheduleContent currentUser={currentUser} />
    </Suspense>
  );
}
