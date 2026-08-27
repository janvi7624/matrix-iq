'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Megaphone, CheckCircle2, AlertTriangle, Send, UserCheck, ShieldAlert,
  Clock, FileText, Paperclip, ChevronDown, ChevronUp, Trash2,
  Lock, ArrowRight, MessageSquare, Wrench, Sparkles, Check, X,
  ExternalLink, Layers, RefreshCw
} from 'lucide-react';
import {
  MARKETING_PRODUCT_CATEGORIES,
  MarketingProductCategory,
  MarketingRequestPriority,
  MarketingRequestRecord,
  MarketingRequestStatus,
  MarketingRequestType,
  UserRole
} from '@/lib/types';
import {
  MARKETING_PRIORITY_META,
  MARKETING_REQUEST_TYPE_LABEL,
  MARKETING_STATUS_LABEL,
  getProductCategoryStyle,
  isMarketingRequestOverdue
} from '@/lib/marketingRequestHelpers';
import { MarketingReminderBand, marketingReminderBand, daysOverdue } from '@/lib/marketingRequestReminder';
import { TechnicalRosterEntry } from '@/lib/technicalRoster';
import { MarketingRosterEntry } from '@/lib/marketingRoster';
import AppShell from './AppShell';
import MarketingRequestWizard, { MarketingRequestForm } from './MarketingRequestWizard';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { usePrompt } from './ui/PromptDialog';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import Button from './ui/Button';
import SharedStatusBadge, { StatusTone } from './ui/StatusBadge';
import SharedPriorityBadge, { PriorityTone } from './ui/PriorityBadge';

interface MarketingRequestsViewProps {
  currentUser: { id?: string; username: string; role: UserRole };
  isReviewer: boolean;
}

const STATUS_TONE: Record<MarketingRequestStatus, StatusTone> = {
  submitted: 'pending',
  approved: 'confirmed',
  marketing_in_progress: 'done',
  pending_technical_review: 'pending',
  technical_approved: 'confirmed',
  tech_changes_requested: 'rejected',
  marketing_final_review: 'done',
  completed: 'confirmed',
  timeline_set: 'done',
  in_progress: 'done',
  waiting_info: 'pending',
  ready_for_review: 'done',
  rejected: 'rejected',
  cancelled: 'cancelled'
};

const PRIORITY_TONE: Record<MarketingRequestPriority, PriorityTone> = {
  low: 'cool',
  medium: 'info',
  high: 'warm',
  urgent: 'hot'
};

