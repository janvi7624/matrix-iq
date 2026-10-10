'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Download, IndianRupee, RotateCcw } from 'lucide-react';
import AppShell from './AppShell';
import historyStyles from './quotationHistory.module.css';
import styles from './hrExpenseReport.module.css';
import { SkeletonRows } from './ui/Skeleton';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import Select from './ui/Select';
import Button from './ui/Button';
import StatTile from './ui/StatTile';
import { useToast } from './ui/ToastProvider';
import { formatMoney } from '@/lib/format';

type SourceKey = 'reimbursement' | 'admin_expense' | 'office_operation';
type Granularity = 'month' | 'quarter' | 'year';
type GroupBy = 'employee' | 'department' | 'source';
// 'all' = every bucket in the selected year; otherwise one specific month
// (1-12) or quarter (1-4). What this picker offers follows the granularity,
// which is the whole point: a monthly report asks you for a month, a
// quarterly one for a quarter, and a yearly one for nothing but the year.
type PeriodScope = 'all' | number;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// None of the three registers holds anything before July 2026, so the
// pickers don't offer earlier periods and a whole-year range starts at July
// rather than opening with six guaranteed-empty columns. Raise these when
// the first real entry moves; they are the only place the floor is stated.
const DATA_START_YEAR = 2026;
const DATA_START_MONTH = 7;

