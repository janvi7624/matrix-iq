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
import styles from './marketingRequests.module.css';
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
      className={styles.categoryBadge}
      style={{
        background: style.bg,
        color: style.text,
        borderColor: style.border
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
    <div className={styles.stepperCard}>
      <div className={styles.stepperTitle}>
        Workflow Progression (Requester ➔ Marketing ➔ Technical ➔ Marketing ➔ Requester)
      </div>
      <div className={styles.stepperRow}>
        {steps.map((s, idx) => {
          let colorClass = '';

          if (s.done) {
            colorClass = styles.stepBadgeDone;
          } else if (s.warning) {
            colorClass = styles.stepBadgeWarning;
          } else if (s.active) {
            colorClass = styles.stepBadgeActive;
          }

          return (
            <div key={s.label} className={styles.stepWrap}>
              <div
                className={`${styles.stepBadge} ${colorClass} ${s.active ? styles.stepBadgeBold : ''}`}
              >
                {s.done ? <Check size={13} /> : s.warning ? <AlertTriangle size={13} /> : s.active ? <Clock size={13} /> : <span className={styles.stepIndexNum}>{idx + 1}</span>}
                <div>
                  <div>{s.label}</div>
                  <div className={styles.stepSub}>{s.sub}</div>
                </div>
              </div>
              {idx < steps.length - 1 && <ArrowRight size={13} className={styles.stepArrowIcon} />}
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
      <tr onClick={() => setExpanded((v) => !v)} className={styles.clickableRow}>
        <td className={styles.titleCell}>
          <div className={calcStyles.inlineFlexGap6}>
            <span>{r.title}</span>
          </div>
          {r.description && (
            <div className={styles.descriptionPreview}>
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
            <span className={`${historyStyles.reminderBadge} ${styles.overdueInline}`}>
              <AlertTriangle size={12} /> Overdue
            </span>
          )}
        </td>
        <td>
          <span className={styles.creatorName}>{r.creator_name || r.created_by}</span>
        </td>
        <td>
          {r.assigned_to ? (
            <span className={styles.assignedToText}>{r.assigned_to_name || r.assigned_to}</span>
          ) : (
            <span className={styles.unassignedLabel}>Unassigned</span>
          )}
        </td>
        <td>
          {r.technical_member_name || r.technical_member_username ? (
            <span className={styles.technicalMemberText}>{r.technical_member_name || r.technical_member_username}</span>
          ) : (
            <span className={styles.noTechAssigned}>—</span>
          )}
        </td>
        <td className={styles.deadlineCell}>
          {formatDate(r.needed_by_date || r.created_at)}
          <div className={calcStyles.mt4}><ReminderBadge record={r} /></div>
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
            <div className={`${historyStyles.wideCellPin} ${styles.detailWrap}`}>
              {/* Visual Workflow Stepper */}
              <WorkflowStepper record={r} />

              {/* Assignment acceptance gate — the assigned member must confirm
                  availability before they can do any work on this request. */}
              {r.assignment_status === 'pending' && r.assigned_to === currentUser.username && (
                <div className={styles.acceptanceGate}>
                  <div>
                    <div className={styles.gateTitle}>
                      <AlertTriangle size={18} /> This request was assigned to you
                    </div>
                    <div className={styles.gateBody}>Confirm your availability before you start working on it.</div>
                  </div>
                  <div className={styles.gateActions}>
                    <Button variant="primary" compact loading={busy} onClick={handleAcceptAssignment}>Accept</Button>
                    <Button variant="danger" compact loading={busy} onClick={handleDeclineAssignment}>Decline</Button>
                  </div>
                </div>
              )}

              {/* 3-Way Context Summary Bar — uses the shared, already-responsive
                  summaryCardGrid container (2 columns at <=640px) instead of a
                  bare inline auto-fit/minmax grid with no mobile override;
                  each card keeps its own distinct inline background/border. */}
              <div className={`${historyStyles.summaryCardGrid} ${styles.contextGrid}`}>
                <div className={styles.contextCardRequester}>
                  <div className={styles.contextLabelSlate}>Original Requester</div>
                  <div className={styles.contextValueSlate}>{r.creator_name || r.created_by}</div>
                  <div className={styles.contextMetaSlate}>Created on {formatDate(r.created_at)}</div>
                </div>

                <div className={styles.contextCardMarketing}>
                  <div className={styles.contextLabelGreen}>Marketing Member</div>
                  <div className={styles.contextValueGreen}>{r.assigned_to_name || r.assigned_to || 'Unassigned'}</div>
                  <div className={styles.contextMetaGreen}>{r.status === 'submitted' ? 'Awaiting assignment/action' : 'Managing Request'}</div>
                </div>

                <div className={styles.contextCardTechnical}>
                  <div className={styles.contextLabelTeal}>Technical Reviewer</div>
                  <div className={styles.contextValueTeal}>{r.technical_member_name || r.technical_member_username || 'Not assigned yet'}</div>
                  <div className={styles.contextMetaTeal}>{r.technical_review_decision ? `Decision: ${r.technical_review_decision}` : 'Technical validation'}</div>
                </div>

                {marketingReminderBand(r) !== 'none' && (
                  <div className={styles.contextCardReminder}>
                    <div className={styles.contextLabelOrange}>Reminder Status</div>
                    <div className={calcStyles.mt4}><ReminderBadge record={r} /></div>
                    {marketingReminderBand(r) === 'overdue' && (
                      <div className={styles.contextMetaOrange}>Overdue by {daysOverdue(r)} day{daysOverdue(r) === 1 ? '' : 's'}</div>
                    )}
                  </div>
                )}
              </div>

              {/* SECTION 1: Original Request Details */}
              <div className={`${calcStyles.sectionPanel} ${calcStyles.mb14}`}>
                <div className={styles.rowHeaderBetween}>
                  <div className={calcStyles.inlineFlexGap8}>
                    <Megaphone size={16} className={styles.iconBlue} />
                    <span className={styles.sectionTitle14}>Original Requirement</span>
                  </div>
                  <ProductCategoryBadge category={r.product_category} />
                </div>

                <div className={styles.originalReqBody}>
                  {r.description}
                </div>

                {r.additional_info && (
                  <div className={styles.additionalInfoBox}>
                    <strong>Additional Information:</strong> {r.additional_info}
                  </div>
                )}

                {r.project_id && (
                  <div className={styles.linkedProjectLine}>
                    <strong>Linked Sales Project:</strong> <Link href={`/projects/${r.project_id}`}>{r.project_id}</Link>
                  </div>
                )}

                {r.attachments && r.attachments.length > 0 && (
                  <div className={calcStyles.mt8}>
                    <div className={styles.attachmentsLabel}>Requester Attachments:</div>
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
                <div className={`${styles.warningBanner} ${calcStyles.mb14}`}>
                  <div className={styles.warningBannerTitle}>
                    <AlertTriangle size={18} /> Technical Feedback: Changes Requested
                  </div>
                  <div className={styles.warningBannerBody}>
                    {r.technical_remarks || 'Please review and update the content per technical requirements.'}
                  </div>
                  <div className={styles.warningBannerFooter}>
                    Feedback provided by <strong>{r.technical_reviewed_by || r.technical_member_username}</strong> on {formatDateTime(r.technical_reviewed_at)}. Marketing member will apply changes and deliver the final result.
                  </div>
                </div>
              )}

              {r.status === 'technical_approved' && (
                <div className={`${styles.successBanner} ${calcStyles.mb14}`}>
                  <div className={styles.successBannerTitle}>
                    <CheckCircle2 size={18} /> Technical Review Approved!
                  </div>
                  <div className={styles.successBannerBody}>
                    {r.technical_remarks ? `Technical notes: "${r.technical_remarks}"` : 'The technical specification and materials have been approved.'}
                  </div>
                  <div className={styles.successBannerFooter}>
                    Approved by <strong>{r.technical_reviewed_by || r.technical_member_username}</strong> on {formatDateTime(r.technical_reviewed_at)}. Marketing member can now complete final delivery to {r.created_by}.
                  </div>
                </div>
              )}

              {/* SECTION 3: Marketing Workspace (Step 2 & 3: Prepare content, remarks, & send to Technical) */}
              {(r.status === 'submitted' || r.status === 'marketing_in_progress' || r.status === 'tech_changes_requested') && (
                <>
                  {canAccessMarketingWorkspace && (
                    <div className={`${calcStyles.sectionPanel} ${calcStyles.mb14} ${styles.workspaceAccent}`}>
                      <div className={styles.workspaceHeaderRow}>
                        <div className={calcStyles.inlineFlexGap8}>
                          <Wrench size={16} className={styles.iconBlue} />
                          <span className={styles.sectionTitle14}>Marketing Workspace — Prepare &amp; Coordinate</span>
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
                      <div className={styles.workspaceFieldSpacer}>
                        <label className={calcStyles.label}>Marketing Prepared Attachments / Collateral</label>
                        <input
                          ref={mktFileInputRef}
                          type="file"
                          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                          multiple
                          className={calcStyles.hidden}
                          onChange={(e) => handleMarketingFileUpload(e.target.files)}
                        />
                        <div className={calcStyles.inlineFlexGap8}>
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
                          <div className={`${historyStyles.imageStrip} ${calcStyles.mt8}`}>
                            {marketingFiles.map((url) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <div key={url} className={styles.attachmentThumbWrap}>
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
                      <div className={styles.workspaceActionBar}>
                        <div>
                          {r.technical_member_name || r.technical_member_username ? (
                            <div className={styles.techVerifierAssigned}>
                              <CheckCircle2 size={16} /> Technical Verifier: <strong>{r.technical_member_name || r.technical_member_username}</strong>
                            </div>
                          ) : (
                            <div className={styles.techVerifierPending}>
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
                    <div className={`${styles.lockedPanel} ${calcStyles.mb14}`}>
                      <div className={styles.lockedPanelTitle}>
                        <Lock size={16} className={styles.lockIconColor} /> Assigned to Marketing Member: {r.assigned_to_name || r.assigned_to}
                      </div>
                      <div className={styles.lockedPanelBody}>
                        This workspace is currently being handled by <strong>{r.assigned_to_name || r.assigned_to}</strong>, who will coordinate directly with the Technical Team.
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Display Marketing Prepared Content (Read Only when in later stages) */}
              {r.status !== 'submitted' && r.status !== 'marketing_in_progress' && r.marketing_prepared_content && (
                <div className={`${calcStyles.sectionPanel} ${calcStyles.mb14}`}>
                  <div className={styles.readOnlyContentTitle}>
                    Prepared Content by Marketing ({r.assigned_to_name || r.assigned_to || 'Marketing'})
                  </div>
                  <div className={styles.readOnlyContentBody}>
                    {r.marketing_prepared_content}
                  </div>
                  {r.marketing_remarks && (
                    <div className={styles.readOnlyRemark}>
                      <strong>Marketing Remarks:</strong> {r.marketing_remarks}
                    </div>
                  )}
                  {r.technical_instructions && (
                    <div className={styles.readOnlyInstructions}>
                      <strong>Instructions for Technical:</strong> {r.technical_instructions}
                    </div>
                  )}
                  {r.marketing_attachments && r.marketing_attachments.length > 0 && (
                    <div className={calcStyles.mt8}>
                      <div className={styles.attachmentsLabel}>Marketing Collateral / Attachments:</div>
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
                <div className={`${styles.techReviewBox} ${calcStyles.mb14}`}>
                  <div className={styles.rowHeaderBetween}>
                    <div className={styles.techReviewHeaderLeft}>
                      <UserCheck size={18} /> Step 4 — Technical Team Review
                    </div>
                    <div className={styles.techReviewAssignedTo}>
                      Assigned To: {r.technical_member_name || r.technical_member_username}
                    </div>
                  </div>

                  <p className={styles.techReviewIntro}>
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
                    <div className={styles.changesDialogBox}>
                      <label className={`${calcStyles.label} ${styles.changesDialogLabel}`}>
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
                      <div className={`${historyStyles.actionGroupButtons} ${calcStyles.mt10}`}>
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
                    <div className={`${styles.finalSubmissionBox} ${calcStyles.mb14}`}>
                      <div className={styles.finalSubmissionHeader}>
                        <Sparkles size={18} /> Step 7 — Final Submission to Original Requester ({r.creator_name || r.created_by})
                      </div>
                      <p className={styles.finalSubmissionIntro}>
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

                      <div className={calcStyles.mb12}>
                        <label className={calcStyles.label}>Final Deliverable Files / Assets</label>
                        <input
                          ref={finalFileInputRef}
                          type="file"
                          accept="image/*,.pdf,.zip,.doc,.docx"
                          multiple
                          className={calcStyles.hidden}
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
                          <div className={`${historyStyles.imageStrip} ${calcStyles.mt8}`}>
                            {finalFiles.map((url) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <div key={url} className={styles.attachmentThumbWrap}>
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
                    <div className={`${styles.finalAwaitingBox} ${calcStyles.mb14}`}>
                      <div className={styles.finalAwaitingTitle}>
                        <Sparkles size={16} /> Awaiting Final Delivery by {r.assigned_to_name || r.assigned_to}
                      </div>
                      <div className={styles.finalAwaitingBody}>
                        Assigned marketing member <strong>{r.assigned_to_name || r.assigned_to}</strong> will deliver the final collateral directly to {r.creator_name || r.created_by}.
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* SECTION 6: Completed Deliverables Display (For Requester & all) */}
              {r.status === 'completed' && (
                <div className={`${styles.completedBox} ${calcStyles.mb14}`}>
                  <div className={styles.successBannerTitle}>
                    <CheckCircle2 size={18} /> Request Completed &amp; Delivered to {r.creator_name || r.created_by}
                  </div>
                  {r.final_submission_notes && (
                    <div className={styles.completedDeliveryMsg}>
                      <strong>Delivery Message:</strong> {r.final_submission_notes}
                    </div>
                  )}
                  {r.final_submission_files && r.final_submission_files.length > 0 && (
                    <div className={calcStyles.mt10}>
                      <div className={styles.completedDeliverablesLabel}>Final Deliverables:</div>
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
                <div className={`${calcStyles.sectionPanel} ${calcStyles.mt14} ${calcStyles.mb14} ${styles.managerPanelAccent}`}>
                  <div className={styles.managerPanelTitle}>
                    <UserCheck size={16} className={styles.iconBlue} /> Manager Team Assignments
                  </div>
                  <div className={`${calcStyles.row} ${calcStyles.columns} ${calcStyles.mb0}`}>
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
              <div className={styles.commentsSection}>
                <div className={styles.commentsHeader}>
                  <MessageSquare size={15} /> Discussion &amp; Remarks Timeline ({r.comments?.length || 0})
                </div>
                {(!r.comments || r.comments.length === 0) && (
                  <div className={`${calcStyles.small} ${styles.noCommentsNote}`}>
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
                        <div className={styles.commentBody}>{c.text}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className={styles.commentInputRow}>
                  <input
                    className={`${calcStyles.formControl} ${styles.commentInputFlex}`}
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
                <div className={styles.deleteSection}>
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
          {/* Triage & Stage Quick Metric Cards — shared quickActionGrid
              container for the same reason as the summary bar above: gets
              the existing <=640px 2-column override for free. */}
          <div className={`${historyStyles.quickActionGrid} ${styles.metricGrid}`}>
            <button
              type="button"
              onClick={() => setTab('all')}
              className={`${calcStyles.sectionPanel} ${styles.metricCard} ${tab === 'all' ? styles.metricCardActiveBlue : ''}`}
            >
              <div className={styles.metricLabelDefault}>All Requests</div>
              <div className={styles.metricValueDefault}>{counts.all}</div>
            </button>

            <button
              type="button"
              onClick={() => setTab('marketing_queue')}
              className={`${calcStyles.sectionPanel} ${styles.metricCard} ${tab === 'marketing_queue' ? styles.metricCardActiveBlue : ''}`}
            >
              <div className={styles.metricLabelBlue}>Awaiting Marketing</div>
              <div className={styles.metricValueInfo}>{counts.marketingQueue}</div>
            </button>

            <button
              type="button"
              onClick={() => setTab('technical_review')}
              className={`${calcStyles.sectionPanel} ${styles.metricCard} ${tab === 'technical_review' ? styles.metricCardActiveTeal : ''}`}
            >
              <div className={styles.metricLabelTeal}>Pending Technical</div>
              <div className={styles.metricValueTeal}>{counts.technicalReview}</div>
            </button>

            <button
              type="button"
              onClick={() => setTab('ready_delivery')}
              className={`${calcStyles.sectionPanel} ${styles.metricCard} ${tab === 'ready_delivery' ? styles.metricCardActiveViolet : ''}`}
            >
              <div className={styles.metricLabelViolet}>Ready for Delivery</div>
              <div className={styles.metricValueViolet}>{counts.readyDelivery}</div>
            </button>

            <button
              type="button"
              onClick={() => setTab('completed')}
              className={`${calcStyles.sectionPanel} ${styles.metricCard} ${tab === 'completed' ? styles.metricCardActiveGreen : ''}`}
            >
              <div className={styles.metricLabelGreen}>Completed</div>
              <div className={styles.metricValueSuccess}>{counts.completed}</div>
            </button>

            <button
              type="button"
              onClick={() => setTab('my_requests')}
              className={`${calcStyles.sectionPanel} ${styles.metricCard} ${tab === 'my_requests' ? styles.metricCardActiveOrange : ''}`}
            >
              <div className={styles.metricLabelOrange}>My Requests</div>
              <div className={styles.metricValueOrange}>{counts.myRequests}</div>
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
              className={`${calcStyles.formControl} ${styles.selectAuto}`}
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
              className={`${calcStyles.formControl} ${styles.selectAuto}`}
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
            >
              <option value="">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            <label className={styles.dueOnlyLabel}>
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
              <RefreshCw size={14} className={styles.refreshIconSpacing} /> Refresh
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
