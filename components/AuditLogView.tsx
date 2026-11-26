'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuditLogEntry } from '@/lib/types';
import { exportListToPdf } from '@/lib/exportPdf';
import AppShell from './AppShell';
import styles from './quotationHistory.module.css';
import auditStyles from './auditLog.module.css';
import calcStyles from './calculator.module.css';
import ToolbarButton from './ui/ToolbarButton';
import Dropdown from './ui/Dropdown';
import { setListParam } from '@/lib/listParam';
import CommonButton from './ui/CommonButton';
import Table, { TableColumn } from './ui/Table';
import TablePager from './ui/TablePager';
import { Skeleton, SkeletonTable } from './ui/Skeleton';
import { RefreshButton } from './ui/ListControls';

const ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: 'demo', label: 'Demo requests' },
  { value: 'delivery_challan', label: 'Delivery Challans' },
  { value: 'custom_module', label: 'Custom Modules' },
  { value: 'lead', label: 'Leads' },
  { value: 'quotation', label: 'Quotations' },
  { value: 'marketing_request', label: 'Marketing Requests' },
  { value: 'project', label: 'Projects' },
  { value: 'department', label: 'Departments' },
  { value: 'user_import', label: 'User Imports' },
  { value: 'tms_project', label: 'TMS Projects' },
  { value: 'tms_task', label: 'TMS Tasks' },
  { value: 'tms_bom_request', label: 'TMS BOM Requests' },
  { value: 'travel_schedule', label: 'Travel Schedule' },
  { value: 'reimbursement_sheet', label: 'Reimbursement Sheets' },
  { value: 'general_task', label: 'Tasks' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'leave_request', label: 'Leave Requests' },
  { value: 'employee_exit', label: 'Employee Exits' }
];

const DEFAULT_PAGE_SIZE = 50;
// The API caps a page at 200 rows (lib/auditLogStore.ts MAX_PAGE_SIZE).
const PAGE_SIZES = [25, 50, 100, 200] as const;

interface Filters {
  search: string;
  // Multi-select: an empty list means no filter (sent as repeated params, lib/listParam).
  entityType: string[];
  by: string[];
  role: string[];
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  entityType: [],
  by: [],
  role: [],
  dateFrom: '',
  dateTo: ''
};

function formatDateTime(iso: string): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('en-IN');
  } catch {
    return iso;
  }
}

