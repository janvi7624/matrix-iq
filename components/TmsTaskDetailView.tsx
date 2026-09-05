'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Paperclip } from 'lucide-react';
import { AuditLogEntry, TmsPriority, TmsTaskRecord, TmsTaskStatus, TmsTaskUpdateRecord, UserRole } from '@/lib/types';
import { EngineerTaskAction, TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE, TMS_TASK_ACTION_LABEL, TMS_TASK_STATUS_LABEL, TMS_TASK_STATUS_TONE } from '@/lib/tmsLabels';
import { TMS_MANAGER_TIER_ROLES } from '@/lib/tmsConstants';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import { useToast } from './ui/ToastProvider';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import ToolbarButton from './ui/ToolbarButton';
import styles from './tmsDetail.module.css';

interface TaskDetailResponse {
  task: TmsTaskRecord;
  activity: AuditLogEntry[];
}

// Client-side mirror of lib/tmsTaskStore.ts's VALID_TRANSITIONS — for
// button visibility only. The real enforcement is server-side in
// app/api/tms/tasks/[id]/update/route.ts; a stale/wrong entry here would at
// worst show a button that the server then rejects.
const ENGINEER_ACTIONS: Record<TmsTaskStatus, EngineerTaskAction[]> = {
  to_do: ['start'],
  in_progress: ['progress', 'blocked', 'ready_for_review'],
  blocked: ['reopen'],
  ready_for_review: [],
  on_hold: [],
  completed: [],
  cancelled: []
};

interface TmsTaskDetailViewProps {
  taskId: string;
  currentUser: { username: string; role: UserRole };
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN');
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

export default function TmsTaskDetailView({ taskId, currentUser }: TmsTaskDetailViewProps) {
  const toast = useToast();
  const [data, setData] = useState<TaskDetailResponse | null>(null);
  const [status, setStatus] = useState('Loading...');
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [taskUpdates, setTaskUpdates] = useState<TmsTaskUpdateRecord[]>([]);
  const [actingAction, setActingAction] = useState<EngineerTaskAction | null>(null);
  const [actionRemark, setActionRemark] = useState('');
  const [actionProgress, setActionProgress] = useState('');
  const [acting, setActing] = useState(false);

  const isManagerTier = TMS_MANAGER_TIER_ROLES.has(currentUser.role);

  async function loadUpdates() {
    try {
      const response = await fetch(`/api/tms/tasks/${taskId}/update`);
      if (!response.ok) return;
      const body: { updates: TmsTaskUpdateRecord[] } = await response.json();
      setTaskUpdates(body.updates);
    } catch {
      // non-critical — the page still works without the update history
    }
  }

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch(`/api/tms/tasks/${taskId}`);
      if (response.status === 404) {
        setStatus('This task could not be found — it may have been deleted, or you may not have access to it.');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const body: TaskDetailResponse = await response.json();
      setData(body);
      setStatus('');
    } catch {
      setStatus('Could not load this task.');
    }
  }

  useEffect(() => {
    load();
    loadUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function changeStatus(next: TmsTaskStatus) {
    setSaving(true);
    try {
      const response = await fetch(`/api/tms/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
      toast.success(`Task marked ${TMS_TASK_STATUS_LABEL[next]}.`);
    } catch {
      toast.error('Could not update the task status.');
    } finally {
      setSaving(false);
    }
  }

  function startAction(action: EngineerTaskAction) {
    setActingAction(action);
    setActionRemark('');
    setActionProgress(action === 'progress' ? String(data?.task.progress_percent || 0) : '');
  }

  async function submitAction() {
    if (!actingAction) return;
    if (actingAction === 'blocked' && !actionRemark.trim()) {
      toast.error('A remark is required to mark this task blocked.');
      return;
    }
    setActing(true);
    try {
      const response = await fetch(`/api/tms/tasks/${taskId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: actingAction,
          remark: actionRemark.trim(),
          progressPercent: actionProgress !== '' ? Number(actionProgress) : undefined
        })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || String(response.status));
      }
      setActingAction(null);
      setActionRemark('');
      setActionProgress('');
      await Promise.all([load(), loadUpdates()]);
      toast.success('Task updated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the task.');
    } finally {
      setActing(false);
    }
  }

