'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AuditLogEntry, GeneralTaskDeadlineChangeRecord, GeneralTaskRecord, GeneralTaskUpdateRecord } from '@/lib/types';
import { GENERAL_TASK_PRIORITY_LABEL, GENERAL_TASK_PRIORITY_TONE, GENERAL_TASK_SOURCE_LABEL, GENERAL_TASK_STATUS_LABEL, GENERAL_TASK_STATUS_TONE } from '@/lib/generalTaskLabels';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './tmsDetail.module.css';
import StatusBadge from './ui/StatusBadge';
import PriorityBadge from './ui/PriorityBadge';
import ActivityTimeline from './ui/ActivityTimeline';
import Textarea from './ui/Textarea';
import ToolbarButton from './ui/ToolbarButton';
import { useToast } from './ui/ToastProvider';

interface DetailResponse {
  task: GeneralTaskRecord;
  updates: GeneralTaskUpdateRecord[];
  deadlineChanges: GeneralTaskDeadlineChangeRecord[];
  activity: AuditLogEntry[];
  permissions: { isAssignee: boolean; canAct: boolean; canSubmit: boolean; canReopen: boolean; canReview: boolean; canManage: boolean };
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

type PendingAction = 'submit' | 'review-approve' | 'review-rework' | 'review-reject' | 'reassign' | 'extend-deadline' | null;

interface MyTaskDetailViewProps {
  taskId: string;
  currentUser: { username: string; name: string };
}

export default function MyTaskDetailView({ taskId, currentUser }: MyTaskDetailViewProps) {
  void currentUser;
  const toast = useToast();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [status, setStatus] = useState('Loading...');
  const [acting, setActing] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [workSummary, setWorkSummary] = useState('');
  const [remark, setRemark] = useState('');
  const [newAssigneeId, setNewAssigneeId] = useState('');
  const [assignableEmployees, setAssignableEmployees] = useState<{ id: string; name: string }[]>([]);
  const [newDeadline, setNewDeadline] = useState('');

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch(`/api/general-tasks/${taskId}`);
      if (response.status === 404) {
        setStatus('This task could not be found — it may have been deleted, or you may not have access to it.');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json());
      setStatus('');
    } catch {
      setStatus('Could not load this task.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  useEffect(() => {
    if (pendingAction === 'reassign' && data) {
      fetch(`/api/departments/${data.task.department_id}/active-employees`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: { id: string; name: string }[]) => setAssignableEmployees(rows))
        .catch(() => setAssignableEmployees([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction]);

  function startAction(action: PendingAction) {
    setPendingAction(action);
    setWorkSummary('');
    setRemark('');
    setNewAssigneeId('');
    setNewDeadline(data?.task.deadline || '');
  }

  async function submitStart() {
    setActing(true);
    try {
      const response = await fetch(`/api/general-tasks/${taskId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' })
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
      toast.success('Task started.');
    } catch {
      toast.error('Could not start this task.');
    } finally {
      setActing(false);
    }
  }

  async function submitReopen() {
    setActing(true);
    try {
      const response = await fetch(`/api/general-tasks/${taskId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reopen' })
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
      toast.success('Task resumed.');
    } catch {
      toast.error('Could not resume this task.');
    } finally {
      setActing(false);
    }
  }

  async function confirmSubmit() {
    if (!workSummary.trim()) return toast.error('A work summary is required.');
    setActing(true);
    try {
      const response = await fetch(`/api/general-tasks/${taskId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', workSummary: workSummary.trim(), remarks: remark.trim() })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || String(response.status));
      }
      setPendingAction(null);
      await load();
      toast.success('Task submitted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not submit this task.');
    } finally {
      setActing(false);
    }
  }

  async function confirmReview(action: 'approve' | 'rework' | 'reject') {
    if (action !== 'approve' && !remark.trim()) return toast.error('A remark is required.');
    setActing(true);
    try {
      const response = await fetch(`/api/general-tasks/${taskId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, remark: remark.trim() })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || String(response.status));
      }
      setPendingAction(null);
      await load();
      toast.success('Review recorded.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record this review.');
    } finally {
      setActing(false);
    }
  }

  async function confirmReassign() {
    if (!newAssigneeId) return toast.error('Select a new employee.');
    if (!remark.trim()) return toast.error('A reason is required.');
    setActing(true);
    try {
      const response = await fetch(`/api/general-tasks/${taskId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newAssigneeId, reason: remark.trim() })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || String(response.status));
      }
      setPendingAction(null);
      await load();
      toast.success('Task reassigned.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not reassign this task.');
    } finally {
      setActing(false);
    }
  }

  async function confirmExtendDeadline() {
    if (!newDeadline) return toast.error('Select a new deadline.');
    if (!remark.trim()) return toast.error('A remark is required.');
    setActing(true);
    try {
      const response = await fetch(`/api/general-tasks/${taskId}/extend-deadline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newDeadline, remark: remark.trim() })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || String(response.status));
      }
      setPendingAction(null);
      await load();
      toast.success('Deadline changed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not change the deadline.');
    } finally {
      setActing(false);
    }
  }

