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
import leadStyles from './leadsView.module.css';
import { useToast } from './ui/ToastProvider';
import { useConfirm } from './ui/ConfirmDialog';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import StatTile from './ui/StatTile';
import SegmentedToggle, { SegmentedButton, SegmentedOption } from './ui/SegmentedToggle';
import FilterBar from './ui/FilterBar';
import Select from './ui/Select';
import ToolbarButton, { ToolbarLink, DeleteButton } from './ui/ToolbarButton';
import Table, { TableColumn, TableWrap } from './ui/Table';
import Pagination from './ui/Pagination';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Textarea from './ui/Textarea';
import PriorityBadge from './ui/PriorityBadge';

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

type Mode = 'capture' | 'list' | 'bulk';
const MODE_OPTIONS: SegmentedOption<Mode>[] = [
  { value: 'capture', label: '+ Add Inquiry' },
  { value: 'bulk', label: 'Import Leads / Inquiries' },
  { value: 'list', label: 'All Leads' }
];

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
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
  const classes = [leadStyles.sourceBadge, isMeta ? leadStyles.sourceBadgeMeta : ''].filter(Boolean).join(' ');
  return (
    <button type="button" onClick={isMeta ? onClick : undefined} className={classes}>
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
  const [mode, setMode] = useState<Mode>(startUnattended ? 'list' : 'capture');
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

  const columns: TableColumn<LeadRecord>[] = [];
  if (canAssign) {
    columns.push({
      key: 'select',
      header: (
        <input
          type="checkbox"
          className={leadStyles.checkbox}
          checked={allOnPageSelected}
          onChange={togglePageSelection}
          aria-label={allOnPageSelected ? 'Deselect all leads on this page' : 'Select all leads on this page'}
        />
      ),
      headerClassName: leadStyles.checkCell,
      cellClassName: leadStyles.checkCell,
      render: (l) => (
        <input
          type="checkbox"
          className={leadStyles.checkbox}
          checked={selectedIds.has(l.id)}
          onChange={() => toggleRowSelection(l.id)}
          aria-label={`Select lead ${l.name || l.company || l.id}`}
        />
      )
    });
  }
  columns.push(
    { key: 'name', header: 'Name', render: (l) => l.name || '-' },
    { key: 'company', header: 'Company', render: (l) => l.company || '-' },
    { key: 'designation', header: 'Designation', render: (l) => l.designation || '-' },
    { key: 'mobile', header: 'Mobile', cellClassName: leadStyles.num, render: (l) => l.mobile || '-' },
    { key: 'email', header: 'Email', render: (l) => l.email || '-' },
    {
      key: 'interests',
      header: 'Interests',
      render: (l) =>
        l.interests.length > 0 ? (
          <div className={leadStyles.interestIcons}>
            {l.interests.map((d) => {
              const tile = LEAD_DOMAIN_TILES.find((t) => t.key === d);
              const Icon = tile?.icon;
              return Icon ? <Icon key={d} size={14} /> : <span key={d}>{d}</span>;
            })}
          </div>
        ) : (
          '-'
        )
    },
    {
      key: 'priority',
      header: 'Priority',
      render: (l) => {
        if (!l.priority) return <span className={leadStyles.emptyCell}>-</span>;
        const Icon = LEAD_PRIORITY_META[l.priority].icon;
        return <PriorityBadge tone={l.priority} icon={<Icon size={12} />} label={l.priority.toUpperCase()} />;
      }
    },
    { key: 'source', header: 'Source', render: (l) => <SourceBadge lead={l} onClick={() => setMetaInfoLead(l)} /> },
    {
      key: 'assignedTo',
      header: 'Assigned To',
      cellClassName: leadStyles.assigneeCell,
      render: (l) =>
        canAssign ? (
          <select
            className={`${leadStyles.rowSelect} ${!l.assigned_to_id ? leadStyles.rowSelectUnassigned : ''}`}
            value={l.assigned_to_id || ''}
            disabled={assigningId === l.id}
            onChange={(e) => handleRowAssign(l.id, e.target.value)}
            aria-label={`Assign lead ${l.name || l.company || l.id} to`}
          >
            <option value="">Unassigned</option>
            {(assignees || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            {/* Keeps the current assignee selectable even if they've since
                moved out of the assignable set (department change,
                deactivation) — otherwise the select would silently show
                "Unassigned" for a lead that is in fact assigned. */}
            {l.assigned_to_id && !(assignees || []).some((a) => a.id === l.assigned_to_id) && (
              <option value={l.assigned_to_id}>{l.assigned_to_name || l.assigned_to} (inactive)</option>
            )}
          </select>
        ) : l.assigned_to ? (
          <>
            <span className={leadStyles.assigneeName}>
              {l.assigned_to_name || l.assigned_to}
              {l.assigned_to === currentUser.username && <span className={leadStyles.assigneeMine}>You</span>}
            </span>
            {l.assigned_by && <span className={leadStyles.assigneeMeta}>by {l.assigned_by}</span>}
          </>
        ) : (
          <span className={leadStyles.unassignedPill}>Unassigned</span>
        )
    },
    { key: 'capturedBy', header: 'Captured By', render: (l) => l.created_by },
    { key: 'date', header: 'Date', render: (l) => formatDateTime(l.created_at) },
    {
      key: 'actions',
      header: '',
      render: (l) => (
        <div className={leadStyles.rowActions}>
          <ToolbarButton onClick={() => openEditLead(l)} aria-label={`Edit lead ${l.name || l.company || l.id}`}>
            <Pencil size={12} style={{ verticalAlign: 'text-bottom', marginRight: 4 }} /> Edit
          </ToolbarButton>
          {!l.project_id ? (
            <ToolbarButton onClick={() => handleConvertToProject(l.id)}>To Project</ToolbarButton>
          ) : (
            <Link href={`/projects/${l.project_id}`} className={leadStyles.mutedLink}>View Project</Link>
          )}
          {isPrivileged && <DeleteButton onClick={() => handleDelete(l)}>Delete</DeleteButton>}
        </div>
      )
    }
  );

  return (
    <AppShell title="Lead Capture / Inquiry" subtitle="Scan a business card, bulk-import from CSV or photos, qualify the lead, and follow up — all in one flow.">
        {stats && (
          <div className={leadStyles.statsRow}>
            <StatTile value={stats.total} label="Total Leads" />
            <StatTile value={stats.today} label="Captured Today" tone="success" />
            <StatTile value={stats.hot} label="Hot Leads" tone="danger" icon={<Flame size={20} />} iconPosition="after" />
            {/* A sales manager's actual queue: what has come in and still
                needs routing to a rep. One tap filters the list to it. */}
            <StatTile
              value={stats.metaTotal}
              label="Meta Leads"
              tone="accent"
              icon={<Share2 size={18} />}
              onClick={() => { setMode('list'); setSourceFilter((v) => (v === 'meta_lead_ads' ? '' : 'meta_lead_ads')); }}
              active={sourceFilter === 'meta_lead_ads'}
            />
            <StatTile
              value={stats.unattended}
              label="Unattended"
              tone="danger"
              icon={<AlertTriangle size={20} />}
              onClick={() => { setMode('list'); setUnattendedOnly(true); }}
              active={unattendedOnly}
            />
            {canAssign && (
              <StatTile
                value={stats.unassigned}
                label="To Assign"
                tone="warning"
                icon={<UserPlus size={20} />}
                onClick={() => { setMode('list'); setAssigneeFilter(FILTER_UNASSIGNED); }}
                active={assigneeFilter === FILTER_UNASSIGNED}
                ariaPressed={assigneeFilter === FILTER_UNASSIGNED}
              />
            )}
            {/* Reps get the mirror image — what has been routed to them. */}
            {stats.assignedToMe > 0 && (
              <StatTile
                value={stats.assignedToMe}
                label="Assigned To Me"
                tone="info"
                icon={<UserCheck size={20} />}
                onClick={() => { setMode('list'); setAssigneeFilter(FILTER_MINE); }}
                active={assigneeFilter === FILTER_MINE}
                ariaPressed={assigneeFilter === FILTER_MINE}
              />
            )}
          </div>
        )}

        <SegmentedToggle options={MODE_OPTIONS} value={mode} onChange={(v) => (v === 'list' ? showAllLeads() : setMode(v))} />

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
            <FilterBar>
              <input type="text" placeholder="Search name, company, city, email, mobile..." value={q} onChange={(e) => setQ(e.target.value)} />
              <Select auto value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as LeadPriority | '')}>
                <option value="">All priorities</option>
                <option value="hot">Hot</option>
                <option value="warm">Warm</option>
                <option value="cool">Cold</option>
              </Select>
              <Select auto value={interestFilter} onChange={(e) => setInterestFilter(e.target.value as DomainKey | '')}>
                <option value="">All interests</option>
                {LEAD_DOMAIN_TILES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </Select>
              <Select auto value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as LeadSource | '')}>
                <option value="">All sources</option>
                <option value="meta_lead_ads">Meta Lead Ads</option>
                <option value="manual">Manual</option>
                <option value="business_card">Business Card</option>
                <option value="csv_import">CSV Import</option>
              </Select>
              <Select auto value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} aria-label="Filter by assignee">
                <option value="">All assignees</option>
                <option value={FILTER_UNASSIGNED}>Unassigned</option>
                <option value={FILTER_MINE}>Assigned to me</option>
                {(assignees || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
              <Select auto value={sortBy} onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'name')}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name (A-Z)</option>
              </Select>
              <SegmentedButton
                active={unattendedOnly}
                className={unattendedOnly ? leadStyles.unattendedActive : undefined}
                onClick={() => setUnattendedOnly((v) => !v)}
              >
                Unattended only
              </SegmentedButton>
              <ToolbarButton onClick={loadLeads}>Refresh</ToolbarButton>
              <ToolbarLink href="/api/leads/export.csv">Export CSV</ToolbarLink>
              <ToolbarButton onClick={() => window.print()}>Print</ToolbarButton>
            </FilterBar>
            {!loading && !loadFailed && <div className={leadStyles.status}>{status}</div>}

            {canAssign && selectedVisibleIds.length > 0 && (
              <div className={leadStyles.bulkBar}>
                <span className={leadStyles.bulkCount}>
                  {selectedVisibleIds.length} lead{selectedVisibleIds.length === 1 ? '' : 's'} selected
                </span>
                <select
                  className={leadStyles.bulkSelect}
                  value={bulkAssigneeId}
                  onChange={(e) => setBulkAssigneeId(e.target.value)}
                  aria-label="Assign selected leads to"
                >
                  <option value="">— Unassign —</option>
                  {(assignees || []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.designation ? ` · ${a.designation}` : ''}</option>
                  ))}
                </select>
                <ToolbarButton primary onClick={handleBulkAssign} disabled={bulkBusy}>
                  {bulkBusy ? 'Assigning…' : bulkAssigneeId ? 'Assign' : 'Unassign'}
                </ToolbarButton>
                <button type="button" className={leadStyles.linkBtn} onClick={() => setSelectedIds(new Set())}>
                  Clear selection
                </button>
              </div>
            )}

            {loading ? (
              <TableWrap><SkeletonRows rows={8} columns={9} /></TableWrap>
            ) : loadFailed ? (
              <ErrorState message="Could not load leads — check your connection and try again." onRetry={loadLeads} />
            ) : (
              <Table
                columns={columns}
                rows={pageRows}
                rowKey={(l) => l.id}
                rowClassName={(l) => (selectedIds.has(l.id) ? leadStyles.rowSelected : undefined)}
                empty={
                  <EmptyState
                    icon={Contact}
                    title={leads.length === 0 ? 'No leads captured yet' : 'No leads match your filters'}
                    message={leads.length === 0 ? 'Scan a business card to capture your first lead.' : 'Try clearing a filter or search term.'}
                    action={leads.length === 0 ? <button type="button" className={leadStyles.primaryBtn} onClick={() => setMode('capture')}>Capture a Lead</button> : undefined}
                  />
                }
              />
            )}

            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}

        {metaInfoLead && (
          <Modal
            title="Meta Information"
            ariaLabel="Meta Information"
            size="wide"
            onClose={() => setMetaInfoLead(null)}
            footer={<ModalOkButton onClick={() => setMetaInfoLead(null)}>Close</ModalOkButton>}
          >
            <div className={leadStyles.metaGrid}>
              <span className={leadStyles.metaLabel}>Platform</span><span>{metaPlatformLabel(metaInfoLead.meta_platform)}</span>
              <span className={leadStyles.metaLabel}>Campaign</span><span>{metaInfoLead.meta_campaign_name || '—'}</span>
              <span className={leadStyles.metaLabel}>Ad Set</span><span>{metaInfoLead.meta_adset_name || '—'}</span>
              <span className={leadStyles.metaLabel}>Ad</span><span>{metaInfoLead.meta_ad_name || '—'}</span>
              <span className={leadStyles.metaLabel}>Form</span><span>{metaInfoLead.meta_form_name || '—'}</span>
              <span className={leadStyles.metaLabel}>Meta Lead ID</span><span className={leadStyles.metaMono}>{metaInfoLead.meta_lead_id || '—'}</span>
              <span className={leadStyles.metaLabel}>Received</span><span>{formatDateTime(metaInfoLead.meta_created_at)}</span>
            </div>
          </Modal>
        )}

        {editingLead && (
          <Modal
            title="Edit Lead"
            ariaLabel="Edit Lead"
            size="wide"
            dismissible={!savingEdit}
            onClose={() => setEditingLead(null)}
            footer={
              <>
                <ModalCancelButton disabled={savingEdit} onClick={() => setEditingLead(null)}>Cancel</ModalCancelButton>
                <ModalOkButton disabled={savingEdit} onClick={handleSaveEdit}>{savingEdit ? 'Saving…' : 'Save Changes'}</ModalOkButton>
              </>
            }
          >
            <FieldRow className={leadStyles.firstRow}>
              <Field label="Name">
                <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label="Company">
                <Input value={editForm.company} onChange={(e) => setEditForm((f) => ({ ...f, company: e.target.value }))} />
              </Field>
              <Field label="Designation">
                <Input value={editForm.designation} onChange={(e) => setEditForm((f) => ({ ...f, designation: e.target.value }))} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Mobile">
                <PhoneInput value={editForm.mobile} onChange={(v) => setEditForm((f) => ({ ...f, mobile: v }))} />
              </Field>
              <Field label="Email">
                <Input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} />
              </Field>
              <Field label="City">
                <Input value={editForm.city} onChange={(e) => setEditForm((f) => ({ ...f, city: e.target.value }))} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Budget">
                <Input value={editForm.budget} onChange={(e) => setEditForm((f) => ({ ...f, budget: e.target.value }))} />
              </Field>
              <Field label="Priority">
                <Select value={editForm.priority} onChange={(e) => setEditForm((f) => ({ ...f, priority: e.target.value as LeadPriority }))}>
                  <option value="">Unrated</option>
                  <option value="hot">{LEAD_PRIORITY_META.hot.label}</option>
                  <option value="warm">{LEAD_PRIORITY_META.warm.label}</option>
                  <option value="cool">{LEAD_PRIORITY_META.cool.label}</option>
                </Select>
              </Field>
            </FieldRow>
            <Field label="Notes">
              <Textarea rows={3} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </Modal>
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
