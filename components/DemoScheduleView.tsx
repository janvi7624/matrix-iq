'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { UserCheck, Wrench } from 'lucide-react';
import approvalStyles from './demoApproval.module.css';
import { DemoMode, DemoOutcome, DemoPriority, DemoProductLine, DemoRequestStatus, DemoScheduleRecord, DomainKey, QuotationRecord, UserRole } from '@/lib/types';
import { TechnicalRosterEntry } from '@/lib/technicalRoster';
import { TMS_ROLE_KEYS } from '@/lib/tmsConstants';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { useDomainLeadLabels } from '@/lib/domainLeads';
import DemoProductPicker from './DemoProductPicker';
import { selectAllOnFocusIfZero } from '@/lib/numberInputHelpers';
import AppShell from './AppShell';
import TeamCheckboxes from './TeamCheckboxes';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { nowDatetimeInputValue, todayDateInputValue } from '@/lib/dateHelpers';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import ProjectSelect from './ui/ProjectSelect';
import Button from './ui/Button';
import StatusBadge, { StatusTone } from './ui/StatusBadge';
import { DEMO_STATUS_LABEL, stagesForMode } from '@/lib/demoStages';
import WorkflowStepper, { StepperStep } from './ui/WorkflowStepper';
import { fetchCached } from '@/lib/fetchCached';
import DemoBrief from './DemoBrief';
import briefStyles from './demoBrief.module.css';


