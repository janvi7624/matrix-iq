'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MarketingRequestPriority, MarketingRequestRecord, MarketingRequestStatus, MarketingRequestType, ProjectRecord, UserRole } from '@/lib/types';
import { MARKETING_PRIORITY_META, MARKETING_REQUEST_TYPE_LABEL, MARKETING_STATUS_LABEL, isMarketingRequestOverdue } from '@/lib/marketingRequestHelpers';
import AppShell from './AppShell';
import MarketingRequestWizard, { MarketingRequestForm } from './MarketingRequestWizard';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';

interface MarketingRequestsViewProps {
  currentUser: { username: string; role: UserRole };
  isReviewer: boolean;
}

const STATUS_CLASS: Record<MarketingRequestStatus, string> = {
  submitted: historyStyles.statusPending,
  timeline_set: historyStyles.statusDone,
  in_progress: historyStyles.statusConfirmed,
  completed: historyStyles.statusConfirmed,
  rejected: historyStyles.statusRejected,
  cancelled: historyStyles.statusCancelled
};

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

function PriorityBadge({ priority }: { priority: MarketingRequestPriority }) {
  const meta = MARKETING_PRIORITY_META[priority];
  return <span className={historyStyles.priorityBadge} style={{ background: 'rgba(107,114,128,0.12)', color: '#374151' }}>{meta.icon} {meta.label}</span>;
}

function StatusBadge({ status }: { status: MarketingRequestStatus }) {
  return <span className={`${historyStyles.statusBadge} ${STATUS_CLASS[status]}`}>{MARKETING_STATUS_LABEL[status]}</span>;
}

