'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TmsBomRequestRecord, UserRole } from '@/lib/types';
import { TMS_BOM_STATUS_LABEL, TMS_BOM_STATUS_TONE, tmsBomPendingApprovalLabel } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import EmptyState from './ui/EmptyState';
import { Paperclip } from 'lucide-react';

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

interface TmsBomRequestDetailViewProps {
  requestId: string;
  currentUser: { id: string; username: string; role: UserRole; isPrivileged: boolean };
}

export default function TmsBomRequestDetailView({ requestId, currentUser }: TmsBomRequestDetailViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const [record, setRecord] = useState<TmsBomRequestRecord | null>(null);
  const [status, setStatus] = useState('Loading...');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [isAccountsManager, setIsAccountsManager] = useState(currentUser.isPrivileged);

  useEffect(() => {
    if (currentUser.isPrivileged) return;
    fetch('/api/departments/managers')
      .then((r) => (r.ok ? r.json() : {}))
      .then((byDepartment: Record<string, { username: string }[]>) => {
        setIsAccountsManager((byDepartment['Accounts'] || []).some((m) => m.username === currentUser.username));
      })
      .catch(() => setIsAccountsManager(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch(`/api/tms/bom-requests/${requestId}`);
      if (response.status === 404) {
        setStatus('This BOM request could not be found.');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setRecord(await response.json());
      setStatus('');
    } catch {
      setStatus('Could not load this BOM request.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  async function callAction(path: string, body?: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch(`/api/tms/bom-requests/${requestId}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => null);
        throw new Error(errBody?.error || String(response.status));
      }
      await load();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (await callAction('/submit')) toast.success('Request submitted for review.');
  }

  async function handleApprove() {
    if (!(await confirm({ message: 'Approve this BOM request?' }))) return;
    if (await callAction('/approve')) toast.success('Request approved.');
  }

  async function handleReject() {
    const reason = window.prompt('Reason for declining this request:');
    if (!reason || !reason.trim()) return;
    if (await callAction('/reject', { reason: reason.trim() })) toast.success('Request declined.');
  }

  async function handleSendToProcurement() {
    if (!(await confirm({ message: 'Send this approved request to Procurement?' }))) return;
    if (await callAction('/send-to-procurement')) toast.success('Sent to Procurement.');
  }

  async function handleFinanceApprove() {
    if (!(await confirm({ message: 'Approve this BOM request for payment?' }))) return;
    if (await callAction('/finance-approve')) toast.success('Approved by Finance.');
  }

  async function handleFinanceReject() {
    const reason = window.prompt('Reason for declining this request:');
    if (!reason || !reason.trim()) return;
    if (await callAction('/finance-reject', { reason: reason.trim() })) toast.success('Request declined.');
  }

  async function handleMarkPayment(files: FileList | null) {
    if (!files || !files.length) {
      toast.error('A payment proof attachment is required.');
      return;
    }
    setUploadingProof(true);
    try {
      const formData = new FormData();
      formData.append('folder', 'tms-bom-payment-proof');
      Array.from(files).forEach((f) => formData.append('files', f));
      const uploadRes = await fetch('/api/uploads', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error(String(uploadRes.status));
      const { urls } = await uploadRes.json();
      if (await callAction('/mark-payment', { proofUrls: urls })) toast.success('Payment marked done.');
    } catch {
      toast.error('Could not upload the payment proof.');
    } finally {
      setUploadingProof(false);
    }
  }

  async function handleMarkReceived() {
    if (!(await confirm({ message: 'Confirm the material has been received?' }))) return;
    if (await callAction('/mark-received')) toast.success('Marked as received.');
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('folder', 'tms-bom-requests');
      Array.from(files).forEach((f) => formData.append('files', f));
      const uploadRes = await fetch('/api/uploads', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error(String(uploadRes.status));
      const { urls } = await uploadRes.json();
      const patchRes = await fetch(`/api/tms/bom-requests/${requestId}`, {
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

  if (!record) {
    return (
      <AppShell title="BOM Request" subtitle="" showBackLink>
        <div className={historyStyles.status}>{status || 'Loading...'}</div>
      </AppShell>
    );
  }

  const isRequester = !!currentUser.id && currentUser.id === record.requested_by_id;
  const pendingLabel = tmsBomPendingApprovalLabel(record.status);

  return (
    <AppShell title={record.item_name} subtitle={`${record.bom_request_code} · ${record.project_name}`} showBackLink>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusBadge tone={TMS_BOM_STATUS_TONE[record.status]} label={TMS_BOM_STATUS_LABEL[record.status]} />
        <Link className={historyStyles.button} href="/tms/bom-requests">Back to BOM Requests</Link>
        {record.status === 'draft' && (
          <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleSubmit}>Submit for review</button>
        )}
        {(record.status === 'submitted' || record.status === 'under_review') && (
          <>
            <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={busy} onClick={handleApprove}>Approve</button>
            <button type="button" className={historyStyles.deleteBtn} disabled={busy} onClick={handleReject}>Reject</button>
          </>
        )}
        {record.status === 'approved' && (
          <>
            <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={busy} onClick={handleFinanceApprove}>Approve (Finance)</button>
            <button type="button" className={historyStyles.deleteBtn} disabled={busy} onClick={handleFinanceReject}>Reject</button>
            <button type="button" className={calcStyles.btn} disabled={busy} onClick={handleSendToProcurement}>Send to Procurement</button>
          </>
        )}
        {record.status === 'payment_done' && (isRequester || currentUser.isPrivileged) && (
          <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} disabled={busy} onClick={handleMarkReceived}>Mark Material Received</button>
        )}
      </div>

      {pendingLabel && (
        <div className={historyStyles.status} style={{ marginBottom: 16 }}>
          {pendingLabel}
        </div>
      )}

      <div className={calcStyles.sectionPanel}>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div><strong>Project:</strong> {record.project_name}</div>
          <div><strong>Requested by:</strong> {record.requested_by_name || '-'}</div>
          <div><strong>Department:</strong> {record.department_name || '-'}</div>
        </div>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div><strong>Request date:</strong> {formatDate(record.request_date)}</div>
          <div><strong>Required date:</strong> {formatDate(record.required_date)}</div>
          <div><strong>Estimated cost:</strong> {formatCurrency(record.estimated_cost)}</div>
        </div>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div><strong>Part number / Model:</strong> {record.part_number || '-'}</div>
          <div><strong>Quantity:</strong> {record.quantity}</div>
          <div><strong>Preferred brand / OEM:</strong> {record.preferred_brand || '-'}</div>
        </div>
        <div style={{ marginTop: 12 }}><strong>Specification:</strong> {record.specification || '-'}</div>
        <div style={{ marginTop: 12 }}><strong>Item description:</strong> {record.item_description || '-'}</div>
        <div style={{ marginTop: 12 }}><strong>Remarks:</strong> {record.remarks || '-'}</div>
        {record.status === 'rejected' && (
          <div style={{ marginTop: 12, color: 'var(--mx-danger)' }}><strong>Rejection reason:</strong> {record.rejection_reason || '-'}</div>
        )}
        {record.reviewed_by_name && (
          <div style={{ marginTop: 12 }}><strong>Reviewed by (Technical Manager):</strong> {record.reviewed_by_name} on {formatDate(record.reviewed_at)}</div>
        )}
        {record.finance_reviewed_by_name && (
          <div style={{ marginTop: 12 }}><strong>Approved by (Finance):</strong> {record.finance_reviewed_by_name} on {formatDate(record.finance_reviewed_at)}</div>
        )}
        {record.payment_marked_by_name && (
          <div style={{ marginTop: 12 }}><strong>Payment marked by (Accounts):</strong> {record.payment_marked_by_name} on {formatDate(record.payment_marked_at)}</div>
        )}
        {record.received_by_name && (
          <div style={{ marginTop: 12 }}><strong>Material received by:</strong> {record.received_by_name} on {formatDate(record.received_at)}</div>
        )}
      </div>

      {record.status === 'finance_approved' && isAccountsManager && (
        <div className={calcStyles.sectionPanel} style={{ marginTop: 18 }}>
          <div className={calcStyles.h2}>Mark Payment Done</div>
          <div className={calcStyles.small} style={{ marginBottom: 8 }}>Attach a payment proof (receipt, transfer confirmation, etc.) to mark this request paid.</div>
          <input type="file" multiple disabled={uploadingProof} onChange={(e) => handleMarkPayment(e.target.files)} />
          {uploadingProof && <div className={historyStyles.status}>Uploading…</div>}
        </div>
      )}

      {record.payment_proof_attachments.length > 0 && (
        <div className={calcStyles.sectionPanel} style={{ marginTop: 18 }}>
          <div className={calcStyles.h2}>Payment Proof</div>
          <ul style={{ marginTop: 12 }}>
            {record.payment_proof_attachments.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">{url.split('/').pop()}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={calcStyles.sectionPanel} style={{ marginTop: 18 }}>
        <div className={calcStyles.h2}>Attachments</div>
        <input type="file" multiple disabled={uploading} onChange={(e) => handleUpload(e.target.files)} />
        {uploading && <div className={historyStyles.status}>Uploading…</div>}
        {record.attachments.length === 0 ? (
          <EmptyState icon={Paperclip} title="No attachments yet" message="Upload a quotation, spec sheet, or reference document above." />
        ) : (
          <ul style={{ marginTop: 12 }}>
            {record.attachments.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">{url.split('/').pop()}</a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
