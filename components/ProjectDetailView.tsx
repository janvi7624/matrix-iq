'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRightLeft,
  FileText,
  Handshake,
  Lock,
  MapPin,
  MessageSquare,
  Monitor,
  MoreVertical,
  Package,
  Paperclip,
  Receipt,
  StickyNote,
  Users,
  Wrench,
  Clock
} from 'lucide-react';
import {
  CustomerResponseRecord,
  DeliveryChallanRecord,
  DemoScheduleRecord,
  InstallationRecord,
  MarketingRequestRecord,
  NegotiationRecord,
  PoRecord,
  ProjectPriority,
  ProjectRecord,
  ProjectStage,
  ProjectStatus,
  QuotationRecord,
  SiteVisitRecord,
  UserRole,
  ProjectHandoverRecord
} from '@/lib/types';
import { FORWARD_STAGES, STAGE_LABEL, stageProgressPercent } from '@/lib/projectStages';
import { TechnicalRosterEntry } from '@/lib/technicalRoster';
import { DOMAIN_DISPLAY_NAME } from '@/lib/domainLabels';
import { STAGE_LABEL as VISIT_STAGE_LABEL } from '@/lib/siteVisitReminder';
import { parseFollowUpNotes } from '@/lib/followUp';
import { exportListToPdf } from '@/lib/exportPdf';
import { MARKETING_STATUS_LABEL } from '@/lib/marketingRequestHelpers';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import { todayDateInputValue } from '@/lib/dateHelpers';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';

interface DetailResponse {
  project: ProjectRecord;
  siteVisits: SiteVisitRecord[];
  quotations: QuotationRecord[];
  demos: DemoScheduleRecord[];
  responses: CustomerResponseRecord[];
  negotiations: NegotiationRecord[];
  purchaseOrders: PoRecord[];
  installations: InstallationRecord[];
  deliveryChallans: DeliveryChallanRecord[];
  marketingRequests: MarketingRequestRecord[];
}

const STATUS_LABEL: Record<ProjectStatus, string> = { active: 'Active', on_hold: 'On Hold', won: 'Won', lost: 'Lost' };
const PRIORITY_LABEL: Record<ProjectPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'timeline', label: 'Timeline' },
  { key: 'quotations', label: 'Quotations' },
  { key: 'siteVisits', label: 'Site Visits' },
  { key: 'demo', label: 'Demo' },
  { key: 'responses', label: 'Customer Responses' },
  { key: 'negotiations', label: 'Negotiations' },
  { key: 'dc', label: 'Delivery Challans' },
  { key: 'marketing', label: 'Marketing Requests' },
  { key: 'po', label: 'Purchase Orders' },
  { key: 'installation', label: 'Installation' },
  { key: 'documents', label: 'Documents' },
  { key: 'activity', label: 'Activity Logs' },
  { key: 'notes', label: 'Notes' }
] as const;
type TabKey = (typeof TABS)[number]['key'];

const DC_STATUS_LABEL: Record<DeliveryChallanRecord['status'], string> = { prepared: 'Prepared', dispatched: 'Dispatched', returned: 'Returned', closed: 'Closed' };

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

const EMPTY_NEGOTIATION = { discussionDate: '', person: '', discussion: '', offerGiven: '', discount: '', revisedPrice: '', expectedClosure: '' };
const EMPTY_PO = { poNumber: '', poDate: '', amount: '', advanceReceived: '', paymentTerms: '' };
const EMPTY_INSTALLATION = { installationDate: '', assignedEngineer: '' };
const EMPTY_RESPONSE = { feedback: '', responseType: '' as CustomerResponseRecord['response_type'], expectedDecisionDate: '', remarks: '' };

interface ProjectDetailViewProps {
  projectId: string;
  currentUser: { username: string; role: UserRole };
}

