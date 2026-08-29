'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Paperclip } from 'lucide-react';
import { AuditLogEntry, TmsPriority, TmsTaskRecord, TmsTaskStatus, UserRole } from '@/lib/types';
import { TMS_PRIORITY_LABEL, TMS_PRIORITY_TONE, TMS_TASK_STATUS_LABEL, TMS_TASK_STATUS_TONE } from '@/lib/tmsLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import { useToast } from './ui/ToastProvider';

interface TaskDetailResponse {
  task: TmsTaskRecord;
  activity: AuditLogEntry[];
}

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
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <StatusBadge tone={TMS_TASK_STATUS_TONE[task.status]} label={TMS_TASK_STATUS_LABEL[task.status]} />
        <PriorityBadge tone={TMS_PRIORITY_TONE[task.priority]} label={TMS_PRIORITY_LABEL[task.priority]} />
        <Link className={historyStyles.button} href={`/tms/projects/${task.project_id}`}>View Project</Link>
        <Link className={historyStyles.button} href="/tms/tasks">Back to Tasks</Link>
      </div>

      <div className={calcStyles.sectionPanel} style={{ marginBottom: 16 }}>
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
        <div style={{ marginTop: 12 }}><strong>Description:</strong></div>
        <div style={{ marginTop: 4, whiteSpace: 'pre-line' }}>{task.description || 'No description provided.'}</div>
      </div>

      <div className={calcStyles.sectionPanel} style={{ marginBottom: 16 }}>
        <div className={calcStyles.h2} style={{ marginTop: 0 }}>Update Status</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {task.status === 'to_do' && (
            <button type="button" className={calcStyles.btn} disabled={saving} onClick={() => changeStatus('in_progress')}>Start Task</button>
          )}
          {task.status !== 'completed' && task.status !== 'cancelled' && (
            <button type="button" className={calcStyles.btn} disabled={saving} onClick={() => changeStatus('completed')}>Mark Complete</button>
          )}
          {task.status !== 'on_hold' && task.status !== 'completed' && task.status !== 'cancelled' && (
            <button type="button" className={historyStyles.button} disabled={saving} onClick={() => changeStatus('on_hold')}>Put On Hold</button>
          )}
          {task.status === 'on_hold' && (
            <button type="button" className={historyStyles.button} disabled={saving} onClick={() => changeStatus('in_progress')}>Resume</button>
          )}
          <select
            className={calcStyles.formControl}
            style={{ width: 'auto' }}
            value={task.status}
            disabled={saving}
            onChange={(e) => changeStatus(e.target.value as TmsTaskStatus)}
          >
            {(Object.keys(TMS_TASK_STATUS_LABEL) as TmsTaskStatus[]).map((s) => (
              <option key={s} value={s}>{TMS_TASK_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={calcStyles.sectionPanel} style={{ marginBottom: 16 }}>
        <div className={calcStyles.h2} style={{ marginTop: 0 }}>Attachments</div>
        <input type="file" multiple disabled={uploading} onChange={(e) => handleUpload(e.target.files)} />
        {uploading && <div className={historyStyles.status}>Uploading…</div>}
        {task.attachments.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--mx-ink-muted)', marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Paperclip size={14} /> No attachments yet.
          </div>
        ) : (
          <ul style={{ marginTop: 12 }}>
            {task.attachments.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">{url.split('/').pop()}</a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={calcStyles.sectionPanel}>
        <div className={calcStyles.h2} style={{ marginTop: 0 }}>Activity</div>
        <div className={calcStyles.field} style={{ marginBottom: 12 }}>
          <textarea
            className={calcStyles.formControl}
            rows={2}
            placeholder="Add a comment for your manager or teammates…"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <button type="button" className={calcStyles.btn} style={{ marginTop: 8 }} disabled={postingComment || !comment.trim()} onClick={postComment}>
            {postingComment ? 'Posting…' : 'Add Comment'}
          </button>
        </div>
        {activity.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--mx-ink-muted)' }}>No activity yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activity.map((a) => (
              <div key={a.id} style={{ padding: '10px 12px', background: 'var(--mx-surface-sunken)', borderRadius: 'var(--mx-radius-sm)', fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{a.action}</div>
                <div style={{ color: 'var(--mx-ink-muted)', fontSize: 12, marginTop: 2 }}>{a.by} · {formatDateTime(a.at)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
