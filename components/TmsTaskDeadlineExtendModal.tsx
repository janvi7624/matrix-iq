'use client';

import { useState } from 'react';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import { Field } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import { useToast } from './ui/ToastProvider';
import { DeadlineExtensionReason } from '@/lib/types';

// TMS Task's equivalent of components/TmsDeadlineExtendModal.tsx — same shape,
// posts to the task-specific endpoint. Kept as its own component rather than
// generalising that one, matching the reasoning already written into
// components/ProjectDeadlineExtendModal.tsx: these sides have different record
// types and endpoints, and this codebase duplicates per module on purpose.

function formatDate(iso: string): string {
  if (!iso) return 'Not set';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function dayAfter(iso: string): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

interface TmsTaskDeadlineExtendModalProps {
  taskId: string;
  taskName: string;
  currentDeadline: string;
  onClose: () => void;
  onExtended: () => void;
}

export default function TmsTaskDeadlineExtendModal({
  taskId,
  taskName,
  currentDeadline,
  onClose,
  onExtended
}: TmsTaskDeadlineExtendModalProps) {
  const toast = useToast();
  const [newDeadline, setNewDeadline] = useState('');
  const [reason, setReason] = useState<DeadlineExtensionReason>('user_end');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // A task's due date is never free-edited through this path — it moves only
  // through here, whether that is filling it in for the first time or pushing
  // an existing one out. Same approval tiering either way; only the wording
  // changes, so a first date doesn't read as "extending" something unset.
  const isInitialSet = !currentDeadline;
  const minDate = dayAfter(currentDeadline);

  async function handleSave() {
    const trimmedRemark = remark.trim();
    if (!trimmedRemark) {
      setError('A remark is required.');
      return;
    }
    if (!newDeadline || newDeadline <= (currentDeadline || '')) {
      setError(isInitialSet ? 'Pick a date.' : 'The new deadline must be later than the current deadline.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/tms/tasks/${taskId}/extend-deadline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newDeadline, reason, remark: trimmedRemark })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || String(response.status));
      }
      const { extension } = await response.json();
      // The requester's own tier decides whether this applied or queued, so the
      // confirmation has to say which — otherwise an engineer whose request is
      // waiting on a manager walks away believing the date moved.
      //
      // A task request only ever comes back 'approved' (manager/admin) or
      // 'pending_manager' (engineer/technician) — a manager no longer queues
      // behind an admin. The 'pending_admin' branch is kept because the status
      // is still decidable server-side and still reachable on the project-level
      // flow, so it reads correctly if it ever does occur here.
      toast.success(
        extension?.status === 'approved'
          ? isInitialSet
            ? 'Due date set.'
            : 'Due date extended.'
          : `${isInitialSet ? 'Request' : 'Extension request'} sent — awaiting ${
              extension?.status === 'pending_admin' ? 'Admin' : 'Manager'
            } approval.`
      );
      onExtended();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not extend the due date.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isInitialSet ? 'Set Due Date' : 'Extend Due Date'}
      ariaLabel={isInitialSet ? `Set due date for ${taskName}` : `Extend due date for ${taskName}`}
      onClose={onClose}
      size="wide"
      dismissible={!saving}
      footer={
        <>
          <ModalCancelButton onClick={onClose} disabled={saving}>Cancel</ModalCancelButton>
          <ModalOkButton onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isInitialSet ? 'Set Due Date' : 'Request Extension'}
          </ModalOkButton>
        </>
      }
    >
      <Field label="Task">
        <Input value={taskName} readOnly disabled />
      </Field>
      {!isInitialSet && (
        <Field label="Current Due Date">
          <Input value={formatDate(currentDeadline)} readOnly disabled />
        </Field>
      )}
      <Field label={isInitialSet ? 'Due Date' : 'New Due Date'}>
        <Input type="date" min={minDate} value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} />
      </Field>
      <Field label="Reason">
        <Select value={reason} onChange={(e) => setReason(e.target.value as DeadlineExtensionReason)}>
          <option value="user_end">From User End</option>
          <option value="client_end">From Client End</option>
        </Select>
      </Field>
      <Field label="Remark (required)">
        <Textarea
          rows={3}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
          placeholder={isInitialSet ? 'Why this date?' : 'e.g. Client pushed the site visit to next week'}
        />
      </Field>
      {error && <div style={{ color: 'var(--mx-danger)', fontSize: 13, marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