// The first month that exists for a given year — July for the first year,
// January for every year after it.
function firstMonthOf(year: number): number {
  return year === DATA_START_YEAR ? DATA_START_MONTH : 1;
}

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
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Day 0 of the following month is the last day of this one — no
// days-per-month or leap-year table needed.
function lastDayOf(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// The last month worth reporting on for a given year: the month in progress
// for the current year, December for any year already finished. Capping here
// is what keeps months that haven't happened out of the table — and what
// makes a new one appear on its own the day it begins, with no code change.
function lastMonthOf(year: number, now: { year: number; month: number }): number {
  return year === now.year ? now.month : 12;
}

function monthIsSelectable(month: number, year: number, now: { year: number; month: number }): boolean {
  return month >= firstMonthOf(year) && month <= lastMonthOf(year, now);
}

function quarterIsSelectable(quarter: number, year: number, now: { year: number; month: number }): boolean {
  return quarter * 3 >= firstMonthOf(year) && (quarter - 1) * 3 + 1 <= lastMonthOf(year, now);
}

// The picker's (year, granularity, scope) turned into the from/to range the
// API already speaks, so the server keeps one date-range contract and the
// UI decides what a "period" means. Both ends are clamped: no earlier than
// the first month with data, no later than the month in progress.
function resolveRange(
  year: number,
  granularity: Granularity,
  scope: PeriodScope,
  now: { year: number; month: number }
): { from: string; to: string } {
  const firstMonth = firstMonthOf(year);
  const lastMonth = lastMonthOf(year, now);

  if (granularity === 'month' && scope !== 'all') {
    return { from: iso(year, scope, 1), to: iso(year, scope, lastDayOf(year, scope)) };
  }
  if (granularity === 'quarter' && scope !== 'all') {
    const startMonth = (scope - 1) * 3 + 1;
    // The quarter in progress ends at the current month, not at a future
    // quarter-end date.
    const endMonth = Math.min(startMonth + 2, lastMonth);
    return { from: iso(year, startMonth, 1), to: iso(year, endMonth, lastDayOf(year, endMonth)) };
  }
  // Yearly, or "all months"/"all quarters" — everything that has happened
  // this year, which the report then splits into however many buckets the
  // granularity asks for (months, quarters, or the one year).
  return { from: iso(year, firstMonth, 1), to: iso(year, lastMonth, lastDayOf(year, lastMonth)) };
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
  return <td className={classes}>{value === 0 ? '—' : formatMoney(value)}</td>;
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
  // 'all' keeps every register in one view; picking one answers "show me
  // just the reimbursement spend" without any further clicks.
  const [sourceFilter, setSourceFilter] = useState<SourceKey | 'all'>('all');
  const [department, setDepartment] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [approvedOnly, setApprovedOnly] = useState(false);

  const [options, setOptions] = useState<FilterOptions>({ employees: [], departments: [] });
  const [exporting, setExporting] = useState(false);
  // One state object keyed by the request it answered, rather than separate
  // report/loading/failed flags: `loading` is then DERIVED from "the newest
  // request hasn't landed yet", so no filter change can leave a stale report
  // on screen looking settled, and the effect never has to setState
  // synchronously to start a load.
  const [result, setResult] = useState<{ key: string; report: Report | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const sources = useMemo<SourceKey[]>(
    () => (sourceFilter === 'all' ? ALL_SOURCES : [sourceFilter]),
    [sourceFilter]
  );
  const { from, to } = useMemo(() => resolveRange(year, granularity, scope, now), [year, granularity, scope, now]);

  // The query string is built once and reused verbatim by the export, which
  // is what guarantees the spreadsheet matches the table on screen.
  const query = useMemo(() => {
    const params = new URLSearchParams({ from, to, granularity, groupBy, sources: sources.join(',') });
    if (department) params.set('department', department);
    if (employeeId) params.set('employeeId', employeeId);
    if (approvedOnly) params.set('approvedOnly', '1');
    return params.toString();
  }, [from, to, granularity, groupBy, sources, department, employeeId, approvedOnly]);

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
  }, [query, requestKey, sources.length]);

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
  const yearChoices = useMemo(
    () => Array.from({ length: Math.max(1, currentYear - DATA_START_YEAR + 1) }, (_, i) => currentYear - i),
    [currentYear]
  );

  // Only periods that have actually started, between the data floor and the
  // month in progress — same predicates changeYear re-checks below, so the
  // list and the validation can't disagree.
  const monthChoices = useMemo(
    () => MONTH_NAMES.map((name, i) => ({ name, value: i + 1 })).filter((m) => monthIsSelectable(m.value, year, now)),
    [year, now]
  );
  const quarterChoices = useMemo(
    () => [1, 2, 3, 4].filter((q) => quarterIsSelectable(q, year, now)),
    [year, now]
  );

  // Switching year can invalidate the selected month/quarter (the first year
  // starts in July, the current one ends at this month), so an out-of-range
  // scope falls back to "all".
  function changeYear(next: number) {
    setYear(next);
    if (scope === 'all') return;
    const stillValid = granularity === 'month'
      ? monthIsSelectable(scope, next, now)
      : quarterIsSelectable(scope, next, now);
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

  // Derived from the RESOLVED range, not from the picker: "All Months" of
  // the current year really means July to this month, and the label has to
  // say so rather than implying a full year of data.
  const periodLabel = useMemo(() => {
    if (granularity === 'quarter' && scope !== 'all') return `Q${scope} ${year}`;
    const fromMonth = Number(from.slice(5, 7));
    const toMonth = Number(to.slice(5, 7));
    if (fromMonth === toMonth) return `${MONTH_NAMES[fromMonth - 1]} ${year}`;
    return `${MONTH_NAMES[fromMonth - 1].slice(0, 3)}–${MONTH_NAMES[toMonth - 1].slice(0, 3)} ${year}`;
  }, [from, to, granularity, scope, year]);

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
    sourceFilter !== 'all' ||
    !!department ||
    !!employeeId ||
    approvedOnly;

  function resetFilters() {
    setYear(currentYear);
    setGranularity('month');
    setScope('all');
    setSourceFilter('all');
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
            <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceKey | 'all')}>
              <option value="all">All Expense Types</option>
              {ALL_SOURCES.map((key) => <option key={key} value={key}>{SOURCE_LABEL[key]} only</option>)}
            </Select>
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
            {' · '}<strong>{sourceFilter === 'all' ? 'all expense types' : `${SOURCE_LABEL[sourceFilter]} only`}</strong>
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
                value={formatMoney(report.sourceTotals[key] || 0)}
                label={`Total ${SOURCE_LABEL[key]}`}
                tone="info"
              />
            ))}
            {/* With one register selected its total IS the grand total — a
                second tile repeating the same number is just noise. */}
            {report.sources.length > 1 && <StatTile value={formatMoney(report.grandTotal)} label="Grand Total" tone="brand" />}
            <StatTile value={report.entryCount} label="Entries" />
          </div>

          {report.rows.length === 0 ? (
            <EmptyState icon={IndianRupee} title="No spend in this period" message="No entries match this period and these filters." />
          ) : (
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.panelTitle}>
                  {GROUP_HEADING[report.groupBy]} · {periodLabel}
                  {sourceFilter !== 'all' ? ` · ${SOURCE_LABEL[sourceFilter]} only` : ''}
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
                        <td className={styles.totalCell}>{formatMoney(row.total)}</td>
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
                      <td className={styles.totalCell}>{formatMoney(report.grandTotal)}</td>
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
