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
  /** The TMS task's own name. */
  taskName: string;
  description: string;
  /** Raw TMS value ('low'|'medium'|'high'), not the AI display label. */
  priority: string;
  currentDeadline: string;
  /** tms_status_label off the entry — the real TMS word, not the AI 3-way bucket. */
  tmsStatusLabel: string;
  /** tms_progress_percent off the entry, already formatted ("40%"). */
  progressLabel: string;
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
//
// The panel exists because a linked row's TMS-sourced fields are read-only
// in the report: lib/aiTmsTaskLink.ts re-derives them from the live task on
// every save, so an edit typed into the row would be silently overwritten.
// It therefore has to be obvious that this is where those changes are made,
// which is why the header states it rather than leaving it to be discovered.
export default function TmsLinkedTaskPanel({
  taskId,
  taskName,
  description,
  priority,
  currentDeadline,
  tmsStatusLabel,
  progressLabel,
  onPatch
}: TmsLinkedTaskPanelProps) {
  const [open, setOpen] = useState(false);
  const [acting, setActing] = useState<EngineerTaskAction | null>(null);
  const [remark, setRemark] = useState('');
  const [progress, setProgress] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);
  // Seeded when the editor OPENS, not when the panel mounts. Mounting once
  // and holding the first value meant that after any refresh — a report
  // save, an action taken here — the editor reopened with stale text and
  // saving it silently reverted whatever had changed in TMS meanwhile.
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState('medium');
  const [extendOpen, setExtendOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const availableActions = engineerActionsForStatusLabel(tmsStatusLabel);
  const unavailable = ALL_ACTIONS.filter((a) => !availableActions.includes(a));

  function openDetailsEditor() {
    setEditName(taskName);
    setEditDescription(description);
    setEditPriority(priority || 'medium');
    setEditingDetails(true);
    setError('');
  }

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
    if (!editName.trim()) {
      setError('A task needs a name.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(`/api/tms/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // name included: a TMS task filed with no description shows its NAME
        // in this row (buildEntryPatchFromTmsTask falls back to it), so
        // without this the one thing on screen was the one thing that could
        // not be corrected from here.
        body: JSON.stringify({ name: editName.trim(), description: editDescription, priority: editPriority })
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
      {/* Was a bare blue "Update linked task" link with nothing around it, so
          the one place a linked task CAN be changed looked like a footnote.
          The header now states what it is and what it acts on. */}
      <button
        type="button"
        className={styles.tmsLinkedPanelHead}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={styles.tmsLinkedPanelHeadMain}>
          <span className={styles.tmsLinkedPanelTitle}>Linked TMS task</span>
          {tmsStatusLabel && <span className={styles.tmsLinkedStatus}>{tmsStatusLabel}</span>}
          {progressLabel && <span className={styles.tmsLinkedMeta}>{progressLabel}</span>}
        </span>
        <span className={styles.tmsLinkedPanelChevron}>{open ? 'Hide' : 'Change in TMS'}</span>
      </button>

      {open && (
        <div className={styles.tmsLinkedPanelBody}>
          <div className={styles.tmsLinkedNote}>
            These fields are read-only in the report because they are kept in step with TMS. Changes you make here are saved to the task
            itself — your own notes for the day stay in the Notes box above.
          </div>

          {error && <div className={styles.errorText} role="alert">{error}</div>}

          {!acting && !editingDetails && (
            <>
              {/* Only the actions that are actually possible are rendered.
                  Five greyed-out buttons whose reason lived in a `title`
                  attribute read as "this panel is broken" on a touchscreen,
                  where there is no hover. */}
              <div className={styles.tmsLinkedActionRow}>
                {availableActions.map((action) => (
                  <Button
                    key={action}
                    variant="secondary"
                    compact
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
                <Button variant="secondary" compact onClick={openDetailsEditor}>
                  Edit Name &amp; Details
                </Button>
              </div>
              {unavailable.length > 0 && tmsStatusLabel && (
                <div className={styles.tmsLinkedUnavailable}>
                  Not available from &ldquo;{tmsStatusLabel}&rdquo;: {unavailable.map((a) => TMS_TASK_ACTION_LABEL[a]).join(', ')}
                </div>
              )}
            </>
          )}

          {acting && (
            <div className={styles.tmsLinkedActionForm}>
              {acting === 'progress' && (
                <div className={calcStyles.field}>
                  <label className={calcStyles.label} htmlFor={`tms-progress-${taskId}`}>Progress %</label>
                  <Input
                    id={`tms-progress-${taskId}`}
                    type="number"
                    min={0}
                    max={100}
                    value={progress}
                    onChange={(e) => setProgress(e.target.value)}
                  />
                </div>
              )}
              <div className={calcStyles.field}>
                <label className={calcStyles.label} htmlFor={`tms-remark-${taskId}`}>
                  {acting === 'blocked' ? 'Why is this task blocked? (required)' : 'Remark (optional)'}
                </label>
                <Textarea id={`tms-remark-${taskId}`} rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
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
                <label className={calcStyles.label} htmlFor={`tms-name-${taskId}`}>Task Name</label>
                <Input id={`tms-name-${taskId}`} value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label} htmlFor={`tms-desc-${taskId}`}>Task Description</label>
                <Textarea id={`tms-desc-${taskId}`} rows={3} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label} htmlFor={`tms-priority-${taskId}`}>Priority</label>
                <Select id={`tms-priority-${taskId}`} value={editPriority} onChange={(e) => setEditPriority(e.target.value)}>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </Select>
              </div>
              <div className={styles.tmsLinkedActionButtons}>
                <Button variant="primary" compact loading={saving} loadingLabel="Saving…" onClick={saveDetails}>
                  Save to TMS
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
