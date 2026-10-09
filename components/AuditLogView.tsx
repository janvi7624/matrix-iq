'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuditLogEntry } from '@/lib/types';
import { exportListToPdf } from '@/lib/exportPdf';
import AppShell from './AppShell';
import styles from './quotationHistory.module.css';
import auditStyles from './auditLog.module.css';
import calcStyles from './calculator.module.css';
import ToolbarButton from './ui/ToolbarButton';
import Table, { TableColumn } from './ui/Table';
import Pagination from './ui/Pagination';

const ENTITY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All entities' },
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

const PAGE_SIZE = 50;

const EMPTY_FILTERS = {
  search: '',
  entityType: '',
  by: '',
  role: '',
  dateFrom: '',
  dateTo: ''
};

type Filters = typeof EMPTY_FILTERS;

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
    () => (Object.keys(EMPTY_FILTERS) as (keyof Filters)[]).filter((key) => filters[key].trim() !== '').length,
    [filters]
  );

  const requestKey = [page, debouncedSearch, filters.entityType, filters.by, filters.role, filters.dateFrom, filters.dateTo].join('|');
  const loading = loadedKey !== requestKey;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      if (filters.entityType) params.set('entityType', filters.entityType);
      if (filters.by) params.set('by', filters.by);
      if (filters.role) params.set('role', filters.role);
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
  }, [requestKey, page, debouncedSearch, filters.entityType, filters.by, filters.role, filters.dateFrom, filters.dateTo]);

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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppShell title="Audit Log" subtitle="Every status-changing action across the platform.">
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
            <select className={calcStyles.formControl} value={filters.entityType} onChange={(e) => set('entityType', e.target.value)}>
              {ENTITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          {/* Options come from the table itself, so a user or role with no
              entries is never offered — a filter that can only ever return
              nothing is worse than no filter. */}
          <label className={auditStyles.field}>
            <span className={auditStyles.label}>User</span>
            <select className={calcStyles.formControl} value={filters.by} onChange={(e) => set('by', e.target.value)}>
              <option value="">Everyone</option>
              {facets.users.map((user) => (
                <option key={user} value={user}>{user}</option>
              ))}
            </select>
          </label>

          <label className={auditStyles.field}>
            <span className={auditStyles.label}>Role</span>
            <select className={calcStyles.formControl} value={filters.role} onChange={(e) => set('role', e.target.value)}>
              <option value="">All roles</option>
              {facets.roles.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
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
              ? 'Loading…'
              : failed
                ? 'Could not reach the audit log API. Try refreshing.'
                : total
                  ? `${total.toLocaleString('en-IN')} entr${total === 1 ? 'y' : 'ies'}`
                  : ''}
          </span>
          {activeCount > 0 && (
            <button type="button" className={auditStyles.clearBtn} onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
            </button>
          )}
          <ToolbarButton onClick={handleExportPdf}>Export page as PDF</ToolbarButton>
          <ToolbarButton onClick={load}>Refresh</ToolbarButton>
        </div>
      </div>

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
          {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
        </>
      )}
    </AppShell>
  );
}
