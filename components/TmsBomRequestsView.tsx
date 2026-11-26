'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from '@/components/ui/AppLink';
import { FileText, Plus } from 'lucide-react';
import { TmsBomRequestRecord, TmsBomRequestStatus, TmsProjectRecord, UserRole } from '@/lib/types';
import { TMS_BOM_STATUS_LABEL, TMS_BOM_STATUS_TONE } from '@/lib/tmsLabels';
import { bomPendingWithLabel } from '@/lib/tmsBomApprovalChain';
import AppShell from './AppShell';
import CommonButton from './ui/CommonButton';
import StatCard, { StatCardGrid } from './ui/StatCard';
import tmsDashboardStyles from './tmsDashboard.module.css';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import StatusBadge from './ui/StatusBadge';
import Modal from './ui/Modal';
import { useToast } from './ui/ToastProvider';
import { Skeleton, SkeletonTable } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { Field, FieldRow } from './ui/Field';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import FilterBar from './ui/FilterBar';
import SearchInput from './ui/SearchInput';
import Dropdown, { inSelection } from './ui/Dropdown';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';
import { RefreshButton } from './ui/ListControls';

const EMPTY_FORM = {
  projectId: '',
  itemName: '',
  itemDescription: '',
  partNumber: '',
  quantity: '1',
  specification: '',
  preferredBrand: '',
  estimatedCost: '',
  requiredDate: '',
  remarks: ''
};

interface TmsBomRequestsViewProps {
  currentUser: { username: string; role: UserRole };
}