export default function AuditLogView() {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [facets, setFacets] = useState<{ users: string[]; roles: string[] }>({ users: [], roles: [] });
  const [failed, setFailed] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // Typing filters server-side, so the query is debounced rather than fired
  // per keystroke against a table with thousands of rows.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(filters.search);
      // Reset here rather than in an effect of its own: staying on page 12
      // of a result set that now has two pages shows an empty table that
      // reads as "no results".
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const activeCount = useMemo(
    () => (Object.keys(EMPTY_FILTERS) as (keyof Filters)[]).filter((key) => { const v = filters[key]; return Array.isArray(v) ? v.length > 0 : v.trim() !== ''; }).length,
    [filters]
  );

  const requestKey = [page, pageSize, debouncedSearch, filters.entityType.join(','), filters.by.join(','), filters.role.join(','), filters.dateFrom, filters.dateTo].join('|');
  const loading = loadedKey !== requestKey;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      setListParam(params, 'entityType', filters.entityType);
      setListParam(params, 'by', filters.by);
      setListParam(params, 'role', filters.role);
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);

      const response = await fetch(`/api/admin/audit-log?${params.toString()}`);
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      setRows(data.entries ?? []);
      setTotal(data.total ?? 0);
      if (data.facets) setFacets(data.facets);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoadedKey(requestKey);
    }
  }, [requestKey, page, pageSize, debouncedSearch, filters.entityType, filters.by, filters.role, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    // Every filter but the search box applies immediately, so the page reset
    // belongs with the change itself. Search resets on its debounce above.
    if (key !== 'search') setPage(1);
  }

  // Exports what is on screen — the current page of the current filter.
  // Exporting the unfiltered table from a filtered view is the kind of
  // mismatch that ends up in a report nobody can reconcile.
  function handleExportPdf() {
    exportListToPdf(
      'Audit Log',
      ['Date/Time', 'User', 'Role', 'Entity', 'Action', 'Previous Status', 'New Status', 'Remarks', 'IP'],
      rows.map((r) => [formatDateTime(r.at), r.by, r.role, `${r.entity_type} ${r.entity_id}`, r.action, r.previous_status, r.new_status, r.remarks, r.ip]),
      `audit-log-${new Date().toISOString().slice(0, 10)}.pdf`
    );
  }

  const columns: TableColumn<AuditLogEntry>[] = [
    { key: 'at', header: 'Date/Time', render: (r) => formatDateTime(r.at) },
    { key: 'by', header: 'User', render: (r) => r.by },
    { key: 'role', header: 'Role', render: (r) => r.role },
    { key: 'entity', header: 'Entity', render: (r) => `${r.entity_type} ${r.entity_id}` },
    { key: 'action', header: 'Action', render: (r) => r.action },
    { key: 'statusChange', header: 'Previous → New', render: (r) => `${r.previous_status || '-'} → ${r.new_status || '-'}` },
    { key: 'remarks', header: 'Remarks', render: (r) => r.remarks || '-' },
    { key: 'ip', header: 'IP', render: (r) => r.ip || '-' }
  ];


  return (
    <AppShell fillPage title="Audit Log" subtitle="Every status-changing action across the platform.">
      <div className={auditStyles.filterPanel}>
        <div className={auditStyles.filterGrid}>
          <label className={auditStyles.field}>
            <span className={auditStyles.label}>Search</span>
            <input
              type="search"
              className={calcStyles.formControl}
              placeholder="User, action, remark, status, IP…"
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
            />
          </label>

          <label className={auditStyles.field}>
            <span className={auditStyles.label}>Entity</span>
            <Dropdown multiselect fullWidth ariaLabel="Entity" placeholder="All entities" value={filters.entityType} onChange={(v) => set('entityType', v)} options={ENTITY_OPTIONS} />
          </label>

          {/* Options come from the table itself, so a user or role with no
              entries is never offered — a filter that can only ever return
              nothing is worse than no filter. */}
          <label className={auditStyles.field}>
            <span className={auditStyles.label}>User</span>
            <Dropdown multiselect fullWidth ariaLabel="User" placeholder="Everyone" value={filters.by} onChange={(v) => set('by', v)} options={facets.users.map((user) => ({ value: user, label: user }))} />
          </label>

          <label className={auditStyles.field}>
            <span className={auditStyles.label}>Role</span>
            <Dropdown multiselect fullWidth ariaLabel="Role" placeholder="All roles" value={filters.role} onChange={(v) => set('role', v)} options={facets.roles.map((role) => ({ value: role, label: role }))} />
          </label>

          <label className={auditStyles.field}>
            <span className={auditStyles.label}>From</span>
            <input type="date" className={calcStyles.formControl} value={filters.dateFrom} max={filters.dateTo || undefined} onChange={(e) => set('dateFrom', e.target.value)} />
          </label>

          <label className={auditStyles.field}>
            <span className={auditStyles.label}>To</span>
            <input type="date" className={calcStyles.formControl} value={filters.dateTo} min={filters.dateFrom || undefined} onChange={(e) => set('dateTo', e.target.value)} />
          </label>
        </div>

        <div className={auditStyles.filterActions}>
          <span className={auditStyles.resultCount}>
            {loading
              ? <Skeleton inline width={90} height={14} />
              : failed
                ? 'Could not reach the audit log API. Try refreshing.'
                : total
                  ? `${total.toLocaleString('en-IN')} entr${total === 1 ? 'y' : 'ies'}`
                  : ''}
          </span>
          {activeCount > 0 && (
            <CommonButton variant="link" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
            </CommonButton>
          )}
          <ToolbarButton onClick={handleExportPdf}>Export page as PDF</ToolbarButton>
          <RefreshButton onRefresh={load} pushRight />
        </div>
      </div>

      {loading && <SkeletonTable columns={columns.length} rows={8} />}
      {!loading && !failed && (
        <>
          <Table
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            empty={
              <div className={styles.empty}>
                {activeCount > 0 ? 'No entries match these filters.' : 'No audit log entries yet.'}
              </div>
            }
          />
          <TablePager
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            noun={total === 1 ? 'entry' : 'entries'}
            sizes={PAGE_SIZES}
            allowAll={false}
          />
        </>
      )}
    </AppShell>
  );
}
