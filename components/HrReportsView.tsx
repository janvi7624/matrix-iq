'use client';

import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, IndianRupee, RotateCcw } from 'lucide-react';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './hrExpenseReport.module.css';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import Select from './ui/Select';
import Button from './ui/Button';
import StatTile from './ui/StatTile';
import { useToast } from './ui/ToastProvider';
import { formatMoneyWhole } from '@/lib/format';
import {
  Granularity,
  PeriodScope,
  PeriodBounds,
  FALLBACK_BOUNDS,
  selectableYears,
  monthIsSelectable,
  quarterIsSelectable,
  resolveRange
} from '@/lib/hrReportPeriod';

type SourceKey = 'reimbursement' | 'admin_expense' | 'office_operation';
type GroupBy = 'employee' | 'department' | 'source';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const GRANULARITY_WORD: Record<Granularity, string> = { month: 'monthly', quarter: 'quarterly', year: 'yearly' };
const GROUP_HEADING: Record<GroupBy, string> = { employee: 'By Employee', department: 'By Department', source: 'By Expense Type' };
const COLUMN_HEADING: Record<GroupBy, string> = { employee: 'Employee', department: 'Department', source: 'Expense Type' };
const ROW_NOUN: Record<GroupBy, string> = { employee: 'employee', department: 'department', source: 'expense type' };

const ALL_SOURCES: SourceKey[] = ['reimbursement', 'admin_expense', 'office_operation'];
const SOURCE_LABEL: Record<SourceKey, string> = {
  reimbursement: 'Reimbursement',
  admin_expense: 'Admin Expense',
  office_operation: 'Office Operation'
};

interface ReportRow {
  key: string;
  label: string;
  sublabel: string;
  periods: Record<string, number>;
  sources: Record<SourceKey, number>;
  entries: number;
  total: number;
}

interface Report {
  from: string;
  to: string;
  granularity: Granularity;
  groupBy: GroupBy;
  sources: SourceKey[];
  buckets: { key: string; label: string }[];
  rows: ReportRow[];
  periodTotals: Record<string, number>;
  sourceTotals: Record<SourceKey, number>;
  grandTotal: number;
  entryCount: number;
}

interface FilterOptions {
  employees: { id: string; name: string; employeeId: string; department: string }[];
  departments: string[];
  /** Null until the first fetch lands, or when there is no spend at all. */
  bounds: PeriodBounds | null;
}

// One labelled control. A filter whose purpose is only legible from its
// current value stops being legible the moment it's changed.
function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.filterField}>
      <span className={styles.filterLabel}>{label}</span>
      {children}
    </div>
  );
}

// Up to two initials for the row's avatar — "HR & Admin" gives "HA", a
// one-word label its first letter.
function initialsOf(label: string): string {
  const words = label.split(/[\s&·]+/).filter((w) => /[a-z0-9]/i.test(w));
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '—';
}

function Money({ value, className }: { value: number; className?: string }) {
  const classes = [styles.num, value === 0 ? styles.zero : '', className || ''].filter(Boolean).join(' ');
  return <td className={classes}>{value === 0 ? '—' : formatMoneyWhole(value)}</td>;
}

