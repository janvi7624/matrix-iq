'use client';

import { useState } from 'react';
import { EngineerTaskAction, TMS_TASK_ACTION_LABEL } from '@/lib/tmsLabels';
import { engineerActionsForStatusLabel, buildEntryPatchFromTmsTask } from '@/lib/aiTmsStatusMapping';
import { TmsTaskRecord } from '@/lib/types';
import TmsTaskDeadlineExtendModal from './TmsTaskDeadlineExtendModal';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import calcStyles from './calculator.module.css';
import styles from './dailyReport.module.css';

const ALL_ACTIONS: EngineerTaskAction[] = ['start', 'progress', 'blocked', 'ready_for_review', 'reopen'];
const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' }
];

interface TmsLinkedTaskPanelProps {
  taskId: string;
  taskName: string;
  description: string;
  /** Raw TMS value ('low'|'medium'|'high'), not the AI display label. */
  priority: string;
  currentDeadline: string;
  /** tms_status_label off the entry — the real TMS word, not the AI 3-way bucket. */
  tmsStatusLabel: string;
  /** Patches the entry's own tms_*-prefixed fields right away, so the row
   *  reflects what was just saved without waiting for the next report save
   *  to pull it — same optimistic-then-confirmed pattern the picker uses. */
  onPatch: (patch: Record<string, unknown>) => void;
}

// The write half of the AI Daily Report <-> TMS Task link. Every action here
// POSTs straight to the SAME TMS API routes components/TmsTaskDetailView.tsx
// itself calls (POST .../update, PATCH .../[id], POST .../extend-deadline,
// the last one via the literal same TmsTaskDeadlineExtendModal) — there is
// no second implementation of the transition rules, the permission checks,
// or the due-date approval chain here. This component is a second DOOR into
// those routes, not a second copy of what is behind them.
export default function TmsLinkedTaskPanel({ taskId, taskName, description, priority, currentDeadline, tmsStatusLabel, onPatch }: TmsLinkedTaskPanelProps) {
  const [open, setOpen] = useState(false);
  const [acting, setActing] = useState<EngineerTaskAction | null>(null);
  const [remark, setRemark] = useState('');
  const [progress, setProgress] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);
  const [editDescription, setEditDescription] = useState(description);
  const [editPriority, setEditPriority] = useState(priority || 'medium');
  const [extendOpen, setExtendOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const availableActions = engineerActionsForStatusLabel(tmsStatusLabel);

  function applyTaskToPatch(task: TmsTaskRecord) {
    onPatch(
      buildEntryPatchFromTmsTask({
        name: task.name,
        description: task.description,
        dueDate: task.due_date,
        priority: task.priority,
        status: task.status,
        projectName: task.project_name,
        progressPercent: task.progress_percent,
        completionDate: task.completion_date
      })
    );
  }

  async function submitAction() {
    if (!acting) return;
    if (acting === 'blocked' && !remark.trim()) {
      setError('A remark is required to mark this task blocked.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/tms/tasks/${taskId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: acting,
          remark: remark.trim(),
          progressPercent: progress !== '' ? Number(progress) : undefined
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not update the task.');
      }
      const task: TmsTaskRecord = await response.json();
      applyTaskToPatch(task);
      setActing(null);
      setRemark('');
      setProgress('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the task.');
    } finally {
      setSaving(false);
    }
  }

  async function saveDetails() {
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/tms/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: editDescription, priority: editPriority })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Could not save the task details.');
      }
      const task: TmsTaskRecord = await response.json();
      applyTaskToPatch(task);
      setEditingDetails(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the task details.');
    } finally {
      setSaving(false);
    }
  }

  async function handleExtended() {
    try {
      const response = await fetch(`/api/tms/tasks/${taskId}`);
      if (!response.ok) return;
      const body: { task: TmsTaskRecord } = await response.json();
      applyTaskToPatch(body.task);
    } catch {
      // The extension itself already succeeded (the modal's own toast said
      // so) — a failed re-fetch here just means this row stays on its old
      // due date until the next report save re-syncs it.
    }
  }

  return (
    <div className={styles.tmsLinkedPanel}>
      <button type="button" className={styles.tmsLinkedPanelToggle} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide task actions' : 'Update linked task'}
      </button>

      {open && (
        <div className={styles.tmsLinkedPanelBody}>
          {error && <div className={styles.errorText}>{error}</div>}

          {!acting && !editingDetails && (
            <div className={styles.tmsLinkedActionRow}>
              {ALL_ACTIONS.map((action) => (
                <Button
                  key={action}
                  variant="secondary"
                  compact
                  disabled={!availableActions.includes(action)}
                  title={!availableActions.includes(action) ? `Not available from "${tmsStatusLabel}"` : undefined}
                  onClick={() => {
                    setActing(action);
                    setRemark('');
                    setProgress('');
                    setError('');
                  }}
                >
                  {TMS_TASK_ACTION_LABEL[action]}
                </Button>
              ))}
              <Button variant="secondary" compact onClick={() => setExtendOpen(true)}>
                Extend Due Date
              </Button>
              <Button variant="secondary" compact onClick={() => { setEditingDetails(true); setError(''); }}>
                Edit Details
              </Button>
            </div>
          )}

          {acting && (
            <div className={styles.tmsLinkedActionForm}>
              {acting === 'progress' && (
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Progress %</label>
                  <Input type="number" min={0} max={100} value={progress} onChange={(e) => setProgress(e.target.value)} />
                </div>
              )}
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>
                  {acting === 'blocked' ? 'Why is this task blocked? (required)' : 'Remark (optional)'}
                </label>
                <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
              </div>
              <div className={styles.tmsLinkedActionButtons}>
                <Button variant="primary" compact loading={saving} loadingLabel="Saving…" onClick={submitAction}>
                  Confirm: {TMS_TASK_ACTION_LABEL[acting]}
                </Button>
                <Button variant="ghost" compact disabled={saving} onClick={() => setActing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {editingDetails && (
            <div className={styles.tmsLinkedActionForm}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Task Description</label>
                <Textarea rows={2} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Priority</label>
                <Select value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </Select>
              </div>
              <div className={styles.tmsLinkedActionButtons}>
                <Button variant="primary" compact loading={saving} loadingLabel="Saving…" onClick={saveDetails}>
                  Save Details
                </Button>
                <Button variant="ghost" compact disabled={saving} onClick={() => setEditingDetails(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {extendOpen && (
        <TmsTaskDeadlineExtendModal
          taskId={taskId}
          taskName={taskName}
          currentDeadline={currentDeadline}
          onClose={() => setExtendOpen(false)}
          onExtended={handleExtended}
        />
      )}
    </div>
  );
}