  if (!data) {
    return (
      <AppShell title="Task" subtitle="" showBackLink>
        <div className={historyStyles.status}>{status || 'Loading...'}</div>
      </AppShell>
    );
  }

  const { task, updates, deadlineChanges, activity, permissions } = data;

  return (
    <AppShell title={task.title} subtitle={`${GENERAL_TASK_SOURCE_LABEL[task.source_module]} task · ${task.department_name}`} showBackLink>
      <div className={styles.headerRow}>
        <StatusBadge tone={GENERAL_TASK_STATUS_TONE[task.status]} label={GENERAL_TASK_STATUS_LABEL[task.status]} />
        <PriorityBadge tone={GENERAL_TASK_PRIORITY_TONE[task.priority]} label={GENERAL_TASK_PRIORITY_LABEL[task.priority]} />
        <Link className={historyStyles.button} href="/my-tasks">Back to My Tasks</Link>
      </div>

      <div className={`${calcStyles.sectionPanel} ${styles.panelSpaced16}`}>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div><strong>Assigned By:</strong> {task.created_by}</div>
          <div><strong>Assigned To:</strong> {task.assignee_name}</div>
          <div><strong>Reviewer:</strong> {task.reviewer_name || '-'}</div>
        </div>
        <div className={`${calcStyles.row} ${calcStyles.columns}`}>
          <div><strong>Department:</strong> {task.department_name}</div>
          <div><strong>Category:</strong> {task.category || '-'}</div>
          <div><strong>Deadline:</strong> {formatDate(task.deadline)}</div>
        </div>
        <div className={styles.infoRow}><strong>Description:</strong></div>
        <div className={styles.descriptionValue}>{task.description || 'No description provided.'}</div>
        {task.remarks && (
          <>
            <div className={styles.infoRow}><strong>Remarks:</strong></div>
            <div className={styles.descriptionValue}>{task.remarks}</div>
          </>
        )}
      </div>

      <div className={`${calcStyles.sectionPanel} ${styles.panelSpaced16}`}>
        <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Actions</div>
        <div className={styles.actionButtonsRow}>
          {permissions.canAct && <button type="button" className={calcStyles.btn} disabled={acting} onClick={submitStart}>Start Task</button>}
          {permissions.canSubmit && <button type="button" className={calcStyles.btn} disabled={acting} onClick={() => startAction('submit')}>Submit</button>}
          {permissions.canReopen && <button type="button" className={calcStyles.btn} disabled={acting} onClick={submitReopen}>Resume</button>}
          {permissions.canReview && (
            <>
              <button type="button" className={calcStyles.btn} disabled={acting} onClick={() => startAction('review-approve')}>Approve</button>
              <ToolbarButton disabled={acting} onClick={() => startAction('review-rework')}>Rework Required</ToolbarButton>
              <ToolbarButton disabled={acting} onClick={() => startAction('review-reject')}>Reject</ToolbarButton>
            </>
          )}
          {permissions.canManage && task.status !== 'approved' && task.status !== 'completed' && task.status !== 'cancelled' && task.status !== 'rejected' && (
            <>
              <ToolbarButton disabled={acting} onClick={() => startAction('reassign')}>Reassign</ToolbarButton>
              <ToolbarButton disabled={acting} onClick={() => startAction('extend-deadline')}>Extend Deadline</ToolbarButton>
            </>
          )}
          {!permissions.canAct && !permissions.canSubmit && !permissions.canReopen && !permissions.canReview && !permissions.canManage && (
            <span className={styles.mutedText13}>No action available for you on this task right now.</span>
          )}
        </div>

        {pendingAction === 'submit' && (
          <div className={`${calcStyles.field} ${styles.commentBox}`}>
            <Textarea rows={2} placeholder="Work summary (required)" value={workSummary} onChange={(e) => setWorkSummary(e.target.value)} />
            <Textarea rows={2} placeholder="Remarks (optional)" value={remark} onChange={(e) => setRemark(e.target.value)} />
            <div className={`${styles.actionButtonsRow} ${calcStyles.mt10}`}>
              <button type="button" className={calcStyles.btn} disabled={acting} onClick={confirmSubmit}>{acting ? 'Saving…' : 'Confirm Submit'}</button>
              <ToolbarButton disabled={acting} onClick={() => setPendingAction(null)}>Cancel</ToolbarButton>
            </div>
          </div>
        )}

        {(pendingAction === 'review-approve' || pendingAction === 'review-rework' || pendingAction === 'review-reject') && (
          <div className={`${calcStyles.field} ${styles.commentBox}`}>
            <Textarea
              rows={2}
              placeholder={pendingAction === 'review-approve' ? 'Remark (optional)' : 'Remark (required)'}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
            <div className={`${styles.actionButtonsRow} ${calcStyles.mt10}`}>
              <button
                type="button"
                className={calcStyles.btn}
                disabled={acting}
                onClick={() => confirmReview(pendingAction === 'review-approve' ? 'approve' : pendingAction === 'review-rework' ? 'rework' : 'reject')}
              >
                {acting ? 'Saving…' : 'Confirm'}
              </button>
              <ToolbarButton disabled={acting} onClick={() => setPendingAction(null)}>Cancel</ToolbarButton>
            </div>
          </div>
        )}

        {pendingAction === 'reassign' && (
          <div className={`${calcStyles.field} ${styles.commentBox}`}>
            <select className={calcStyles.formControl} value={newAssigneeId} onChange={(e) => setNewAssigneeId(e.target.value)}>
              <option value="">Select new employee</option>
              {assignableEmployees.filter((e) => e.id !== task.assignee_id).map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
            <Textarea rows={2} placeholder="Reason (required)" value={remark} onChange={(e) => setRemark(e.target.value)} />
            <div className={`${styles.actionButtonsRow} ${calcStyles.mt10}`}>
              <button type="button" className={calcStyles.btn} disabled={acting} onClick={confirmReassign}>{acting ? 'Saving…' : 'Confirm Reassign'}</button>
              <ToolbarButton disabled={acting} onClick={() => setPendingAction(null)}>Cancel</ToolbarButton>
            </div>
          </div>
        )}

        {pendingAction === 'extend-deadline' && (
          <div className={`${calcStyles.field} ${styles.commentBox}`}>
            <input type="date" className={calcStyles.formControl} min={task.deadline} value={newDeadline} onChange={(e) => setNewDeadline(e.target.value)} />
            <Textarea rows={2} placeholder="Reason (required)" value={remark} onChange={(e) => setRemark(e.target.value)} />
            <div className={`${styles.actionButtonsRow} ${calcStyles.mt10}`}>
              <button type="button" className={calcStyles.btn} disabled={acting} onClick={confirmExtendDeadline}>{acting ? 'Saving…' : 'Confirm'}</button>
              <ToolbarButton disabled={acting} onClick={() => setPendingAction(null)}>Cancel</ToolbarButton>
            </div>
          </div>
        )}
      </div>

      <div className={`${calcStyles.sectionPanel} ${styles.panelSpaced16}`}>
        <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Progress &amp; Submissions</div>
        {updates.length === 0 ? (
          <div className={styles.mutedText13}>No updates yet.</div>
        ) : (
          <div className={styles.activityList}>
            {updates.map((u) => (
              <div key={u.id} className={styles.activityItem}>
                <div className={styles.activityAction}>{GENERAL_TASK_STATUS_LABEL[u.statusAtUpdate]}{u.workSummary ? `: ${u.workSummary}` : ''}{u.remarks ? ` — ${u.remarks}` : ''}</div>
                <div className={styles.activityMeta}>{u.updatedByName || u.updatedByUsername} · {formatDateTime(u.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {deadlineChanges.length > 0 && (
        <div className={`${calcStyles.sectionPanel} ${styles.panelSpaced16}`}>
          <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Deadline History</div>
          <div className={styles.activityList}>
            {deadlineChanges.map((d) => (
              <div key={d.id} className={styles.activityItem}>
                <div className={styles.activityAction}>{formatDate(d.previousDeadline)} → {formatDate(d.newDeadline)}: {d.remark}</div>
                <div className={styles.activityMeta}>{d.changedByName} · {formatDateTime(d.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={calcStyles.sectionPanel}>
        <div className={`${calcStyles.h2} ${calcStyles.h2Flush}`}>Activity</div>
        <ActivityTimeline entries={activity.map((a) => ({ id: a.id, label: a.action, by: a.by, at: a.at }))} empty="No activity recorded yet." />
      </div>
    </AppShell>
  );
}
