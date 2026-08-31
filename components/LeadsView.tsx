'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DomainKey, LeadPriority, LeadRecord, LeadSource, UserRole } from '@/lib/types';
import { LEAD_DOMAIN_TILES, LEAD_PRIORITY_META } from '@/lib/leadInterestOptions';
import { isLeadUnattended } from '@/lib/followUp';
import { AlertTriangle, Flame, Contact, Share2, UserPlus, UserCheck, Pencil } from 'lucide-react';
import AppShell from './AppShell';
import LeadCaptureWizard from './LeadCaptureWizard';
import LeadBulkImportWizard from './LeadBulkImportWizard';
import PhoneInput from './ui/PhoneInput';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import notifyStyles from './ui/notify.module.css';
import assignStyles from './leadAssignment.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';

interface LeadsViewProps {
  currentUser: { username: string; role: UserRole };
}

interface Assignee {
  id: string;
  username: string;
  name: string;
  department: string;
  designation: string;
}

const PAGE_SIZE = 20;

// Sentinel values for the "Assigned to" filter dropdown. Prefixed so they can
// never collide with a real user id.
const FILTER_UNASSIGNED = '@unassigned';
const FILTER_MINE = '@mine';

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

function PriorityBadge({ priority }: { priority: LeadPriority }) {
  if (!priority) return <span style={{ color: '#9ca3af', fontSize: 12 }}>-</span>;
  const cls = priority === 'hot' ? historyStyles.priorityBadgeHot : priority === 'warm' ? historyStyles.priorityBadgeWarm : historyStyles.priorityBadgeCool;
  const Icon = LEAD_PRIORITY_META[priority].icon;
  return <span className={`${historyStyles.priorityBadge} ${cls}`}><Icon size={12} /> {priority.toUpperCase()}</span>;
}

const SOURCE_LABEL: Record<LeadSource, string> = {
  manual: 'Manual',
  business_card: 'Business Card',
  csv_import: 'CSV Import',
  meta_lead_ads: 'Meta Lead Ads'
};

function metaPlatformLabel(platform: string): string {
  return platform === 'ig' ? 'Instagram' : platform === 'fb' ? 'Facebook' : 'Meta';
}

function SourceBadge({ lead, onClick }: { lead: LeadRecord; onClick?: () => void }) {
  const isMeta = lead.source === 'meta_lead_ads';
  const label = SOURCE_LABEL[lead.source] || 'Manual';
  return (
    <button
      type="button"
      onClick={isMeta ? onClick : undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600,
        padding: '2px 9px', borderRadius: 'var(--mx-radius-full)',
        color: isMeta ? 'var(--mx-blue-600)' : 'var(--mx-ink-muted)',
        background: isMeta ? 'var(--mx-blue-50)' : 'var(--mx-surface-sunken)',
        border: 'none', cursor: isMeta ? 'pointer' : 'default'
      }}
    >
      {isMeta && <Share2 size={11} />}
      {label}
    </button>
  );
}