export default function HrReportsView() {
  const toast = useToast();
  // Read once per mount: the report is a date-range query, so "the current
  // month" only has to agree with the calendar of whoever is reading it.
  const now = useMemo(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }, []);
  const currentYear = now.year;

  const [year, setYear] = useState(currentYear);
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [scope, setScope] = useState<PeriodScope>('all');
  // The Group By picker is gone — the report is always by employee, which
  // is what every consumer of it actually wanted. The value is still sent
  // to the API, which keeps supporting department/source grouping for the
  // XLSX export and any future caller; this view just no longer offers the
  // choice.
  const groupBy: GroupBy = 'employee';
  // Every register selected by default; unchecking one answers "show me
  // just reimbursement + admin expense" etc. Always kept non-empty (toggling
  // off the last remaining one is a no-op) — the API itself would 400 on an
  // empty list, so the UI never offers a selection it knows will fail.
  const [sourceFilter, setSourceFilter] = useState<SourceKey[]>(ALL_SOURCES);

  function toggleSource(key: SourceKey) {
    setSourceFilter((prev) => {
      const has = prev.includes(key);
      if (has && prev.length === 1) return prev;
      return has ? prev.filter((s) => s !== key) : [...prev, key];
    });
  }
  // A closed dropdown (not the inline chip row this replaced) so Expense
  // Type takes up exactly as much row width as every other filter and the
  // whole bar fits on one line — same open/close-on-outside-click pattern
  // as NotificationBell's panel.
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sourceDropdownRef.current && !sourceDropdownRef.current.contains(e.target as Node)) setSourceDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const [department, setDepartment] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [approvedOnly, setApprovedOnly] = useState(false);

  const [options, setOptions] = useState<FilterOptions>({ employees: [], departments: [], bounds: null });
  const [exporting, setExporting] = useState(false);
  // One state object keyed by the request it answered, rather than separate
  // report/loading/failed flags: `loading` is then DERIVED from "the newest
  // request hasn't landed yet", so no filter change can leave a stale report
  // on screen looking settled, and the effect never has to setState
  // synchronously to start a load.
  const [result, setResult] = useState<{ key: string; report: Report | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // One resolved window every picker and the range itself read from, so a
  // call site cannot be left on the old hardcoded floor by accident.
  const bounds = options.bounds ?? FALLBACK_BOUNDS;
  const { from, to } = useMemo(() => resolveRange(year, granularity, scope, now, bounds), [year, granularity, scope, now, bounds]);

  // The query string is built once and reused verbatim by the export, which
  // is what guarantees the spreadsheet matches the table on screen.
  const query = useMemo(() => {
    const params = new URLSearchParams({ from, to, granularity, groupBy, sources: sourceFilter.join(',') });
    if (department) params.set('department', department);
    if (employeeId) params.set('employeeId', employeeId);
    if (approvedOnly) params.set('approvedOnly', '1');
    return params.toString();
  }, [from, to, granularity, groupBy, sourceFilter, department, employeeId, approvedOnly]);

  const requestKey = `${query}#${attempt}`;
  const loading = !result || result.key !== requestKey;
  const report = result?.report ?? null;
  const loadFailed = !!result?.failed;

  useEffect(() => {
    let active = true;
    fetch(`/api/hr/reports?${query}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => { if (active) setResult({ key: requestKey, report: data, failed: false }); })
      .catch(() => { if (active) setResult({ key: requestKey, report: null, failed: true }); });
    return () => { active = false; };
  }, [query, requestKey, sourceFilter.length]);

  useEffect(() => {
    fetch('/api/hr/reports/filters')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setOptions(data))
      .catch(() => undefined);
  }, []);

  // A quarter number is meaningless once the view is monthly (and vice
  // versa), so switching granularity drops back to "all" rather than
  // silently reinterpreting Q3 as March.
  function changeGranularity(next: Granularity) {
    setGranularity(next);
    setScope('all');
  }

  // Newest first, back to the first year with data — never further.
  // `bounds` is in every dependency list below on purpose: it starts as the
  // fallback and is replaced once /filters lands, so a list memoised without
  // it would keep showing the fallback window forever.
  const yearChoices = useMemo(() => selectableYears(now, bounds), [now, bounds]);

  // Only periods inside the real data window — same predicates changeYear
  // re-checks below, so the list and the validation can't disagree.
  const monthChoices = useMemo(
    () => MONTH_NAMES.map((name, i) => ({ name, value: i + 1 })).filter((m) => monthIsSelectable(m.value, year, now, bounds)),
    [year, now, bounds]
  );
  const quarterChoices = useMemo(
    () => [1, 2, 3, 4].filter((q) => quarterIsSelectable(q, year, now, bounds)),
    [year, now, bounds]
  );

  // Switching year can invalidate the selected month/quarter (the first year
  // starts at the data floor, the current one ends at this month), so an
  // out-of-range scope falls back to "all".
  function changeYear(next: number) {
    setYear(next);
    if (scope === 'all') return;
    const stillValid = granularity === 'month'
      ? monthIsSelectable(scope, next, now, bounds)
      : quarterIsSelectable(scope, next, now, bounds);
    if (!stillValid) setScope('all');
  }

  async function handleExport() {
    if (!report || !report.rows.length) {
      toast.error('Nothing to export for these filters.');
      return;
    }
    setExporting(true);
    try {
      const response = await fetch(`/api/hr/reports/export?${query}`);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `HR_Expense_Report_${from}_to_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not build the Excel file. Please try again.');
    } finally {
      setExporting(false);
    }
  }

  // Derived from the RESOLVED range, not from the picker: "All Months" of a
  // part-finished year really means its first month with data to the month in
  // progress, and the label has to say so rather than implying a full year.
  const periodLabel = useMemo(() => {
    if (granularity === 'quarter' && scope !== 'all') return `Q${scope} ${year}`;
    const fromMonth = Number(from.slice(5, 7));
    const toMonth = Number(to.slice(5, 7));
    if (fromMonth === toMonth) return `${MONTH_NAMES[fromMonth - 1]} ${year}`;
    return `${MONTH_NAMES[fromMonth - 1].slice(0, 3)}–${MONTH_NAMES[toMonth - 1].slice(0, 3)} ${year}`;
  }, [from, to, granularity, scope, year]);

  // "all expense types" once every chip is checked (the common case), else
  // the selected ones joined together — same rule the two summary spots
  // below used to each spell out separately for the old single-select.
  const sourceSummaryLabel = sourceFilter.length === ALL_SOURCES.length
    ? 'all expense types'
    : sourceFilter.map((s) => SOURCE_LABEL[s]).join(' + ');

  // A per-source total column repeats the row total when only one register
  // is selected, and duplicates the row identity when grouping BY source.
  const showSourceColumns = !!report && report.sources.length > 1 && report.groupBy !== 'source';

  const employeeChoices = useMemo(
    () => (department ? options.employees.filter((e) => e.department === department) : options.employees),
    [options.employees, department]
  );

  const employeeName = useMemo(
    () => options.employees.find((e) => e.id === employeeId)?.name || '',
    [options.employees, employeeId]
  );

  // Only offered once something is actually narrowed — a Reset that resets
  // nothing is just another button to read past.
  const filtersChanged =
    year !== currentYear ||
    granularity !== 'month' ||
    scope !== 'all' ||
    sourceFilter.length !== ALL_SOURCES.length ||
    !!department ||
    !!employeeId ||
    approvedOnly;

  function resetFilters() {
    setYear(currentYear);
    setGranularity('month');
    setScope('all');
    setSourceFilter(ALL_SOURCES);
    setDepartment('');
    setEmployeeId('');
    setApprovedOnly(false);
  }

  return (
    <AppShell
      title="HR Expense Report"
      subtitle="Reimbursement, Admin Expense, and Office Operation spend — by month, quarter, or year, for everyone or one department."
    >
      <section className={styles.filters} aria-label="Report filters">
        <div className={styles.filterGrid}>
          {/* Period first, and in reading order: the granularity decides
              what the picker beside it asks for — a month, a quarter, or
              nothing beyond the year itself. */}
          <FilterField label="Report Period">
            <Select value={granularity} onChange={(e) => changeGranularity(e.target.value as Granularity)}>
              <option value="month">Monthly</option>
              <option value="quarter">Quarterly</option>
              <option value="year">Yearly</option>
            </Select>
          </FilterField>

          <FilterField label="Year">
            <Select value={year} onChange={(e) => changeYear(Number(e.target.value))}>
              {yearChoices.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </FilterField>

          {granularity === 'month' && (
            <FilterField label="Month">
              <Select value={String(scope)} onChange={(e) => setScope(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                <option value="all">All Months</option>
                {monthChoices.map((m) => <option key={m.name} value={m.value}>{m.name}</option>)}
              </Select>
            </FilterField>
          )}

          {granularity === 'quarter' && (
            <FilterField label="Quarter">
              <Select value={String(scope)} onChange={(e) => setScope(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                <option value="all">All Quarters</option>
                {quarterChoices.map((q) => (
                  <option key={q} value={q}>{`Q${q} (${MONTH_NAMES[(q - 1) * 3].slice(0, 3)}–${MONTH_NAMES[q * 3 - 1].slice(0, 3)})`}</option>
                ))}
              </Select>
            </FilterField>
          )}

          <FilterField label="Expense Type">
            <div ref={sourceDropdownRef} className={styles.sourceDropdown}>
              <button
                type="button"
                className={`${calcStyles.formControl} ${styles.sourceDropdownTrigger}`}
                onClick={() => setSourceDropdownOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={sourceDropdownOpen}
              >
                <span>{sourceSummaryLabel}</span>
                <ChevronDown size={14} />
              </button>
              {sourceDropdownOpen && (
                <div className={styles.sourceDropdownPanel} role="listbox" aria-label="Expense type">
                  {ALL_SOURCES.map((key) => (
                    <label key={key} className={styles.sourceDropdownRow}>
                      <input type="checkbox" checked={sourceFilter.includes(key)} onChange={() => toggleSource(key)} />
                      {SOURCE_LABEL[key]}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </FilterField>

          <FilterField label="Department">
            <Select value={department} onChange={(e) => { setDepartment(e.target.value); setEmployeeId(''); }}>
              <option value="">All Departments</option>
              {options.departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </FilterField>

          <FilterField label="Employee">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">All Employees</option>
              {employeeChoices.map((e) => <option key={e.id} value={e.id}>{e.name}{e.employeeId ? ` (${e.employeeId})` : ''}</option>)}
            </Select>
          </FilterField>
        </div>

        <div className={styles.filterFooter}>
          {/* Says in words what the eight controls above currently add up
              to, so nobody has to re-read the dropdowns to trust a figure. */}
          <div className={styles.filterSummary}>
            Showing <strong>{periodLabel}</strong> ({GRANULARITY_WORD[granularity]})
            {' · '}<strong>{sourceSummaryLabel}</strong>
            {department && <> · <strong>{department}</strong></>}
            {employeeName && <> · <strong>{employeeName}</strong></>}
            {approvedOnly && <> · <strong>approved entries only</strong></>}
          </div>

          <div className={styles.filterActions}>
            <label className={styles.toggleChip}>
              <input type="checkbox" checked={approvedOnly} onChange={(e) => setApprovedOnly(e.target.checked)} />
              Approved only
            </label>
            {filtersChanged && (
              <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={resetFilters}>Reset</Button>
            )}
            <Button
              variant="primary"
              icon={<Download size={14} />}
              onClick={handleExport}
              loading={exporting}
              loadingLabel="Preparing…"
              disabled={loading}
            >
              Export Excel
            </Button>
          </div>
        </div>
      </section>

      {loading ? (
        <div className={historyStyles.tableWrap}><SkeletonRows rows={8} columns={6} /></div>
      ) : loadFailed ? (
        <ErrorState message="Could not load this report — check your connection and try again." onRetry={() => setAttempt((a) => a + 1)} />
      ) : !report ? null : (
        <>
          <div className={historyStyles.summaryCardGrid}>
            {ALL_SOURCES.filter((s) => report.sources.includes(s)).map((key) => (
              <StatTile
                key={key}
                value={formatMoneyWhole(report.sourceTotals[key] || 0)}
                label={`Total ${SOURCE_LABEL[key]}`}
                tone="info"
              />
            ))}
            {/* With one register selected its total IS the grand total — a
                second tile repeating the same number is just noise. */}
            {report.sources.length > 1 && <StatTile value={formatMoneyWhole(report.grandTotal)} label="Grand Total" tone="brand" />}
            <StatTile value={report.entryCount} label="Entries" />
          </div>

          {report.rows.length === 0 ? (
            <EmptyState icon={IndianRupee} title="No spend in this period" message="No entries match this period and these filters." />
          ) : (
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.panelTitle}>
                  {GROUP_HEADING[report.groupBy]} · {periodLabel}
                  {sourceFilter.length !== ALL_SOURCES.length ? ` · ${sourceSummaryLabel}` : ''}
                </span>
                <span className={styles.panelMeta}>
                  {report.rows.length} {report.rows.length === 1 ? ROW_NOUN[report.groupBy] : `${ROW_NOUN[report.groupBy]}s`}
                  {' · '}sorted by highest spend
                </span>
              </div>

              <div className={styles.scroller}>
                <table className={styles.matrix}>
                  {/* Two header rows: the blocks of columns, then the
                      columns themselves. Without the first row a 12-month
                      matrix with trailing per-type totals reads as one
                      undifferentiated run of numbers. */}
                  <thead>
                    <tr className={styles.groupHead}>
                      <th className={styles.labelCell} />
                      <th colSpan={report.buckets.length}>
                        {report.granularity === 'month' ? 'Month' : report.granularity === 'quarter' ? 'Quarter' : 'Year'}
                      </th>
                      {showSourceColumns && <th className={styles.blockStart} colSpan={report.sources.length}>By Expense Type</th>}
                      <th className={styles.blockStart} colSpan={2}>Overall</th>
                    </tr>
                    <tr className={styles.colHead}>
                      <th className={styles.labelCell} scope="col">{COLUMN_HEADING[report.groupBy]}</th>
                      {report.buckets.map((b) => <th key={b.key} scope="col">{b.label}</th>)}
                      {showSourceColumns &&
                        report.sources.map((src, i) => (
                          <th key={src} scope="col" className={i === 0 ? styles.blockStart : undefined}>{SOURCE_LABEL[src]}</th>
                        ))}
                      <th scope="col" className={styles.blockStart}>Entries</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.key}>
                        <th className={styles.labelCell} scope="row">
                          <span className={styles.rowLabel}>
                            <span className={styles.avatar} aria-hidden="true">{initialsOf(row.label)}</span>
                            <span>
                              <span className={styles.rowName}>{row.label}</span>
                              {row.sublabel && <span className={styles.rowSub}>{row.sublabel}</span>}
                            </span>
                          </span>
                        </th>
                        {report.buckets.map((b) => <Money key={b.key} value={row.periods[b.key] || 0} />)}
                        {showSourceColumns &&
                          report.sources.map((src, i) => (
                            <Money key={src} value={row.sources[src] || 0} className={i === 0 ? styles.blockStart : undefined} />
                          ))}
                        <td className={`${styles.count} ${styles.blockStart}`}>{row.entries}</td>
                        <td className={styles.totalCell}>{formatMoneyWhole(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>

                  <tfoot>
                    <tr className={styles.totalRow}>
                      <th className={styles.labelCell} scope="row">Total</th>
                      {report.buckets.map((b) => <Money key={b.key} value={report.periodTotals[b.key] || 0} />)}
                      {showSourceColumns &&
                        report.sources.map((src, i) => (
                          <Money key={src} value={report.sourceTotals[src] || 0} className={i === 0 ? styles.blockStart : undefined} />
                        ))}
                      <td className={`${styles.count} ${styles.blockStart}`}>{report.entryCount}</td>
                      <td className={styles.totalCell}>{formatMoneyWhole(report.grandTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}

          <p className={styles.note}>
            Each entry is attributed to the employee it was recorded against — the claimant for a Reimbursement, the
            employee an Admin Expense batch was split to, and the person who logged an Office Operation expense (that
            register has no per-employee split).
            {approvedOnly
              ? ' Showing approved entries only: approver-signed Admin Expense batches and Reimbursements whose monthly sheet reached HR approval or payment. Office Operation entries have no approval stage and are always included.'
              : ' Showing every entry, including Reimbursement sheets still in review and Admin Expense batches awaiting approval — tick "Approved only" to count just cleared spend.'}
          </p>
        </>
      )}
    </AppShell>
  );
}
