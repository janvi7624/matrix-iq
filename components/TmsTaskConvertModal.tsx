'use client';

import { useEffect, useState } from 'react';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import { Field } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import calcStyles from './calculator.module.css';

interface TmsProjectOption {
  id: string;
  name: string;
}

export interface ConvertedTmsTask {
  id: string;
  name: string;
  description: string;
  due_date: string;
  priority: string;
  status: string;
  project_name: string;
  progress_percent: number;
}

interface TmsTaskConvertModalProps {
  employeeId?: string;
  initialDescription: string;
  initialPriority: string;
  initialDueDate: string;
  onClose: () => void;
  onConverted: (task: ConvertedTmsTask) => void;
}

// Workflow B's conversion step, in the UI: a standalone AI task becomes a
// real TMS task through the EXISTING POST /api/tms/tasks route's own store
// call (app/api/daily-reports/tms-tasks/convert/route.ts — created once,
// never a parallel insert), gated server-side on the same tms-tasks:create
// permission the real create route requires. Only reachable from a row that
// is NOT yet linked — see DailyReportForm.tsx's own gate on rendering this.
export default function TmsTaskConvertModal({
  employeeId,
  initialDescription,
  initialPriority,
  initialDueDate,
  onClose,
  onConverted
}: TmsTaskConvertModalProps) {
  const [projects, setProjects] = useState<TmsProjectOption[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [taskDescription, setTaskDescription] = useState(initialDescription);
  const [priority, setPriority] = useState(initialPriority);
  const [dueDate, setDueDate] = useState(initialDueDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/tms/projects');
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (!cancelled) setError(body?.error || 'Could not load TMS projects.');
          return;
        }
        const body: TmsProjectOption[] = await response.json();
        if (!cancelled) setProjects(body);
      } catch {
        if (!cancelled) setError('Could not reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    if (!taskDescription.trim()) {
      setError('A task description is required.');
      return;
    }
    if (!projectId) {
      setError('Choose a TMS project to attach this task to.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/daily-reports/tms-tasks/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, taskDescription: taskDescription.trim(), projectId, priority, dueDate })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not create the TMS task.');
      }
      const body: { task: ConvertedTmsTask } = await response.json();
      onConverted(body.task);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the TMS task.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Create a TMS task from this entry"
      ariaLabel="Create a TMS task from this Daily Report entry"
      onClose={onClose}
      size="wide"
      dismissible={!saving}
      footer={
        <>
          <ModalCancelButton onClick={onClose} disabled={saving}>Cancel</ModalCancelButton>
          <ModalOkButton onClick={handleCreate} disabled={saving || projects === null}>
            {saving ? 'Creating…' : 'Create TMS Task'}
          </ModalOkButton>
        </>
      }
    >
      <Field label="Task Description">
        <Textarea rows={2} value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} />
      </Field>
      <Field label="TMS Project">
        {projects === null ? (
          <div className={calcStyles.small}>Loading projects…</div>
        ) : (
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— Select —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Priority">
        <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </Select>
      </Field>
      <Field label="Due Date">
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
      {error && <div style={{ color: 'var(--mx-danger)', fontSize: 13, marginTop: 8 }}>{error}</div>}
    </Modal>
  );
}