export default function TmsBomRequestsView({ currentUser }: TmsBomRequestsViewProps) {
  void currentUser;
  const toast = useToast();
  const [records, setRecords] = useState<TmsBomRequestRecord[]>([]);
  const [projects, setProjects] = useState<TmsProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState('Loading...');
  // Opened straight from a project hub — see the form initializer below.
  const [showForm, setShowForm] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('new') === '1';
  });
  // Opened straight from a project hub: /tms/bom-requests?new=1&projectId=<id>.
  // See TmsTasksView for why this reads the URL directly rather than using
  // useSearchParams().
  const [form, setForm] = useState(() => {
    if (typeof window === 'undefined') return EMPTY_FORM;
    const requested = new URLSearchParams(window.location.search).get('projectId') ?? '';
    return requested ? { ...EMPTY_FORM, projectId: requested } : EMPTY_FORM;
  });
  const [creating, setCreating] = useState(false);

  const [fProject, setFProject] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<TmsBomRequestStatus[]>([]);
  const [fSearch, setFSearch] = useState('');

  async function load() {
    setStatus('Loading...');
    setLoading(true);
    setLoadFailed(false);
    try {
      const [recordsRes, projectsRes] = await Promise.all([fetch('/api/tms/bom-requests'), fetch('/api/tms/projects')]);
      if (!recordsRes.ok) throw new Error(String(recordsRes.status));
      const data: TmsBomRequestRecord[] = await recordsRes.json();
      setRecords(data);
      if (projectsRes.ok) setProjects(await projectsRes.json());
      setStatus(data.length ? `${data.length} request${data.length === 1 ? '' : 's'} found.` : '');
    } catch {
      setStatus('Could not reach the TMS API. Try refreshing.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return records.filter((r) => {
      if (!inSelection(String(r.project_id), fProject)) return false;
      if (!inSelection(r.status, fStatus)) return false;
      if (q && ![r.bom_request_code, r.item_name, r.part_number].some((v) => (v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [records, fProject, fStatus, fSearch]);

  async function handleCreate(e: FormEvent, submit: boolean) {
    e.preventDefault();
    if (!form.projectId || !form.itemName.trim()) {
      toast.error('Project and item name are required.');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/tms/bom-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, quantity: Number(form.quantity) || 1, estimatedCost: Number(form.estimatedCost) || 0, submit })
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || String(response.status));
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
      toast.success(submit ? 'BOM request submitted.' : 'BOM request saved as draft.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create this BOM request.');
    } finally {
      setCreating(false);
    }
  }

  // Moved here from the old TMS Dashboard (now merged into /tms/projects) —
  // same bucket logic, now computed over this page's own already-loaded
  // `records` instead of a dashboard-wide fetch. See
  // ABSORBED_INTO_MERGED_PAGE in lib/moduleConfigStore.ts.
  const bomStats = useMemo(() => {
    const pending = records.filter((b) => b.status === 'draft' || b.status === 'submitted' || b.status === 'under_review');
    const approved = records.filter((b) => b.status === 'approved' || b.status === 'sent_for_procurement' || b.status === 'completed');
    const awaitingReview = records.filter((b) => b.status === 'submitted' || b.status === 'under_review');
    return {
      pending: pending.length, pendingItems: pending,
      approved: approved.length, approvedItems: approved,
      awaitingReview: awaitingReview.length, awaitingReviewItems: awaitingReview
    };
  }, [records]);

  interface DrilldownItem { id: string; label: string; sublabel: string; href: string }
  const [drilldown, setDrilldown] = useState<{ title: string; items: DrilldownItem[] } | null>(null);
  function showBom(title: string, items: TmsBomRequestRecord[]) {
    setDrilldown({ title, items: items.map((b) => ({ id: b.id, label: `${b.bom_request_code} — ${b.item_name}`, sublabel: TMS_BOM_STATUS_LABEL[b.status] || b.status, href: `/tms/bom-requests/${b.id}` })) });
  }

  const columns: TableColumn<TmsBomRequestRecord>[] = [
    { key: 'request', header: 'Request', cellClassName: historyStyles.num, render: (r) => r.bom_request_code },
    { key: 'project', header: 'Project', render: (r) => r.project_name },
    { key: 'item', header: 'Item', render: (r) => r.item_name },
    { key: 'qty', header: 'Qty', render: (r) => r.quantity },
    { key: 'requestedBy', header: 'Requested By', render: (r) => r.requested_by_name || '-' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge tone={TMS_BOM_STATUS_TONE[r.status]} label={TMS_BOM_STATUS_LABEL[r.status]} /> },
    // "Where is it stuck" as a scannable column — the status badge says what
    // has been approved, this says who it is sitting on now. Same helper the
    // detail page's chain uses, so the two cannot disagree.
    {
      key: 'pendingWith',
      header: 'Pending With',
      render: (r) => bomPendingWithLabel(r, r.finance_stage_enabled !== false).replace(/^Pending: /, '') || '-'
    },
    { key: 'actions', header: '', render: (r) => <CommonButton size="sm" href={`/tms/bom-requests/${r.id}`}>View</CommonButton> }
  ];

  return (
    <AppShell fillPage title="BOM Request" subtitle="Bill of materials requests, review, and approval.">
      <StatCardGrid>
        <StatCard value={loading && records.length === 0 ? <Skeleton width={64} height={24} /> : bomStats.pending} label="Pending BOM Requests" />
        <StatCard value={loading && records.length === 0 ? <Skeleton width={64} height={24} /> : bomStats.approved} label="Approved BOM Requests" onClick={() => showBom('Approved BOM Requests', bomStats.approvedItems)} actionLabel="View approved BOM requests" />
        <StatCard value={loading && records.length === 0 ? <Skeleton width={64} height={24} /> : bomStats.awaitingReview} label="Awaiting Review" tone="danger" onClick={() => showBom('Awaiting Review', bomStats.awaitingReviewItems)} actionLabel="View BOM requests awaiting review" />
      </StatCardGrid>

      <div className={historyStyles.actionRow}>
        {/* Hidden whenever the table is showing its empty state, because that
            state carries the New button itself — two of the same button on
            one screen is worse than none. Keyed on the FILTERED rows, not the
            full list: a bucket or filter that matches nothing still renders
            the empty state, so the header button has to stand down then too.
            Still shown once the form is open, because this same button is the
            form's Cancel and hiding it would leave no way out. */}
        {(loading || filtered.length > 0 || showForm) && (
          <CommonButton variant={showForm ? 'secondary' : 'primary'} leadingIcon={showForm ? undefined : <Plus />} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New BOM Request'}
          </CommonButton>
        )}
        <RefreshButton onRefresh={load} loading={loading} pushRight />
      </div>

      {showForm && (
        <form className={`${calcStyles.sectionPanel} ${calcStyles.sectionPanelSpaced}`}>
          <FieldRow>
            <Field label="Project">
              <Select value={form.projectId} onChange={(e) => setForm((f) => ({ ...f, projectId: e.target.value }))} required>
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Item name">
              <Input value={form.itemName} onChange={(e) => setForm((f) => ({ ...f, itemName: e.target.value }))} required />
            </Field>
            <Field label="Part number / Model">
              <Input value={form.partNumber} onChange={(e) => setForm((f) => ({ ...f, partNumber: e.target.value }))} />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Quantity">
              <Input type="number" min="1" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </Field>
            <Field label="Preferred brand / OEM">
              <Input value={form.preferredBrand} onChange={(e) => setForm((f) => ({ ...f, preferredBrand: e.target.value }))} />
            </Field>
            <Field label="Estimated cost">
              <Input type="number" min="0" value={form.estimatedCost} onChange={(e) => setForm((f) => ({ ...f, estimatedCost: e.target.value }))} />
            </Field>
            <Field label="Required date">
              <Input type="date" value={form.requiredDate} onChange={(e) => setForm((f) => ({ ...f, requiredDate: e.target.value }))} />
            </Field>
          </FieldRow>
          <Field label="Specification">
            <Textarea rows={2} value={form.specification} onChange={(e) => setForm((f) => ({ ...f, specification: e.target.value }))} />
          </Field>
          <Field label="Item description">
            <Textarea rows={2} value={form.itemDescription} onChange={(e) => setForm((f) => ({ ...f, itemDescription: e.target.value }))} />
          </Field>
          <Field label="Remarks">
            <Textarea rows={2} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </Field>
          <div className={historyStyles.rowActionsInline}>
            <ToolbarButton disabled={creating} onClick={(e) => handleCreate(e, false)}>
              {creating ? 'Saving…' : 'Save as draft'}
            </ToolbarButton>
            <CommonButton variant="primary" disabled={creating} onClick={(e) => handleCreate(e, true)}>
              {creating ? 'Submitting…' : 'Submit for review'}
            </CommonButton>
          </div>
        </form>
      )}

      <FilterBar>
        <SearchInput placeholder="Search request code, item, part number…" value={fSearch} onChange={(v) => setFSearch(v)} />
        <Dropdown
          multiple
          value={fProject}
          onChange={setFProject}
          placeholder="All projects"
          label="Project"
          options={projects.map((p) => ({ value: String(p.id), label: p.name }))}
        />
        <Dropdown<TmsBomRequestStatus>
          multiple
          value={fStatus}
          onChange={setFStatus}
          placeholder="All statuses"
          label="Status"
          options={(Object.keys(TMS_BOM_STATUS_LABEL) as TmsBomRequestStatus[]).map((s) => ({ value: s, label: TMS_BOM_STATUS_LABEL[s] }))}
        />
      </FilterBar>
      {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}

      {loading ? (
        <SkeletonTable columns={columns.length} rows={8} />
      ) : loadFailed ? (
        <ErrorState message="Could not load BOM requests — check your connection and try again." onRetry={load} />
      ) : (
        <Table
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          empty={
            <EmptyState
              icon={FileText}
              title={records.length === 0 ? 'No BOM requests yet' : 'No requests match your filters'}
              message={records.length === 0 ? 'Create a request to start tracking material requirements.' : 'Try clearing a filter or search term.'}
              action={<CommonButton variant="primary" leadingIcon={<Plus />} onClick={() => setShowForm(true)}>New BOM Request</CommonButton>}
            />
          }
        />
      )}

      {drilldown && (
        <Modal title={drilldown.title} ariaLabel={drilldown.title} onClose={() => setDrilldown(null)}>
          {drilldown.items.length === 0 ? (
            <p className={calcStyles.small}>Nothing in this bucket.</p>
          ) : (
            <ul className={tmsDashboardStyles.drilldownList}>
              {drilldown.items.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} className={tmsDashboardStyles.drilldownRow} onClick={() => setDrilldown(null)}>
                    <span className={tmsDashboardStyles.drilldownLabel}>{item.label}</span>
                    <span className={tmsDashboardStyles.drilldownSublabel}>{item.sublabel}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </AppShell>
  );
}