const EMPTY_FORM = {
  projectId: '',
  quotationId: '',
  clientName: '',
  company: '',
  location: '',
  mode: 'onsite' as DemoMode,
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

// STATUS_LABEL and the two stage chains now live in lib/demoStages.ts so the
// partner portal renders the identical pipeline instead of a second copy
// that drifts. Imported rather than redefined here.
const STATUS_LABEL = DEMO_STATUS_LABEL;

const STATUS_TONE: Record<DemoRequestStatus, StatusTone> = {
  draft: 'cancelled',
  pending_technical: 'pending',
  pending_manager: 'pending',
  pending_backoffice: 'pending',
  ready_for_demo: 'confirmed',
  dc_generated: 'confirmed',
  material_dispatched: 'confirmed',
  demo_completed: 'done',
  material_returned: 'done',
  dc_closed: 'done',
  cancelled: 'rejected'
};

// Cancellation can happen from any status and doesn't record which stage it
// was cancelled at, so a cancelled demo gets a plain badge instead of a
// fabricated stepper position.
function buildDemoSteps(record: DemoScheduleRecord): StepperStep[] | null {
  if (record.status === 'cancelled') return null;
  // A virtual demo never goes through Back Office, so showing it four steps it
  // will never reach would make a finished demo look permanently unfinished.
  // Manager approval lands on 'ready_for_demo' instead of 'pending_backoffice'.
  const stages = stagesForMode(record.mode);
  const idx = record.status === 'draft' ? -1 : stages.findIndex((s) => s.key === record.status);
  return stages.map((s, i) => {
    let meta: string | undefined;
    if (s.key === 'pending_manager' && record.technical_approval.decision) {
      meta = `${record.technical_approval.decision} by ${record.technical_approval.decided_by}`;
    } else if ((s.key === 'pending_backoffice' || s.key === 'ready_for_demo') && record.manager_approval.decision) {
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
    <div className={approvalStyles.panel}>
      <div className={approvalStyles.header}>
        <span className={approvalStyles.headerIcon}><Wrench size={16} /></span>
        <div>
          <h3 className={approvalStyles.title}>Technical availability</h3>
          <p className={approvalStyles.subtitle}>Confirm whether you can attend this demo, then approve, reject or propose a new time.</p>
        </div>
      </div>
      <div className={approvalStyles.body}>
        <div className={approvalStyles.grid}>
          <div className={approvalStyles.field}>
            <span className={approvalStyles.label}>Availability</span>
            <div className={approvalStyles.choice} role="radiogroup" aria-label="Availability">
              <button type="button" role="radio" aria-checked={availability === 'available'} className={`${approvalStyles.choiceBtn} ${availability === 'available' ? approvalStyles.choiceYes : ''}`} onClick={() => setAvailability('available')}>Available</button>
              <button type="button" role="radio" aria-checked={availability === 'not_available'} className={`${approvalStyles.choiceBtn} ${availability === 'not_available' ? approvalStyles.choiceNo : ''}`} onClick={() => setAvailability('not_available')}>Not available</button>
            </div>
          </div>
          <label className={approvalStyles.field}>
            <span className={approvalStyles.label}>Expected arrival time</span>
            <input className={approvalStyles.control} placeholder="e.g. 10:30 AM" value={expectedArrivalTime} onChange={(e) => setExpectedArrivalTime(e.target.value)} />
          </label>
          <label className={approvalStyles.field}>
            <span className={approvalStyles.label}>Reschedule to <span className={approvalStyles.hint}>(only for Reschedule)</span></span>
            <input type="datetime-local" className={approvalStyles.control} min={nowDatetimeInputValue()} value={newScheduledAt} onChange={(e) => setNewScheduledAt(e.target.value)} />
          </label>
        </div>
        <label className={approvalStyles.field}>
          <span className={approvalStyles.label}>Remarks</span>
          <textarea className={approvalStyles.control} rows={2} placeholder="Anything the sales team should know" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
      </div>
      <div className={approvalStyles.footer}>
        <span className={approvalStyles.footerNote}>Pick a new date &amp; time above before choosing Reschedule.</span>
        <Button variant="secondary" loading={busy} onClick={() => decide('reschedule')}>Reschedule</Button>
        <Button variant="danger" icon="✕" loading={busy} loadingLabel="Rejecting…" onClick={() => decide('rejected')}>Reject</Button>
        <Button variant="success" icon="✓" loading={busy} loadingLabel="Approving…" onClick={() => decide('approved')}>Approve</Button>
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
    <div className={approvalStyles.panel}>
      <div className={approvalStyles.header}>
        <span className={approvalStyles.headerIcon}><UserCheck size={16} /></span>
        <div>
          <h3 className={approvalStyles.title}>Manager review</h3>
          <p className={approvalStyles.subtitle}>Approve as planned, or change the engineer or time first.</p>
        </div>
      </div>
      <div className={approvalStyles.body}>
        <div className={approvalStyles.grid}>
          <label className={approvalStyles.field}>
            <span className={approvalStyles.label}>Assign different engineer <span className={approvalStyles.hint}>(optional)</span></span>
            <select className={approvalStyles.control} value={reassignedEngineerId} onChange={(e) => setReassignedEngineerId(e.target.value)}>
              <option value="">-- Keep as assigned --</option>
              {technicalRoster.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </select>
          </label>
          <label className={approvalStyles.field}>
            <span className={approvalStyles.label}>Modify schedule <span className={approvalStyles.hint}>(optional)</span></span>
            <input type="datetime-local" className={approvalStyles.control} min={nowDatetimeInputValue()} value={newScheduledAt} onChange={(e) => setNewScheduledAt(e.target.value)} />
          </label>
        </div>
        <label className={approvalStyles.field}>
          <span className={approvalStyles.label}>Remarks</span>
          <textarea className={approvalStyles.control} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
        </label>
      </div>
      <div className={approvalStyles.footer}>
        <Button variant="secondary" loading={busy} onClick={() => decide('modified')}>Save Changes (Modify)</Button>
        <Button variant="danger" icon="✕" loading={busy} loadingLabel="Rejecting…" onClick={() => decide('rejected')}>Reject</Button>
        <Button variant="success" icon="✓" loading={busy} loadingLabel="Approving…" onClick={() => decide('approved')}>Approve</Button>
      </div>
    </div>
  );
}

type ManagersByDept = Record<string, { id: string; username: string; name: string }[]>;
type DemoAction = 'technical' | 'manager' | 'complete' | 'submit' | null;

// What (if anything) the current user must do on this demo. Drives the
// "Needs my action" filter and the row highlight; mirrors the server gates.
function pendingActionFor(
  record: DemoScheduleRecord,
  currentUser: { username: string; role: UserRole; isPrivileged: boolean },
  technicalRoster: TechnicalRosterEntry[],
  managersByDepartment: ManagersByDept
): DemoAction {
  const isAdminOverride = currentUser.role === 'admin' || currentUser.role === 'superadmin';
  const assigned = technicalRoster.find((p) => p.id === record.assigned_technical_person_id);
  const isAssignedMe = !!assigned && assigned.username === currentUser.username;
  if (record.status === 'pending_technical' && (record.assigned_technical_person_id ? isAssignedMe || isAdminOverride : isAdminOverride)) return 'technical';
  const domainManagers = assigned?.department ? managersByDepartment[assigned.department] || [] : [];
  if (record.status === 'pending_manager' && (domainManagers.length ? domainManagers.some((m) => m.username === currentUser.username) || isAdminOverride : currentUser.isPrivileged)) return 'manager';
  if ((record.status === 'material_dispatched' || record.status === 'ready_for_demo') && isAssignedMe) return 'complete';
  if (record.status === 'draft' && record.created_by === currentUser.username) return 'submit';
  return null;
}

const ACTION_LABEL: Record<Exclude<DemoAction, null>, string> = {
  technical: 'Your response needed',
  manager: 'Your approval needed',
  complete: 'Mark done after the demo',
  submit: 'Draft — submit it'
};

function DemoRow({
  record,
  currentUser,
  technicalRoster,
  managersByDepartment,
  onCancel,
  onSubmitDraft,
  onAssignTechnical,
  onMarkCompleted,
  onDelete,
  onSaveReport,
  onApprovalDone
}: {
  record: DemoScheduleRecord;
  currentUser: { username: string; role: UserRole; isPrivileged: boolean };
  technicalRoster: TechnicalRosterEntry[];
  managersByDepartment: Record<string, { id: string; username: string; name: string }[]>;
  onCancel: (id: string) => void;
  onSubmitDraft: (id: string) => void;
  onAssignTechnical: (id: string, technicalPersonId: string) => void;
  onMarkCompleted: (id: string) => void;
  onDelete: (id: string) => void;
  onSaveReport: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onApprovalDone: (updated: DemoScheduleRecord) => void;
}) {
  // Role Management's isPrivileged flag, resolved server-side — NOT
  // re-derived from role name, since an admin can toggle a role's
  // privileged status independently of what the role is called.
  const isPrivileged = currentUser.isPrivileged;
  const isTechnical = currentUser.role === 'engineer' || isPrivileged;
  const isOwner = record.created_by === currentUser.username;

  // Strict routing: once a real person is assigned, only they (or an
  // admin/superadmin override) can act on the technical step — nobody else,
  // not even a manager or another technical-role account. An unassigned
  // demo requires the admin/superadmin override too (matches
  // app/api/demo-schedule/[id]/technical-approval/route.ts exactly, so this
  // button never shows when the action would actually be rejected
  // server-side). The manager step keeps its own domain-manager-or-override
  // rule, unaffected.
  const isAdminOverride = currentUser.role === 'admin' || currentUser.role === 'superadmin';
  const assignedRosterEntry = technicalRoster.find((p) => p.id === record.assigned_technical_person_id);
  const canActTechnical = record.assigned_technical_person_id
    ? assignedRosterEntry?.username === currentUser.username || isAdminOverride
    : isAdminOverride;
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
    if (!report.outcome) {
      toast.error('Select an outcome before saving the report.');
      return;
    }
    setSaving(true);
    try {
      await onSaveReport(record.id, report);
    } finally {
      setSaving(false);
    }
  }

  const myAction = pendingActionFor(record, currentUser, technicalRoster, managersByDepartment);

  return (
    <>
      <tr style={myAction ? { boxShadow: 'inset 3px 0 0 var(--mx-brand, #dc2626)', background: 'var(--mx-brand-subtle, rgba(220,38,38,0.05))' } : undefined}>
        <td>
          <button type="button" title={expanded ? 'Hide details' : 'Show the full demo brief'} className={historyStyles.toggleBtn} onClick={() => setExpanded((v) => !v)}>{expanded ? '−' : '+'}</button>
        </td>
        <td>{formatDateTime(record.scheduled_at)}</td>
        <td>
          <strong>{record.client_name}</strong>{record.company ? ` (${record.company})` : ''}
          {record.demo_objective && (
            <div className={calcStyles.small} title={record.demo_objective}>
              🎯 {record.demo_objective.length > 70 ? record.demo_objective.slice(0, 70) + '…' : record.demo_objective}
            </div>
          )}
          {myAction && (
            <span className={briefStyles.tag} style={{ marginTop: 4, background: 'var(--mx-brand, #dc2626)', color: '#fff', textTransform: 'none' }}>
              ● {ACTION_LABEL[myAction]}
            </span>
          )}
        </td>
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
          {/* A partner request arrives as a draft owned by their relationship
              manager, which otherwise looks identical to that person's own
              abandoned draft. Saying where it came from is what turns it
              into something actionable. */}
          {record.partner_name && (
            <div className={calcStyles.small}>
              <strong>Partner request</strong> — {record.partner_name}
            </div>
          )}
          {record.outcome && <div className={calcStyles.small}>Outcome: {OUTCOME_LABEL[record.outcome]}</div>}
        </td>
        <td>{record.created_by_name || record.created_by}</td>
        <td className={historyStyles.actionGroupButtons}>
          {record.status === 'draft' && isOwner && (
            <>
              {/* The sales person assigns the technical person before this
                  goes for approval — a partner can never pick one (see the
                  PATCH guard in app/api/demo-schedule/[id]). Shown inline so
                  the whole action is one row, not a trip to another screen. */}
              <select
                className={calcStyles.formControl}
                value={record.assigned_technical_person_id || ''}
                onChange={(e) => onAssignTechnical(record.id, e.target.value)}
                aria-label="Assign technical person"
              >
                <option value="">— Assign technical person —</option>
                {technicalRoster.map((person) => (
                  <option key={person.id} value={person.id}>{person.name || person.username}</option>
                ))}
              </select>
              <Button variant="primary" compact onClick={() => onSubmitDraft(record.id)}>Submit for Approval</Button>
            </>
          )}
          {record.status === 'pending_backoffice' && (
            <Link className={`${historyStyles.actionBtn} ${historyStyles.actionBtnPrimary} ${historyStyles.actionBtnCompact}`} href={`/backoffice?demoId=${record.id}`}>Generate DC →</Link>
          )}
          {(record.status === 'dc_generated' || record.status === 'material_dispatched' || record.status === 'material_returned') && (
            <Link className={`${historyStyles.actionBtn} ${historyStyles.actionBtnSecondary} ${historyStyles.actionBtnCompact}`} href={`/backoffice?demoId=${record.id}`}>View DC →</Link>
          )}
          {/* A virtual demo has no dispatch to wait for, so it becomes
              completable as soon as the manager has approved it. */}
          {(record.status === 'material_dispatched' || record.status === 'ready_for_demo') && (isTechnical || currentUser.role === 'backoffice') && (
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
          <td colSpan={9}>
            <div className={historyStyles.wideCellPin}>
              <div style={{ display: 'grid', gap: 12 }}>
                <DemoBrief record={record} />
                <TechnicalApprovalForm demoId={record.id} onDone={onApprovalDone} />
              </div>
            </div>
          </td>
        </tr>
      )}
      {record.status === 'pending_manager' && canActManager && (
        <tr>
          <td colSpan={9}>
            <div className={historyStyles.wideCellPin}>
              <div style={{ display: 'grid', gap: 12 }}>
                <DemoBrief record={record} compact />
                <ManagerApprovalForm demoId={record.id} technicalRoster={technicalRoster} onDone={onApprovalDone} />
              </div>
            </div>
          </td>
        </tr>
      )}

      {expanded && (
        <tr className={historyStyles.detailsRow}>
          <td colSpan={9}>
           <div className={historyStyles.wideCellPin}>
            {/* Already shown above the approval form when one is open. */}
            {!(record.status === 'pending_technical' && canActTechnical) && !(record.status === 'pending_manager' && canActManager) && (
              <div className={calcStyles.mb12}>
                <DemoBrief record={record} />
              </div>
            )}
            {(() => {
              const steps = buildDemoSteps(record);
              return steps ? (
                <div className={`${calcStyles.field} ${calcStyles.mb12}`}>
                  <label className={calcStyles.label}>Workflow progress</label>
                  <WorkflowStepper steps={steps} />
                </div>
              ) : null;
            })()}
            {record.technical_approval.decision && (
              <div className={`${calcStyles.field} ${calcStyles.mb8}`}>
                <label className={calcStyles.label}>Technical approval</label>
                <div className={calcStyles.small}>
                  {record.technical_approval.decision} by {record.technical_approval.decided_by} — {record.technical_approval.availability || 'n/a'}
                  {record.technical_approval.expected_arrival_time ? `, ETA ${record.technical_approval.expected_arrival_time}` : ''}
                  {record.technical_approval.remarks ? `. ${record.technical_approval.remarks}` : ''}
                </div>
              </div>
            )}
            {record.manager_approval.decision && (
              <div className={`${calcStyles.field} ${calcStyles.mb8}`}>
                <label className={calcStyles.label}>Manager approval</label>
                <div className={calcStyles.small}>
                  {record.manager_approval.decision} by {record.manager_approval.decided_by}
                  {record.manager_approval.reassigned_engineer ? `, reassigned to ${record.manager_approval.reassigned_engineer}` : ''}
                  {record.manager_approval.remarks ? `. ${record.manager_approval.remarks}` : ''}
                </div>
              </div>
            )}
            <h3 className={historyStyles.h3Flush}>Demo outcome &amp; report</h3>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Outcome *</label>
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

function DemoScheduleContent({ currentUser }: { currentUser: { username: string; role: UserRole; isPrivileged: boolean } }) {
  // TMS accounts (technical-manager/team-lead/engineer/technician) can see
  // this queue but not submit new requests — matches the server-side gate
  // in app/api/demo-schedule/route.ts's POST.
  const canCreate = !(TMS_ROLE_KEYS as readonly string[]).includes(currentUser.role);
  const searchParams = useSearchParams();
  const [records, setRecords] = useState<DemoScheduleRecord[]>([]);
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
  const [view, setView] = useState<'action' | 'upcoming' | 'done' | 'all'>('all');
  const [viewChosen, setViewChosen] = useState(false);

  const actionOf = (r: DemoScheduleRecord) => pendingActionFor(r, currentUser, technicalRoster, managersByDepartment);
  const actionCount = records.filter((r) => actionOf(r)).length;
  const DONE: string[] = ['demo_completed', 'material_returned', 'dc_closed', 'cancelled'];
  const visible = records
    .filter((r) =>
      view === 'action' ? !!actionOf(r) : view === 'upcoming' ? !DONE.includes(r.status) && r.status !== 'draft' : view === 'done' ? DONE.includes(r.status) : true
    )
    // Anything waiting on me first, then the soonest demo.
    .sort((a, b) => Number(!!actionOf(b)) - Number(!!actionOf(a)) || (a.scheduled_at || '').localeCompare(b.scheduled_at || ''));

  // Open on "Needs my action" when something is waiting (once per visit).
  if (!viewChosen && loaded && technicalRoster.length > 0 && actionCount > 0 && view !== 'action') {
    setView('action');
    setViewChosen(true);
  }

  async function load() {
    setStatus('Loading...');
    try {
      const dRes = await fetch('/api/demo-schedule');
      if (!dRes.ok) throw new Error(String(dRes.status));
      const data: DemoScheduleRecord[] = await dRes.json();
      setRecords(data);
      setStatus(data.length ? `${data.length} demo${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the demo schedule API. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
    fetchCached('/api/technical-roster')
      .then((data: TechnicalRosterEntry[]) => setTechnicalRoster(data))
      .catch(() => setTechnicalRoster([]));
    fetchCached('/api/departments/managers')
      .then((data: Record<string, { id: string; username: string; name: string }[]>) => setManagersByDepartment(data))
      .catch(() => setManagersByDepartment({}));
  }, []);

  // Prefill (company/location/clientName) now happens directly in
  // ProjectSelect's onChange from the full record it already has — this
  // effect only needs the project's quotations, which aren't part of that
  // record.
  useEffect(() => {
    if (!form.projectId) {
      setProjectQuotations([]);
      return;
    }
    fetch(`/api/projects/${form.projectId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setProjectQuotations(json?.quotations || []))
      .catch(() => setProjectQuotations([]));
  }, [form.projectId]);


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

  // Assigning the technical person on a draft. The server re-checks that the
  // caller is this demo's sales owner — see app/api/demo-schedule/[id].
  function handleAssignTechnical(id: string, technicalPersonId: string) {
    patchRecord(id, { assignedTechnicalPersonId: technicalPersonId });
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
        {canCreate && (
        <>
        <h2 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Request a demo</h2>
        <form className={calcStyles.sectionPanel} onSubmit={(e) => handleCreate(e, true)}>
          <div className={`${calcStyles.row} ${calcStyles.columns}`}>
            <div className={calcStyles.field}>
              <label className={calcStyles.label}>Project *</label>
              <ProjectSelect
                value={form.projectId}
                required
                onChange={(projectId, project) =>
                  setForm((f) => ({
                    ...f,
                    projectId,
                    quotationId: '',
                    company: project?.company || f.company,
                    location: project?.address || f.location,
                    clientName: project?.client_name || f.clientName
                  }))
                }
              />
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
            {/* Decides the whole rest of the pipeline: an onsite demo needs a
                delivery challan, dispatch and return; a virtual one needs none
                of it and is done once the demo has happened. */}
            <div className={calcStyles.field}>
              <label className={calcStyles.label} htmlFor="demo-mode">How is the demo given?</label>
              <select
                id="demo-mode"
                className={calcStyles.formControl}
                value={form.mode}
                onChange={(e) => setForm((f) => ({ ...f, mode: e.target.value as DemoMode }))}
              >
                <option value="onsite">At the client&apos;s site — equipment is sent</option>
                <option value="virtual">Virtual / online — nothing is sent</option>
              </select>
              <span className={calcStyles.small}>
                {form.mode === 'virtual'
                  ? 'No delivery challan, dispatch or material return. Approved by the manager, then marked done after the demo.'
                  : 'Goes to Back Office for a delivery challan after approval.'}
              </span>
            </div>
          </div>

          <DemoProductPicker
            domains={form.productDomains}
            onDomainsChange={(next) => setForm((f) => ({ ...f, productDomains: next }))}
            lines={form.productsRequired}
            onChange={(next) => setForm((f) => ({ ...f, productsRequired: next }))}
          />

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
            <div className={`${calcStyles.small} ${calcStyles.mb8}`}>
              This request will need approval from: {domainLeadLabels(form.productDomains)} (technical), then a manager.
            </div>
          )}
          <div className={calcStyles.formActionsRow}>
            <button type="submit" className={calcStyles.btn} disabled={creating}>
              {creating ? 'Sending…' : 'Submit for Technical Approval'}
            </button>
            <button type="button" className={calcStyles.secondaryButton} disabled={creating} onClick={(e) => handleCreate(e, false)}>
              Save as Draft
            </button>
          </div>
        </form>
        </>
      )}

        <div className={`${historyStyles.toolbar} ${historyStyles.toolbarSpaced}`} style={{ flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['action', `Needs my action (${actionCount})`],
              ['upcoming', 'Upcoming'],
              ['done', 'Completed'],
              ['all', `All (${records.length})`]
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => {
                setView(key);
                setViewChosen(true);
              }}
              className={briefStyles.tag}
              style={{
                cursor: 'pointer',
                border: '1px solid ' + (view === key ? 'var(--mx-brand, #dc2626)' : 'var(--mx-border-strong, #d1d5db)'),
                background: view === key ? 'var(--mx-brand, #dc2626)' : 'transparent',
                color: view === key ? '#fff' : undefined,
                padding: '6px 14px',
                fontSize: 13,
                textTransform: 'none'
              }}
            >
              {label}
            </button>
          ))}
          <button type="button" className={historyStyles.button} onClick={load} style={{ marginLeft: 'auto' }}>
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
                <th>Domain(s) / Products</th>
                <th>Priority</th>
                <th>Assigned Technical</th>
                <th>Status</th>
                <th>Requested By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={9} className={historyStyles.empty}>
                    {records.length === 0 ? 'No demo requests yet.' : view === 'action' ? 'Nothing is waiting on you right now. 🎉' : 'No demos in this view.'}
                  </td>
                </tr>
              ) : (
                visible.map((r) => (
                  <DemoRow
                    key={r.id}
                    record={r}
                    currentUser={currentUser}
                    technicalRoster={technicalRoster}
                    managersByDepartment={managersByDepartment}
                    onCancel={handleCancel}
                    onSubmitDraft={handleSubmitDraft}
                    onAssignTechnical={handleAssignTechnical}
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

export default function DemoScheduleView({ currentUser }: { currentUser: { username: string; role: UserRole; isPrivileged: boolean } }) {
  return (
    <Suspense fallback={<AppShell title="Demo Schedule" subtitle="Request and approve product demos.">{null}</AppShell>}>
      <DemoScheduleContent currentUser={currentUser} />
    </Suspense>
  );
}