  async function postComment() {
    if (!data || !comment.trim()) return;
    setPostingComment(true);
    try {
      const stamp = `[${new Date().toLocaleString('en-IN')} — ${currentUser.username}] ${comment.trim()}`;
      const nextRemarks = data.task.remarks ? `${data.task.remarks}\n${stamp}` : stamp;
      const response = await fetch(`/api/tms/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remarks: nextRemarks })
      });
      if (!response.ok) throw new Error(String(response.status));
      setComment('');
      await load();
      toast.success('Comment added.');
    } catch {
      toast.error('Could not add the comment.');
    } finally {
      setPostingComment(false);
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('folder', 'tms-tasks');
      Array.from(files).forEach((f) => formData.append('files', f));
      const uploadRes = await fetch('/api/uploads', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error(String(uploadRes.status));
      const { urls } = await uploadRes.json();
      const patchRes = await fetch(`/api/tms/tasks/${taskId}`, {
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

  if (!data) {
    return (
      <AppShell title="Task" subtitle="" showBackLink>
        <div className={historyStyles.status}>{status || 'Loading...'}</div>
      </AppShell>
    );
  }

  const { task, activity } = data;

  return (
    <AppShell title={task.name} subtitle={`Task on ${task.project_name}`} showBackLink>
      <div className={styles.headerRow}>
        <StatusBadge tone={TMS_TASK_STATUS_TONE[task.status]} label={TMS_TASK_STATUS_LABEL[task.status]} />
        <PriorityBadge tone={TMS_PRIORITY_TONE[task.priority]} label={TMS_PRIORITY_LABEL[task.priority]} />
        <Link className={historyStyles.button} href={`/tms/projects/${task.project_id}`}>View Project</Link>
        <Link className={historyStyles.button} href="/tms/tasks">Back to Tasks</Link>
      </div>

      <div className={`${calcStyles.sectionPanel} ${styles.panelSpaced16}`}>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div><strong>Project:</strong> {task.project_name}</div>
          <div><strong>Assigned By:</strong> {task.created_by}</div>
          <div><strong>Assigned To:</strong> {task.assignee_name || 'Unassigned'}</div>
        </div>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div><strong>Department:</strong> {task.department_name || '-'}</div>
          <div><strong>Start Date:</strong> {formatDate(task.start_date)}</div>
          <div><strong>Due Date:</strong> {formatDate(task.due_date)}</div>
        </div>
        <div className={styles.infoRow}><strong>Description:</strong></div>
        <div className={styles.descriptionValue}>{task.description || 'No description provided.'}</div>
      </div>

      {isManagerTier ? (
        <div className={`${calcStyles.sectionPanel} ${styles.panelSpaced16}`}>
          <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Update Status</div>
          <div className={styles.actionButtonsRow}>
            {task.status === 'to_do' && (
              <button type="button" className={calcStyles.btn} disabled={saving} onClick={() => changeStatus('in_progress')}>Start Task</button>
            )}
            {task.status === 'ready_for_review' && (
              <button type="button" className={calcStyles.btn} disabled={saving} onClick={() => changeStatus('completed')}>Approve &amp; Complete</button>
            )}
            {task.status !== 'completed' && task.status !== 'cancelled' && (
              <button type="button" className={calcStyles.btn} disabled={saving} onClick={() => changeStatus('completed')}>Mark Complete</button>
            )}
            {task.status !== 'on_hold' && task.status !== 'completed' && task.status !== 'cancelled' && (
              <ToolbarButton disabled={saving} onClick={() => changeStatus('on_hold')}>Put On Hold</ToolbarButton>
            )}
            {task.status === 'on_hold' && (
              <ToolbarButton disabled={saving} onClick={() => changeStatus('in_progress')}>Resume</ToolbarButton>
            )}
            <Select
              auto
              value={task.status}
              disabled={saving}
              onChange={(e) => changeStatus(e.target.value as TmsTaskStatus)}
            >
              {(Object.keys(TMS_TASK_STATUS_LABEL) as TmsTaskStatus[]).map((s) => (
                <option key={s} value={s}>{TMS_TASK_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </div>
        </div>
      ) : (
        <div className={`${calcStyles.sectionPanel} ${styles.panelSpaced16}`}>
          <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Update Task</div>
          <div className={styles.actionButtonsRow}>
            {(ENGINEER_ACTIONS[task.status] || []).map((action) => (
              <button key={action} type="button" className={calcStyles.btn} disabled={acting} onClick={() => startAction(action)}>
                {TMS_TASK_ACTION_LABEL[action]}
              </button>
            ))}
            {(ENGINEER_ACTIONS[task.status] || []).length === 0 && (
              <span className={styles.mutedText13}>No action available while this task is &quot;{TMS_TASK_STATUS_LABEL[task.status]}&quot;.</span>
            )}
          </div>
          {actingAction && (
            <div className={`${calcStyles.field} ${styles.commentBox}`}>
              {actingAction === 'progress' && (
                <input
                  type="number"
                  min={0}
                  max={100}
                  className={calcStyles.formControl}
                  value={actionProgress}
                  onChange={(e) => setActionProgress(e.target.value)}
                  placeholder="Progress %"
                />
              )}
              <Textarea
                rows={2}
                placeholder={actingAction === 'blocked' ? 'Why is this task blocked? (required)' : 'Optional note'}
                value={actionRemark}
                onChange={(e) => setActionRemark(e.target.value)}
              />
              <div className={`${styles.actionButtonsRow} ${calcStyles.mt10}`}>
                <button type="button" className={calcStyles.btn} disabled={acting} onClick={submitAction}>
                  {acting ? 'Saving…' : `Confirm: ${TMS_TASK_ACTION_LABEL[actingAction]}`}
                </button>
                <ToolbarButton disabled={acting} onClick={() => setActingAction(null)}>Cancel</ToolbarButton>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={calcStyles.sectionPanel}>
        <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Progress &amp; Updates ({task.progress_percent}%)</div>
        {taskUpdates.length === 0 ? (
          <div className={styles.mutedText13}>No progress updates yet.</div>
        ) : (
          <div className={styles.activityList}>
            {taskUpdates.map((u) => (
              <div key={u.id} className={styles.activityItem}>
                <div className={styles.activityAction}>{u.progressPercent}% — {TMS_TASK_STATUS_LABEL[u.statusAtUpdate]}{u.remark ? `: ${u.remark}` : ''}</div>
                <div className={styles.activityMeta}>{u.updatedByName || u.updatedByUsername} · {formatDateTime(u.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={`${calcStyles.sectionPanel} ${styles.panelSpaced16}`}>
        <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Attachments</div>
        <input type="file" multiple disabled={uploading} onChange={(e) => handleUpload(e.target.files)} />
        {uploading && <div className={historyStyles.status}>Uploading…</div>}
        {task.attachments.length === 0 ? (
          <div className={styles.emptyNoteRow}>
            <Paperclip size={14} /> No attachments yet.
          </div>
        ) : (
          <ul className={styles.attachmentList}>
            {task.attachments.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">{url.split('/').pop()}</a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={calcStyles.sectionPanel}>
        <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Activity</div>
        <div className={`${calcStyles.field} ${styles.commentBox}`}>
          <Textarea
            rows={2}
            placeholder="Add a comment for your manager or teammates…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="button" className={`${calcStyles.btn} ${calcStyles.mt8}`} disabled={postingComment || !comment.trim()} onClick={postComment}>
            {postingComment ? 'Posting…' : 'Add Comment'}
          </button>
        </div>
        {activity.length === 0 ? (
          <div className={styles.mutedText13}>No activity yet.</div>
        ) : (
          <div className={styles.activityList}>
            {activity.map((a) => (
              <div key={a.id} className={styles.activityItem}>
                <div className={styles.activityAction}>{a.action}</div>
                <div className={styles.activityMeta}>{a.by} · {formatDateTime(a.at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