export default function ProjectDetailView({ projectId, currentUser }: ProjectDetailViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';
  const [data, setData] = useState<DetailResponse | null>(null);
  const [status, setStatus] = useState('Loading...');
  const [tab, setTab] = useState<TabKey>('overview');
  const [showMoreActions, setShowMoreActions] = useState(false);
  const [remarkText, setRemarkText] = useState('');
  const [savingRemark, setSavingRemark] = useState(false);

  const [negForm, setNegForm] = useState(EMPTY_NEGOTIATION);
  const [poForm, setPoForm] = useState(EMPTY_PO);
  const [instForm, setInstForm] = useState(EMPTY_INSTALLATION);
  const [respForm, setRespForm] = useState(EMPTY_RESPONSE);
  const [busySection, setBusySection] = useState('');
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [technicalRoster, setTechnicalRoster] = useState<TechnicalRosterEntry[]>([]);
  const [showHandover, setShowHandover] = useState(false);
  const [handoverToUserId, setHandoverToUserId] = useState('');
  const [handoverRemarks, setHandoverRemarks] = useState('');
  const [submittingHandover, setSubmittingHandover] = useState(false);
  const [allUsers, setAllUsers] = useState<{ id: string; username: string; name: string }[]>([]);
  const [pendingHandover, setPendingHandover] = useState<ProjectHandoverRecord | null>(null);
  const [handoverLogs, setHandoverLogs] = useState<ProjectHandoverRecord[]>([]);
  const [respondingHandover, setRespondingHandover] = useState(false);
  const [showDeclineForm, setShowDeclineForm] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [showHandoverHistory, setShowHandoverHistory] = useState(false);

  useEffect(() => {
    fetch('/api/technical-roster')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: TechnicalRosterEntry[]) => setTechnicalRoster(rows))
      .catch(() => setTechnicalRoster([]));
  }, []);

  // Fetch users for the handover dropdown (server filters by department rules)
  useEffect(() => {
    fetch('/api/users/list?scope=handover')
      .then((r) => (r.ok ? r.json() : []))
      .then((users: { id: string; username: string; name: string }[]) => setAllUsers(users))
      .catch(() => setAllUsers([]));
  }, []);

  // Check for pending handover requests on this project
  function loadHandoverStatus() {
    fetch(`/api/projects/${projectId}/handover`)
      .then((r) => (r.ok ? r.json() : []))
      .then((requests: ProjectHandoverRecord[]) => {
        const pending = requests.find((r) => r.status === 'pending');
        setPendingHandover(pending || null);
        setHandoverLogs(requests);
      })
      .catch(() => { setPendingHandover(null); setHandoverLogs([]); });
  }
  useEffect(() => { loadHandoverStatus(); }, [projectId]);

  async function submitHandover() {
    if (!handoverToUserId) { toast.error('Please select a person'); return; }
    setSubmittingHandover(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/handover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toUserId: handoverToUserId, remarks: handoverRemarks.trim() })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        toast.error(err.error || 'Failed to send handover request');
        return;
      }
      toast.success('Handover request sent! Waiting for approval.');
      setShowHandover(false);
      setHandoverToUserId('');
      setHandoverRemarks('');
      loadHandoverStatus();
    } catch {
      toast.error('Network error');
    } finally {
      setSubmittingHandover(false);
    }
  }

  async function respondToHandover(approved: boolean, responseRemarks: string) {
    if (!pendingHandover) return;
    setRespondingHandover(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/handover/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoverRequestId: pendingHandover.id, approved, responseRemarks })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        toast.error(err.error || 'Failed to respond');
        return;
      }
      toast.success(approved ? 'Handover accepted! Project transferred to you.' : 'Handover declined.');
      loadHandoverStatus();
      if (approved) load();
    } catch {
      toast.error('Network error');
    } finally {
      setRespondingHandover(false);
    }
  }

  async function load() {
    setStatus('Loading...');
    try {
      const response = await fetch(`/api/projects/${projectId}`);
      if (response.status === 404) {
        setStatus('This project could not be found — it may have been deleted.');
        return;
      }
      if (response.status === 403) {
        setStatus('You do not have permission to view this project.');
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const json: DetailResponse = await response.json();
      setData(json);
      setStatus('');
    } catch {
      setStatus('Could not load this project. Try refreshing.');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const canEdit = useMemo(() => isPrivileged || data?.project.created_by === currentUser.username, [isPrivileged, data, currentUser.username]);

  async function patchProject(patch: Record<string, unknown>) {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      if (!response.ok) throw new Error(String(response.status));
      await load();
    } catch {
      toast.error('Could not save this change. Please try again.');
    }
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSavingNote(true);
    try {
      await patchProject({ action: 'addNote', text: noteText });
      setNoteText('');
    } finally {
      setSavingNote(false);
    }
  }

  async function handleUploadAttachment(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadingAttachment(true);
    try {
      const body = new FormData();
      body.append('folder', 'project');
      Array.from(fileList).forEach((f) => body.append('files', f));
      const response = await fetch('/api/uploads', { method: 'POST', body });
      if (!response.ok) throw new Error(String(response.status));
      const uploaded: { urls: string[] } = await response.json();
      await patchProject({ action: 'addAttachment', urls: uploaded.urls });
    } catch {
      toast.error('Could not upload one or more attachments.');
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleAddRemark(e: FormEvent) {
    e.preventDefault();
    if (!remarkText.trim()) return;
    setSavingRemark(true);
    try {
      await patchProject({ action: 'addRemark', remarks: remarkText });
      setRemarkText('');
    } finally {
      setSavingRemark(false);
    }
  }

  async function handleAddNegotiation(e: FormEvent) {
    e.preventDefault();
    if (!negForm.discussionDate) {
      toast.error('Discussion date is required.');
      return;
    }
    setBusySection('negotiation');
    try {
      const response = await fetch('/api/negotiation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...negForm, revisedPrice: Number(negForm.revisedPrice) || 0 })
      });
      if (!response.ok) throw new Error(String(response.status));
      setNegForm(EMPTY_NEGOTIATION);
      await load();
    } catch {
      toast.error('Could not save this negotiation entry.');
    } finally {
      setBusySection('');
    }
  }

  async function handleDeleteNegotiation(id: string) {
    if (!(await confirm({ message: 'Delete this negotiation entry?', danger: true }))) return;
    await fetch(`/api/negotiation/${id}`, { method: 'DELETE' });
    await load();
  }

  async function handleAddPo(e: FormEvent) {
    e.preventDefault();
    if (!poForm.poNumber.trim()) {
      toast.error('PO number is required.');
      return;
    }
    setBusySection('po');
    try {
      const response = await fetch('/api/po', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...poForm, amount: Number(poForm.amount) || 0, advanceReceived: Number(poForm.advanceReceived) || 0 })
      });
      if (!response.ok) throw new Error(String(response.status));
      setPoForm(EMPTY_PO);
      await load();
    } catch {
      toast.error('Could not save this PO.');
    } finally {
      setBusySection('');
    }
  }

  async function handleDeletePo(id: string) {
    if (!(await confirm({ message: 'Delete this PO?', danger: true }))) return;
    await fetch(`/api/po/${id}`, { method: 'DELETE' });
    await load();
  }

  async function handleAddInstallation(e: FormEvent) {
    e.preventDefault();
    if (!instForm.installationDate) {
      toast.error('Installation date is required.');
      return;
    }
    setBusySection('installation');
    try {
      const response = await fetch('/api/installation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...instForm })
      });
      if (!response.ok) throw new Error(String(response.status));
      setInstForm(EMPTY_INSTALLATION);
      await load();
    } catch {
      toast.error('Could not save this installation.');
    } finally {
      setBusySection('');
    }
  }

  async function handleInstallationStatus(id: string, statusValue: InstallationRecord['status']) {
    await fetch(`/api/installation/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: statusValue })
    });
    await load();
  }

  async function handleAddResponse(e: FormEvent) {
    e.preventDefault();
    setBusySection('response');
    try {
      const response = await fetch('/api/customer-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ...respForm })
      });
      if (!response.ok) throw new Error(String(response.status));
      setRespForm(EMPTY_RESPONSE);
      await load();
    } catch {
      toast.error('Could not save this response.');
    } finally {
      setBusySection('');
    }
  }

  function handleExportPdf() {
    if (!data) return;
    exportListToPdf(
      `Project ${data.project.id} — Activity Timeline`,
      ['Date', 'Stage', 'Event', 'By', 'Remarks'],
      data.project.timeline.map((t) => [formatDateTime(t.at), STAGE_LABEL[t.stage as ProjectStage] || t.stage, t.label, t.by, t.remarks]),
      `project-${data.project.id}-timeline.pdf`
    );
  }

  async function handleAssignTeam() {
    if (!data) return;
    const next = window.prompt('Sales person for this project:', data.project.sales_person);
    if (next === null || !next.trim()) return;
    await patchProject({ salesPerson: next.trim() });
  }

  async function handleCloseProject() {
    if (!data) return;
    const outcome = window.prompt('Close this project as "won" or "lost"? Type won or lost:', 'won');
    if (!outcome) return;
    const normalized = outcome.trim().toLowerCase();
    if (normalized !== 'won' && normalized !== 'lost') {
      toast.error('Please type exactly "won" or "lost".');
      return;
    }
    if (!(await confirm({ message: `Close this project as ${normalized === 'won' ? 'Won' : 'Closed Lost'}? This updates the final stage.`, danger: true }))) return;
    await patchProject({ stage: normalized === 'won' ? 'completed' : 'closed_lost' });
  }

  if (status && !data) {
    return (
      <AppShell title="Project Detail" subtitle="Loading…">
          <div className={historyStyles.status}>{status}</div>
          <Link className={historyStyles.button} href="/projects">&larr; All Projects</Link>
      </AppShell>
    );
  }
  if (!data) return null;

  const { project, siteVisits, quotations, demos, responses, negotiations, purchaseOrders, installations, deliveryChallans, marketingRequests } = data;
  const currentIdx = FORWARD_STAGES.indexOf(project.stage);
  const isClosed = project.stage === 'closed_lost' || project.status === 'lost' || project.stage === 'completed';
  const isOverdue = !isClosed && !!project.next_follow_up_date && project.next_follow_up_date < new Date().toISOString().slice(0, 10);
  const progressPercent = project.status === 'lost' ? 100 : stageProgressPercent(project.stage);
  const totalPoAmount = purchaseOrders.reduce((sum, po) => sum + po.amount, 0);
  const totalAdvance = purchaseOrders.reduce((sum, po) => sum + po.advance_received, 0);
  const followUps = quotations
    .flatMap((q) => parseFollowUpNotes(q.follow_up_notes_json).map((n) => ({ ...n, quotationNumber: q.quotation_number })))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
  const latestQuotation = [...quotations].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  const latestDemo = [...demos].sort((a, b) => (a.scheduled_at < b.scheduled_at ? 1 : -1))[0];
  const technicalTeam = [...new Set([...demos.flatMap((d) => d.technical_members), ...demos.map((d) => d.assigned_technical_person), ...siteVisits.flatMap((v) => v.team_technical)].filter(Boolean))];
  const salesTeam = [...new Set([project.sales_person, ...siteVisits.flatMap((v) => v.team_sales)].filter(Boolean))];
  const lastActivity = [...project.timeline].sort((a, b) => (a.at < b.at ? 1 : -1))[0];

  return (
    <AppShell title={project.client_name || project.company || `Project ${project.id}`} subtitle={`Project ${project.id} — the central workspace for this deal.`}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <Link className={historyStyles.button} href="/projects">&larr; All Projects</Link>
          <button type="button" className={historyStyles.button} onClick={handleExportPdf}>Export Timeline PDF</button>
          <button type="button" className={historyStyles.button} onClick={() => window.print()}>Print</button>
        </div>

        {/* Header summary: name / ID / client / sales person / stage / status / progress% */}
        <div className={historyStyles.detailPanel} style={{ marginTop: 0 }}>
          <div className={historyStyles.projectHeaderTop}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{project.client_name || project.company || 'Unnamed client'}</div>
              <div className={historyStyles.projectHeaderMeta}>
                {/* <span>ID: <strong>{project.id}</strong></span> */}
                <span>Client: <strong>{project.client_name || '-'}</strong></span>
                <span>Sales Person: <strong>{project.sales_person}</strong></span>
                <span>Stage: <strong>{STAGE_LABEL[project.stage]}</strong></span>
                <span>Status: <strong>{STATUS_LABEL[project.status]}</strong></span>
              </div>
            </div>
            <div className={historyStyles.projectProgressRing}>
              <div className={historyStyles.projectProgressRingValue}>{progressPercent}%</div>
              <div className={historyStyles.projectProgressRingLabel}>Progress</div>
            </div>
          </div>
        </div>

        {/* Project Progress Timeline — green done, blue current, grey pending, red delayed */}
        <h2 className={calcStyles.h2}>Project Progress</h2>
        <div className={historyStyles.progressTrack}>
          <div
            className={`${historyStyles.progressFill} ${project.status === 'lost' ? historyStyles.progressFillLost : ''}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className={historyStyles.stepper}>
          {isClosed && project.stage === 'closed_lost' ? (
            <span className={`${historyStyles.step} ${historyStyles.stepLost}`}>✕ Closed Lost</span>
          ) : (
            FORWARD_STAGES.map((s, idx) => {
              const cls =
                idx < currentIdx ? historyStyles.stepDone : idx === currentIdx ? (isOverdue ? historyStyles.stepDelayed : historyStyles.stepCurrent) : '';
              return (
                <span key={s} className={`${historyStyles.step} ${cls}`}>
                  {idx < currentIdx ? '✓ ' : idx === currentIdx && isOverdue ? <AlertTriangle size={14} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} /> : ''}
                  {STAGE_LABEL[s]}
                </span>
              );
            })
          )}
        </div>

        {/* Summary cards */}
        <div className={historyStyles.summaryCardGrid}>
          <div className={historyStyles.summaryCard}>
            <div className={historyStyles.summaryCardLabel}>Client Details</div>
            <div className={historyStyles.summaryCardValue}>{project.company || '-'}</div>
            <div className={calcStyles.small}>{project.contact_person || '-'} · {project.phone || '-'}</div>
          </div>
          <div className={historyStyles.summaryCard}>
            <div className={historyStyles.summaryCardLabel}>Sales Team</div>
            <div className={historyStyles.summaryCardValue}>{salesTeam.length ? salesTeam.join(', ') : '-'}</div>
          </div>
          <div className={historyStyles.summaryCard}>
            <div className={historyStyles.summaryCardLabel}>Assigned Technical Team</div>
            <div className={historyStyles.summaryCardValue}>{technicalTeam.length ? technicalTeam.join(', ') : 'Unassigned'}</div>
          </div>
          <div className={historyStyles.summaryCard}>
            <div className={historyStyles.summaryCardLabel}>Quotation Amount</div>
            <div className={historyStyles.summaryCardValue}>{latestQuotation ? `₹${latestQuotation.total.toLocaleString('en-IN')}` : '-'}</div>
          </div>
          <div className={historyStyles.summaryCard}>
            <div className={historyStyles.summaryCardLabel}>Expected Closure</div>
            <div className={historyStyles.summaryCardValue}>{formatDate(project.expected_closing_date)}</div>
          </div>
          <div className={historyStyles.summaryCard}>
            <div className={historyStyles.summaryCardLabel}>Priority</div>
            <div className={historyStyles.summaryCardValue}>{PRIORITY_LABEL[project.priority]}</div>
          </div>
          <div className={historyStyles.summaryCard}>
            <div className={historyStyles.summaryCardLabel}>Last Activity</div>
            <div className={historyStyles.summaryCardValue}>{lastActivity ? lastActivity.label : '-'}</div>
            <div className={calcStyles.small}>{lastActivity ? formatDateTime(lastActivity.at) : ''}</div>
          </div>
          <div className={historyStyles.summaryCard} style={{ borderColor: isOverdue ? '#dc2626' : undefined }}>
            <div className={historyStyles.summaryCardLabel}>Next Follow-up</div>
            <div className={historyStyles.summaryCardValue} style={{ color: isOverdue ? '#b91c1c' : undefined }}>
              {formatDate(project.next_follow_up_date)}{isOverdue ? ' (overdue)' : ''}
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <h2 className={calcStyles.h2}>Quick Actions</h2>
        <div className={historyStyles.quickActionGrid}>
          <Link href={`/site-visits?projectId=${project.id}`} className={historyStyles.quickActionBtn}>
            <span className={historyStyles.quickActionIcon}><MapPin size={20} /></span> New Site Visit
          </Link>
          <Link href={`/quotation?projectId=${project.id}`} className={historyStyles.quickActionBtn}>
            <span className={historyStyles.quickActionIcon}><Receipt size={20} /></span> New Quotation
          </Link>
          <Link href={`/demo-schedule?projectId=${project.id}`} className={historyStyles.quickActionBtn}>
            <span className={historyStyles.quickActionIcon}><Monitor size={20} /></span> Schedule Demo
          </Link>
          {/* Below ~480px this second group collapses behind "More actions"
              — the 3 buttons above (start something new) stay immediately
              visible; the rest (in-page tab shortcuts + admin actions) don't
              need to fight for space on a phone screen by default. */}
          <div className={`${historyStyles.quickActionOverflow} ${showMoreActions ? historyStyles.quickActionOverflowOpen : ''}`}>
            <button type="button" className={historyStyles.quickActionBtn} onClick={() => setTab('responses')}>
              <span className={historyStyles.quickActionIcon}><MessageSquare size={20} /></span> Customer Response
            </button>
            <button type="button" className={historyStyles.quickActionBtn} onClick={() => setTab('negotiations')}>
              <span className={historyStyles.quickActionIcon}><Handshake size={20} /></span> Negotiation
            </button>
            <Link
              href={latestDemo ? `/backoffice?demoId=${latestDemo.id}` : '#'}
              className={historyStyles.quickActionBtn}
              aria-disabled={!latestDemo}
              onClick={(e) => { if (!latestDemo) { e.preventDefault(); toast.error('Schedule a demo first — a Delivery Challan is generated from an approved demo request.'); } }}
            >
              <span className={historyStyles.quickActionIcon}><Package size={20} /></span> Generate DC
            </Link>
            <button type="button" className={historyStyles.quickActionBtn} onClick={() => setTab('po')}>
              <span className={historyStyles.quickActionIcon}><FileText size={20} /></span> Upload PO
            </button>
            <button type="button" className={historyStyles.quickActionBtn} onClick={() => setTab('installation')}>
              <span className={historyStyles.quickActionIcon}><Wrench size={20} /></span> Installation
            </button>
            <button type="button" className={historyStyles.quickActionBtn} onClick={() => setTab('activity')}>
              <span className={historyStyles.quickActionIcon}><Clock size={20} /></span> Add Follow-up
            </button>
            <button type="button" className={historyStyles.quickActionBtn} onClick={() => setTab('notes')}>
              <span className={historyStyles.quickActionIcon}><StickyNote size={20} /></span> Add Notes
            </button>
            <button type="button" className={historyStyles.quickActionBtn} onClick={() => setTab('documents')}>
              <span className={historyStyles.quickActionIcon}><Paperclip size={20} /></span> Upload Documents
            </button>
            {canEdit && (
              <button type="button" className={historyStyles.quickActionBtn} onClick={handleAssignTeam}>
                <span className={historyStyles.quickActionIcon}><Users size={20} /></span> Assign Team
              </button>
            )}
            {canEdit && !isClosed && !pendingHandover && (
              <button type="button" className={historyStyles.quickActionBtn} onClick={() => setShowHandover(true)}>
                <span className={historyStyles.quickActionIcon}><ArrowRightLeft size={20} /></span> Handover Project
              </button>
            )}
            {canEdit && !isClosed && (
              <button type="button" className={`${historyStyles.quickActionBtn} ${historyStyles.quickActionDanger}`} onClick={handleCloseProject}>
                <span className={historyStyles.quickActionIcon}><Lock size={20} /></span> Close Project
              </button>
            )}
          </div>
          <button type="button" className={historyStyles.quickActionMoreBtn} onClick={() => setShowMoreActions((v) => !v)} aria-expanded={showMoreActions}>
            <span className={historyStyles.quickActionIcon}><MoreVertical size={20} /></span> {showMoreActions ? 'Fewer actions' : 'More actions'}
          </button>
        </div>

        {/* Pending handover banner — shown to the recipient */}
        {pendingHandover && pendingHandover.to_username === currentUser.username && (
          <div className={calcStyles.sectionPanel} style={{ marginBottom: 16, borderLeft: '3px solid #f59e0b', background: '#fffbeb', padding: 16, borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8, color: '#92400e' }}>
              Handover Request
            </div>
            <div style={{ fontSize: 14, marginBottom: 12, color: '#78350f' }}>
              <strong>{pendingHandover.from_name || pendingHandover.from_username}</strong> wants to hand over this project to you.
              {pendingHandover.remarks && <div style={{ marginTop: 6, padding: '8px 12px', background: '#fef3c7', borderRadius: 6, fontSize: 13 }}>Remarks: {pendingHandover.remarks}</div>}
            </div>

            {!showDeclineForm ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 500 }}
                  disabled={respondingHandover}
                  onClick={() => respondToHandover(true, '')}
                >
                  Accept
                </button>
                <button
                  style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 500 }}
                  disabled={respondingHandover}
                  onClick={() => setShowDeclineForm(true)}
                >
                  Decline
                </button>
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #fbbf24', borderRadius: 8, padding: 14 }}>
                <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 14, color: '#92400e' }}>Reason for declining</div>
                <textarea
                  className={calcStyles.formControl}
                  rows={3}
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Please provide a reason for declining this handover..."
                  style={{ marginBottom: 10 }}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 500 }}
                    disabled={respondingHandover || !declineReason.trim()}
                    onClick={() => {
                      respondToHandover(false, declineReason.trim());
                      setShowDeclineForm(false);
                      setDeclineReason('');
                    }}
                  >
                    {respondingHandover ? 'Submitting...' : 'Submit Decline'}
                  </button>
                  <button
                    style={{ background: '#e5e7eb', color: '#374151', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer' }}
                    onClick={() => { setShowDeclineForm(false); setDeclineReason(''); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pending handover info — shown to the sender */}
        {pendingHandover && pendingHandover.from_username === currentUser.username && (
          <div className={calcStyles.sectionPanel} style={{ marginBottom: 16, borderLeft: '3px solid #3b82f6', background: '#eff6ff', padding: 16, borderRadius: 8 }}>
            <div style={{ fontSize: 14, color: '#1e40af', marginBottom: 10 }}>
              Handover request sent to <strong>{pendingHandover.to_name || pendingHandover.to_username}</strong> — waiting for their response.
            </div>
            <button
              style={{ background: '#dc2626', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              disabled={respondingHandover}
              onClick={async () => {
                const ok = await confirm({ message: 'Cancel this handover request?', danger: true });
                if (!ok) return;
                setRespondingHandover(true);
                try {
                  const res = await fetch(`/api/projects/${projectId}/handover/cancel`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ handoverRequestId: pendingHandover.id })
                  });
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: 'Failed' }));
                    toast.error(err.error || 'Failed to cancel');
                    return;
                  }
                  toast.success('Handover request cancelled.');
                  loadHandoverStatus();
                } catch { toast.error('Network error'); } finally { setRespondingHandover(false); }
              }}
            >
              Cancel Request
            </button>
          </div>
        )}

        {/* Handover modal */}
        {showHandover && (
          <div className={calcStyles.sectionPanel} style={{ marginBottom: 16, borderLeft: '3px solid #6366f1', padding: 16, borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 12 }}>Handover Project</div>
            <div className={calcStyles.field} style={{ marginBottom: 12 }}>
              <label className={calcStyles.label}>Hand over to</label>
              <select className={calcStyles.formControl} value={handoverToUserId} onChange={(e) => setHandoverToUserId(e.target.value)}>
                <option value="">-- Select person --</option>
                {allUsers
                  .filter((u) => u.username !== currentUser.username)
                  .map((u) => {
                    const dept = (u as any).department;
                    return <option key={u.id} value={u.id}>{u.name || u.username}{dept ? ` (${dept})` : ''}</option>;
                  })}
              </select>
            </div>
            <div className={calcStyles.field} style={{ marginBottom: 12 }}>
              <label className={calcStyles.label}>Remarks (optional)</label>
              <textarea className={calcStyles.formControl} rows={3} value={handoverRemarks} onChange={(e) => setHandoverRemarks(e.target.value)} placeholder="Reason for handover..." />
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: handoverLogs.length > 0 ? 14 : 0 }}>
              <button
                style={{ background: '#6366f1', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontWeight: 500 }}
                disabled={submittingHandover || !handoverToUserId}
                onClick={submitHandover}
              >
                {submittingHandover ? 'Sending...' : 'Send Request'}
              </button>
              <button
                style={{ background: '#e5e7eb', color: '#374151', border: 'none', padding: '8px 20px', borderRadius: 6, cursor: 'pointer' }}
                onClick={() => { setShowHandover(false); setHandoverToUserId(''); setHandoverRemarks(''); setShowHandoverHistory(false); }}
              >
                Cancel
              </button>
            </div>

            {/* Handover history toggle inside the box */}
            {handoverLogs.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowHandoverHistory((v) => !v)}
                  style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 500, padding: 0, textDecoration: 'underline' }}
                >
                  {showHandoverHistory ? 'Hide History' : `View History (${handoverLogs.length})`}
                </button>
                {showHandoverHistory && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    {handoverLogs.map((log) => {
                      const statusColor = log.status === 'approved' ? '#16a34a' : log.status === 'rejected' ? '#dc2626' : log.status === 'cancelled' ? '#6b7280' : '#f59e0b';
                      const statusLabel = log.status === 'approved' ? 'Accepted' : log.status === 'rejected' ? 'Declined' : log.status === 'cancelled' ? 'Cancelled' : 'Pending';
                      return (
                        <div key={log.id} style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span>
                              <strong>{log.from_name || log.from_username}</strong>
                              {' \u2192 '}
                              <strong>{log.to_name || log.to_username}</strong>
                            </span>
                            <span style={{ color: statusColor, fontWeight: 600, fontSize: 12, padding: '2px 8px', borderRadius: 4, background: `${statusColor}15` }}>
                              {statusLabel}
                            </span>
                          </div>
                          <div style={{ color: '#64748b', fontSize: 12 }}>
                            {new Date(log.created_at).toLocaleString('en-IN')}
                          </div>
                          {log.remarks && (
                            <div style={{ marginTop: 4, color: '#475569', fontSize: 12 }}>Request remarks: {log.remarks}</div>
                          )}
                          {log.response_remarks && (
                            <div style={{ marginTop: 4, color: log.status === 'rejected' ? '#dc2626' : '#475569', fontSize: 12, fontWeight: 500 }}>
                              {log.status === 'rejected' ? 'Decline reason' : 'Response'}: {log.response_remarks}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className={historyStyles.tabBar}>
          {TABS.map((t) => (
            <button key={t.key} type="button" className={`${historyStyles.tabBtn} ${tab === t.key ? historyStyles.tabBtnActive : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className={historyStyles.detailPanel} style={{ marginTop: 0 }}>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Company</label>
                <div className={calcStyles.small}>{project.company || '-'}</div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Email</label>
                <div className={calcStyles.small}>{project.email || '-'}</div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Address</label>
                <div className={calcStyles.small}>{project.address || '-'}</div>
              </div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Priority</label>
                {canEdit ? (
                  <select className={calcStyles.formControl} value={project.priority} onChange={(e) => patchProject({ priority: e.target.value })}>
                    {(Object.keys(PRIORITY_LABEL) as ProjectPriority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </select>
                ) : <div className={calcStyles.small}>{PRIORITY_LABEL[project.priority]}</div>}
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Status</label>
                {canEdit ? (
                  <select className={calcStyles.formControl} value={project.status} onChange={(e) => patchProject({ status: e.target.value })}>
                    {(Object.keys(STATUS_LABEL) as ProjectStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                ) : <div className={calcStyles.small}>{STATUS_LABEL[project.status]}</div>}
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Current stage</label>
                {canEdit ? (
                  <select className={calcStyles.formControl} value={project.stage} onChange={(e) => patchProject({ stage: e.target.value })}>
                    {FORWARD_STAGES.concat('closed_lost').map((s) => <option key={s} value={s}>{STAGE_LABEL[s as ProjectStage]}</option>)}
                  </select>
                ) : <div className={calcStyles.small}>{STAGE_LABEL[project.stage]}</div>}
              </div>
            </div>
            <div className={`${calcStyles.row} ${calcStyles.columns}`}>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Expected closing date</label>
                {canEdit ? (
                  <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={project.expected_closing_date} onChange={(e) => patchProject({ expectedClosingDate: e.target.value })} />
                ) : <div className={calcStyles.small}>{formatDate(project.expected_closing_date)}</div>}
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Next follow-up date</label>
                {canEdit ? (
                  <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} value={project.next_follow_up_date} onChange={(e) => patchProject({ nextFollowUpDate: e.target.value })} />
                ) : <div className={calcStyles.small}>{formatDate(project.next_follow_up_date)}</div>}
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Source</label>
                <div className={calcStyles.small}>{project.source || '-'}</div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Assigned Technical Person</label>
                {canEdit ? (
                  <select
                    className={calcStyles.formControl}
                    value={project.assigned_technical_person_id}
                    onChange={(e) => patchProject({ assignedTechnicalPersonId: e.target.value })}
                  >
                    <option value="">-- Unassigned --</option>
                    {technicalRoster.map((person) => (
                      <option key={person.id} value={person.id}>{person.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className={calcStyles.small}>{project.assigned_technical_person_name || 'Unassigned'}</div>
                )}
              </div>
            </div>
            <div className={historyStyles.miniCard} style={{ marginTop: 12 }}>
              <div className={historyStyles.miniCardTitle}>Payment</div>
              <div className={historyStyles.miniCardRow}>PO total: ₹{totalPoAmount.toLocaleString('en-IN')}</div>
              <div className={historyStyles.miniCardRow}>Advance received: ₹{totalAdvance.toLocaleString('en-IN')}</div>
              <div className={historyStyles.miniCardRow}>Balance due: ₹{Math.max(0, totalPoAmount - totalAdvance).toLocaleString('en-IN')}</div>
            </div>
          </div>
        )}

        {tab === 'timeline' && (
          <div className={historyStyles.detailPanel} style={{ marginTop: 0 }}>
            <div className={calcStyles.small} style={{ marginBottom: 10 }}>Lead Created → Site Visit → Quotation → Demo → Customer Response → Negotiation → Purchase Order → Installation → Completed</div>
            <div className={historyStyles.stepper}>
              {FORWARD_STAGES.map((s, idx) => {
                const cls = idx < currentIdx ? historyStyles.stepDone : idx === currentIdx ? (isOverdue ? historyStyles.stepDelayed : historyStyles.stepCurrent) : '';
                return <span key={s} className={`${historyStyles.step} ${cls}`}>{idx < currentIdx ? '✓ ' : ''}{STAGE_LABEL[s]}</span>;
              })}
            </div>
          </div>
        )}

        {tab === 'quotations' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Quotations ({quotations.length})<Link href={`/quotation?projectId=${project.id}`}>+ Add</Link></div>
            {quotations.length === 0 ? <div className={historyStyles.miniCardEmpty}>No quotations yet.</div> : quotations.map((q) => (
              <div key={q.id} className={historyStyles.miniCardRow}>{q.quotation_number} — ₹{q.total.toLocaleString('en-IN')}</div>
            ))}
            <div className={historyStyles.miniCardTitle} style={{ marginTop: 14 }}>Follow-ups ({followUps.length})</div>
            {followUps.length === 0 ? <div className={historyStyles.miniCardEmpty}>No follow-ups logged yet.</div> : followUps.slice(0, 8).map((f, idx) => (
              <div key={idx} className={historyStyles.miniCardRow}>{formatDateTime(f.at)} — {f.by} ({f.quotationNumber}): {f.note || '(no note)'}</div>
            ))}
          </div>
        )}

        {tab === 'siteVisits' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Site Visits ({siteVisits.length})<Link href={`/site-visits?projectId=${project.id}`}>+ Add</Link></div>
            {siteVisits.length === 0 ? <div className={historyStyles.miniCardEmpty}>No site visits logged yet.</div> : siteVisits.map((v) => (
              <div key={v.id} className={historyStyles.miniCardRow}>{formatDate(v.visit_date)} — {v.location || 'No location'} {v.stage ? `· ${VISIT_STAGE_LABEL[v.stage]}` : ''}</div>
            ))}
          </div>
        )}

        {tab === 'demo' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Demos ({demos.length})<Link href={`/demo-schedule?projectId=${project.id}`}>+ Add</Link></div>
            {demos.length === 0 ? <div className={historyStyles.miniCardEmpty}>No demos requested yet.</div> : demos.map((d) => (
              <div key={d.id} className={historyStyles.miniCardRow}>
                {formatDateTime(d.scheduled_at)} — {d.status}{d.outcome ? ` · ${d.outcome.replace(/_/g, ' ')}` : ''} {d.product_domains.length ? `(${d.product_domains.map((k) => DOMAIN_DISPLAY_NAME[k]).join(', ')})` : ''}
              </div>
            ))}
          </div>
        )}

        {tab === 'responses' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Customer Response ({responses.length})</div>
            {responses.length === 0 ? <div className={historyStyles.miniCardEmpty}>No response logged yet.</div> : responses.map((r) => (
              <div key={r.id} className={historyStyles.miniCardRow}>{formatDate(r.created_at)} — {r.response_type ? r.response_type.replace(/_/g, ' ') : 'No decision yet'}</div>
            ))}
            <form onSubmit={handleAddResponse} style={{ marginTop: 10 }}>
              <select className={calcStyles.formControl} value={respForm.responseType} onChange={(e) => setRespForm((f) => ({ ...f, responseType: e.target.value as CustomerResponseRecord['response_type'] }))} style={{ marginBottom: 6 }}>
                <option value="">-- Response type --</option>
                <option value="interested">Interested</option>
                <option value="not_interested">Not interested</option>
                <option value="need_revision">Need revision</option>
                <option value="need_new_quotation">Need new quotation</option>
                <option value="budget_issue">Budget issue</option>
                <option value="competitor">Competitor</option>
              </select>
              <textarea className={calcStyles.formControl} rows={2} placeholder="Feedback" value={respForm.feedback} onChange={(e) => setRespForm((f) => ({ ...f, feedback: e.target.value }))} style={{ marginBottom: 6 }} />
              <button type="submit" className={calcStyles.btn} disabled={busySection === 'response'}>{busySection === 'response' ? 'Saving…' : 'Log response'}</button>
            </form>
          </div>
        )}

        {tab === 'negotiations' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Negotiation history ({negotiations.length})</div>
            {negotiations.length === 0 ? <div className={historyStyles.miniCardEmpty}>No negotiation entries yet.</div> : negotiations.map((n) => (
              <div key={n.id} className={historyStyles.miniCardRow} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{formatDate(n.discussion_date)} — {n.person}: {n.discussion || n.offer_given || '-'}</span>
                {isPrivileged && <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDeleteNegotiation(n.id)}>Delete</button>}
              </div>
            ))}
            <form onSubmit={handleAddNegotiation} style={{ marginTop: 10 }}>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input type="date" className={calcStyles.formControl} value={negForm.discussionDate} onChange={(e) => setNegForm((f) => ({ ...f, discussionDate: e.target.value }))} />
                <input className={calcStyles.formControl} placeholder="Person" value={negForm.person} onChange={(e) => setNegForm((f) => ({ ...f, person: e.target.value }))} />
              </div>
              <textarea className={calcStyles.formControl} rows={2} placeholder="Discussion" value={negForm.discussion} onChange={(e) => setNegForm((f) => ({ ...f, discussion: e.target.value }))} style={{ marginBottom: 6 }} />
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input className={calcStyles.formControl} placeholder="Offer given" value={negForm.offerGiven} onChange={(e) => setNegForm((f) => ({ ...f, offerGiven: e.target.value }))} />
                <input className={calcStyles.formControl} placeholder="Discount" value={negForm.discount} onChange={(e) => setNegForm((f) => ({ ...f, discount: e.target.value }))} />
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input type="number" className={calcStyles.formControl} placeholder="Revised price" value={negForm.revisedPrice} onChange={(e) => setNegForm((f) => ({ ...f, revisedPrice: e.target.value }))} />
                <input type="date" className={calcStyles.formControl} min={todayDateInputValue()} placeholder="Expected closure" value={negForm.expectedClosure} onChange={(e) => setNegForm((f) => ({ ...f, expectedClosure: e.target.value }))} />
              </div>
              <button type="submit" className={calcStyles.btn} disabled={busySection === 'negotiation'}>{busySection === 'negotiation' ? 'Saving…' : 'Log discussion'}</button>
            </form>
          </div>
        )}

        {tab === 'dc' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Delivery Challans ({deliveryChallans.length})<Link href="/backoffice">+ View in Back Office</Link></div>
            {deliveryChallans.length === 0 ? <div className={historyStyles.miniCardEmpty}>No Delivery Challans yet.</div> : deliveryChallans.map((dc) => (
              <div key={dc.id} className={historyStyles.miniCardRow}>{dc.dc_number} — {DC_STATUS_LABEL[dc.status]} · Issued {formatDate(dc.issued_date)}</div>
            ))}
          </div>
        )}

        {tab === 'marketing' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Marketing Requests ({marketingRequests.length})<Link href="/marketing-requests">+ View in Marketing</Link></div>
            {marketingRequests.length === 0 ? <div className={historyStyles.miniCardEmpty}>No Marketing Requests for this project yet.</div> : marketingRequests.map((mr) => (
              <div key={mr.id} className={historyStyles.miniCardRow}>{mr.title} — {MARKETING_STATUS_LABEL[mr.status]}{mr.assigned_to ? ` · Assigned to ${mr.assigned_to}` : ''}</div>
            ))}
          </div>
        )}

        {tab === 'po' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Purchase Orders ({purchaseOrders.length})</div>
            {purchaseOrders.length === 0 ? <div className={historyStyles.miniCardEmpty}>No PO received yet.</div> : purchaseOrders.map((po) => (
              <div key={po.id} className={historyStyles.miniCardRow} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{po.po_number} — ₹{po.amount.toLocaleString('en-IN')} ({formatDate(po.po_date)})</span>
                {isPrivileged && <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDeletePo(po.id)}>Delete</button>}
              </div>
            ))}
            <form onSubmit={handleAddPo} style={{ marginTop: 10 }}>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input className={calcStyles.formControl} placeholder="PO number" value={poForm.poNumber} onChange={(e) => setPoForm((f) => ({ ...f, poNumber: e.target.value }))} />
                <input type="date" className={calcStyles.formControl} value={poForm.poDate} onChange={(e) => setPoForm((f) => ({ ...f, poDate: e.target.value }))} />
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input type="number" className={calcStyles.formControl} placeholder="Amount" value={poForm.amount} onChange={(e) => setPoForm((f) => ({ ...f, amount: e.target.value }))} />
                <input type="number" className={calcStyles.formControl} placeholder="Advance received" value={poForm.advanceReceived} onChange={(e) => setPoForm((f) => ({ ...f, advanceReceived: e.target.value }))} />
              </div>
              <input className={calcStyles.formControl} placeholder="Payment terms" value={poForm.paymentTerms} onChange={(e) => setPoForm((f) => ({ ...f, paymentTerms: e.target.value }))} style={{ marginBottom: 6 }} />
              <button type="submit" className={calcStyles.btn} disabled={busySection === 'po'}>{busySection === 'po' ? 'Saving…' : 'Log PO'}</button>
            </form>
          </div>
        )}

        {tab === 'installation' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Installation ({installations.length})</div>
            {installations.length === 0 ? <div className={historyStyles.miniCardEmpty}>Not scheduled yet.</div> : installations.map((inst) => (
              <div key={inst.id} className={historyStyles.miniCardRow}>
                <div>{formatDate(inst.installation_date)} — {inst.assigned_engineer || 'Unassigned'}</div>
                <select className={calcStyles.formControl} value={inst.status} onChange={(e) => handleInstallationStatus(inst.id, e.target.value as InstallationRecord['status'])} style={{ marginTop: 4 }}>
                  <option value="scheduled">Scheduled</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            ))}
            <form onSubmit={handleAddInstallation} style={{ marginTop: 10 }}>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginBottom: 6 }}>
                <input type="date" className={calcStyles.formControl} value={instForm.installationDate} onChange={(e) => setInstForm((f) => ({ ...f, installationDate: e.target.value }))} />
                <input className={calcStyles.formControl} placeholder="Assigned engineer" value={instForm.assignedEngineer} onChange={(e) => setInstForm((f) => ({ ...f, assignedEngineer: e.target.value }))} />
              </div>
              <button type="submit" className={calcStyles.btn} disabled={busySection === 'installation'}>{busySection === 'installation' ? 'Saving…' : 'Schedule installation'}</button>
            </form>
          </div>
        )}

        {tab === 'documents' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Attachments ({project.attachments.length})</div>
            {project.attachments.length === 0 ? <div className={historyStyles.miniCardEmpty}>No attachments yet.</div> : project.attachments.map((url) => (
              <div key={url} className={historyStyles.miniCardRow}><a href={url} target="_blank" rel="noreferrer">{url.split('/').pop()}</a></div>
            ))}
            <input type="file" multiple disabled={uploadingAttachment} onChange={(e) => handleUploadAttachment(e.target.files)} style={{ marginTop: 10 }} />
            {uploadingAttachment && <div className={calcStyles.small}>Uploading…</div>}
          </div>
        )}

        {tab === 'activity' && (
          <div className={historyStyles.detailPanel} style={{ marginTop: 0 }}>
            <form onSubmit={handleAddRemark} className={historyStyles.followUpForm} style={{ marginBottom: 14 }}>
              <input type="text" placeholder="Add a remark to this project's timeline…" value={remarkText} onChange={(e) => setRemarkText(e.target.value)} />
              <button type="submit" disabled={savingRemark}>{savingRemark ? 'Saving…' : 'Add remark'}</button>
            </form>
            <div className={historyStyles.timeline}>
              {project.timeline.slice().reverse().map((t) => (
                <div key={t.id} className={historyStyles.timelineEntry}>
                  <div className={historyStyles.timelineMeta}>{formatDateTime(t.at)} · {t.by} · {STAGE_LABEL[t.stage as ProjectStage] || 'Created'}</div>
                  <div>{t.label}</div>
                  {t.remarks && <div className={calcStyles.small}>{t.remarks}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'notes' && (
          <div className={historyStyles.miniCard}>
            <div className={historyStyles.miniCardTitle}>Notes ({project.notes.length})</div>
            {project.notes.length === 0 ? <div className={historyStyles.miniCardEmpty}>No notes yet.</div> : project.notes.slice().reverse().map((n) => (
              <div key={n.id} className={historyStyles.miniCardRow}>{formatDateTime(n.at)} — {n.by}: {n.text}</div>
            ))}
            <form onSubmit={handleAddNote} style={{ marginTop: 10 }}>
              <textarea className={calcStyles.formControl} rows={2} placeholder="Add a note…" value={noteText} onChange={(e) => setNoteText(e.target.value)} style={{ marginBottom: 6 }} />
              <button type="submit" className={calcStyles.btn} disabled={savingNote}>{savingNote ? 'Saving…' : 'Add note'}</button>
            </form>
          </div>
        )}
    </AppShell>
  );
}
