'use client';

import { useState } from 'react';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import { Field } from './ui/Field';
import Input from './ui/Input';
import Textarea from './ui/Textarea';
import { useToast } from './ui/ToastProvider';

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

interface TmsDeadlineExtendModalProps {
  projectId: string;
  currentDeadline: string;
  onClose: () => void;
  onExtended: () => void;
}

export default function TmsDeadlineExtendModal({ projectId, currentDeadline, onClose, onExtended }: TmsDeadlineExtendModalProps) {
  const toast = useToast();
  const [newDeadline, setNewDeadline] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const minDate = dayAfter(currentDeadline);

  async function handleSave() {
    const trimmedRemark = remark.trim();
    if (!trimmedRemark) {
      setError('A remark is required.');
      return;
    }
    if (!newDeadline || newDeadline <= (currentDeadline || '')) {
      setError('The new deadline must be later than the current deadline.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/tms/projects/${projectId}/extend-deadline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newDeadline, remark: trimmedRemark })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || String(response.status));
      }
      toast.success('Deadline extended.');
      onExtended();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not extend the deadline.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Extend Deadline"
      ariaLabel="Extend project deadline"
      onClose={onClose}
      size="wide"
      dismissible={!saving}
      footer={
        <>
          <ModalCancelButton onClick={onClose} disabled={saving}>Cancel</ModalCancelButton>
          <ModalOkButton onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Extend Deadline'}</ModalOkButton>
        </>
      }
    >
      <Field label="Current Deadline">
        <Input value={formatDate(currentDeadline)} readOnly disabled />
      </Field>
      <Field label="New Deadline">
        <Input type="date" min={minDate} value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} />
      </Field>
      <Field label="Reason / Remark">
        <Textarea rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Why is this deadline being extended?" />
      </Field>
      {error && <div style={{ color: 'var(--mx-danger)', fontSize: 13, marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
