'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AuditLogEntry, ProjectRecord, TravelScheduleRecord, TravelScheduleStatus, UserRole } from '@/lib/types';
import { TRAVEL_STATUS_LABEL, TRAVEL_STATUS_TONE, travelPendingLabel } from '@/lib/travelLabels';
import AppShell from './AppShell';
import StatusBadge from './ui/StatusBadge';
import WorkflowStepper, { StepperStep } from './ui/WorkflowStepper';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import TravelScheduleForm, { EMPTY_TRAVEL_EXTRA_FIELDS, travelExtraFieldsFromRecord, travelExtraFieldsToPayload } from './TravelScheduleForm';
import ProjectSelect from './ui/ProjectSelect';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './travelDetail.module.css';

function formatDate(iso: string): string {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleDateString('en-IN'); } catch { return iso; }
}

function formatTime12h(time: string): string {
  if (!time) return '-';
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return time;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatCurrency(value: number): string {
  return value ? `₹${value.toLocaleString('en-IN')}` : '-';
}

function projectLabel(p: ProjectRecord): string {
  return `${p.client_name || ''}${p.company ? ` — ${p.company}` : ''}`;
}

function friendlyDocName(url: string, record: TravelScheduleRecord, docType: string): string {
  const ext = url.split('.').pop() || '';
  const project = (record.project_names?.[0] || record.project_name || '').replace(/[^a-zA-Z0-9]/g, '');
  const person = (record.created_by || '').replace(/[^a-zA-Z0-9.]/g, '');
  const from = (record.origin || '').replace(/[^a-zA-Z0-9]/g, '');
  const to = (record.destination || '').replace(/[^a-zA-Z0-9]/g, '');
  return `${project || 'NoProject'}_${person}_${from}_${to}_${docType}.${ext}`;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  submit: 'Submitted for approval',
  manager_approve: 'Approved by Manager',
  manager_request_changes: 'Changes requested by Manager',
  hr_approve: 'Approved by HR',
  hr_request_changes: 'Changes requested by HR',
  admin_approve: 'Approved by Admin',
  admin_request_changes: 'Sent back by Admin',
  complete_booking: 'Ticket booking completed',
  hr_final_approve: 'Final verification by HR',
  hr_final_request_changes: 'Sent back by HR (Final Verification)',
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] || action;
}

function auditActionToneClass(action: string): string {
  if (action.includes('request_changes')) return styles.auditBarDanger;
  if (action.includes('approve') || action === 'complete_booking') return styles.auditBarSuccess;
  return styles.auditBarBrand;
}

interface TravelScheduleDetailViewProps {
  requestId: string;
  currentUser: { id: string; username: string; role: UserRole; isPrivileged: boolean };
}

function buildSteps(record: TravelScheduleRecord): StepperStep[] {
  const status = record.status;
  const ORDER: TravelScheduleStatus[] = [
    'draft', 'submitted', 'manager_approved', 'hr_reviewed',
    'admin_approved', 'ticket_booking', 'completed'
  ];
  const LABELS: Record<string, string> = {
    draft: 'Employee Creates Request',
    submitted: 'Department Manager Review',
    manager_approved: 'HR Review & Travel Planning',
    hr_reviewed: 'Admin Department Review',
    admin_approved: 'Accounts — Ticket Booking',
    ticket_booking: 'HR Final Verification',
    completed: 'Travel Confirmed'
  };

  if (status === 'changes_requested') {
    return ORDER.map((key) => ({
      key,
      label: LABELS[key],
      state: 'skipped' as const,
      meta: key === 'draft' ? `Changes requested by ${record.change_requested_by || 'reviewer'}` : undefined
    }));
  }

  const currentIdx = ORDER.indexOf(status);
  return ORDER.map((key, i) => {
    let state: 'done' | 'current' | 'upcoming';
    if (i < currentIdx) state = 'done';
    else if (i === currentIdx) state = status === 'completed' ? 'done' : 'current';
    else state = 'upcoming';

    let meta: string | undefined;
    if (key === 'submitted' && record.manager_name) meta = `${record.manager_name} · ${formatDate(record.manager_action_at)}`;
    if (key === 'manager_approved' && record.hr_reviewer_name) meta = `${record.hr_reviewer_name} · ${formatDate(record.hr_reviewed_at)}`;
    if (key === 'hr_reviewed' && record.admin_reviewer_name) meta = `${record.admin_reviewer_name} · ${formatDate(record.admin_reviewed_at)}`;
    if (key === 'admin_approved' && record.accounts_handler_name) meta = `${record.accounts_handler_name} · ${formatDate(record.accounts_completed_at)}`;
    if (key === 'ticket_booking' && record.hr_final_verifier_name) meta = `${record.hr_final_verifier_name} · ${formatDate(record.hr_final_verified_at)}`;

    return { key, label: LABELS[key], state, meta };
  });
}