function formatDate(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function PriorityBadge({ priority }: { priority: MarketingRequestPriority }) {
  const meta = MARKETING_PRIORITY_META[priority] || { label: priority };
  return <SharedPriorityBadge tone={PRIORITY_TONE[priority] || 'info'} label={meta.label} />;
}

// Reuses the same restrained 4-step badge component/palette as priority
// (cool -> info -> warm -> hot) instead of inventing new reminder colors.
const REMINDER_LABEL: Record<MarketingReminderBand, string> = {
  upcoming: 'Upcoming',
  due_soon: 'Due Soon',
  due_today: 'Due Today',
  overdue: 'Overdue',
  none: ''
};
const REMINDER_TONE: Record<MarketingReminderBand, PriorityTone> = {
  upcoming: 'cool',
  due_soon: 'info',
  due_today: 'warm',
  overdue: 'hot',
  none: 'cool'
};

function ReminderBadge({ record }: { record: Pick<MarketingRequestRecord, 'timeline' | 'needed_by_date' | 'status'> }) {
  const band = marketingReminderBand(record);
  if (band === 'none') return null;
  return <SharedPriorityBadge tone={REMINDER_TONE[band]} label={REMINDER_LABEL[band]} />;
}

function StatusBadge({ status }: { status: MarketingRequestStatus }) {
  return <SharedStatusBadge tone={STATUS_TONE[status] || 'pending'} label={MARKETING_STATUS_LABEL[status] || status} />;
}

function ProductCategoryBadge({ category }: { category: MarketingProductCategory }) {
  const style = getProductCategoryStyle(category);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 9px',
        borderRadius: 6,
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: '0.02em',
        background: style.bg,
        color: style.text,
        border: `1px solid ${style.border}`,
        whiteSpace: 'nowrap'
      }}
    >
      <Layers size={11} /> {category || 'Other'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Visual Workflow Stepper
// ---------------------------------------------------------------------------

function WorkflowStepper({ record: r }: { record: MarketingRequestRecord }) {
  const isSubmittedDone = r.status !== 'submitted';
  const isMarketingDone = ['pending_technical_review', 'technical_approved', 'tech_changes_requested', 'marketing_final_review', 'completed'].includes(r.status);
  const isTechnicalDone = ['technical_approved', 'tech_changes_requested', 'marketing_final_review', 'completed'].includes(r.status);
  const isChangesRequested = r.status === 'tech_changes_requested';
  const isCompleted = r.status === 'completed';

  const steps = [
    {
      label: 'Requester Submitted',
      sub: r.created_by,
      active: r.status === 'submitted',
      done: isSubmittedDone
    },
    {
      label: 'Marketing Prep',
      sub: r.assigned_to || 'Marketing Team',
      active: r.status === 'marketing_in_progress' || r.status === 'submitted',
      done: isMarketingDone
    },
    {
      label: 'Technical Review',
      sub: r.technical_member_name || r.technical_member_username || 'Tech Member',
      active: r.status === 'pending_technical_review',
      done: isTechnicalDone,
      warning: isChangesRequested
    },
    {
      label: isChangesRequested ? 'Changes Required' : 'Technical Approved',
      sub: isChangesRequested ? 'Needs Marketing Edits' : 'Validated',
      active: r.status === 'tech_changes_requested' || r.status === 'technical_approved',
      done: isTechnicalDone && !isChangesRequested,
      warning: isChangesRequested
    },
    {
      label: 'Final Delivery to Requester',
      sub: `Deliver to ${r.created_by}`,
      active: r.status === 'marketing_final_review' || (r.status === 'technical_approved' && !isCompleted),
      done: isCompleted
    },
    {
      label: 'Completed',
      sub: isCompleted ? 'Delivered' : 'Pending Delivery',
      active: isCompleted,
      done: isCompleted
    }
  ];

  return (
    <div style={{ margin: '14px 0 20px', background: '#f8fafc', padding: '14px 16px', borderRadius: 12, border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em', marginBottom: 10 }}>
        Workflow Progression (Requester ➔ Marketing ➔ Technical ➔ Marketing ➔ Requester)
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {steps.map((s, idx) => {
          let bg = '#f1f5f9';
          let fg = '#64748b';
          let border = '1px solid #e2e8f0';

          if (s.done) {
            bg = '#ecfdf5';
            fg = '#059669';
            border = '1px solid #a7f3d0';
          } else if (s.warning) {
            bg = '#fffbeb';
            fg = '#b45309';
            border = '1px solid #fde68a';
          } else if (s.active) {
            bg = '#eff6ff';
            fg = '#2563eb';
            border = '1.5px solid #93c5fd';
          }

          return (
            <div key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 10px',
                  borderRadius: 8,
                  background: bg,
                  color: fg,
                  border,
                  fontSize: 12,
                  fontWeight: s.active ? 700 : 600
                }}
              >
                {s.done ? <Check size={13} /> : s.warning ? <AlertTriangle size={13} /> : s.active ? <Clock size={13} /> : <span style={{ opacity: 0.5 }}>{idx + 1}</span>}
                <div>
                  <div>{s.label}</div>
                  <div style={{ fontSize: 10.5, opacity: 0.8, fontWeight: 500 }}>{s.sub}</div>
                </div>
              </div>
              {idx < steps.length - 1 && <ArrowRight size={13} style={{ color: '#cbd5e1' }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row Component & Workspace
// ---------------------------------------------------------------------------

interface RowProps {
  record: MarketingRequestRecord;
  currentUser: { id?: string; username: string; role: UserRole };
  isReviewer: boolean;
  technicalRoster: TechnicalRosterEntry[];
  marketingRoster: MarketingRosterEntry[];
  users: { id: string; username: string; name: string }[];
  onSendToTechnical: (id: string, payload: { technicalMemberId: string; marketingPreparedContent: string; marketingAttachments: string[]; marketingRemarks: string; technicalInstructions: string }) => Promise<void>;
  onTechnicalReview: (id: string, action: 'approve' | 'request_changes', remarks: string) => Promise<void>;
  onFinalSubmission: (id: string, payload: { finalSubmissionNotes: string; finalSubmissionFiles: string[]; marketingPreparedContent: string }) => Promise<void>;
  onStatusAction: (id: string, action: string, extra?: Record<string, unknown>) => Promise<void>;
  onAssign: (id: string, patch: { assigneeId?: string; technicalMemberId?: string }) => Promise<void>;
  onAcceptAssignment: (id: string) => Promise<void>;
  onDeclineAssignment: (id: string, reason: string) => Promise<void>;
  onComment: (id: string, text: string) => Promise<void>;
  onDelete: (record: MarketingRequestRecord) => Promise<void>;
}

function MarketingRequestRow({
  record: r,
  currentUser,
  isReviewer,
  technicalRoster,
  marketingRoster,
  users,
  onSendToTechnical,
  onTechnicalReview,
  onFinalSubmission,
  onStatusAction,
  onAssign,
  onAcceptAssignment,
  onDeclineAssignment,
  onComment,
  onDelete
}: RowProps) {
  const toast = useToast();
  const promptText = usePrompt();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commentText, setCommentText] = useState('');

  // Marketing Workspace form state
  const [marketingContent, setMarketingContent] = useState(r.marketing_prepared_content || '');
  const [marketingRemarks, setMarketingRemarks] = useState(r.marketing_remarks || '');
  const [technicalInstructions, setTechnicalInstructions] = useState(r.technical_instructions || '');
  const [marketingFiles, setMarketingFiles] = useState<string[]>(r.marketing_attachments || []);
  const [selectedTechMemberId, setSelectedTechMemberId] = useState(r.technical_member_id || '');
  const [uploadingMarketingFiles, setUploadingMarketingFiles] = useState(false);
  const mktFileInputRef = useRef<HTMLInputElement>(null);

  // Technical Review form state
  const [showTechChangesDialog, setShowTechChangesDialog] = useState(false);
  const [techRemarksInput, setTechRemarksInput] = useState('');

  // Final Submission form state
  const [finalNotes, setFinalNotes] = useState(r.final_submission_notes || '');
  const [finalFiles, setFinalFiles] = useState<string[]>(r.final_submission_files || []);
  const [uploadingFinalFiles, setUploadingFinalFiles] = useState(false);
  const finalFileInputRef = useRef<HTMLInputElement>(null);

  // Category-specific and workload-balanced technical roster
  const [categoryTechRoster, setCategoryTechRoster] = useState<TechnicalRosterEntry[]>([]);
  const [loadingCategoryTech, setLoadingCategoryTech] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setLoadingCategoryTech(true);
    const query = r.product_category ? `?category=${encodeURIComponent(r.product_category)}` : '';
    fetch(`/api/technical-roster${query}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: TechnicalRosterEntry[]) => {
        if (active) setCategoryTechRoster(data);
      })
      .catch(() => {
        if (active) setCategoryTechRoster(technicalRoster);
      })
      .finally(() => {
        if (active) setLoadingCategoryTech(false);
      });

    return () => {
      active = false;
    };
  }, [expanded, r.product_category, technicalRoster]);

  const effectiveTechList = categoryTechRoster.length > 0 ? categoryTechRoster : technicalRoster;
  const categoryMatchedList = effectiveTechList.filter((t) => t.categoryMatched);
  const otherTechList = effectiveTechList.filter((t) => !t.categoryMatched);

  const isOwner = Boolean(currentUser.username) && r.created_by.toLowerCase() === currentUser.username.toLowerCase();
  const isAssignedMarketing = Boolean(
    (r.assigned_to && currentUser.username && r.assigned_to.toLowerCase() === currentUser.username.toLowerCase()) ||
    (r.assigned_to_id && currentUser.id && r.assigned_to_id === currentUser.id)
  );
  const isUnassignedMarketing = !r.assigned_to && !r.assigned_to_id;
  const isSuperadmin = currentUser.role === 'superadmin' || currentUser.role === 'admin';
  const canAccessMarketingWorkspace = isAssignedMarketing || (isUnassignedMarketing && isReviewer) || isSuperadmin;
  const isMarketingAssignedToOther = !isAssignedMarketing && !isUnassignedMarketing && !isSuperadmin;

  const isAssignedTechnical = r.technical_member_username === currentUser.username || (currentUser.role === 'engineer' && r.status === 'pending_technical_review');
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

  async function handleMarketingFileUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadingMarketingFiles(true);
    try {
      const body = new FormData();
      body.append('folder', 'marketing-requests/prepared');
      Array.from(fileList).forEach((f) => body.append('files', f));
      const response = await fetch('/api/uploads', { method: 'POST', body });
      if (!response.ok) throw new Error(String(response.status));
      const data: { urls: string[] } = await response.json();
      setMarketingFiles((prev) => [...prev, ...data.urls]);
    } catch {
      toast.error('Could not upload one or more files.');
    } finally {
      setUploadingMarketingFiles(false);
    }
  }

  async function handleFinalFileUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadingFinalFiles(true);
    try {
      const body = new FormData();
      body.append('folder', 'marketing-requests/final');
      Array.from(fileList).forEach((f) => body.append('files', f));
      const response = await fetch('/api/uploads', { method: 'POST', body });
      if (!response.ok) throw new Error(String(response.status));
      const data: { urls: string[] } = await response.json();
      setFinalFiles((prev) => [...prev, ...data.urls]);
    } catch {
      toast.error('Could not upload one or more files.');
    } finally {
      setUploadingFinalFiles(false);
    }
  }

  function handleSendToTechnical() {
    const techId = r.technical_member_id || (r.technical_member_username ? technicalRoster.find((t) => t.username === r.technical_member_username)?.id : '');
    if (!techId) {
      toast.error('Technical Team member has not been assigned yet by the Marketing Manager.');
      return;
    }
    run(() =>
      onSendToTechnical(r.id, {
        technicalMemberId: techId,
        marketingPreparedContent: marketingContent,
        marketingAttachments: marketingFiles,
        marketingRemarks: marketingRemarks,
        technicalInstructions: technicalInstructions
      })
    );
  }

  function handleAcceptAssignment() {
    run(() => onAcceptAssignment(r.id));
  }

  async function handleDeclineAssignment() {
    const reason = await promptText({ title: 'Reason for declining this assignment:' });
    if (!reason || !reason.trim()) return;
    run(() => onDeclineAssignment(r.id, reason.trim()));
  }

  function handleApproveTechnical() {
    run(() => onTechnicalReview(r.id, 'approve', techRemarksInput));
  }

  function handleRequestChangesTechnical() {
    if (!techRemarksInput.trim()) {
      toast.error('Please provide technical remarks detailing the changes needed.');
      return;
    }
    run(async () => {
      await onTechnicalReview(r.id, 'request_changes', techRemarksInput);
      setShowTechChangesDialog(false);
    });
  }

  function handleDeliverToRequester() {
    run(() =>
      onFinalSubmission(r.id, {
        finalSubmissionNotes: finalNotes,
        finalSubmissionFiles: finalFiles,
        marketingPreparedContent: marketingContent
      })
    );
  }

  return (
    <>
      <tr onClick={() => setExpanded((v) => !v)} style={{ cursor: 'pointer' }}>
        <td style={{ fontWeight: 600 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{r.title}</span>
          </div>
          {r.description && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 280 }}>
              {r.description}
            </div>
          )}
        </td>
        <td>
          <ProductCategoryBadge category={r.product_category} />
        </td>
        <td>
          <PriorityBadge priority={r.priority} />
        </td>
        <td>
          <StatusBadge status={r.status} />
          {overdue && (
            <span className={historyStyles.reminderBadge} style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={12} /> Overdue
            </span>
          )}
        </td>
        <td>
          <span style={{ fontWeight: 600, color: '#0f172a' }}>{r.creator_name || r.created_by}</span>
        </td>
        <td>
          {r.assigned_to ? (
            <span style={{ color: '#2563eb', fontWeight: 500 }}>{r.assigned_to_name || r.assigned_to}</span>
          ) : (
            <span style={{ opacity: 0.5 }}>Unassigned</span>
          )}
        </td>
        <td>
          {r.technical_member_name || r.technical_member_username ? (
            <span style={{ color: '#0f766e', fontWeight: 500 }}>{r.technical_member_name || r.technical_member_username}</span>
          ) : (
            <span style={{ opacity: 0.4 }}>—</span>
          )}
        </td>
        <td style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
          {formatDate(r.needed_by_date || r.created_at)}
          <div style={{ marginTop: 4 }}><ReminderBadge record={r} /></div>
        </td>
        <td>
          <button type="button" className={historyStyles.toggleBtn} onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className={historyStyles.detailsRow}>
          <td colSpan={9}>
            <div className={historyStyles.wideCellPin} style={{ padding: '8px 4px', width: '100%' }}>
              {/* Visual Workflow Stepper */}
              <WorkflowStepper record={r} />

              {/* Assignment acceptance gate — the assigned member must confirm
                  availability before they can do any work on this request. */}
              {r.assignment_status === 'pending' && r.assigned_to === currentUser.username && (
                <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 10, padding: '14px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#1d4ed8', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                      <AlertTriangle size={18} /> This request was assigned to you
                    </div>
                    <div style={{ fontSize: 13, color: '#1e3a8a' }}>Confirm your availability before you start working on it.</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="primary" compact loading={busy} onClick={handleAcceptAssignment}>Accept</Button>
                    <Button variant="danger" compact loading={busy} onClick={handleDeclineAssignment}>Decline</Button>
                  </div>
                </div>
              )}

              {/* 3-Way Context Summary Bar */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 14 }}>
                <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Original Requester</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{r.creator_name || r.created_by}</div>
                  <div style={{ fontSize: 11.5, color: '#64748b' }}>Created on {formatDate(r.created_at)}</div>
                </div>

                <div style={{ background: '#f0fdf4', padding: '10px 14px', borderRadius: 8, border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>Marketing Member</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#14532d', marginTop: 2 }}>{r.assigned_to_name || r.assigned_to || 'Unassigned'}</div>
                  <div style={{ fontSize: 11.5, color: '#166534' }}>{r.status === 'submitted' ? 'Awaiting assignment/action' : 'Managing Request'}</div>
                </div>

                <div style={{ background: '#f0fdfa', padding: '10px 14px', borderRadius: 8, border: '1px solid #99f6e4' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#0f766e', textTransform: 'uppercase' }}>Technical Reviewer</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#134e4a', marginTop: 2 }}>{r.technical_member_name || r.technical_member_username || 'Not assigned yet'}</div>
                  <div style={{ fontSize: 11.5, color: '#0f766e' }}>{r.technical_review_decision ? `Decision: ${r.technical_review_decision}` : 'Technical validation'}</div>
                </div>

                {marketingReminderBand(r) !== 'none' && (
                  <div style={{ background: '#fff7ed', padding: '10px 14px', borderRadius: 8, border: '1px solid #fed7aa' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#9a3412', textTransform: 'uppercase' }}>Reminder Status</div>
                    <div style={{ marginTop: 4 }}><ReminderBadge record={r} /></div>
                    {marketingReminderBand(r) === 'overdue' && (
                      <div style={{ fontSize: 11.5, color: '#9a3412', marginTop: 4 }}>Overdue by {daysOverdue(r)} day{daysOverdue(r) === 1 ? '' : 's'}</div>
                    )}
                  </div>
                )}
              </div>

              {/* SECTION 1: Original Request Details */}
              <div className={calcStyles.sectionPanel} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Megaphone size={16} style={{ color: '#2563eb' }} />
                    <span style={{ fontWeight: 700, fontSize: 14 }}>Original Requirement</span>
                  </div>
                  <ProductCategoryBadge category={r.product_category} />
                </div>

                <div style={{ fontSize: 13.5, color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.5, marginBottom: 10 }}>
                  {r.description}
                </div>

                {r.additional_info && (
                  <div style={{ fontSize: 12.5, color: '#475569', background: '#f1f5f9', padding: '8px 12px', borderRadius: 6, marginBottom: 10 }}>
                    <strong>Additional Information:</strong> {r.additional_info}
                  </div>
                )}

                {r.project_id && (
                  <div style={{ fontSize: 12.5, marginBottom: 8 }}>
                    <strong>Linked Sales Project:</strong> <Link href={`/projects/${r.project_id}`}>{r.project_id}</Link>
                  </div>
                )}

                {r.attachments && r.attachments.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Requester Attachments:</div>
                    <div className={historyStyles.imageStrip}>
                      {r.attachments.map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a key={url} href={url} target="_blank" rel="noreferrer" title="Click to open file">
                          <img src={url} alt="Requester Attachment" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 2: Technical Review Banner / Feedback (if changes requested or approved) */}
              {r.status === 'tech_changes_requested' && (
                <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#b45309', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                    <AlertTriangle size={18} /> Technical Feedback: Changes Requested
                  </div>
                  <div style={{ fontSize: 13, color: '#78350f', background: 'rgba(255,255,255,0.7)', padding: '10px 12px', borderRadius: 6, border: '1px solid #fef3c7', whiteSpace: 'pre-wrap' }}>
                    {r.technical_remarks || 'Please review and update the content per technical requirements.'}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#92400e', marginTop: 6 }}>
                    Feedback provided by <strong>{r.technical_reviewed_by || r.technical_member_username}</strong> on {formatDateTime(r.technical_reviewed_at)}. Marketing member will apply changes and deliver the final result.
                  </div>
                </div>
              )}

              {r.status === 'technical_approved' && (
                <div style={{ background: '#ecfdf5', border: '1.5px solid #a7f3d0', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#047857', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                    <CheckCircle2 size={18} /> Technical Review Approved!
                  </div>
                  <div style={{ fontSize: 13, color: '#065f46' }}>
                    {r.technical_remarks ? `Technical notes: "${r.technical_remarks}"` : 'The technical specification and materials have been approved.'}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#047857', marginTop: 4 }}>
                    Approved by <strong>{r.technical_reviewed_by || r.technical_member_username}</strong> on {formatDateTime(r.technical_reviewed_at)}. Marketing member can now complete final delivery to {r.created_by}.
                  </div>
                </div>
              )}

              {/* SECTION 3: Marketing Workspace (Step 2 & 3: Prepare content, remarks, & send to Technical) */}
              {(r.status === 'submitted' || r.status === 'marketing_in_progress' || r.status === 'tech_changes_requested') && (
                <>
                  {canAccessMarketingWorkspace && (
                    <div className={calcStyles.sectionPanel} style={{ marginBottom: 14, borderLeft: '4px solid #2563eb' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Wrench size={16} style={{ color: '#2563eb' }} />
                          <span style={{ fontWeight: 700, fontSize: 14 }}>Marketing Workspace — Prepare &amp; Coordinate</span>
                        </div>
                        {r.status === 'submitted' && isUnassignedMarketing && (
                          <Button
                            variant="secondary"
                            compact
                            loading={busy}
                            onClick={() => run(() => onStatusAction(r.id, 'claim'))}
                          >
                            Claim &amp; Start Working
                          </Button>
                        )}
                      </div>

                      <div className={calcStyles.field}>
                        <label className={calcStyles.label}>Prepared Marketing Content / Draft</label>
                        <textarea
                          className={calcStyles.formControl}
                          rows={4}
                          placeholder="Write or paste the prepared copy, brochure draft text, headlines, product specs, or creative summary here..."
                          value={marketingContent}
                          onChange={(e) => setMarketingContent(e.target.value)}
                        />
                      </div>

                      <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                        <div className={calcStyles.field}>
                          <label className={calcStyles.label}>Marketing Remarks</label>
                          <input
                            className={calcStyles.formControl}
                            placeholder="e.g. Focused on retail clients; customized highlights"
                            value={marketingRemarks}
                            onChange={(e) => setMarketingRemarks(e.target.value)}
                          />
                        </div>
                        <div className={calcStyles.field}>
                          <label className={calcStyles.label}>Technical Instructions for Reviewer</label>
                          <input
                            className={calcStyles.formControl}
                            placeholder="e.g. Please verify AI camera specs and PoE requirements"
                            value={technicalInstructions}
                            onChange={(e) => setTechnicalInstructions(e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Marketing Attachments */}
                      <div style={{ marginTop: 10, marginBottom: 14 }}>
                        <label className={calcStyles.label}>Marketing Prepared Attachments / Collateral</label>
                        <input
                          ref={mktFileInputRef}
                          type="file"
                          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                          multiple
                          style={{ display: 'none' }}
                          onChange={(e) => handleMarketingFileUpload(e.target.files)}
                        />
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button
                            type="button"
                            className={calcStyles.secondaryButton}
                            disabled={uploadingMarketingFiles}
                            onClick={() => mktFileInputRef.current?.click()}
                          >
                            {uploadingMarketingFiles ? 'Uploading…' : '+ Attach Prepared File / Design'}
                          </button>
                        </div>

                        {marketingFiles.length > 0 && (
                          <div className={historyStyles.imageStrip} style={{ marginTop: 8 }}>
                            {marketingFiles.map((url) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <div key={url} style={{ position: 'relative', display: 'inline-block' }}>
                                <img
                                  src={url}
                                  alt="Marketing Attachment"
                                  title="Click to remove"
                                  onClick={() => setMarketingFiles((prev) => prev.filter((u) => u !== url))}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Marketing Workspace Action Bar */}
                      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                        <div>
                          {r.technical_member_name || r.technical_member_username ? (
                            <div style={{ fontSize: 13, color: '#0f766e', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <CheckCircle2 size={16} /> Technical Verifier: <strong>{r.technical_member_name || r.technical_member_username}</strong>
                            </div>
                          ) : (
                            <div style={{ fontSize: 12.5, color: '#b45309', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Clock size={15} /> Awaiting Manager to assign Technical Verifier below
                            </div>
                          )}
                        </div>
                        <Button
                          variant="primary"
                          icon={<Send size={14} />}
                          loading={busy}
                          loadingLabel="Sending…"
                          disabled={!r.technical_member_id && !r.technical_member_username}
                          onClick={handleSendToTechnical}
                        >
                          Send for Technical Verification
                        </Button>
                      </div>
                    </div>
                  )}

                  {isMarketingAssignedToOther && (
                    <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#334155', fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>
                        <Lock size={16} style={{ color: '#64748b' }} /> Assigned to Marketing Member: {r.assigned_to_name || r.assigned_to}
                      </div>
                      <div style={{ fontSize: 12.5, color: '#64748b' }}>
                        This workspace is currently being handled by <strong>{r.assigned_to_name || r.assigned_to}</strong>, who will coordinate directly with the Technical Team.
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Display Marketing Prepared Content (Read Only when in later stages) */}
              {r.status !== 'submitted' && r.status !== 'marketing_in_progress' && r.marketing_prepared_content && (
                <div className={calcStyles.sectionPanel} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                    Prepared Content by Marketing ({r.assigned_to_name || r.assigned_to || 'Marketing'})
                  </div>
                  <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                    {r.marketing_prepared_content}
                  </div>
                  {r.marketing_remarks && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                      <strong>Marketing Remarks:</strong> {r.marketing_remarks}
                    </div>
                  )}
                  {r.technical_instructions && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                      <strong>Instructions for Technical:</strong> {r.technical_instructions}
                    </div>
                  )}
                  {r.marketing_attachments && r.marketing_attachments.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Marketing Collateral / Attachments:</div>
                      <div className={historyStyles.imageStrip}>
                        {r.marketing_attachments.map((url) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a key={url} href={url} target="_blank" rel="noreferrer">
                            <img src={url} alt="Marketing Material" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 4: Technical Team Member Action Box (Step 4 & 5) */}
              {r.status === 'pending_technical_review' && (
                <div style={{ background: '#f0fdfa', border: '1.5px solid #99f6e4', borderRadius: 10, padding: '16px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0f766e', fontWeight: 700, fontSize: 14 }}>
                      <UserCheck size={18} /> Step 4 — Technical Team Review
                    </div>
                    <div style={{ fontSize: 12, color: '#0f766e', fontWeight: 600 }}>
                      Assigned To: {r.technical_member_name || r.technical_member_username}
                    </div>
                  </div>

                  <p style={{ fontSize: 13, color: '#134e4a', margin: '4px 0 12px' }}>
                    Review the product specification and marketing draft. You can either approve the request or send remarks back if changes are needed.
                  </p>

                  {(isAssignedTechnical || currentUser.role === 'engineer' || isReviewer) && !showTechChangesDialog && (
                    <div className={historyStyles.actionGroupButtons}>
                      <Button
                        variant="success"
                        icon={<Check size={14} />}
                        loading={busy}
                        loadingLabel="Approving…"
                        onClick={handleApproveTechnical}
                      >
                        Approve Request
                      </Button>
                      <Button
                        variant="danger"
                        icon={<AlertTriangle size={14} />}
                        onClick={() => setShowTechChangesDialog(true)}
                      >
                        Request Changes
                      </Button>
                    </div>
                  )}

                  {showTechChangesDialog && (
                    <div style={{ background: '#fff', padding: '12px', borderRadius: 8, border: '1px solid #fecdd3', marginTop: 10 }}>
                      <label className={calcStyles.label} style={{ color: '#be123c' }}>
                        Technical Remarks / Changes Needed *
                      </label>
                      <textarea
                        className={calcStyles.formControl}
                        rows={3}
                        placeholder="e.g. Please correct the product specification in the second paragraph and update the attached product data sheet."
                        value={techRemarksInput}
                        onChange={(e) => setTechRemarksInput(e.target.value)}
                        autoFocus
                      />
                      <div className={historyStyles.actionGroupButtons} style={{ marginTop: 10 }}>
                        <Button
                          variant="danger"
                          icon={<Send size={14} />}
                          loading={busy}
                          loadingLabel="Sending feedback…"
                          disabled={!techRemarksInput.trim()}
                          onClick={handleRequestChangesTechnical}
                        >
                          Submit Change Request to Marketing
                        </Button>
                        <Button variant="ghost" onClick={() => setShowTechChangesDialog(false)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* SECTION 5: Final Submission to Original Requester (Step 6 & 7) */}
              {(r.status === 'technical_approved' || r.status === 'marketing_final_review' || r.status === 'tech_changes_requested') && (
                <>
                  {canAccessMarketingWorkspace && (
                    <div style={{ background: '#faf5ff', border: '1.5px solid #e9d5ff', borderRadius: 10, padding: '16px', marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#7e22ce', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                        <Sparkles size={18} /> Step 7 — Final Submission to Original Requester ({r.creator_name || r.created_by})
                      </div>
                      <p style={{ fontSize: 12.5, color: '#6b21a8', margin: '0 0 10px' }}>
                        Deliver the finalized marketing collateral directly to <strong>{r.creator_name || r.created_by}</strong> to complete this request.
                      </p>

                      <div className={calcStyles.field}>
                        <label className={calcStyles.label}>Final Delivery Notes / Message to Requester</label>
                        <textarea
                          className={calcStyles.formControl}
                          rows={2}
                          placeholder="e.g. Here is your final approved brochure and high-resolution print files. Let us know if you need further adjustments."
                          value={finalNotes}
                          onChange={(e) => setFinalNotes(e.target.value)}
                        />
                      </div>

                      <div style={{ marginBottom: 12 }}>
                        <label className={calcStyles.label}>Final Deliverable Files / Assets</label>
                        <input
                          ref={finalFileInputRef}
                          type="file"
                          accept="image/*,.pdf,.zip,.doc,.docx"
                          multiple
                          style={{ display: 'none' }}
                          onChange={(e) => handleFinalFileUpload(e.target.files)}
                        />
                        <button
                          type="button"
                          className={calcStyles.secondaryButton}
                          disabled={uploadingFinalFiles}
                          onClick={() => finalFileInputRef.current?.click()}
                        >
                          {uploadingFinalFiles ? 'Uploading…' : '+ Add Final Deliverable File(s)'}
                        </button>

                        {finalFiles.length > 0 && (
                          <div className={historyStyles.imageStrip} style={{ marginTop: 8 }}>
                            {finalFiles.map((url) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <div key={url} style={{ position: 'relative', display: 'inline-block' }}>
                                <img
                                  src={url}
                                  alt="Final File"
                                  title="Click to remove"
                                  onClick={() => setFinalFiles((prev) => prev.filter((u) => u !== url))}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <Button
                        variant="success"
                        icon={<CheckCircle2 size={15} />}
                        loading={busy}
                        loadingLabel="Delivering…"
                        onClick={handleDeliverToRequester}
                      >
                        Complete &amp; Deliver to {r.creator_name || r.created_by}
                      </Button>
                    </div>
                  )}

                  {isMarketingAssignedToOther && (
                    <div style={{ background: '#faf5ff', border: '1.5px solid #e9d5ff', borderRadius: 10, padding: '14px 16px', marginBottom: 14 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#7e22ce', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={16} /> Awaiting Final Delivery by {r.assigned_to_name || r.assigned_to}
                      </div>
                      <div style={{ fontSize: 12.5, color: '#6b21a8', marginTop: 4 }}>
                        Assigned marketing member <strong>{r.assigned_to_name || r.assigned_to}</strong> will deliver the final collateral directly to {r.creator_name || r.created_by}.
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* SECTION 6: Completed Deliverables Display (For Requester & all) */}
              {r.status === 'completed' && (
                <div style={{ background: '#ecfdf5', border: '1.5px solid #a7f3d0', borderRadius: 10, padding: '16px', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#047857', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                    <CheckCircle2 size={18} /> Request Completed &amp; Delivered to {r.creator_name || r.created_by}
                  </div>
                  {r.final_submission_notes && (
                    <div style={{ fontSize: 13, color: '#065f46', marginTop: 4 }}>
                      <strong>Delivery Message:</strong> {r.final_submission_notes}
                    </div>
                  )}
                  {r.final_submission_files && r.final_submission_files.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#047857', marginBottom: 4 }}>Final Deliverables:</div>
                      <div className={historyStyles.imageStrip}>
                        {r.final_submission_files.map((url) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <a key={url} href={url} target="_blank" rel="noreferrer" title="Open deliverable">
                            <img src={url} alt="Deliverable" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Assignment Controls for Marketing Manager / Reviewer */}
              {isReviewer && (
                <div className={calcStyles.sectionPanel} style={{ marginTop: 14, marginBottom: 14, background: '#f8fafc', border: '1.5px solid #e2e8f0' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <UserCheck size={16} style={{ color: '#2563eb' }} /> Manager Team Assignments
                  </div>
                  <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 0 }}>
                    <div className={calcStyles.field}>
                      <label className={calcStyles.label}>Marketing Assignee</label>
                      <select
                        className={calcStyles.formControl}
                        disabled={busy}
                        value={r.assigned_to_id || marketingRoster.find((u) => u.username === r.assigned_to)?.id || users.find((u) => u.username === r.assigned_to)?.id || ''}
                        onChange={(e) => run(() => onAssign(r.id, { assigneeId: e.target.value }))}
                      >
                        <option value="">— Unassigned in Marketing —</option>
                        {marketingRoster.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name || u.username} ({u.username})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={calcStyles.field}>
                      <label className={calcStyles.label}>
                        Technical Member for Verification ({r.product_category ? `${r.product_category} Specialist` : 'Technical'})
                      </label>
                      <select
                        className={calcStyles.formControl}
                        disabled={busy}
                        value={r.technical_member_id || technicalRoster.find((t) => t.username === r.technical_member_username)?.id || ''}
                        onChange={(e) => run(() => onAssign(r.id, { technicalMemberId: e.target.value }))}
                      >
                        <option value="">— Select Technical Verifier —</option>
                        {categoryMatchedList.length > 0 && (
                          <optgroup label={`🌟 ${r.product_category} Specialists (Recommended)`}>
                            {categoryMatchedList.map((t) => {
                              const tasks = t.pendingTasksCount ?? 0;
                              const taskLabel = tasks === 0 ? '0 pending tasks' : `${tasks} pending task${tasks === 1 ? '' : 's'}`;
                              const recLabel = t.isRecommended ? ' ★ Lowest Workload' : '';
                              return (
                                <option key={t.id} value={t.id}>
                                  {t.name} ({t.department || 'Technical'}) • {taskLabel}{recLabel}
                                </option>
                              );
                            })}
                          </optgroup>
                        )}
                        {otherTechList.length > 0 && (
                          <optgroup label={categoryMatchedList.length > 0 ? 'Other Technical Team Members' : 'All Technical Members'}>
                            {otherTechList.map((t) => {
                              const tasks = t.pendingTasksCount ?? 0;
                              const taskLabel = tasks === 0 ? '0 pending tasks' : `${tasks} pending task${tasks === 1 ? '' : 's'}`;
                              return (
                                <option key={t.id} value={t.id}>
                                  {t.name} ({t.department || 'Technical'}) • {taskLabel}
                                </option>
                              );
                            })}
                          </optgroup>
                        )}
                        {categoryMatchedList.length === 0 && otherTechList.length === 0 && (
                          technicalRoster.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.department || 'Technical'})
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* SECTION 7: Comments & Collaboration Timeline */}
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13.5, color: '#334155', marginBottom: 8 }}>
                  <MessageSquare size={15} /> Discussion &amp; Remarks Timeline ({r.comments?.length || 0})
                </div>
                {(!r.comments || r.comments.length === 0) && (
                  <div className={calcStyles.small} style={{ color: '#94a3b8', fontStyle: 'italic' }}>
                    No comments yet. Anyone involved can leave a message.
                  </div>
                )}
                {r.comments && r.comments.length > 0 && (
                  <div className={historyStyles.timeline}>
                    {r.comments.map((c) => (
                      <div key={c.id} className={historyStyles.timelineEntry}>
                        <div className={historyStyles.timelineMeta}>
                          <strong>{c.by}</strong> · {formatDateTime(c.at)}
                        </div>
                        <div style={{ marginTop: 2, fontSize: 13 }}>{c.text}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <input
                    className={calcStyles.formControl}
                    style={{ flex: '1 1 240px' }}
                    placeholder="Add a remark or question…"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && commentText.trim()) {
                        onComment(r.id, commentText);
                        setCommentText('');
                      }
                    }}
                  />
                  <Button
                    variant="secondary"
                    compact
                    disabled={!commentText.trim()}
                    onClick={() => {
                      onComment(r.id, commentText);
                      setCommentText('');
                    }}
                  >
                    Post Comment
                  </Button>
                </div>
              </div>

              {canDelete && (
                <div style={{ marginTop: 18, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
                  <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => onDelete(r)}>
                    Delete Request
                  </Button>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Marketing Requests View Component
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'marketing_queue' | 'technical_review' | 'ready_delivery' | 'completed' | 'my_requests';

function MarketingRequestsViewContent({ currentUser, isReviewer }: MarketingRequestsViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const startFilter = searchParams.get('filter');

  const [mode, setMode] = useState<'new' | 'list'>('list');
  const [tab, setTab] = useState<FilterTab>(startFilter === 'submitted' ? 'marketing_queue' : 'all');
  const [requests, setRequests] = useState<MarketingRequestRecord[]>([]);
  const [technicalRoster, setTechnicalRoster] = useState<TechnicalRosterEntry[]>([]);
  const [marketingRoster, setMarketingRoster] = useState<MarketingRosterEntry[]>([]);
  const [users, setUsers] = useState<{ id: string; username: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  // Deep-linked from the Dashboard/sidebar's "due today or overdue" count (?filter=due).
  const [dueOnly, setDueOnly] = useState(startFilter === 'due');

  async function loadRequests() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/marketing-requests');
      if (!response.ok) throw new Error(String(response.status));
      const data: MarketingRequestRecord[] = await response.json();
      setRequests(data);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequests();
    fetch('/api/technical-roster').then((r) => (r.ok ? r.json() : [])).then(setTechnicalRoster).catch(() => setTechnicalRoster([]));
    fetch('/api/marketing-roster').then((r) => (r.ok ? r.json() : [])).then(setMarketingRoster).catch(() => setMarketingRoster([]));
    fetch('/api/users/lite').then((r) => (r.ok ? r.json() : [])).then(setUsers).catch(() => setUsers([]));
  }, []);

  const counts = useMemo(() => {
    return {
      all: requests.length,
      marketingQueue: requests.filter((r) => r.status === 'submitted' || r.status === 'marketing_in_progress' || r.status === 'tech_changes_requested').length,
      technicalReview: requests.filter((r) => r.status === 'pending_technical_review').length,
      readyDelivery: requests.filter((r) => r.status === 'technical_approved' || r.status === 'marketing_final_review').length,
      completed: requests.filter((r) => r.status === 'completed').length,
      myRequests: requests.filter((r) => r.created_by === currentUser.username).length
    };
  }, [requests, currentUser.username]);

  const visible = useMemo(() => {
    let rows = requests;

    // Tab filter
    if (tab === 'marketing_queue') {
      rows = rows.filter((r) => r.status === 'submitted' || r.status === 'marketing_in_progress' || r.status === 'tech_changes_requested');
    } else if (tab === 'technical_review') {
      rows = rows.filter((r) => r.status === 'pending_technical_review');
    } else if (tab === 'ready_delivery') {
      rows = rows.filter((r) => r.status === 'technical_approved' || r.status === 'marketing_final_review');
    } else if (tab === 'completed') {
      rows = rows.filter((r) => r.status === 'completed');
    } else if (tab === 'my_requests') {
      rows = rows.filter((r) => r.created_by === currentUser.username);
    }

    // Category filter
    if (categoryFilter) {
      rows = rows.filter((r) => r.product_category === categoryFilter);
    }

    // Priority filter
    if (priorityFilter) {
      rows = rows.filter((r) => r.priority === priorityFilter);
    }

    // Due today or overdue only
    if (dueOnly) {
      rows = rows.filter((r) => {
        const band = marketingReminderBand(r);
        return band === 'due_today' || band === 'overdue';
      });
    }

    // Search query
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          `${r.title} ${r.description} ${r.created_by} ${r.creator_name || ''} ${r.assigned_to || ''} ${r.technical_member_name || ''} ${r.product_category || ''}`
            .toLowerCase()
            .includes(needle)
      );
    }

    return [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [requests, tab, categoryFilter, priorityFilter, dueOnly, q, currentUser.username]);

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
        toast.error(body?.error || 'Could not submit request.');
        return null;
      }
      const created: MarketingRequestRecord = await response.json();
      setRequests((prev) => [created, ...prev]);
      toast.success('Marketing request submitted!');
      return created;
    } catch {
      toast.error('Could not reach the server.');
      return null;
    } finally {
      setCreating(false);
    }
  }

  async function postAction(url: string, body: unknown, successMessage?: string) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      toast.error(errBody?.error || 'That action could not be completed.');
      return;
    }
    const updated: MarketingRequestRecord = await response.json();
    replaceRecord(updated);
    if (successMessage) toast.success(successMessage);
  }

  async function handleSendToTechnical(
    id: string,
    payload: { technicalMemberId: string; marketingPreparedContent: string; marketingAttachments: string[]; marketingRemarks: string; technicalInstructions: string }
  ) {
    await postAction(`/api/marketing-requests/${id}/send-to-technical`, payload, 'Request sent to Technical Team member.');
  }

  async function handleTechnicalReview(id: string, action: 'approve' | 'request_changes', remarks: string) {
    await postAction(
      `/api/marketing-requests/${id}/technical-review`,
      { action, remarks },
      action === 'approve' ? 'Technical review approved!' : 'Changes requested and sent to Marketing.'
    );
  }

  async function handleFinalSubmission(
    id: string,
    payload: { finalSubmissionNotes: string; finalSubmissionFiles: string[]; marketingPreparedContent: string }
  ) {
    await postAction(`/api/marketing-requests/${id}/final-submission`, payload, 'Delivered to requester and marked completed!');
  }

  async function handleStatusAction(id: string, action: string, extra?: Record<string, unknown>) {
    await postAction(`/api/marketing-requests/${id}/status`, { action, ...extra }, 'Status updated.');
  }

  async function handleAssign(id: string, patch: { assigneeId?: string; technicalMemberId?: string }) {
    await postAction(`/api/marketing-requests/${id}/assign`, patch, 'Assignments updated.');
  }

  async function handleAcceptAssignment(id: string) {
    await postAction(`/api/marketing-requests/${id}/accept-assignment`, {}, 'Assignment accepted.');
  }

  async function handleDeclineAssignment(id: string, reason: string) {
    await postAction(`/api/marketing-requests/${id}/decline-assignment`, { reason }, 'Assignment declined.');
  }

  async function handleComment(id: string, text: string) {
    await postAction(`/api/marketing-requests/${id}/comments`, { text });
  }

  async function handleDelete(record: MarketingRequestRecord) {
    if (!(await confirm({ message: `Delete "${record.title}"? This cannot be undone.`, danger: true }))) return;
    const response = await fetch(`/api/marketing-requests/${record.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toast.error('Could not delete request.');
      return;
    }
    setRequests((prev) => prev.filter((r) => r.id !== record.id));
    toast.success('Request deleted.');
  }

  return (
    <AppShell
      title="Marketing Request Workflow"
      subtitle="Collaborative marketing collateral pipeline: Requester ➔ Marketing ➔ Technical Review ➔ Final Delivery."
    >
      {/* Top Header Mode Toggle */}
      <div className={historyStyles.modeToggle}>
        <button
          type="button"
          className={`${historyStyles.modeToggleBtn} ${mode === 'new' ? historyStyles.modeToggleBtnActive : ''}`}
          onClick={() => setMode('new')}
        >
          + New Marketing Request
        </button>
        <button
          type="button"
          className={`${historyStyles.modeToggleBtn} ${mode === 'list' ? historyStyles.modeToggleBtnActive : ''}`}
          onClick={() => { setMode('list'); loadRequests(); }}
        >
          Workflow Board ({requests.length})
        </button>
      </div>

      {mode === 'new' && (
        <MarketingRequestWizard
          creating={creating}
          onSubmit={handleSubmitRequest}
          onViewAllRequests={() => setMode('list')}
        />
      )}

      {mode === 'list' && (
        <>
          {/* Triage & Stage Quick Metric Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => setTab('all')}
              className={calcStyles.sectionPanel}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                border: tab === 'all' ? '2px solid #2563eb' : '1px solid #e2e8f0',
                background: tab === 'all' ? '#eff6ff' : '#ffffff'
              }}
            >
              <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>All Requests</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{counts.all}</div>
            </button>

            <button
              type="button"
              onClick={() => setTab('marketing_queue')}
              className={calcStyles.sectionPanel}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                border: tab === 'marketing_queue' ? '2px solid #2563eb' : '1px solid #e2e8f0',
                background: tab === 'marketing_queue' ? '#eff6ff' : '#ffffff'
              }}
            >
              <div style={{ fontSize: 11.5, color: '#2563eb', fontWeight: 700 }}>Awaiting Marketing</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#1d4ed8' }}>{counts.marketingQueue}</div>
            </button>

            <button
              type="button"
              onClick={() => setTab('technical_review')}
              className={calcStyles.sectionPanel}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                border: tab === 'technical_review' ? '2px solid #0f766e' : '1px solid #e2e8f0',
                background: tab === 'technical_review' ? '#f0fdfa' : '#ffffff'
              }}
            >
              <div style={{ fontSize: 11.5, color: '#0f766e', fontWeight: 700 }}>Pending Technical</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#0f766e' }}>{counts.technicalReview}</div>
            </button>

            <button
              type="button"
              onClick={() => setTab('ready_delivery')}
              className={calcStyles.sectionPanel}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                border: tab === 'ready_delivery' ? '2px solid #7c3aed' : '1px solid #e2e8f0',
                background: tab === 'ready_delivery' ? '#faf5ff' : '#ffffff'
              }}
            >
              <div style={{ fontSize: 11.5, color: '#7c3aed', fontWeight: 700 }}>Ready for Delivery</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#6d28d9' }}>{counts.readyDelivery}</div>
            </button>

            <button
              type="button"
              onClick={() => setTab('completed')}
              className={calcStyles.sectionPanel}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                border: tab === 'completed' ? '2px solid #16a34a' : '1px solid #e2e8f0',
                background: tab === 'completed' ? '#f0fdf4' : '#ffffff'
              }}
            >
              <div style={{ fontSize: 11.5, color: '#16a34a', fontWeight: 700 }}>Completed</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#15803d' }}>{counts.completed}</div>
            </button>

            <button
              type="button"
              onClick={() => setTab('my_requests')}
              className={calcStyles.sectionPanel}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                border: tab === 'my_requests' ? '2px solid #ea580c' : '1px solid #e2e8f0',
                background: tab === 'my_requests' ? '#fff7ed' : '#ffffff'
              }}
            >
              <div style={{ fontSize: 11.5, color: '#ea580c', fontWeight: 700 }}>My Requests</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#c2410c' }}>{counts.myRequests}</div>
            </button>
          </div>

          {/* Search & Filter Toolbar */}
          <div className={historyStyles.toolbar}>
            <input
              type="text"
              placeholder="Search title, category, requester, marketing, technical..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <select
              className={calcStyles.formControl}
              style={{ width: 'auto' }}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Product Categories</option>
              {MARKETING_PRODUCT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>

            <select
              className={calcStyles.formControl}
              style={{ width: 'auto' }}
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              <option value="">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} />
              Due today or overdue
            </label>

            {(categoryFilter || priorityFilter || dueOnly || q) && (
              <button
                type="button"
                className={historyStyles.button}
                onClick={() => {
                  setCategoryFilter('');
                  setPriorityFilter('');
                  setDueOnly(false);
                  setQ('');
                }}
              >
                Clear Filters
              </button>
            )}

            <button type="button" className={historyStyles.button} onClick={loadRequests}>
              <RefreshCw size={14} style={{ marginRight: 4 }} /> Refresh
            </button>
          </div>

          {/* Table Wrap */}
          {loading ? (
            <div className={historyStyles.tableWrap}>
              <SkeletonRows rows={8} columns={9} />
            </div>
          ) : loadFailed ? (
            <ErrorState
              message="Could not load marketing requests. Please check your connection."
              onRetry={loadRequests}
            />
          ) : (
            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    <th>Request Title &amp; Details</th>
                    <th>Product Category</th>
                    <th>Priority</th>
                    <th>Workflow Status</th>
                    <th>Requester</th>
                    <th>Marketing Member</th>
                    <th>Technical Reviewer</th>
                    <th>Deadline</th>
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
                      technicalRoster={technicalRoster}
                      marketingRoster={marketingRoster}
                      users={users}
                      onSendToTechnical={handleSendToTechnical}
                      onTechnicalReview={handleTechnicalReview}
                      onFinalSubmission={handleFinalSubmission}
                      onStatusAction={handleStatusAction}
                      onAssign={handleAssign}
                      onAcceptAssignment={handleAcceptAssignment}
                      onDeclineAssignment={handleDeclineAssignment}
                      onComment={handleComment}
                      onDelete={handleDelete}
                    />
                  ))}
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={9}>
                        <EmptyState
                          icon={Megaphone}
                          title={requests.length === 0 ? 'No marketing requests yet' : 'No requests match your current filter'}
                          message={
                            requests.length === 0
                              ? 'Submit a marketing collateral request to get started.'
                              : 'Try changing your search term or tab filter.'
                          }
                          action={
                            requests.length === 0 ? (
                              <button type="button" className={calcStyles.btn} onClick={() => setMode('new')}>
                                + New Marketing Request
                              </button>
                            ) : undefined
                          }
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}

export default function MarketingRequestsView(props: MarketingRequestsViewProps) {
  return (
    <Suspense
      fallback={
        <AppShell title="Marketing Requests" subtitle="Loading marketing workflow...">
          {null}
        </AppShell>
      }
    >
      <MarketingRequestsViewContent {...props} />
    </Suspense>
  );
}
