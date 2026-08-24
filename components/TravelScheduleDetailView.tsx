'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AuditLogEntry, TravelScheduleRecord, TravelScheduleStatus, UserRole } from '@/lib/types';
import { TRAVEL_STATUS_LABEL, TRAVEL_STATUS_TONE, travelPendingLabel } from '@/lib/travelLabels';
import AppShell from './AppShell';
import StatusBadge from './ui/StatusBadge';
import WorkflowStepper, { StepperStep } from './ui/WorkflowStepper';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

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

function friendlyDocName(url: string, record: TravelScheduleRecord, docType: string): string {
  const ext = url.split('.').pop() || '';
  const project = (record.project_name || '').replace(/[^a-zA-Z0-9]/g, '');
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

function auditActionTone(action: string): string {
  if (action.includes('request_changes')) return 'var(--mx-danger, #dc2626)';
  if (action.includes('approve') || action === 'complete_booking') return 'var(--mx-success, #16a34a)';
  return 'var(--mx-brand, #2563eb)';
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
  const [editForm, setEditForm] = useState({ origin: '', destination: '', startDate: '', endDate: '', requiredArrivalTime: '', expectedDepartureTime: '', purpose: '', linkedClient: '', expenseNote: '', projectId: '', companionIds: [] as string[] });
  const [allUsers, setAllUsers] = useState<{ id: string; username: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; client_name?: string; company?: string }[]>([]);
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
    fetch('/api/projects').then((r) => (r.ok ? r.json() : [])).then(setProjects).catch(() => setProjects([]));
    fetch('/api/users/lite').then((r) => (r.ok ? r.json() : [])).then(setAllUsers).catch(() => setAllUsers([]));
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
      purpose: record.purpose, linkedClient: record.linked_client, expenseNote: record.expense_note,
      projectId: record.project_id,
      companionIds: Array.isArray(record.companion_ids) ? [...record.companion_ids] : []
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
        body: JSON.stringify(editForm)
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
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
        <div className={calcStyles.sectionPanel} style={{ borderLeft: `3px solid ${activePanel.includes('changes') ? 'var(--mx-danger)' : 'var(--mx-primary, #2563eb)'}`, marginBottom: 16, background: 'var(--mx-surface-alt, #f8fafc)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 className={calcStyles.h2} style={{ margin: 0 }}>
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
            <button type="button" className={historyStyles.button} onClick={() => setActivePanel(null)} style={{ padding: '2px 10px', fontSize: '0.85rem' }}>Cancel</button>
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
            <div className={calcStyles.field} style={{ marginTop: 8 }}>
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
            <div className={calcStyles.field} style={{ marginTop: 8 }}>
              <label className={calcStyles.label}>{activePanel === 'hr_approve' ? 'Estimated Travel Cost (optional)' : 'Actual Journey Cost (optional)'}</label>
              <input type="number" className={calcStyles.formControl} value={actionCost} onChange={(e) => setActionCost(e.target.value)} placeholder="e.g. 15000" />
            </div>
          )}

          {/* Booking details - shown for booking panel */}
          {activePanel === 'booking' && (
            <div className={calcStyles.field} style={{ marginTop: 8 }}>
              <label className={calcStyles.label}>Booking / Ticket Details *</label>
              <textarea className={calcStyles.formControl} rows={3} value={actionBookingDetails} onChange={(e) => setActionBookingDetails(e.target.value)}
                placeholder="Enter ticket numbers, PNR, flight/train details, timings..." />
            </div>
          )}

          {/* HR document upload - shown for HR approve */}
          {activePanel === 'hr_approve' && (
            <div className={calcStyles.field} style={{ marginTop: 8 }}>
              <label className={calcStyles.label}>Attach Documents (optional)</label>
              <input type="file" multiple disabled={uploading} onChange={(e) => { handleUploadHrDocs(e.target.files); e.target.value = ''; }} />
              {uploading && <div className={historyStyles.status}>Uploading...</div>}
              {pendingHrDocUrls.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: '0.85rem' }}>
                  {pendingHrDocUrls.map((url) => <li key={url}>{url.split('/').pop()}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* Ticket document upload - shown for booking */}
          {activePanel === 'booking' && (
            <div className={calcStyles.field} style={{ marginTop: 8 }}>
              <label className={calcStyles.label}>Attach Ticket Documents (optional)</label>
              <input type="file" multiple disabled={uploading} onChange={(e) => { handleUploadTicketDocs(e.target.files); e.target.value = ''; }} />
              {uploading && <div className={historyStyles.status}>Uploading...</div>}
              {pendingTicketDocUrls.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: '0.85rem' }}>
                  {pendingTicketDocUrls.map((url) => <li key={url}>{url.split('/').pop()}</li>)}
                </ul>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {activePanel === 'manager_approve' && <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleManagerApprove}>{busy ? 'Processing...' : 'Approve'}</button>}
            {activePanel === 'manager_changes' && <button type="button" className={calcStyles.btn} disabled={busy} style={{ background: 'var(--mx-danger, #dc2626)' }} onClick={handleManagerRequestChanges}>{busy ? 'Processing...' : 'Request Changes'}</button>}
            {activePanel === 'hr_approve' && <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleHrApprove}>{busy ? 'Processing...' : 'Approve & Forward to Admin'}</button>}
            {activePanel === 'hr_changes' && <button type="button" className={calcStyles.btn} disabled={busy} style={{ background: 'var(--mx-danger, #dc2626)' }} onClick={handleHrRequestChanges}>{busy ? 'Processing...' : 'Request Changes'}</button>}
            {activePanel === 'admin_approve' && <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleAdminApprove}>{busy ? 'Processing...' : 'Approve & Send to Accounts'}</button>}
            {activePanel === 'admin_changes' && <button type="button" className={calcStyles.btn} disabled={busy} style={{ background: 'var(--mx-danger, #dc2626)' }} onClick={handleAdminRequestChanges}>{busy ? 'Processing...' : 'Request Changes'}</button>}
            {activePanel === 'booking' && <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleCompleteBooking}>{busy ? 'Processing...' : 'Complete Booking'}</button>}
            {activePanel === 'hr_final_approve' && <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleHrFinalApprove}>{busy ? 'Processing...' : 'Verify & Send to Employee'}</button>}
            {activePanel === 'hr_final_changes' && <button type="button" className={calcStyles.btn} disabled={busy} style={{ background: 'var(--mx-danger, #dc2626)' }} onClick={handleHrFinalRequestChanges}>{busy ? 'Processing...' : 'Send Back'}</button>}
            <button type="button" className={historyStyles.button} onClick={() => setActivePanel(null)}>Cancel</button>
          </div>
        </div>
      )}

      {record.status === 'changes_requested' && record.change_request_remarks && (
        <div className={calcStyles.sectionPanel} style={{ borderLeft: '3px solid var(--mx-danger)', marginBottom: 16 }}>
          <strong>Changes Requested by {record.change_requested_by}:</strong>
          <div style={{ marginTop: 4 }}>{record.change_request_remarks}</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, alignItems: 'start' }}>
        <div>
          {editing ? (
            <div className={calcStyles.sectionPanel}>
              <h3 className={calcStyles.h2} style={{ marginTop: 0 }}>Edit Travel Request</h3>
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
              <h4 className={calcStyles.label} style={{ marginTop: 12, marginBottom: 4, fontSize: '0.85rem', opacity: 0.7 }}>When do you need to reach the destination?</h4>
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
              <h4 className={calcStyles.label} style={{ marginTop: 12, marginBottom: 4, fontSize: '0.85rem', opacity: 0.7 }}>When do you want to leave the destination?</h4>
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
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginTop: 12 }}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Project</label>
                  <select className={calcStyles.formControl} value={editForm.projectId} onChange={(e) => setEditForm((f) => ({ ...f, projectId: e.target.value }))}>
                    <option value="">— Select project —</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.client_name || ''}{p.company ? ` — ${p.company}` : ''}</option>
                    ))}
                  </select>
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Linked Client</label>
                  <input className={calcStyles.formControl} value={editForm.linkedClient} onChange={(e) => setEditForm((f) => ({ ...f, linkedClient: e.target.value }))} />
                </div>
              </div>
              <div className={calcStyles.field} style={{ marginTop: 8 }}>
                <label className={calcStyles.label}>Purpose of Travel</label>
                <textarea className={calcStyles.formControl} rows={2} value={editForm.purpose} onChange={(e) => setEditForm((f) => ({ ...f, purpose: e.target.value }))} />
              </div>
              <div className={calcStyles.field} style={{ marginTop: 8 }}>
                <label className={calcStyles.label}>Expense Note</label>
                <textarea className={calcStyles.formControl} rows={2} value={editForm.expenseNote} onChange={(e) => setEditForm((f) => ({ ...f, expenseNote: e.target.value }))} />
              </div>
              <div className={calcStyles.field} style={{ marginTop: 8 }}>
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
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {editForm.companionIds.map((id) => {
                      const user = allUsers.find((u) => u.id === id);
                      return (
                        <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 12, background: 'var(--mx-surface-alt, #e5e7eb)', fontSize: '0.85rem' }}>
                          {user?.name || user?.username || id}
                          <button type="button" onClick={() => setEditForm((f) => ({ ...f, companionIds: f.companionIds.filter((c) => c !== id) }))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1, opacity: 0.6 }}>&times;</button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className={calcStyles.btn} disabled={saving} onClick={handleSaveEdit}>{saving ? 'Saving...' : 'Save Changes'}</button>
                <button type="button" className={historyStyles.button} onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {/* Travel Details */}
              <div className={calcStyles.sectionPanel}>
                <h3 className={calcStyles.h2} style={{ marginTop: 0 }}>Travel Details</h3>
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
              <div className={calcStyles.sectionPanel} style={{ marginTop: 16 }}>
                <h3 className={calcStyles.h2} style={{ marginTop: 0 }}>Project & Purpose</h3>
                <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                  <div><strong>Project:</strong> {record.project_name || '-'}</div>
                  <div><strong>Linked Client:</strong> {record.linked_client || '-'}</div>
                </div>
                <div style={{ marginTop: 8 }}><strong>Purpose:</strong> {record.purpose || '-'}</div>
                <div style={{ marginTop: 8 }}><strong>Expense Note:</strong> {record.expense_note || '-'}</div>
                <div style={{ marginTop: 8 }}><strong>Requested By:</strong> {record.created_by} on {formatDate(record.created_at)}</div>
                {record.companion_names && record.companion_names.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <strong>Travel Companions:</strong>{' '}
                    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, verticalAlign: 'middle' }}>
                      {record.companion_names.map((name, i) => (
                        <span key={i} style={{ padding: '2px 8px', borderRadius: 12, background: 'var(--mx-surface-alt, #e5e7eb)', fontSize: '0.85rem' }}>{name}</span>
                      ))}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Costing */}
          {(record.estimated_cost > 0 || record.actual_cost > 0) && (
            <div className={calcStyles.sectionPanel} style={{ marginTop: 16 }}>
              <h3 className={calcStyles.h2} style={{ marginTop: 0 }}>Costing</h3>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div><strong>Estimated Cost:</strong> {formatCurrency(record.estimated_cost)}</div>
                <div><strong>Actual Cost:</strong> {formatCurrency(record.actual_cost)}</div>
              </div>
            </div>
          )}

          {/* Approval History — from audit log */}
          <div className={calcStyles.sectionPanel} style={{ marginTop: 16 }}>
            <h3 className={calcStyles.h2} style={{ marginTop: 0 }}>Approval History ({auditHistory.length})</h3>
            {auditHistory.length === 0 ? (
              <div style={{ marginTop: 8, opacity: 0.6 }}>No activity yet.</div>
            ) : (
              <div style={{ marginTop: 4, maxHeight: 240, overflowY: 'auto' }}>
                {[...auditHistory].reverse().map((entry) => (
                  <div key={entry.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid var(--mx-border, #e5e7eb)' }}>
                    <div style={{ width: 4, minHeight: 20, borderRadius: 2, background: auditActionTone(entry.action), marginTop: 2, flexShrink: 0 }} />
                    <div style={{ flex: 1, fontSize: '0.9rem' }}>
                      <div><strong>{auditActionLabel(entry.action)}</strong> by {entry.by}</div>
                      <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>{formatDate(entry.at)}{entry.new_status ? ` — Status: ${TRAVEL_STATUS_LABEL[entry.new_status as TravelScheduleStatus] || entry.new_status}` : ''}</div>
                      {entry.remarks && <div style={{ marginTop: 2, fontStyle: 'italic', opacity: 0.8 }}>&ldquo;{entry.remarks}&rdquo;</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Booking Details */}
          {record.booking_details && (
            <div className={calcStyles.sectionPanel} style={{ marginTop: 16 }}>
              <h3 className={calcStyles.h2} style={{ marginTop: 0 }}>Booking Details</h3>
              <div style={{ whiteSpace: 'pre-wrap' }}>{record.booking_details}</div>
            </div>
          )}

          {/* HR Documents */}
          {record.hr_documents.length > 0 && (
            <div className={calcStyles.sectionPanel} style={{ marginTop: 16 }}>
              <h3 className={calcStyles.h2} style={{ marginTop: 0 }}>HR Documents</h3>
              <ul>
                {record.hr_documents.map((url, i) => (
                  <li key={url}><a href={url} target="_blank" rel="noreferrer" download={friendlyDocName(url, record, `DOC${record.hr_documents.length > 1 ? i + 1 : ''}`)}>{friendlyDocName(url, record, `DOC${record.hr_documents.length > 1 ? i + 1 : ''}`)}</a></li>
                ))}
              </ul>
            </div>
          )}

          {/* Ticket Documents */}
          {record.ticket_documents.length > 0 && (
            <div className={calcStyles.sectionPanel} style={{ marginTop: 16 }}>
              <h3 className={calcStyles.h2} style={{ marginTop: 0 }}>Ticket Documents</h3>
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
          <h3 className={calcStyles.h2} style={{ marginTop: 0 }}>Workflow Progress</h3>
          <WorkflowStepper steps={buildSteps(record)} />
          {record.status !== 'completed' && record.status !== 'changes_requested' && (
            <div className={historyStyles.status} style={{ marginTop: 12 }}>
              {travelPendingLabel(record.status)}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