function LeadsViewContent({ currentUser }: LeadsViewProps) {
  const toast = useToast();
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const startUnattended = searchParams.get('filter') === 'unattended';
  const [mode, setMode] = useState<'capture' | 'list' | 'bulk'>(startUnattended ? 'list' : 'capture');
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<LeadPriority | ''>('');
  const [interestFilter, setInterestFilter] = useState<DomainKey | ''>('');
  const [sourceFilter, setSourceFilter] = useState<LeadSource | ''>('');
  const [unattendedOnly, setUnattendedOnly] = useState(startUnattended);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [page, setPage] = useState(1);
  const [stats, setStats] = useState<{ total: number; today: number; hot: number; unattended: number; metaTotal: number; metaToday: number; unassigned: number; assignedToMe: number } | null>(null);
  const [metaInfoLead, setMetaInfoLead] = useState<LeadRecord | null>(null);
  const [editingLead, setEditingLead] = useState<LeadRecord | null>(null);
  const [editForm, setEditForm] = useState({ name: '', company: '', designation: '', mobile: '', email: '', city: '', budget: '', priority: '' as LeadPriority, notes: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  // ── Assignment ──────────────────────────────────────────────────────────
  // `assignees` non-empty is also the "this viewer may assign" signal:
  // /api/leads/assignees 403s for anyone who can't, so one fetch decides both
  // whether to render the assignment controls and what to put in them.
  const [assignees, setAssignees] = useState<Assignee[] | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssigneeId, setBulkAssigneeId] = useState('');
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const canAssign = !!assignees;

  async function loadLeads() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch('/api/leads');
      if (!response.ok) throw new Error(String(response.status));
      const data: LeadRecord[] = await response.json();
      setLeads(data);
      setStatus(data.length ? `${data.length} lead${data.length === 1 ? '' : 's'}.` : 'No leads captured yet.');
    } catch {
      setStatus('Could not load leads. Refresh to try again.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const response = await fetch('/api/leads/stats');
      if (response.ok) setStats(await response.json());
    } catch {
      setStats(null);
    }
  }

  // A 403 here is the expected answer for a rep rather than an error — it just
  // means no assignment controls for them, so it stays silent.
  async function loadAssignees() {
    try {
      const response = await fetch('/api/leads/assignees');
      if (!response.ok) {
        setAssignees(null);
        return;
      }
      const data: { assignees: Assignee[] } = await response.json();
      setAssignees(data.assignees);
    } catch {
      setAssignees(null);
    }
  }

  useEffect(() => {
    loadLeads();
    loadStats();
    loadAssignees();
  }, []);

  // Sends both the per-row change and the bulk action through the one
  // endpoint, so authorisation and audit logging can't diverge between them.
  async function assign(leadIds: string[], assigneeId: string): Promise<boolean> {
    try {
      const response = await fetch('/api/leads/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds, assigneeId })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error(body?.error || 'Could not assign. Please try again.');
        return false;
      }
      const result: { assigned: number; failed: string[]; assigneeName: string; leads: LeadRecord[] } = await response.json();

      // Patch the rows in place from the response rather than refetching the
      // whole list — keeps the current scroll position, filters and selection.
      setLeads((prev) => {
        const updatedById = new Map(result.leads.map((l) => [l.id, l]));
        return prev.map((l) => updatedById.get(l.id) ?? l);
      });
      loadStats();

      const noun = `${result.assigned} lead${result.assigned === 1 ? '' : 's'}`;
      if (result.failed.length) {
        toast.error(`${noun} updated, ${result.failed.length} could not be.`);
      } else {
        toast.success(assigneeId ? `${noun} assigned to ${result.assigneeName}.` : `${noun} unassigned.`);
      }
      return true;
    } catch {
      toast.error('Could not reach the server.');
      return false;
    }
  }

  async function handleRowAssign(leadId: string, assigneeId: string) {
    setAssigningId(leadId);
    try {
      await assign([leadId], assigneeId);
    } finally {
      setAssigningId(null);
    }
  }

  async function handleBulkAssign() {
    // selectedVisibleIds, not selectedIds — see its definition below.
    const ids = selectedVisibleIds;
    if (!ids.length) return;
    // Unassigning several leads at once is destructive enough to confirm —
    // it silently drops whoever was working them.
    if (!bulkAssigneeId) {
      const ok = await confirm({
        title: `Unassign ${ids.length} lead${ids.length === 1 ? '' : 's'}?`,
        message: 'They will go back to the unassigned queue and whoever is working them now will lose them.',
        confirmLabel: 'Unassign',
        danger: true
      });
      if (!ok) return;
    }
    setBulkBusy(true);
    try {
      const ok = await assign(ids, bulkAssigneeId);
      if (ok) {
        setSelectedIds(new Set());
        setBulkAssigneeId('');
      }
    } finally {
      setBulkBusy(false);
    }
  }

  const visibleLeads = useMemo(() => {
    let rows = leads;
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((l) => `${l.name} ${l.company} ${l.city} ${l.email} ${l.mobile}`.toLowerCase().includes(needle));
    }
    if (priorityFilter) rows = rows.filter((l) => l.priority === priorityFilter);
    if (interestFilter) rows = rows.filter((l) => l.interests.includes(interestFilter));
    if (sourceFilter) rows = rows.filter((l) => l.source === sourceFilter);
    if (unattendedOnly) rows = rows.filter(isLeadUnattended);
    if (assigneeFilter === FILTER_UNASSIGNED) rows = rows.filter((l) => !l.assigned_to_id);
    else if (assigneeFilter === FILTER_MINE) rows = rows.filter((l) => l.assigned_to === currentUser.username);
    else if (assigneeFilter) rows = rows.filter((l) => l.assigned_to_id === assigneeFilter);
    const sorted = [...rows].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'oldest') return a.created_at < b.created_at ? -1 : 1;
      return a.created_at < b.created_at ? 1 : -1;
    });
    return sorted;
  }, [leads, q, priorityFilter, interestFilter, sourceFilter, unattendedOnly, sortBy, assigneeFilter, currentUser.username]);

  const totalPages = Math.max(1, Math.ceil(visibleLeads.length / PAGE_SIZE));
  const pageRows = visibleLeads.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [q, priorityFilter, interestFilter, sourceFilter, unattendedOnly, sortBy, assigneeFilter]);

  // Selection is only ever acted on through this intersection with the visible
  // rows, so a stale id left behind by a filter change simply stops counting —
  // a bulk assign can never reach a lead the manager isn't looking at.
  // Not memoized: it's a filter over one page's worth of rows, and wrapping a
  // Set lookup in useMemo defeats the React Compiler's own memoization
  // (react-hooks/preserve-manual-memoization) for no measurable gain.
  const selectedVisibleIds = visibleLeads.filter((l) => selectedIds.has(l.id)).map((l) => l.id);
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((l) => selectedIds.has(l.id));

  function toggleRowSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePageSelection() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((l) => next.delete(l.id));
      else pageRows.forEach((l) => next.add(l.id));
      return next;
    });
  }

  // Name/Company/Designation/Mobile/Email/Interests/Priority/Source/
  // Assigned To/Captured By/Date/actions = 12, +1 for the selection
  // checkbox column when the viewer can assign leads.
  const columnCount = canAssign ? 13 : 12;

  async function handleSubmitLead(form: {
    name: string; mobile: string; email: string; designation: string; company: string; city: string; cardImageUrl: string;
    interests: DomainKey[]; subInterests: string[]; priority: LeadPriority; followUpActions: string[]; budget: string; notes: string;
  }): Promise<(LeadRecord & { duplicate?: boolean; duplicateCapturedBy?: string }) | null> {
    setCreating(true);
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      if (!response.ok) {
        toast.error('Could not save this lead. Please try again.');
        return null;
      }
      const result: LeadRecord & { duplicate?: boolean; duplicateCapturedBy?: string } = await response.json();
      // A merged duplicate updates an existing row in place instead of
      // prepending a second copy of the same contact.
      setLeads((prev) => {
        const index = prev.findIndex((l) => l.id === result.id);
        if (index === -1) return [result, ...prev];
        const next = [...prev];
        next[index] = result;
        return next;
      });
      loadStats();
      return result;
    } catch {
      toast.error('Could not reach the server.');
      return null;
    } finally {
      setCreating(false);
    }
  }

  function showAllLeads() {
    setMode('list');
    loadLeads();
  }

  async function handleConvertToProject(leadId: string): Promise<boolean> {
    const response = await fetch(`/api/leads/${leadId}/convert-to-project`, { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      toast.error(body?.error || 'Could not convert this lead.');
      return false;
    }
    await loadLeads();
    return true;
  }

  async function handleDelete(lead: LeadRecord) {
    if (!(await confirm({ message: `Delete the lead for "${lead.name || lead.company}"? This cannot be undone.`, danger: true }))) return;
    const response = await fetch(`/api/leads/${lead.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toast.error('Could not delete this lead.');
      return;
    }
    setLeads((prev) => prev.filter((l) => l.id !== lead.id));
    loadStats();
  }

  function openEditLead(lead: LeadRecord) {
    setEditForm({
      name: lead.name,
      company: lead.company,
      designation: lead.designation,
      mobile: lead.mobile,
      email: lead.email,
      city: lead.city,
      budget: lead.budget,
      priority: lead.priority,
      notes: lead.notes
    });
    setEditingLead(lead);
  }

  async function handleSaveEdit() {
    if (!editingLead) return;
    setSavingEdit(true);
    try {
      const response = await fetch(`/api/leads/${editingLead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error(body?.error || 'Could not save changes.');
        return;
      }
      const updated: LeadRecord = await response.json();
      setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      toast.success('Lead updated.');
      setEditingLead(null);
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setSavingEdit(false);
    }
  }

  const isPrivileged = currentUser.role === 'admin' || currentUser.role === 'superadmin' || currentUser.role === 'manager';

  return (
    <AppShell title="Lead Capture / Inquiry" subtitle="Scan a business card, bulk-import from CSV or photos, qualify the lead, and follow up — all in one flow.">
        {stats && (
          <div className={calcStyles.row} style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
            <div className={calcStyles.sectionPanel} style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{stats.total}</div>
              <div className={calcStyles.small}>Total Leads</div>
            </div>
            <div className={calcStyles.sectionPanel} style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#15803d' }}>{stats.today}</div>
              <div className={calcStyles.small}>Captured Today</div>
            </div>
            <div className={calcStyles.sectionPanel} style={{ flex: 1, minWidth: 120, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>{stats.hot} <Flame size={20} /></div>
              <div className={calcStyles.small}>Hot Leads</div>
            </div>
            <button
              type="button"
              className={calcStyles.sectionPanel}
              style={{ flex: 1, minWidth: 120, textAlign: 'center', cursor: 'pointer', border: sourceFilter === 'meta_lead_ads' ? '1px solid var(--mx-blue-600)' : undefined }}
              onClick={() => { setMode('list'); setSourceFilter((v) => (v === 'meta_lead_ads' ? '' : 'meta_lead_ads')); }}
            >
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--mx-blue-600)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Share2 size={18} /> {stats.metaTotal}</div>
              <div className={calcStyles.small}>Meta Leads</div>
            </button>
            <button
              type="button"
              className={calcStyles.sectionPanel}
              style={{ flex: 1, minWidth: 120, textAlign: 'center', cursor: 'pointer', border: unattendedOnly ? '1px solid #dc2626' : undefined }}
              onClick={() => { setMode('list'); setUnattendedOnly(true); }}
            >
              <div style={{ fontSize: 24, fontWeight: 800, color: '#b91c1c', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><AlertTriangle size={20} /> {stats.unattended}</div>
              <div className={calcStyles.small}>Unattended</div>
            </button>
            {/* A sales manager's actual queue: what has come in and still
                needs routing to a rep. One tap filters the list to it. */}
            {canAssign && (
              <button
                type="button"
                className={`${calcStyles.sectionPanel} ${assignStyles.statBtn} ${assigneeFilter === FILTER_UNASSIGNED ? assignStyles.statActive : ''}`}
                onClick={() => { setMode('list'); setAssigneeFilter(FILTER_UNASSIGNED); }}
                aria-pressed={assigneeFilter === FILTER_UNASSIGNED}
              >
                <div className={`${assignStyles.statValue} ${assignStyles.statWarning}`}><UserPlus size={20} /> {stats.unassigned}</div>
                <div className={calcStyles.small}>To Assign</div>
              </button>
            )}
            {/* Reps get the mirror image — what has been routed to them. */}
            {stats.assignedToMe > 0 && (
              <button
                type="button"
                className={`${calcStyles.sectionPanel} ${assignStyles.statBtn} ${assigneeFilter === FILTER_MINE ? assignStyles.statActive : ''}`}
                onClick={() => { setMode('list'); setAssigneeFilter(FILTER_MINE); }}
                aria-pressed={assigneeFilter === FILTER_MINE}
              >
                <div className={`${assignStyles.statValue} ${assignStyles.statInfo}`}><UserCheck size={20} /> {stats.assignedToMe}</div>
                <div className={calcStyles.small}>Assigned To Me</div>
              </button>
            )}
          </div>
        )}

        <div className={historyStyles.modeToggle}>
          <button type="button" className={`${historyStyles.modeToggleBtn} ${mode === 'capture' ? historyStyles.modeToggleBtnActive : ''}`} onClick={() => setMode('capture')}>
            + Add Inquiry
          </button>
          <button
            type="button"
            className={`${historyStyles.modeToggleBtn} ${mode === 'bulk' ? historyStyles.modeToggleBtnActive : ''}`}
            onClick={() => setMode('bulk')}
          >
            Import Leads / Inquiries
          </button>
          <button
            type="button"
            className={`${historyStyles.modeToggleBtn} ${mode === 'list' ? historyStyles.modeToggleBtnActive : ''}`}
            onClick={showAllLeads}
          >
            All Leads
          </button>
        </div>

        {mode === 'capture' && (
          <LeadCaptureWizard creating={creating} onSubmit={handleSubmitLead} onConvertToProject={handleConvertToProject} onViewAllLeads={showAllLeads} />
        )}

        {mode === 'bulk' && (
          <LeadBulkImportWizard
            onImportComplete={() => {
              loadStats();
            }}
            onCancel={showAllLeads}
          />
        )}

        {mode === 'list' && (
          <>
            <div className={historyStyles.toolbar}>
              <input type="text" placeholder="Search name, company, city, email, mobile..." value={q} onChange={(e) => setQ(e.target.value)} />
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as LeadPriority | '')}>
                <option value="">All priorities</option>
                <option value="hot">Hot</option>
                <option value="warm">Warm</option>
                <option value="cool">Cold</option>
              </select>
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={interestFilter} onChange={(e) => setInterestFilter(e.target.value as DomainKey | '')}>
                <option value="">All interests</option>
                {LEAD_DOMAIN_TILES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as LeadSource | '')}>
                <option value="">All sources</option>
                <option value="meta_lead_ads">Meta Lead Ads</option>
                <option value="manual">Manual</option>
                <option value="business_card">Business Card</option>
                <option value="csv_import">CSV Import</option>
              </select>
              <select
                className={calcStyles.formControl}
                style={{ width: 'auto' }}
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                aria-label="Filter by assignee"
              >
                <option value="">All assignees</option>
                <option value={FILTER_UNASSIGNED}>Unassigned</option>
                <option value={FILTER_MINE}>Assigned to me</option>
                {(assignees || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select className={calcStyles.formControl} style={{ width: 'auto' }} value={sortBy} onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'name')}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name (A-Z)</option>
              </select>
              <button
                type="button"
                className={`${historyStyles.modeToggleBtn} ${unattendedOnly ? historyStyles.modeToggleBtnActive : ''}`}
                style={unattendedOnly ? { color: '#b91c1c', borderColor: '#dc2626' } : undefined}
                onClick={() => setUnattendedOnly((v) => !v)}
              >
                Unattended only
              </button>
              <button type="button" className={historyStyles.button} onClick={loadLeads}>Refresh</button>
              <a className={historyStyles.button} href="/api/leads/export.csv">Export CSV</a>
              <button type="button" className={historyStyles.button} onClick={() => window.print()}>Print</button>
            </div>
            {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

            {canAssign && selectedVisibleIds.length > 0 && (
              <div className={assignStyles.bulkBar}>
                <span className={assignStyles.bulkCount}>
                  {selectedVisibleIds.length} lead{selectedVisibleIds.length === 1 ? '' : 's'} selected
                </span>
                <select
                  className={assignStyles.bulkSelect}
                  value={bulkAssigneeId}
                  onChange={(e) => setBulkAssigneeId(e.target.value)}
                  aria-label="Assign selected leads to"
                >
                  <option value="">— Unassign —</option>
                  {(assignees || []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.designation ? ` · ${a.designation}` : ''}</option>
                  ))}
                </select>
                <button type="button" className={`${historyStyles.button} ${historyStyles.primary}`} onClick={handleBulkAssign} disabled={bulkBusy}>
                  {bulkBusy ? 'Assigning…' : bulkAssigneeId ? 'Assign' : 'Unassign'}
                </button>
                <button type="button" className={assignStyles.linkBtn} onClick={() => setSelectedIds(new Set())}>
                  Clear selection
                </button>
              </div>
            )}

            {loading ? (
              <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={9} /></div>
            ) : loadFailed ? (
              <ErrorState message="Could not load leads — check your connection and try again." onRetry={loadLeads} />
            ) : (
            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    {canAssign && (
                      <th className={assignStyles.checkCell}>
                        <input
                          type="checkbox"
                          className={assignStyles.checkbox}
                          checked={allOnPageSelected}
                          onChange={togglePageSelection}
                          aria-label={allOnPageSelected ? 'Deselect all leads on this page' : 'Select all leads on this page'}
                        />
                      </th>
                    )}
                    <th>Name</th>
                    <th>Company</th>
                    <th>Designation</th>
                    <th>Mobile</th>
                    <th>Email</th>
                    <th>Interests</th>
                    <th>Priority</th>
                    <th>Source</th>
                    <th>Assigned To</th>
                    <th>Captured By</th>
                    <th>Date</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((l) => (
                    <tr key={l.id} className={selectedIds.has(l.id) ? assignStyles.rowSelected : ''}>
                      {canAssign && (
                        <td className={assignStyles.checkCell}>
                          <input
                            type="checkbox"
                            className={assignStyles.checkbox}
                            checked={selectedIds.has(l.id)}
                            onChange={() => toggleRowSelection(l.id)}
                            aria-label={`Select lead ${l.name || l.company || l.id}`}
                          />
                        </td>
                      )}
                      <td>{l.name || '-'}</td>
                      <td>{l.company || '-'}</td>
                      <td>{l.designation || '-'}</td>
                      <td className={historyStyles.num}>{l.mobile || '-'}</td>
                      <td>{l.email || '-'}</td>
                      <td>
                        {l.interests.length > 0 ? (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                            {l.interests.map((d) => {
                              const tile = LEAD_DOMAIN_TILES.find((t) => t.key === d);
                              const Icon = tile?.icon;
                              return Icon ? <Icon key={d} size={14} /> : <span key={d}>{d}</span>;
                            })}
                          </div>
                        ) : '-'}
                      </td>
                      <td><PriorityBadge priority={l.priority} /></td>
                      <td><SourceBadge lead={l} onClick={() => setMetaInfoLead(l)} /></td>
                      {/* A manager gets a picker (assigning one lead shouldn't
                          need a dialog); everyone else gets the read-only fact. */}
                      <td className={assignStyles.assigneeCell}>
                        {canAssign ? (
                          <select
                            className={`${assignStyles.rowSelect} ${!l.assigned_to_id ? assignStyles.rowSelectUnassigned : ''}`}
                            value={l.assigned_to_id || ''}
                            disabled={assigningId === l.id}
                            onChange={(e) => handleRowAssign(l.id, e.target.value)}
                            aria-label={`Assign lead ${l.name || l.company || l.id} to`}
                          >
                            <option value="">Unassigned</option>
                            {(assignees || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            {/* Keeps the current assignee selectable even if
                                they've since moved out of the assignable set
                                (department change, deactivation) — otherwise the
                                select would silently show "Unassigned" for a
                                lead that is in fact assigned. */}
                            {l.assigned_to_id && !(assignees || []).some((a) => a.id === l.assigned_to_id) && (
                              <option value={l.assigned_to_id}>{l.assigned_to_name || l.assigned_to} (inactive)</option>
                            )}
                          </select>
                        ) : l.assigned_to ? (
                          <>
                            <span className={assignStyles.assigneeName}>
                              {l.assigned_to_name || l.assigned_to}
                              {l.assigned_to === currentUser.username && <span className={assignStyles.assigneeMine}>You</span>}
                            </span>
                            {l.assigned_by && <span className={assignStyles.assigneeMeta}>by {l.assigned_by}</span>}
                          </>
                        ) : (
                          <span className={assignStyles.unassignedPill}>Unassigned</span>
                        )}
                      </td>
                      <td>{l.created_by}</td>
                      <td>{formatDateTime(l.created_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className={historyStyles.button} onClick={() => openEditLead(l)} aria-label={`Edit lead ${l.name || l.company || l.id}`}>
                            <Pencil size={12} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} /> Edit
                          </button>
                          {!l.project_id ? (
                            <button type="button" className={historyStyles.button} onClick={() => handleConvertToProject(l.id)}>To Project</button>
                          ) : (
                            <Link href={`/projects/${l.project_id}`} className={calcStyles.small}>View Project</Link>
                          )}
                          {isPrivileged && <button type="button" className={historyStyles.deleteBtn} onClick={() => handleDelete(l)}>Delete</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {pageRows.length === 0 && (
                    <tr><td colSpan={columnCount}>
                      <EmptyState
                        icon={Contact}
                        title={leads.length === 0 ? 'No leads captured yet' : 'No leads match your filters'}
                        message={leads.length === 0 ? 'Scan a business card to capture your first lead.' : 'Try clearing a filter or search term.'}
                        action={leads.length === 0 ? <button type="button" className={calcStyles.btn} onClick={() => setMode('capture')}>Capture a Lead</button> : undefined}
                      />
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            )}

            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', marginTop: 14 }}>
                <button type="button" className={historyStyles.button} disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</button>
                <span className={calcStyles.small}>Page {page} of {totalPages}</span>
                <button type="button" className={historyStyles.button} disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next →</button>
              </div>
            )}
          </>
        )}

        {metaInfoLead && (
          <div className={notifyStyles.overlay} role="presentation" onClick={() => setMetaInfoLead(null)}>
            <div className={notifyStyles.wideCard} role="dialog" aria-modal="true" aria-label="Meta Information" onClick={(e) => e.stopPropagation()}>
              <div className={notifyStyles.confirmTitle}>Meta Information</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 14, rowGap: 8, fontSize: 13.5, marginTop: 10 }}>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Platform</span><span>{metaPlatformLabel(metaInfoLead.meta_platform)}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Campaign</span><span>{metaInfoLead.meta_campaign_name || '—'}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Ad Set</span><span>{metaInfoLead.meta_adset_name || '—'}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Ad</span><span>{metaInfoLead.meta_ad_name || '—'}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Form</span><span>{metaInfoLead.meta_form_name || '—'}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Meta Lead ID</span><span style={{ fontFamily: 'monospace' }}>{metaInfoLead.meta_lead_id || '—'}</span>
                <span style={{ color: 'var(--mx-ink-faint)' }}>Received</span><span>{formatDateTime(metaInfoLead.meta_created_at)}</span>
              </div>
              <div className={notifyStyles.confirmActions} style={{ marginTop: 18 }}>
                <button type="button" className={notifyStyles.confirmOk} onClick={() => setMetaInfoLead(null)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {editingLead && (
          <div className={notifyStyles.overlay} role="presentation" onClick={() => !savingEdit && setEditingLead(null)}>
            <div className={notifyStyles.wideCard} role="dialog" aria-modal="true" aria-label="Edit Lead" onClick={(e) => e.stopPropagation()}>
              <div className={notifyStyles.confirmTitle}>Edit Lead</div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`} style={{ marginTop: 10 }}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Name</label>
                  <input className={calcStyles.formControl} value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Company</label>
                  <input className={calcStyles.formControl} value={editForm.company} onChange={(e) => setEditForm((f) => ({ ...f, company: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Designation</label>
                  <input className={calcStyles.formControl} value={editForm.designation} onChange={(e) => setEditForm((f) => ({ ...f, designation: e.target.value }))} />
                </div>
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Mobile</label>
                  <PhoneInput value={editForm.mobile} onChange={(v) => setEditForm((f) => ({ ...f, mobile: v }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Email</label>
                  <input type="email" className={calcStyles.formControl} value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>City</label>
                  <input className={calcStyles.formControl} value={editForm.city} onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))} />
                </div>
              </div>
              <div className={`${calcStyles.row} ${calcStyles.columns}`}>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Budget</label>
                  <input className={calcStyles.formControl} value={editForm.budget} onChange={(e) => setEditForm((f) => ({ ...f, budget: e.target.value }))} />
                </div>
                <div className={calcStyles.field}>
                  <label className={calcStyles.label}>Priority</label>
                  <select className={calcStyles.formControl} value={editForm.priority} onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as LeadPriority }))}>
                    <option value="">Unrated</option>
                    <option value="hot">{LEAD_PRIORITY_META.hot.label}</option>
                    <option value="warm">{LEAD_PRIORITY_META.warm.label}</option>
                    <option value="cool">{LEAD_PRIORITY_META.cool.label}</option>
                  </select>
                </div>
              </div>
              <div className={calcStyles.field}>
                <label className={calcStyles.label}>Notes</label>
                <textarea className={calcStyles.formControl} rows={3} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className={notifyStyles.confirmActions} style={{ marginTop: 18 }}>
                <button type="button" className={notifyStyles.confirmCancel} disabled={savingEdit} onClick={() => setEditingLead(null)}>Cancel</button>
                <button type="button" className={notifyStyles.confirmOk} disabled={savingEdit} onClick={handleSaveEdit}>{savingEdit ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </div>
          </div>
        )}
    </AppShell>
  );
}

export default function LeadsView(props: LeadsViewProps) {
  return (
    <Suspense fallback={<AppShell title="Lead Capture / Inquiry" subtitle="Scan a business card, bulk-import from CSV or photos, qualify the lead, and follow up — all in one flow.">{null}</AppShell>}>
      <LeadsViewContent {...props} />
    </Suspense>
  );
}
