'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { QuotationEffectiveStatus, QuotationRecord } from '@/lib/types';
import { needsFollowUp } from '@/lib/followUp';
import QuotationTable from './QuotationTable';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import { useToast } from './ui/ToastProvider';
import { SkeletonRows } from './ui/Skeleton';
import ErrorState from './ui/ErrorState';
import { TableWrap } from './ui/Table';
import FilterBar from './ui/FilterBar';
import Select from './ui/Select';
import Input from './ui/Input';
import ToolbarButton, { ToolbarLink } from './ui/ToolbarButton';
import Table from './ui/Table';
import { formatMoney } from '@/lib/format';
import { computeEffectiveStatusClient } from '@/lib/quotationStatus';

const STATUS_OPTIONS: { value: QuotationEffectiveStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' }
];

interface QuotationSummaryRow {
  name: string;
  /** The appended team-wide row, styled as a footer rather than a person. */
  isTotal?: boolean;
  value: number;
  total: number;
  draft: number;
  sent: number;
  approved: number;
  followUps: number;
}

interface CurrentViewer {
  username: string;
  role: string;
  isPrivileged: boolean;
}

const ORG_WIDE_ROLES = new Set(['superadmin', 'admin']);

interface MyQuotationsViewProps {
  /** Renders without its own AppShell/Sidebar — for hosting inside a tabbed
      parent page (see components/QuotationsView.tsx) instead of as its own route. */
  embedded?: boolean;
}