interface RowProps {
  record: MarketingRequestRecord;
  currentUser: { username: string; role: UserRole };
  isReviewer: boolean;
  onSetTimeline: (id: string, expectedDeliveryDate: string, remarks: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
  onCancel: (id: string) => Promise<void>;
  onStart: (id: string) => Promise<void>;
  onComplete: (id: string, completionNotes: string) => Promise<void>;
  onComment: (id: string, text: string) => Promise<void>;
  onDelete: (record: MarketingRequestRecord) => Promise<void>;
}

function MarketingRequestRow({ record: r, currentUser, isReviewer, onSetTimeline, onReject, onCancel, onStart, onComplete, onComment, onDelete }: RowProps) {
  const [expanded, setExpanded] = useState(false);
  const [timelineDate, setTimelineDate] = useState('');
  const [timelineRemarks, setTimelineRemarks] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showComplete, setShowComplete] = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);

  const isOwner = r.created_by === currentUser.username;
  const overdue = isMarketingRequestOverdue(r);
  const canDelete = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <tr onClick={() => setExpanded((v) => !v)} style={{ cursor: 'pointer' }}>
        <td>{r.title}</td>
        <td>{MARKETING_REQUEST_TYPE_LABEL[r.request_type]}</td>
        <td><PriorityBadge priority={r.priority} /></td>
        <td>
          <StatusBadge status={r.status} />
          {overdue && <span className={historyStyles.reminderBadge} style={{ marginLeft: 6 }}>⏰ Overdue</span>}
        </td>
        <td>{r.created_by}</td>
        <td>{r.timeline ? <span title={`Set by ${r.timeline.setBy} on ${formatDateTime(r.timeline.setAt)}`}>🔒 {formatDate(r.timeline.expectedDeliveryDate)}</span> : '-'}</td>
        <td>{formatDate(r.created_at)}</td>
        <td><button type="button" className={historyStyles.toggleBtn} onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>{expanded ? 'Hide' : 'View'}</button></td>
      </tr>
      {expanded && (
        <tr className={historyStyles.detailsRow}>
          <td colSpan={8}>
            <div style={{ padding: '4px 2px' }}>
              <div className={calcStyles.small} style={{ marginBottom: 10, whiteSpace: 'pre-wrap' }}>{r.description}</div>

              {r.project_id && (
                <div className={calcStyles.small} style={{ marginBottom: 10 }}>
                  Project: <Link href={`/projects/${r.project_id}`}>{r.project_id}</Link>
                </div>
              )}
              {r.needed_by_date && <div className={calcStyles.small} style={{ marginBottom: 10 }}>Requester hoped for: {formatDate(r.needed_by_date)}</div>}

              {r.attachments.length > 0 && (
                <div className={historyStyles.imageStrip}>
                  {r.attachments.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt="Attachment" /></a>
                  ))}
                </div>
              )}

              {/* Timeline — locked forever once set, for every viewer including the reviewer who set it. */}
              {r.timeline ? (
                <div className={historyStyles.historyCard} style={{ marginTop: 12 }}>
                  🔒 Committed delivery: <strong>{formatDate(r.timeline.expectedDeliveryDate)}</strong> — set by {r.timeline.setBy} on {formatDateTime(r.timeline.setAt)}
                  {r.timeline.remarks && <div style={{ marginTop: 4 }}>{r.timeline.remarks}</div>}
                  <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 4 }}>This date can&apos;t be changed by anyone once committed.</div>
                </div>
              ) : (
                isReviewer && r.status === 'submitted' && !showReject && (
                  <div className={calcStyles.sectionPanel} style={{ marginTop: 12 }}>
                    <div className={calcStyles.label} style={{ marginBottom: 8 }}>Commit a delivery timeline</div>
                    <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                      <div className={calcStyles.field}>
                        <label className={calcStyles.label}>Expected delivery date</label>
                        <input type="date" className={calcStyles.formControl} value={timelineDate} onChange={(e) => setTimelineDate(e.target.value)} />
                      </div>
                      <div className={calcStyles.field}>
                        <label className={calcStyles.label}>Remarks (optional)</label>
                        <input className={calcStyles.formControl} value={timelineRemarks} onChange={(e) => setTimelineRemarks(e.target.value)} placeholder="e.g. Expedited for the event date" />
                      </div>
                    </div>
                    <span className={calcStyles.small} style={{ display: 'block', margin: '4px 0 10px' }}>Once you save this, it becomes permanent — it can&apos;t be edited afterward, so double-check the date.</span>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button type="button" className={calcStyles.btn} disabled={busy || !timelineDate} onClick={() => run(() => onSetTimeline(r.id, timelineDate, timelineRemarks))}>
                        {busy ? 'Saving…' : '🔒 Commit Timeline'}
                      </button>
                      <button type="button" className={`${calcStyles.btn} ${calcStyles.btnGhost}`} onClick={() => setShowReject(true)}>Decline Request</button>
                    </div>
                  </div>
                )
              )}

              {isReviewer && r.status === 'submitted' && showReject && (
                <div className={calcStyles.sectionPanel} style={{ marginTop: 12 }}>
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Reason for declining</label>
                    <input className={calcStyles.formControl} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} autoFocus />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" className={historyStyles.deleteBtn} disabled={busy || !rejectReason.trim()} onClick={() => run(() => onReject(r.id, rejectReason))}>
                      {busy ? 'Declining…' : 'Confirm Decline'}
                    </button>
                    <button type="button" className={`${calcStyles.btn} ${calcStyles.btnGhost}`} onClick={() => setShowReject(false)}>Cancel</button>
                  </div>
                </div>
              )}

              {isReviewer && r.status === 'timeline_set' && (
                <button type="button" className={calcStyles.btn} style={{ marginTop: 12 }} disabled={busy} onClick={() => run(() => onStart(r.id))}>
                  {busy ? 'Updating…' : '▶ Mark In Progress'}
                </button>
              )}

              {isReviewer && r.status === 'in_progress' && !showComplete && (
                <button type="button" className={calcStyles.btn} style={{ marginTop: 12 }} onClick={() => setShowComplete(true)}>✅ Mark Completed</button>
              )}
              {isReviewer && r.status === 'in_progress' && showComplete && (
                <div className={calcStyles.sectionPanel} style={{ marginTop: 12 }}>
                  <div className={calcStyles.field}>
                    <label className={calcStyles.label}>Completion notes (optional)</label>
                    <textarea className={calcStyles.formControl} rows={3} value={completionNotes} onChange={(e) => setCompletionNotes(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button type="button" className={calcStyles.btn} disabled={busy} onClick={() => run(() => onComplete(r.id, completionNotes))}>
                      {busy ? 'Saving…' : 'Confirm Completed'}
                    </button>
                    <button type="button" className={`${calcStyles.btn} ${calcStyles.btnGhost}`} onClick={() => setShowComplete(false)}>Cancel</button>
                  </div>
                </div>
              )}

              {r.status === 'completed' && r.completion_notes && (
                <div className={historyStyles.autofillNotice} style={{ marginTop: 12 }}>✅ {r.completion_notes}</div>
              )}
              {r.status === 'rejected' && (
                <div className={historyStyles.loginError} style={{ marginTop: 12 }}>Declined: {r.rejection_reason}</div>
              )}

              {isOwner && r.status === 'submitted' && (
                <button type="button" className={`${calcStyles.btn} ${calcStyles.btnGhost}`} style={{ marginTop: 12 }} disabled={busy} onClick={() => run(() => onCancel(r.id))}>
                  Cancel My Request
                </button>
              )}

              {/* Comments — visible to anyone who can see this row (own ticket, or a reviewer). */}
              <div style={{ marginTop: 16 }}>
                <div className={calcStyles.label} style={{ marginBottom: 8 }}>Comments</div>
                {r.comments.length === 0 && <div className={calcStyles.small}>No comments yet.</div>}
                <div className={historyStyles.timeline}>
                  {r.comments.map((c) => (
                    <div key={c.id} className={historyStyles.timelineEntry}>
                      <div className={historyStyles.timelineMeta}>{c.by} · {formatDateTime(c.at)}</div>
                      {c.text}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input className={calcStyles.formControl} placeholder="Add a comment…" value={commentText} onChange={(e) => setCommentText(e.target.value)} />
                  <button
                    type="button"
                    className={historyStyles.button}
                    disabled={!commentText.trim()}
                    onClick={() => { onComment(r.id, commentText); setCommentText(''); }}
                  >
                    Post
                  </button>
                </div>
              </div>

              {canDelete && (
                <button type="button" className={historyStyles.deleteBtn} style={{ marginTop: 16 }} onClick={() => onDelete(r)}>Delete Request</button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MarketingRequestsViewContent({ currentUser, isReviewer }: MarketingRequestsViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const startAwaitingReview = searchParams.get('filter') === 'submitted';
  const [mode, setMode] = useState<'new' | 'list'>(startAwaitingReview ? 'list' : 'new');
  const [requests, setRequests] = useState<MarketingRequestRecord[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<MarketingRequestStatus | ''>(startAwaitingReview ? 'submitted' : '');
  const [typeFilter, setTypeFilter] = useState<MarketingRequestType | ''>('');

  async function loadRequests() {
    setStatus('Loading...');
    try {
      const response = await fetch('/api/marketing-requests');
      if (!response.ok) throw new Error(String(response.status));
      const data: MarketingRequestRecord[] = await response.json();
      setRequests(data);
      setStatus(data.length ? `${data.length} request${data.length === 1 ? '' : 's'}.` : 'No marketing requests yet.');
    } catch {
      setStatus('Could not load marketing requests. Refresh to try again.');
    }
  }

  useEffect(() => {
    loadRequests();
    fetch('/api/projects').then((r) => (r.ok ? r.json() : [])).then(setProjects).catch(() => setProjects([]));
  }, []);

  const visible = useMemo(() => {
    let rows = requests;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((r) => `${r.title} ${r.description} ${r.created_by}`.toLowerCase().includes(needle));
    }
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (typeFilter) rows = rows.filter((r) => r.request_type === typeFilter);
    return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [requests, q, statusFilter, typeFilter]);

  function replaceRecord(updated: MarketingRequestRecord) {
    setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function handleSubmitRequest(form: MarketingRequestForm): Promise<MarketingRequestRecord | null> {
    setCreating(true);
    try {
      const response = await fetch('/api/marketing-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error(body?.error || 'Could not send this request. Please try again.');
        return null;
      }
      const created: MarketingRequestRecord = await response.json();
      setRequests((prev) => [created, ...prev]);
      return created;
    } catch {
      toast.error('Could not reach the server.');
      return null;
    } finally {
      setCreating(false);
    }
  }

  function showAllRequests() {
    setMode('list');
    loadRequests();
  }

  async function postAction(url: string, body: unknown, successMessage?: string) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      toast.error(errBody?.error || 'That action could not be completed.');
      return;
    }
    const updated: MarketingRequestRecord = await response.json();
    replaceRecord(updated);
    if (successMessage) toast.success(successMessage);
  }

  async function handleSetTimeline(id: string, expectedDeliveryDate: string, remarks: string) {
    if (!(await confirm({ title: 'Commit this delivery date?', message: 'Once saved, this date cannot be changed by anyone — including you. Make sure it’s right.', confirmLabel: 'Yes, commit it' }))) return;
    await postAction(`/api/marketing-requests/${id}/set-timeline`, { expectedDeliveryDate, remarks }, 'Delivery timeline committed.');
  }

  async function handleReject(id: string, reason: string) {
    await postAction(`/api/marketing-requests/${id}/reject`, { reason }, 'Request declined.');
  }

  async function handleCancel(id: string) {
    if (!(await confirm({ message: 'Cancel this request? This cannot be undone.', danger: true }))) return;
    await postAction(`/api/marketing-requests/${id}/cancel`, {}, 'Request cancelled.');
  }

  async function handleStart(id: string) {
    await postAction(`/api/marketing-requests/${id}/status`, { action: 'start' }, 'Marked in progress.');
  }

  async function handleComplete(id: string, completionNotes: string) {
    await postAction(`/api/marketing-requests/${id}/status`, { action: 'complete', completionNotes }, 'Marked completed.');
  }

  async function handleComment(id: string, text: string) {
    await postAction(`/api/marketing-requests/${id}/comments`, { text });
  }

  async function handleDelete(record: MarketingRequestRecord) {
    if (!(await confirm({ message: `Delete "${record.title}"? This cannot be undone.`, danger: true }))) return;
    const response = await fetch(`/api/marketing-requests/${record.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toast.error('Could not delete this request.');
      return;
    }
    setRequests((prev) => prev.filter((r) => r.id !== record.id));
  }

  return (
    <AppShell title="Marketing Requests" subtitle="Ask Marketing for what you need, and track the delivery timeline they commit to.">
        <div className={historyStyles.modeToggle}>
          <button type="button" className={`${historyStyles.modeToggleBtn} ${mode === 'new' ? historyStyles.modeToggleBtnActive : ''}`} onClick={() => setMode('new')}>
            📣 New Request
          </button>
          <button type="button" className={`${historyStyles.modeToggleBtn} ${mode === 'list' ? historyStyles.modeToggleBtnActive : ''}`} onClick={showAllRequests}>
            📋 {isReviewer ? 'All Requests' : 'My Requests'}
          </button>
        </div>

        {mode === 'new' && (
          <MarketingRequestWizard creating={creating} projects={projects} onSubmit={handleSubmitRequest} onViewAllRequests={showAllRequests} />
        )}

        {mode === 'list' && (
          <>
            <div className={historyStyles.toolbar}>
              <input type="text" placeholder="Search title, description, requester..." value={q} onChange={(e) => setQ(e.target.value)} />
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as MarketingRequestStatus | '')}>
                <option value="">All statuses</option>
                {(Object.keys(MARKETING_STATUS_LABEL) as MarketingRequestStatus[]).map((s) => (
                  <option key={s} value={s}>{MARKETING_STATUS_LABEL[s]}</option>
                ))}
              </select>
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as MarketingRequestType | '')}>
                <option value="">All types</option>
                {(Object.keys(MARKETING_REQUEST_TYPE_LABEL) as MarketingRequestType[]).map((t) => (
                  <option key={t} value={t}>{MARKETING_REQUEST_TYPE_LABEL[t]}</option>
                ))}
              </select>
              <button type="button" className={historyStyles.button} onClick={loadRequests}>Refresh</button>
            </div>
            <div className={historyStyles.status}>{status}</div>

            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Requested By</th>
                    <th>Timeline</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <MarketingRequestRow
                      key={r.id}
                      record={r}
                      currentUser={currentUser}
                      isReviewer={isReviewer}
                      onSetTimeline={handleSetTimeline}
                      onReject={handleReject}
                      onCancel={handleCancel}
                      onStart={handleStart}
                      onComplete={handleComplete}
                      onComment={handleComment}
                      onDelete={handleDelete}
                    />
                  ))}
                  {visible.length === 0 && (
                    <tr><td colSpan={8} className={historyStyles.empty}>No requests match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
    </AppShell>
  );
}

export default function MarketingRequestsView(props: MarketingRequestsViewProps) {
  return (
    <Suspense fallback={<AppShell title="Marketing Requests" subtitle="Ask Marketing for what you need, and track the delivery timeline they commit to.">{null}</AppShell>}>
      <MarketingRequestsViewContent {...props} />
    </Suspense>
  );
}