type ActionPanel = 'manager_approve' | 'manager_changes' | 'hr_approve' | 'hr_changes' | 'admin_approve' | 'admin_changes' | 'booking' | 'hr_final_approve' | 'hr_final_changes' | null;

export default function TravelScheduleDetailView({ requestId, currentUser }: TravelScheduleDetailViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [record, setRecord] = useState<TravelScheduleRecord | null>(null);
  const [auditHistory, setAuditHistory] = useState<AuditLogEntry[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [departmentManagers, setDepartmentManagers] = useState<Record<string, { username: string }[]>>({});
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ origin: '', destination: '', startDate: '', endDate: '', requiredArrivalTime: '', expectedDepartureTime: '', linkedClient: '', projectIds: [] as string[], companionIds: [] as string[], ...EMPTY_TRAVEL_EXTRA_FIELDS });
  const [allUsers, setAllUsers] = useState<{ id: string; username: string; name: string }[]>([]);
  const [allProjects, setAllProjects] = useState<ProjectRecord[]>([]);
  const [saving, setSaving] = useState(false);
  const [activePanel, setActivePanel] = useState<ActionPanel>(null);
  const [actionRemarks, setActionRemarks] = useState('');
  const [actionCost, setActionCost] = useState('');
  const [actionBookingDetails, setActionBookingDetails] = useState('');
  const [adminSendBackTo, setAdminSendBackTo] = useState('employee');
  const [pendingHrDocUrls, setPendingHrDocUrls] = useState<string[]>([]);
  const [pendingTicketDocUrls, setPendingTicketDocUrls] = useState<string[]>([]);

  function openPanel(panel: ActionPanel) {
    setActionRemarks('');
    setActionCost('');
    setAdminSendBackTo('employee');
    setPendingHrDocUrls([]);
    setPendingTicketDocUrls([]);
    setActionBookingDetails('');
    setActivePanel(panel);
  }

  useEffect(() => {
    fetch('/api/departments/managers')
      .then((r) => (r.ok ? r.json() : {}))
      .then(setDepartmentManagers)
      .catch(() => setDepartmentManagers({}));
    fetch('/api/users/lite').then((r) => (r.ok ? r.json() : [])).then(setAllUsers).catch(() => setAllUsers([]));
    fetch('/api/projects').then((r) => (r.ok ? r.json() : [])).then(setAllProjects).catch(() => setAllProjects([]));
  }, []);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch(`/api/travel-schedule/${requestId}`);
      if (response.status === 404) { setStatus('Travel request not found.'); return; }
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      const { audit_history, ...rest } = data;
      setRecord(rest);
      setAuditHistory(audit_history || []);
      setStatus('');
    } catch {
      setStatus('Could not load this travel request.');
    }
  }

  useEffect(() => { load(); }, [requestId]);

  async function callAction(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(`/api/travel-schedule/${requestId}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(errBody?.error || String(response.status));
      }
      setActivePanel(null);
      await load();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  // Action handlers
  async function handleSubmit() {
    if (!(await confirm({ message: 'Submit this travel request for approval?' }))) return;
    if (await callAction('/submit')) toast.success('Request submitted.');
  }

  async function handleManagerApprove() {
    if (await callAction('/manager-decide', { decision: 'approve', remarks: actionRemarks.trim() })) toast.success('Approved by manager.');
  }

  async function handleManagerRequestChanges() {
    if (!actionRemarks.trim()) { toast.error('Please add remarks describing the required changes.'); return; }
    if (await callAction('/manager-decide', { decision: 'request_changes', remarks: actionRemarks.trim() })) toast.success('Changes requested.');
  }

  async function handleHrApprove() {
    const estimatedCost = actionCost ? parseFloat(actionCost) : undefined;
    if (await callAction('/hr-review', { decision: 'approve', remarks: actionRemarks.trim(), estimatedCost, hrDocuments: pendingHrDocUrls.length ? pendingHrDocUrls : undefined })) toast.success('HR review completed.');
  }

  async function handleHrRequestChanges() {
    if (!actionRemarks.trim()) { toast.error('Please add remarks describing the required changes.'); return; }
    if (await callAction('/hr-review', { decision: 'request_changes', remarks: actionRemarks.trim() })) toast.success('Changes requested.');
  }

  async function handleAdminApprove() {
    if (await callAction('/admin-decide', { decision: 'approve', remarks: actionRemarks.trim() })) toast.success('Approved by admin.');
  }

  async function handleAdminRequestChanges() {
    if (!actionRemarks.trim()) { toast.error('Please add remarks describing the required changes.'); return; }
    if (await callAction('/admin-decide', { decision: 'request_changes', remarks: actionRemarks.trim(), sendBackTo: adminSendBackTo })) {
      const target = adminSendBackTo === 'manager' ? 'Manager' : adminSendBackTo === 'hr' ? 'HR' : 'Employee';
      toast.success(`Sent back to ${target} for review.`);
    }
  }

  async function handleCompleteBooking() {
    if (!actionBookingDetails.trim()) { toast.error('Please enter booking/ticket details.'); return; }
    const actualCost = actionCost ? parseFloat(actionCost) : undefined;
    if (await callAction('/complete-booking', { bookingDetails: actionBookingDetails.trim(), actualCost, ticketDocuments: pendingTicketDocUrls.length ? pendingTicketDocUrls : undefined })) toast.success('Booking completed.');
  }

  async function handleHrFinalApprove() {
    if (await callAction('/hr-final-verify', { decision: 'approve', remarks: actionRemarks.trim() })) toast.success('Travel confirmed and sent to employee.');
  }

  async function handleHrFinalRequestChanges() {
    if (!actionRemarks.trim()) { toast.error('Please add remarks describing what needs correction.'); return; }
    if (await callAction('/hr-final-verify', { decision: 'request_changes', remarks: actionRemarks.trim() })) toast.success('Sent back for corrections.');
  }

  async function handleUploadHrDocs(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('folder', 'travel-hr-docs');
      Array.from(files).forEach((f) => formData.append('files', f));
      const uploadRes = await fetch('/api/uploads', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error(String(uploadRes.status));
      const { urls } = await uploadRes.json();
      setPendingHrDocUrls((prev) => [...prev, ...urls]);
      toast.success(`${urls.length} document${urls.length > 1 ? 's' : ''} uploaded. Click Approve to submit.`);
    } catch {
      toast.error('Could not upload documents.');
    } finally {
      setUploading(false);
    }
  }

  async function handleUploadTicketDocs(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('folder', 'travel-tickets');
      Array.from(files).forEach((f) => formData.append('files', f));
      const uploadRes = await fetch('/api/uploads', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error(String(uploadRes.status));
      const { urls } = await uploadRes.json();
      setPendingTicketDocUrls((prev) => [...prev, ...urls]);
      toast.success(`${urls.length} document${urls.length > 1 ? 's' : ''} uploaded. Click Complete Booking to submit.`);
    } catch {
      toast.error('Could not upload ticket documents.');
    } finally {
      setUploading(false);
    }
  }

  function startEditing() {
    if (!record) return;
    setEditForm({
      origin: record.origin, destination: record.destination,
      startDate: record.start_date, endDate: record.end_date,
      requiredArrivalTime: record.required_arrival_time, expectedDepartureTime: record.expected_departure_time,
      linkedClient: record.linked_client,
      projectIds: Array.isArray(record.project_ids) ? [...record.project_ids] : [],
      companionIds: Array.isArray(record.companion_ids) ? [...record.companion_ids] : [],
      ...travelExtraFieldsFromRecord(record)
    });
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!editForm.destination.trim() || !editForm.startDate) {
      toast.error('Destination and arrival date are required.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/travel-schedule/${requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editForm, ...travelExtraFieldsToPayload(editForm) })
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(errBody?.error || String(response.status));
      }
      setEditing(false);
      await load();
      toast.success('Travel request updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!(await confirm({ message: 'Are you sure you want to delete this travel request? This cannot be undone.' }))) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/travel-schedule/${requestId}`, { method: 'DELETE' });
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(errBody?.error || String(response.status));
      }
      toast.success('Travel request deleted.');
      window.location.href = '/travel-schedule';
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete.');
    } finally {
      setBusy(false);
    }
  }

  if (!record) {
    return (
      <AppShell title="Travel Request" subtitle="" showBackLink>
        <div className={historyStyles.status}>{status || 'Loading...'}</div>
      </AppShell>
    );
  }

  const isCreator = record.created_by === currentUser.username;
  const isOverride = currentUser.role === 'admin' || currentUser.role === 'superadmin';
  const isHrManager = (departmentManagers['HR'] || []).some((m) => m.username === currentUser.username);
  const isAdminManager = (departmentManagers['Admin'] || departmentManagers['Administration'] || []).some((m) => m.username === currentUser.username);
  const isAccountsManager = (departmentManagers['Accounts'] || []).some((m) => m.username === currentUser.username);

  const canEdit = (record.status === 'draft' || record.status === 'changes_requested') && (isCreator || isOverride);
  const canSubmit = canEdit;
  const canManagerDecide = record.status === 'submitted' && (currentUser.isPrivileged || isOverride);
  const canHrReview = record.status === 'manager_approved' && (isHrManager || isOverride || currentUser.isPrivileged);
  const canAdminDecide = record.status === 'hr_reviewed' && (isAdminManager || isOverride || currentUser.isPrivileged);
  const canCompleteBooking = record.status === 'admin_approved' && (isAccountsManager || isOverride || currentUser.isPrivileged);
  const canHrFinalVerify = record.status === 'ticket_booking' && (isHrManager || isOverride || currentUser.isPrivileged);
  const canDelete = isOverride;

  return (
    <AppShell title={`Travel Request ${record.request_code}`} subtitle={`${record.origin} → ${record.destination}`} showBackLink>
      <div className={styles.headerRow}>
        <StatusBadge tone={TRAVEL_STATUS_TONE[record.status] || 'pending'} label={TRAVEL_STATUS_LABEL[record.status]} />
        <Link className={historyStyles.button} href="/travel-schedule">Back to Travel Schedule</Link>

        {canEdit && !editing && (
          <button type="button" className={historyStyles.button} onClick={startEditing}>Edit</button>
        )}
        {canSubmit && !editing && (
          <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleSubmit}>Submit for Approval</button>
        )}
        {canManagerDecide && (
          <>
            <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={busy} onClick={() => openPanel('manager_approve')}>Manager Approve</button>
            <button type="button" className={historyStyles.deleteBtn} disabled={busy} onClick={() => openPanel('manager_changes')}>Request Changes</button>
          </>
        )}
        {canHrReview && (
          <>
            <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={busy} onClick={() => openPanel('hr_approve')}>HR Approve</button>
            <button type="button" className={historyStyles.deleteBtn} disabled={busy} onClick={() => openPanel('hr_changes')}>Request Changes</button>
          </>
        )}
        {canAdminDecide && (
          <>
            <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={busy} onClick={() => openPanel('admin_approve')}>Admin Approve</button>
            <button type="button" className={historyStyles.deleteBtn} disabled={busy} onClick={() => openPanel('admin_changes')}>Request Changes</button>
          </>
        )}
        {canCompleteBooking && (
          <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={busy} onClick={() => openPanel('booking')}>Complete Booking</button>
        )}
        {canHrFinalVerify && (
          <>
            <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={busy} onClick={() => openPanel('hr_final_approve')}>Verify & Confirm</button>
            <button type="button" className={historyStyles.deleteBtn} disabled={busy} onClick={() => openPanel('hr_final_changes')}>Send Back</button>
          </>
        )}
        {canDelete && (
          <button type="button" className={historyStyles.deleteBtn} disabled={busy} onClick={handleDelete}>Delete</button>
        )}
      </div>

      {/* Inline action panels — replace window.prompt */}
      {activePanel && (
        <div className={`${calcStyles.sectionPanel} ${styles.actionPanel} ${activePanel.includes('changes') ? styles.actionPanelDanger : styles.actionPanelNeutral}`}>
          <div className={styles.actionPanelHeader}>
            <h4 className={`${calcStyles.h2} ${calcStyles.h2Reset}`}>
              {activePanel === 'manager_approve' && 'Manager Approval'}
              {activePanel === 'manager_changes' && 'Request Changes (Manager)'}
              {activePanel === 'hr_approve' && 'HR Review & Approval'}
              {activePanel === 'hr_changes' && 'Request Changes (HR)'}
              {activePanel === 'admin_approve' && 'Admin Approval'}
              {activePanel === 'admin_changes' && 'Request Changes (Admin)'}
              {activePanel === 'booking' && 'Complete Ticket Booking'}
              {activePanel === 'hr_final_approve' && 'Final Verification & Confirmation'}
              {activePanel === 'hr_final_changes' && 'Send Back for Corrections'}
            </h4>
            <button type="button" className={`${historyStyles.button} ${styles.panelCancelBtn}`} onClick={() => setActivePanel(null)}>Cancel</button>
          </div>

          {/* Remarks field - shown for all panels */}
          <div className={calcStyles.field}>
            <label className={calcStyles.label}>
              {activePanel.includes('changes') ? 'What changes are needed? *' : 'Remarks (optional)'}
            </label>
            <textarea className={calcStyles.formControl} rows={3} value={actionRemarks} onChange={(e) => setActionRemarks(e.target.value)}
              placeholder={activePanel.includes('changes') ? 'Describe the required changes...' : 'Add any remarks or notes...'} />
          </div>

          {/* Send back to - shown for admin request changes */}
          {activePanel === 'admin_changes' && (
            <div className={`${calcStyles.field} ${calcStyles.mt8}`}>
              <label className={calcStyles.label}>Send back to *</label>
              <select className={calcStyles.formControl} value={adminSendBackTo} onChange={(e) => setAdminSendBackTo(e.target.value)}>
                <option value="employee">Employee (for corrections)</option>
                <option value="manager">Department Manager (re-verify)</option>
                <option value="hr">HR Department (re-verify)</option>
              </select>
            </div>
          )}

          {/* Cost field - shown for HR approve and booking */}
          {(activePanel === 'hr_approve' || activePanel === 'booking') && (
            <div className={`${calcStyles.field} ${calcStyles.mt8}`}>
              <label className={calcStyles.label}>{activePanel === 'hr_approve' ? 'Estimated Travel Cost (optional)' : 'Actual Journey Cost (optional)'}</label>
              <input type="number" className={calcStyles.formControl} value={actionCost} onChange={(e) => setActionCost(e.target.value)} placeholder="e.g. 15000" />
            </div>
          )}

          {/* Booking details - shown for booking panel */}
          {activePanel === 'booking' && (
            <div className={`${calcStyles.field} ${calcStyles.mt8}`}>
              <label className={calcStyles.label}>Booking / Ticket Details *</label>
              <textarea className={calcStyles.formControl} rows={3} value={actionBookingDetails} onChange={(e) => setActionBookingDetails(e.target.value)}
                placeholder="Enter ticket numbers, PNR, flight/train details, timings..." />
            </div>
          )}

          {/* HR document upload - shown for HR approve */}
          {activePanel === 'hr_approve' && (
            <div className={`${calcStyles.field} ${calcStyles.mt8}`}>
              <label className={calcStyles.label}>Attach Documents (optional)</label>
              <input type="file" multiple disabled={uploading} onChange={(e) => { handleUploadHrDocs(e.target.files); e.target.value = ''; }} />
              {uploading && <div className={historyStyles.status}>Uploading...</div>}
              {pendingHrDocUrls.length > 0 && (
                <ul className={styles.docList}>
                  {pendingHrDocUrls.map((url) => <li key={url}>{url.split('/').pop()}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* Ticket document upload - shown for booking */}
          {activePanel === 'booking' && (
            <div className={`${calcStyles.field} ${calcStyles.mt8}`}>
              <label className={calcStyles.label}>Attach Ticket Documents (optional)</label>
              <input type="file" multiple disabled={uploading} onChange={(e) => { handleUploadTicketDocs(e.target.files); e.target.value = ''; }} />
              {uploading && <div className={historyStyles.status}>Uploading...</div>}
              {pendingTicketDocUrls.length > 0 && (
                <ul className={styles.docList}>
                  {pendingTicketDocUrls.map((url) => <li key={url}>{url.split('/').pop()}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className={styles.actionButtonsRow}>
            {activePanel === 'manager_approve' && <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleManagerApprove}>{busy ? 'Processing...' : 'Approve'}</button>}
            {activePanel === 'manager_changes' && <button type="button" className={`${calcStyles.btn} ${styles.dangerActionBtn}`} disabled={busy} onClick={handleManagerRequestChanges}>{busy ? 'Processing...' : 'Request Changes'}</button>}
            {activePanel === 'hr_approve' && <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleHrApprove}>{busy ? 'Processing...' : 'Approve & Forward to Admin'}</button>}
            {activePanel === 'hr_changes' && <button type="button" className={`${calcStyles.btn} ${styles.dangerActionBtn}`} disabled={busy} onClick={handleHrRequestChanges}>{busy ? 'Processing...' : 'Request Changes'}</button>}
            {activePanel === 'admin_approve' && <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleAdminApprove}>{busy ? 'Processing...' : 'Approve & Send to Accounts'}</button>}
            {activePanel === 'admin_changes' && <button type="button" className={`${calcStyles.btn} ${styles.dangerActionBtn}`} disabled={busy} onClick={handleAdminRequestChanges}>{busy ? 'Processing...' : 'Request Changes'}</button>}
            {activePanel === 'booking' && <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleCompleteBooking}>{busy ? 'Processing...' : 'Complete Booking'}</button>}
            {activePanel === 'hr_final_approve' && <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleHrFinalApprove}>{busy ? 'Processing...' : 'Verify & Send to Employee'}</button>}
            {activePanel === 'hr_final_changes' && <button type="button" className={`${calcStyles.btn} ${styles.dangerActionBtn}`} disabled={busy} onClick={handleHrFinalRequestChanges}>{busy ? 'Processing...' : 'Send Back'}</button>}
            <button type="button" className={historyStyles.button} onClick={() => setActivePanel(null)}>Cancel</button>
          </div>
        </div>
      )}

      {record.status === 'changes_requested' && record.change_request_remarks && (
        <div className={`${calcStyles.sectionPanel} ${styles.changesRequestedPanel}`}>
          <strong>Changes Requested by {record.change_requested_by}:</strong>
          <div className={calcStyles.mt4}>{record.change_request_remarks}</div>
        </div>
      )}

      <div className={styles.layoutGrid}>
        <div>
          {editing ? (
            <div className={calcStyles.sectionPanel}>
              <h3 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Edit Travel Request</h3>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Origin *</label>
                  <input className={calcStyles.formControl} value={editForm.origin} onChange={(e) => setEditForm((f) => ({ ...f, origin: e.target.value }))} required />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Destination *</label>
                  <input className={calcStyles.formControl} value={editForm.destination} onChange={(e) => setEditForm((f) => ({ ...f, destination: e.target.value }))} required />
                </div>
              </div>
              <h4 className={`${calcStyles.label} ${styles.subHeading}`}>When do you need to reach the destination?</h4>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Arrival Date *</label>
                  <input type="date" className={calcStyles.formControl} value={editForm.startDate} onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))} required />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Arrival Time</label>
                  <input type="time" className={calcStyles.formControl} value={editForm.requiredArrivalTime} onChange={(e) => setEditForm((f) => ({ ...f, requiredArrivalTime: e.target.value }))} />
                </div>
              </div>
              <h4 className={`${calcStyles.label} ${styles.subHeading}`}>When do you want to leave the destination?</h4>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Departure Date</label>
                  <input type="date" className={calcStyles.formControl} value={editForm.endDate} onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Departure Time</label>
                  <input type="time" className={calcStyles.formControl} value={editForm.expectedDepartureTime} onChange={(e) => setEditForm((f) => ({ ...f, expectedDepartureTime: e.target.value }))} />
                </div>
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns} ${calcStyles.mt12}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Project(s)</label>
                  {editForm.projectIds.length > 0 && (
                    <div className={styles.companionPillRow}>
                      {editForm.projectIds.map((id) => {
                        const project = allProjects.find((p) => p.id === id);
                        return (
                          <span key={id} className={styles.pillEditable}>
                            {project ? projectLabel(project) : id}
                            <button type="button" onClick={() => setEditForm((f) => ({ ...f, projectIds: f.projectIds.filter((c) => c !== id) }))} className={styles.pillRemoveBtn}>&times;</button>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <ProjectSelect
                    value=""
                    placeholder="— Add a project to visit —"
                    onChange={(projectId, project) => {
                      if (!projectId || editForm.projectIds.includes(projectId)) return;
                      if (project) setAllProjects((prev) => (prev.some((p) => p.id === project.id) ? prev : [project, ...prev]));
                      setEditForm((f) => ({
                        ...f,
                        projectIds: [...f.projectIds, projectId],
                        linkedClient: f.projectIds.length === 0 ? (project?.company || project?.client_name || f.linkedClient) : f.linkedClient
                      }));
                    }}
                  />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Linked Client</label>
                  <input className={calcStyles.formControl} value={editForm.linkedClient} onChange={(e) => setEditForm((f) => ({ ...f, linkedClient: e.target.value }))} />
                </div>
              </div>
              <div className={calcStyles.mt8}>
                <TravelScheduleForm
                  value={editForm}
                  onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
                  requesterOrigin={editForm.origin}
                  requesterDestination={editForm.destination}
                  requesterTravelDate={editForm.startDate}
                />
              </div>
              <div className={`${calcStyles.field} ${calcStyles.mt12}`}>
                <label className={calcStyles.label}>Travel Companions</label>
                <select
                  className={calcStyles.formControl}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id && !editForm.companionIds.includes(id)) {
                      setEditForm((f) => ({ ...f, companionIds: [...f.companionIds, id] }));
                    }
                    e.target.value = '';
                  }}
                >
                  <option value="">— Add companion —</option>
                  {allUsers.filter((u) => u.username !== currentUser.username && !editForm.companionIds.includes(u.id)).map((u) => (
                    <option key={u.id} value={u.id}>{u.name || u.username}</option>
                  ))}
                </select>
                {editForm.companionIds.length > 0 && (
                  <div className={styles.companionPillRow}>
                    {editForm.companionIds.map((id) => {
                      const user = allUsers.find((u) => u.id === id);
                      return (
                        <span key={id} className={styles.pillEditable}>
                          {user?.name || user?.username || id}
                          <button type="button" onClick={() => setEditForm((f) => ({ ...f, companionIds: f.companionIds.filter((c) => c !== id) }))} className={styles.pillRemoveBtn}>&times;</button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className={styles.actionButtonsRow}>
                <button type="button" className={calcStyles.btn} disabled={saving} onClick={handleSaveEdit}>{saving ? 'Saving...' : 'Save Changes'}</button>
                <button type="button" className={historyStyles.button} onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {/* Travel Details */}
              <div className={calcStyles.sectionPanel}>
                <h3 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Travel Details</h3>
                <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                  <div><strong>Origin:</strong> {record.origin || '-'}</div>
                  <div><strong>Destination:</strong> {record.destination}</div>
                </div>
                <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                  <div><strong>Start Date:</strong> {formatDate(record.start_date)}</div>
                  <div><strong>End Date:</strong> {formatDate(record.end_date)}</div>
                </div>
                <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                  <div><strong>Required Arrival Time:</strong> {formatTime12h(record.required_arrival_time)}</div>
                  <div><strong>Expected Departure Time:</strong> {formatTime12h(record.expected_departure_time)}</div>
                </div>
              </div>

              {/* Project & Purpose */}
              <div className={`${calcStyles.sectionPanel} ${styles.panelTop16}`}>
                <h3 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Project & Purpose</h3>
                <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                  <div>
                    <strong>{record.project_names && record.project_names.length > 1 ? 'Projects:' : 'Project:'}</strong>{' '}
                    {record.project_names && record.project_names.length > 0 ? (
                      <span className={styles.inlinePillGroup}>
                        {record.project_names.map((name, i) => (
                          <span key={i} className={styles.pillBase}>{name}</span>
                        ))}
                      </span>
                    ) : '-'}
                  </div>
                  <div><strong>Linked Client:</strong> {record.linked_client || '-'}</div>
                </div>
                <div className={`${calcStyles.row} ${calcStyles.columns} ${calcStyles.mt8}`}>
                  <div><strong>Purpose:</strong> {record.purpose || '-'}{record.purpose === 'Others' && record.purpose_other ? ` — ${record.purpose_other}` : ''}</div>
                  <div><strong>Mode of Travel:</strong> {record.mode_of_travel || '-'}</div>
                </div>
                {record.travel_suggestion && (
                  <div className={calcStyles.mt8}><strong>Employee&apos;s Suggestion:</strong> {record.travel_suggestion}</div>
                )}
                <div className={calcStyles.mt8}><strong>Requested By:</strong> {record.created_by} on {formatDate(record.created_at)}</div>
                {record.companion_names && record.companion_names.length > 0 && (
                  <div className={calcStyles.mt8}>
                    <strong>Travel Companions:</strong>{' '}
                    <span className={styles.inlinePillGroup}>
                      {record.companion_names.map((name, i) => (
                        <span key={i} className={styles.pillBase}>{name}</span>
                      ))}
                    </span>
                  </div>
                )}
                {record.co_travellers && record.co_travellers.length > 0 && (
                  <div className={calcStyles.mt8}>
                    <strong>Co-Travellers:</strong>{' '}
                    <span className={styles.inlinePillGroup}>
                      {record.co_travellers.map((c, i) => (
                        <span key={i} className={styles.pillBase}>
                          {c.name}{c.origin && c.destination ? ` (${c.origin} → ${c.destination})` : ''}
                        </span>
                      ))}
                    </span>
                  </div>
                )}
              </div>

              {(record.hotel_accommodation?.required || record.advance_request?.required) && (
                <div className={`${calcStyles.sectionPanel} ${styles.panelTop16}`}>
                  <h3 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Hotel & Advance Requests</h3>
                  {record.hotel_accommodation?.required && (
                    <div className={record.advance_request?.required ? styles.hotelBlockSpaced : undefined}>
                      <strong>Hotel Accommodation</strong>
                      <div className={`${calcStyles.row} ${calcStyles.columns} ${calcStyles.mt4}`}>
                        <div>Preferred Area: {record.hotel_accommodation.preferredArea || '-'}</div>
                        <div>Suggested Hotel: {record.hotel_accommodation.suggestedHotel || '-'}</div>
                      </div>
                      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                        <div>Check-in: {formatDate(record.hotel_accommodation.checkInDate)}</div>
                        <div>Check-out: {formatDate(record.hotel_accommodation.checkOutDate)}</div>
                      </div>
                      <div>Guests: {record.hotel_accommodation.numberOfGuests || '-'}</div>
                      {record.hotel_accommodation.additionalRequirement && <div>Note: {record.hotel_accommodation.additionalRequirement}</div>}
                    </div>
                  )}
                  {record.advance_request?.required && (
                    <div>
                      <strong>Advance Request</strong>
                      <div className={calcStyles.mt4}>Requested Amount: {formatCurrency(record.advance_request.requestedAmount)}</div>
                      {record.advance_request.remark && <div>Remark: {record.advance_request.remark}</div>}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Costing */}
          {(record.estimated_cost > 0 || record.actual_cost > 0) && (
            <div className={`${calcStyles.sectionPanel} ${styles.panelTop16}`}>
              <h3 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Costing</h3>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div><strong>Estimated Cost:</strong> {formatCurrency(record.estimated_cost)}</div>
                <div><strong>Actual Cost:</strong> {formatCurrency(record.actual_cost)}</div>
              </div>
            </div>
          )}

          {/* Approval History — from audit log */}
          <div className={`${calcStyles.sectionPanel} ${styles.panelTop16}`}>
            <h3 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Approval History ({auditHistory.length})</h3>
            {auditHistory.length === 0 ? (
              <div className={styles.mutedNote}>No activity yet.</div>
            ) : (
              <div className={styles.auditScroll}>
                {[...auditHistory].reverse().map((entry) => (
                  <div key={entry.id} className={styles.auditEntry}>
                    <div className={`${styles.auditBar} ${auditActionToneClass(entry.action)}`} />
                    <div className={styles.auditBody}>
                      <div><strong>{auditActionLabel(entry.action)}</strong> by {entry.by}</div>
                      <div className={styles.auditMeta}>{formatDate(entry.at)}{entry.new_status ? ` — Status: ${TRAVEL_STATUS_LABEL[entry.new_status as TravelScheduleStatus] || entry.new_status}` : ''}</div>
                      {entry.remarks && <div className={styles.auditRemark}>&ldquo;{entry.remarks}&rdquo;</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Booking Details */}
          {record.booking_details && (
            <div className={`${calcStyles.sectionPanel} ${styles.panelTop16}`}>
              <h3 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Booking Details</h3>
              <div className={styles.preWrap}>{record.booking_details}</div>
            </div>
          )}

          {/* HR Documents */}
          {record.hr_documents.length > 0 && (
            <div className={`${calcStyles.sectionPanel} ${styles.panelTop16}`}>
              <h3 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>HR Documents</h3>
              <ul>
                {record.hr_documents.map((url, i) => (
                  <li key={url}><a href={url} target="_blank" rel="noreferrer" download={friendlyDocName(url, record, `DOC${record.hr_documents.length > 1 ? i + 1 : ''}`)}>{friendlyDocName(url, record, `DOC${record.hr_documents.length > 1 ? i + 1 : ''}`)}</a></li>
                ))}
              </ul>
            </div>
          )}

          {/* Ticket Documents */}
          {record.ticket_documents.length > 0 && (
            <div className={`${calcStyles.sectionPanel} ${styles.panelTop16}`}>
              <h3 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Ticket Documents</h3>
              <ul>
                {record.ticket_documents.map((url, i) => (
                  <li key={url}><a href={url} target="_blank" rel="noreferrer" download={friendlyDocName(url, record, `Ticket${record.ticket_documents.length > 1 ? i + 1 : ''}`)}>{friendlyDocName(url, record, `Ticket${record.ticket_documents.length > 1 ? i + 1 : ''}`)}</a></li>
                ))}
              </ul>
            </div>
          )}

        </div>

        {/* Workflow Stepper */}
        <div className={calcStyles.sectionPanel}>
          <h3 className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Workflow Progress</h3>
          <WorkflowStepper steps={buildSteps(record)} />
          {record.status !== 'completed' && record.status !== 'changes_requested' && (
            <div className={`${historyStyles.status} ${calcStyles.mt12}`}>
              {travelPendingLabel(record.status)}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