export default function MyQuotationsView({ embedded }: MyQuotationsViewProps = {}) {
  // Set when arriving from a "view this quotation" link elsewhere (e.g. the
  // Dashboard's Recent Quotations card) — passed straight through to
  // QuotationTable so it can auto-expand and scroll to that one row instead
  // of making the visitor hunt for it in the list.
  const highlightId = useSearchParams().get('highlight') || '';
  const [viewer, setViewer] = useState<CurrentViewer | null>(null);
  const [rows, setRows] = useState<QuotationRecord[]>([]);
  const [status, setStatus] = useState('Loading...');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [fSalesPerson, setFSalesPerson] = useState('');
  const [fStatus, setFStatus] = useState<QuotationEffectiveStatus | ''>('');
  const [fProjectId, setFProjectId] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [followUpOnly, setFollowUpOnly] = useState(false);
  const toast = useToast();

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (me) {
          setViewer({
            username: me.username,
            role: me.role,
            isPrivileged: !!me.isPrivileged
          });
        }
      })
      .catch(() => setViewer(null));
  }, []);

  const isPrivileged = viewer?.isPrivileged ?? false;
  const canDelete = viewer?.role === 'superadmin';

  const load = useCallback(async () => {
    setStatus('Loading...');
    setLoaded(false);
    setLoading(true);
    setLoadFailed(false);
    try {
      const params = new URLSearchParams();
      if (searchValue.trim()) params.set('q', searchValue.trim());
      if (fSalesPerson.trim()) params.set('salesPerson', fSalesPerson.trim());
      if (fStatus) params.set('status', fStatus);
      if (fProjectId.trim()) params.set('projectId', fProjectId.trim());
      if (fFrom) params.set('dateFrom', fFrom);
      if (fTo) params.set('dateTo', fTo);
      const qs = params.toString();
      const response = await fetch('/api/quotations/mine' + (qs ? `?${qs}` : ''));
      if (!response.ok) throw new Error(String(response.status));
      const data: QuotationRecord[] = await response.json();
      setRows(data);
      setStatus(data.length ? `${data.length} quotation${data.length === 1 ? '' : 's'} found.` : '');
      setLoaded(true);
    } catch {
      setStatus('Could not reach the quotation API. Try refreshing.');
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [searchValue, fSalesPerson, fStatus, fProjectId, fFrom, fTo]);

  useEffect(() => {
    load();
  }, [load]);

  const visibleRows = useMemo(() => (followUpOnly ? rows.filter((r) => needsFollowUp(r)) : rows), [rows, followUpOnly]);

  // Per-person roll-up for Sales leadership. Built from `rows` — what the
  // search actually returned — not `visibleRows`, so switching the
  // "needs follow-up only" view filter re-scopes the TABLE without silently
  // rewriting the summary underneath it.
  //
  // Status comes from computeEffectiveStatusClient, the same function the
  // table's Status column uses. Reading `r.status` would be wrong: 'expired'
  // is derived from the validity window and never stored, so a lapsed
  // quotation would be counted as whatever it was last saved as and the
  // summary would disagree with the rows below it.
  const teamSummary = useMemo(() => {
    const byPerson = new Map<string, QuotationSummaryRow>();
    for (const r of rows) {
      const who = r.created_by || r.prepared_by || 'Unattributed';
      let row = byPerson.get(who);
      if (!row) {
        row = { name: who, value: 0, total: 0, draft: 0, sent: 0, approved: 0, followUps: 0 };
        byPerson.set(who, row);
      }
      row.total += 1;
      row.value += typeof r.total === 'number' ? r.total : 0;
      const effective = computeEffectiveStatusClient(r);
      if (effective === 'draft') row.draft += 1;
      else if (effective === 'sent') row.sent += 1;
      else if (effective === 'approved') row.approved += 1;
      if (needsFollowUp(r)) row.followUps += 1;
    }
    // Highest quote value first — a name-sorted list tells a manager nothing
    // at a glance. Name breaks ties so the order is stable.
    const people = [...byPerson.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    if (people.length < 2) return people;
    // A team-wide row, so the question "what did we quote in total" doesn't
    // need mental arithmetic. Only worth showing once there's more than one
    // person to add up.
    const totals: QuotationSummaryRow = {
      name: 'Team total',
      isTotal: true,
      value: people.reduce((n, r) => n + r.value, 0),
      total: people.reduce((n, r) => n + r.total, 0),
      draft: people.reduce((n, r) => n + r.draft, 0),
      sent: people.reduce((n, r) => n + r.sent, 0),
      approved: people.reduce((n, r) => n + r.approved, 0),
      followUps: people.reduce((n, r) => n + r.followUps, 0)
    };
    return [...people, totals];
  }, [rows]);

  const peopleCount = teamSummary.filter((r) => !r.isTotal).length;

  const salesPeople = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.created_by) set.add(r.created_by);
      else if (r.prepared_by) set.add(r.prepared_by);
    }
    return Array.from(set).sort();
  }, [rows]);

  async function handleDelete(id: string) {
    try {
      const response = await fetch(`/api/admin/quotations/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(`Server responded with ${response.status}`);
      const next = rows.filter((r) => r.id !== id);
      setRows(next);
      setStatus(next.length ? `${next.length} quotation${next.length === 1 ? '' : 's'} found.` : '');
      toast.success('Quotation deleted successfully.');
    } catch {
      toast.error('Could not delete this quotation. Please try again.');
    }
  }

  async function handleLogFollowUp(id: string, note: string) {
    try {
      const response = await fetch(`/api/quotations/${id}/follow-up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note })
      });
      if (!response.ok) throw new Error(String(response.status));
      const updated: QuotationRecord = await response.json();
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      toast.success('Follow-up logged.');
    } catch {
      toast.error('Could not log this follow-up. Please try again.');
    }
  }

  async function handleChangeStatus(id: string, next: QuotationRecord['status']) {
    try {
      const response = await fetch(`/api/quotations/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next })
      });
      if (!response.ok) throw new Error(String(response.status));
      const updated: QuotationRecord = await response.json();
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      toast.success('Status updated.');
    } catch {
      toast.error('Could not update the status. Please try again.');
    }
  }

  const subtitle = ORG_WIDE_ROLES.has(viewer?.role ?? '')
    ? 'All quotations across the organization — with versions, status, and follow-ups.'
    : isPrivileged
      ? 'Quotations across your department — with versions, status, and follow-ups.'
      : "Quotations you've created — with versions, status, and follow-ups.";

  const content = (
    <>
      {/* Sales leadership only — a rep looking at their own quotations has
          no use for a one-row table of themselves. */}
      {isPrivileged && teamSummary.length > 0 && (
        <div className={historyStyles.teamSummaryCard}>
          <div className={historyStyles.teamSummaryHead}>
            <h3 className={historyStyles.teamSummaryTitle}>Sales Team Summary</h3>
            <span className={historyStyles.teamSummaryMeta}>
              {peopleCount} {peopleCount === 1 ? 'person' : 'people'} · {rows.length} quotation{rows.length === 1 ? '' : 's'}
            </span>
          </div>
          <Table
            rows={teamSummary}
            rowKey={(row) => row.name}
            tableClassName={historyStyles.teamSummaryTable}
            wrapClassName={historyStyles.teamSummaryViewport}
            rowClassName={(row) => (row.isTotal ? historyStyles.teamSummaryTotalRow : undefined)}
            columns={[
              { key: 'name', header: 'Sales Team', render: (row) => row.name },
              {
                key: 'value',
                header: 'Quote Value',
                headerClassName: historyStyles.teamSummaryNum,
                cellClassName: historyStyles.teamSummaryNum,
                render: (row) => formatMoney(row.value)
              },
              ...([
                { key: 'total', header: 'Total Quotes', pick: (row: QuotationSummaryRow) => row.total },
                { key: 'draft', header: 'Draft', pick: (row: QuotationSummaryRow) => row.draft },
                { key: 'sent', header: 'Sent', pick: (row: QuotationSummaryRow) => row.sent },
                { key: 'approved', header: 'Approved', pick: (row: QuotationSummaryRow) => row.approved }
              ].map((c) => ({
                key: c.key,
                header: c.header,
                headerClassName: historyStyles.teamSummaryNum,
                cellClassName: historyStyles.teamSummaryNum,
                // A zero is greyed rather than printed at full strength, so
                // the eye lands on the columns that actually have something.
                render: (row: QuotationSummaryRow) => (
                  <span className={c.pick(row) === 0 ? historyStyles.teamSummaryZero : undefined}>{c.pick(row)}</span>
                )
              }))),
              {
                key: 'followUps',
                header: 'Follow-ups Due',
                headerClassName: historyStyles.teamSummaryNum,
                cellClassName: historyStyles.teamSummaryNum,
                // The one actionable number in the table — called out in the
                // danger colour when there is anything outstanding.
                render: (row) => (
                  <span className={row.followUps > 0 ? historyStyles.teamSummaryFlag : historyStyles.teamSummaryZero}>
                    {row.followUps}
                  </span>
                )
              }
            ]}
          />
        </div>
      )}
      <FilterBar>
        <input
          type="text"
          placeholder="Search by quotation number, client, company, prepared by..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load();
          }}
        />
        {isPrivileged && (
          <Select auto value={fSalesPerson} onChange={(e) => setFSalesPerson(e.target.value)}>
            <option value="">All sales people</option>
            {salesPeople.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
        <Select auto value={fStatus} onChange={(e) => setFStatus(e.target.value as QuotationEffectiveStatus | '')}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <input
          type="text"
          placeholder="Project ID"
          value={fProjectId}
          onChange={(e) => setFProjectId(e.target.value)}
          className={historyStyles.projectIdInput}
        />
        <Input auto type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        <Input auto type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
        <ToolbarButton primary onClick={() => load()}>
          Search
        </ToolbarButton>
        <ToolbarButton onClick={() => load()}>
          Refresh
        </ToolbarButton>
        {isPrivileged && (
          <>
            <label className={historyStyles.followUpCheckboxLabel}>
              <input type="checkbox" checked={followUpOnly} onChange={(e) => setFollowUpOnly(e.target.checked)} />
              Needs follow-up only
            </label>
            <ToolbarLink href="/api/admin/quotations/export.csv">
              Export CSV
            </ToolbarLink>
            <ToolbarLink href="/api/admin/quotations/export.xlsx">
              Export XLSX
            </ToolbarLink>
          </>
        )}
      </FilterBar>
      {!loading && !loadFailed && <div className={historyStyles.status}>{status}</div>}
      {loading ? (
        <TableWrap>
          <SkeletonRows rows={8} columns={12} />
        </TableWrap>
      ) : loadFailed ? (
        <ErrorState message="Could not load quotations — check your connection and try again." onRetry={load} />
      ) : (
        loaded && (
          <QuotationTable
            rows={visibleRows}
            // Always shown here (not just isPrivileged) — this is the
            // viewer's OWN quotations, so seeing who actually created one
            // (e.g. Khushi/Maulik creating it on their behalf) is never a
            // privacy concern the way it would be on an org-wide view.
            showSalesPerson
            onDelete={canDelete ? handleDelete : undefined}
            onLogFollowUp={handleLogFollowUp}
            onChangeStatus={handleChangeStatus}
            highlightId={highlightId}
          />
        )
      )}
    </>
  );

  if (embedded) return content;
  return (
    <AppShell title="Existing Quotations" subtitle={subtitle}>
      {content}
    </AppShell>
  );
}
