'use client';

import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Download, Eye, FilePlus2, History, Pencil } from 'lucide-react';
import { DailyReportPayloadInput, EMPTY_PAYLOAD, TemplateDefinition } from '@/lib/dailyReportTemplates';
import { DailyReportRecord, DailyReportRevisionRecord, TeamDailyReportRangeResponse, TeamDailyReportResponse, TeamDailyReportRow } from '@/lib/dailyReportTypes';
import { Granularity, PeriodBounds, resolveRange, selectableYears } from '@/lib/hrReportPeriod';
import { exportListToPdf } from '@/lib/exportPdf';
import AppShell from './AppShell';
import DailyReportForm from './DailyReportForm';
import calcStyles from './calculator.module.css';
import historyStyles from './quotationHistory.module.css';
import styles from './dailyReport.module.css';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import Textarea from './ui/Textarea';
import FilterBar from './ui/FilterBar';
import StatTile from './ui/StatTile';
import Modal, { ModalCancelButton, ModalOkButton } from './ui/Modal';
import EmptyState from './ui/EmptyState';
import ErrorState from './ui/ErrorState';
import { SkeletonRows } from './ui/Skeleton';
import { useToast } from './ui/ToastProvider';
import TeamDailyReportsSheet from './TeamDailyReportsSheet';
import TaskCategoryEditor from './TaskCategoryEditor';
import sheetStyles from './teamSheet.module.css';
import { useAutoRefresh } from '@/lib/useAutoRefresh';

type Period = 'day' | 'month' | 'quarter' | 'year' | 'custom';

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'month', label: 'Month wise' },
  { value: 'quarter', label: 'Quarter wise' },
  { value: 'year', label: 'Year wise' },
  { value: 'custom', label: 'Custom Range' }
];

// Daily Report has no data before the module shipped — a hardcoded floor is
// safe here (unlike a hardcoded CEILING, the exact mistake
// lib/hrReportPeriod.ts's own header comment documents two real incidents
// from) because the max below is always "now", computed fresh on every call,
// never frozen at today's date.
const DAILY_REPORT_LAUNCH = { year: 2026, month: 10 };
function dailyReportBounds(now: { year: number; month: number }): PeriodBounds {
  return { min: DAILY_REPORT_LAUNCH, max: now };
}

// The manager dashboard.
//
// Rows come from the EXPECTED set, not from the reports that exist, so a
// missing report is a row you can act on rather than an absence you have to
// notice. A draft reads as Missing and is never openable from here: a draft
// is private to its owner and does not satisfy the filing requirement, so
// showing its contents would both leak it and overstate compliance.

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'missing', label: 'Missing' },
  { value: 'late', label: 'Late' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'leave', label: 'On leave' }
];

function formatDateTime(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  } catch {
    return iso;
  }
}

function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function issuesToMap(issues: { path: string; message: string }[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of issues ?? []) map[issue.path] = issue.message;
  return map;
}

function SubmissionBadge({ row }: { row: TeamDailyReportRow }) {
  if (row.leave_status === 'APPROVED') return <span className={`${styles.badge} ${styles.badgeLeave}`}>On leave</span>;
  if (row.submission_status === 'SUBMITTED_LATE') return <span className={`${styles.badge} ${styles.badgeLate}`}>Submitted late</span>;
  if (row.submission_status === 'SUBMITTED') return <span className={`${styles.badge} ${styles.badgeSubmitted}`}>Submitted</span>;
  if (row.leave_status === 'PENDING') return <span className={`${styles.badge} ${styles.badgeLeave}`}>Leave pending</span>;
  // Today, before the cut-off: nothing is filed but nothing is late either,
  // so it must not wear the Missing badge. See MISSING_VISIBLE_AFTER.
  if (row.submission_status === 'PENDING') {
    return <span className={`${styles.badge} ${styles.badgePending}`}>Not due yet</span>;
  }
  return <span className={`${styles.badge} ${styles.badgeMissing}`}>{row.warning_status === 'ACTIVE' ? 'Missing · warned' : 'Missing'}</span>;
}

type DialogMode = { kind: 'view' | 'edit'; row: TeamDailyReportRow } | { kind: 'file'; row: TeamDailyReportRow } | null;

export default function TeamDailyReportsView({
  initialDate,
  initialReportId,
  embedded,
  onDateChange
}: {
  initialDate?: string;
  initialReportId?: string;
  embedded?: boolean;
  /** See the identical prop on DailyReportView. */
  onDateChange?: (date: string) => void;
}) {
  const toast = useToast();

  // 'day' is the original dashboard — one date, for chasing a deadline.
  // 'sheet' is the range grid, for the question that dashboard could not
  // answer: what has this person been doing?
  const [mode, setMode] = useState<'day' | 'sheet'>('day');
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const [date, setDate] = useState(initialDate ?? istToday());
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<TeamDailyReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState('');

  // Month/Quarter/Year/Custom Range — a different question from the single
  // date above ("who is missing today" stops meaning anything once more than
  // one day is in view), so it gets its own state, its own fetch and its own
  // table rather than overloading `date`/`data`. 'day' keeps every existing
  // behaviour on this view completely unchanged.
  const [period, setPeriod] = useState<Period>('day');
  const now = useMemo(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }, []);
  const bounds = useMemo(() => dailyReportBounds(now), [now]);
  const [rangeYear, setRangeYear] = useState(now.year);
  const [rangeMonth, setRangeMonth] = useState(now.month);
  const [rangeQuarter, setRangeQuarter] = useState(Math.ceil(now.month / 3));
  const [customFrom, setCustomFrom] = useState(istToday());
  const [customTo, setCustomTo] = useState(istToday());
  const [rangeData, setRangeData] = useState<TeamDailyReportRangeResponse | null>(null);

  const activeRange = useMemo(() => {
    if (period === 'day') return null;
    if (period === 'custom') {
      if (!customFrom || !customTo || customFrom > customTo) return null;
      return { from: customFrom, to: customTo, label: `${customFrom} – ${customTo}` };
    }
    const scope = period === 'month' ? rangeMonth : period === 'quarter' ? rangeQuarter : ('all' as const);
    const { from, to } = resolveRange(rangeYear, period as Granularity, scope, now, bounds);
    const label =
      period === 'month'
        ? new Date(rangeYear, rangeMonth - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
        : period === 'quarter'
          ? `Q${rangeQuarter} ${rangeYear}`
          : `${rangeYear}`;
    return { from, to, label };
  }, [period, customFrom, customTo, rangeYear, rangeMonth, rangeQuarter, now, bounds]);

  const [dialog, setDialog] = useState<DialogMode>(null);
  const [dialogReport, setDialogReport] = useState<DailyReportRecord | null>(null);
  const [dialogTemplate, setDialogTemplate] = useState<TemplateDefinition | null>(null);
  const [dialogPayload, setDialogPayload] = useState<DailyReportPayloadInput>(EMPTY_PAYLOAD);
  const [dialogRevisions, setDialogRevisions] = useState<DailyReportRevisionRecord[]>([]);
  const [dialogIssues, setDialogIssues] = useState<Record<string, string>>({});
  const [dialogLoading, setDialogLoading] = useState(false);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [reviewNote, setReviewNote] = useState('');

  // The most recent change made AFTER this report was submitted, if there was
  // one. listRevisions orders newest first, so the first match is the latest.
  //
  // This matters because an edit is deliberately silent — it mails nobody, so
  // that a typo fix does not become an inbox event — and the dialog otherwise
  // showed the ORIGINAL submission time beside content that might have been
  // rewritten days later, with nothing to suggest it had moved. Surfacing it
  // here is what makes the silence safe rather than merely quiet.
  const lastEditAfterSubmission = dialogRevisions.find((r) => r.action === 'edited') ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed('');
    try {
      const params = new URLSearchParams({ date });
      if (departmentId) params.set('departmentId', departmentId);
      if (status !== 'all') params.set('status', status);
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/daily-reports/team?${params.toString()}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
      setData(body as TeamDailyReportResponse);
    } catch (error) {
      setLoadFailed(error instanceof Error ? error.message : 'Could not load team daily reports.');
    } finally {
      setLoading(false);
    }
  }, [date, departmentId, status, search]);

  const loadRange = useCallback(async () => {
    if (!activeRange) return;
    setLoading(true);
    setLoadFailed('');
    try {
      const params = new URLSearchParams({ from: activeRange.from, to: activeRange.to, label: activeRange.label });
      if (departmentId) params.set('departmentId', departmentId);
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/daily-reports/team/range?${params.toString()}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
      setRangeData(body as TeamDailyReportRangeResponse);
    } catch (error) {
      setLoadFailed(error instanceof Error ? error.message : 'Could not load team daily reports.');
    } finally {
      setLoading(false);
    }
  }, [activeRange, departmentId, search]);

  useEffect(() => {
    if (period === 'day') load();
    else loadRange();
  }, [period, load, loadRange]);

  // Suspended while a dialog is open — refetching the table underneath a
  // half-typed report would be disorienting at best. Dialogs only ever open
  // from 'day' mode (a range row has no single report to view/edit), but the
  // guard still matters there.
  useAutoRefresh(period === 'day' ? load : loadRange, { enabled: !dialog && !loading });

  const openReport = useCallback(
    async (row: TeamDailyReportRow, kind: 'view' | 'edit') => {
      if (!row.report_id) return;
      setDialog({ kind, row });
      setDialogLoading(true);
      setDialogIssues({});
      setDialogRevisions([]);
      setReviewNote('');
      try {
        const response = await fetch(`/api/daily-reports/${row.report_id}`);
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error || `Could not open this report (${response.status})`);
        setDialogReport(body.report as DailyReportRecord);
        setDialogTemplate(body.template as TemplateDefinition);
        setDialogPayload({
          header: body.report.payload ?? {},
          entries: (body.report.entries ?? []).map((entry: { data: Record<string, unknown> }) => ({ ...entry.data })),
          matrix: body.report.matrix ?? {}
        });
        setDialogRevisions((body.revisions ?? []) as DailyReportRevisionRecord[]);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not open this report.');
        setDialog(null);
      } finally {
        setDialogLoading(false);
      }
    },
    [toast]
  );

  // Deep link from a notification: open the report the bell pointed at.
  useEffect(() => {
    if (!initialReportId || !data) return;
    const row = data.rows.find((r) => r.report_id === initialReportId);
    if (row) openReport(row, 'view');
  }, [initialReportId, data, openReport]);

  async function openFileForThem(row: TeamDailyReportRow) {
    setDialog({ kind: 'file', row });
    setDialogLoading(true);
    setDialogIssues({});
    setDialogReport(null);
    setDialogPayload(EMPTY_PAYLOAD);
    try {
      // The department's own resolved template — the same schema, with the
      // same admin overrides, that the employee would have been given. A
      // manager-filed report is therefore structurally identical to a
      // self-filed one rather than a manager's approximation of it.
      const response = await fetch(`/api/daily-reports/team/template?departmentId=${encodeURIComponent(row.department_id)}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'Could not load the report format.');
      setDialogTemplate(body.template as TemplateDefinition);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load the report format.');
      setDialog(null);
    } finally {
      setDialogLoading(false);
    }
  }

  async function saveEdit() {
    if (!dialog || dialog.kind !== 'edit' || !dialogReport) return;
    setDialogSaving(true);
    setDialogIssues({});
    try {
      const response = await fetch(`/api/daily-reports/${dialogReport.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dialogPayload)
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (body?.issues) setDialogIssues(issuesToMap(body.issues));
        throw new Error(body?.error || `Could not save (${response.status})`);
      }
      setDialog(null);
      await load();
      toast.success('Report updated. The original submission time is unchanged.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save this report.');
    } finally {
      setDialogSaving(false);
    }
  }

  async function fileForThem() {
    if (!dialog || dialog.kind !== 'file') return;
    setDialogSaving(true);
    setDialogIssues({});
    try {
      const response = await fetch('/api/daily-reports/team/file-for-employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: dialog.row.employee_id, reportDate: date, mode: 'submit', ...dialogPayload })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        if (body?.issues) setDialogIssues(issuesToMap(body.issues));
        throw new Error(body?.error || `Could not file this report (${response.status})`);
      }
      setDialog(null);
      await load();
      toast.success(`Report filed for ${dialog.row.employee_name}. They have been notified, and it is marked as manager-filed.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not file this report.');
    } finally {
      setDialogSaving(false);
    }
  }

  async function review(nextStatus: 'REVIEWED' | 'CHANGES_REQUESTED') {
    if (!dialogReport) return;
    if (nextStatus === 'CHANGES_REQUESTED' && !reviewNote.trim()) {
      return toast.error('Say what needs changing — a note is required when requesting changes.');
    }
    setDialogSaving(true);
    try {
      const response = await fetch(`/api/daily-reports/${dialogReport.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, note: reviewNote.trim() })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Could not record this review (${response.status})`);
      setDialog(null);
      await load();
      toast.success(nextStatus === 'REVIEWED' ? 'Marked as reviewed.' : 'Changes requested — the employee has been notified.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record this review.');
    } finally {
      setDialogSaving(false);
    }
  }

  // The "entire department, department-wise" PDF — a tabular register
  // (one row per employee) in the SAME shape every other Export PDF in this
  // app already uses (PO, Delivery Challan), not a full reproduction of
  // every field of every report.
  function exportRangePdf() {
    if (!rangeData) return;
    const departmentLabel = departmentId ? rangeData.departments.find((d) => d.id === departmentId)?.name || 'Department' : 'All Departments';
    exportListToPdf(
      `Daily Report — ${departmentLabel} — ${rangeData.label}`,
      ['Employee', 'Department', 'Expected', 'Submitted', 'Late', 'Missing', 'Leave', 'Compliance %'],
      rangeData.rows.map((r) => [r.employee_name, r.department_name, r.expected, r.submitted, r.submitted_late, r.missing, r.leave_covered, `${r.compliance_percent}%`]),
      `daily-report-${departmentLabel.toLowerCase().replace(/\s+/g, '-')}-${rangeData.from}-to-${rangeData.to}.pdf`
    );
  }

  const title = 'Team Daily Reports';
  const subtitle = 'Reports › who filed, who filed late, and who is missing.';

  // See the identical note in DailyReportView: as a tab inside the merged
  // page the parent owns the AppShell, so this must not render its own.
  const wrap = (node: ReactNode) =>
    embedded ? <>{node}</> : <AppShell title={title} subtitle={subtitle}>{node}</AppShell>;

  if (loadFailed) {
    return wrap(<ErrorState message={loadFailed} onRetry={load} />);
  }

  const modeSwitch = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
    <div className={sheetStyles.presetGroup} role="group" aria-label="View">
      <button
        type="button"
        className={`${sheetStyles.preset} ${mode === 'day' ? sheetStyles.presetActive : ''}`}
        onClick={() => setMode('day')}
      >
        Day view
      </button>
      <button
        type="button"
        className={`${sheetStyles.preset} ${mode === 'sheet' ? sheetStyles.presetActive : ''}`}
        onClick={() => setMode('sheet')}
      >
        Sheet view
      </button>
    </div>
    {/* Sits beside the view switch because it shapes what the reports in
        both views can say. Opens read-only for a department the viewer can
        see but does not manage. */}
    <button type="button" className={historyStyles.button} onClick={() => setCategoriesOpen(true)}>
      Task categories
    </button>
    </div>
  );

  const categoryDialog = categoriesOpen ? <TaskCategoryEditor onClose={() => setCategoriesOpen(false)} /> : null;

  if (mode === 'sheet') {
    return wrap(
      <>
        {modeSwitch}
        {categoryDialog}
        {/* Opening a square jumps the day view to that person's date — the
            two views share one dialog rather than duplicating the reader. */}
        <TeamDailyReportsSheet
          onOpenDay={(_employeeId, day) => {
            setDate(day);
            onDateChange?.(day);
            setMode('day');
          }}
        />
      </>
    );
  }

  return wrap(
    <>
      {modeSwitch}
      {categoryDialog}
      <FilterBar>
        <Select auto value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
          {PERIOD_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </Select>

        {period === 'day' && (
          <Input
            type="date"
            auto
            value={date}
            max={istToday()}
            onChange={(e) => {
              setDate(e.target.value);
              onDateChange?.(e.target.value);
            }}
            aria-label="Reporting date"
          />
        )}
        {period === 'month' && (
          <>
            <Select auto value={rangeMonth} onChange={(e) => setRangeMonth(Number(e.target.value))} aria-label="Month">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{new Date(2026, m - 1, 1).toLocaleDateString('en-IN', { month: 'long' })}</option>
              ))}
            </Select>
            <Select auto value={rangeYear} onChange={(e) => setRangeYear(Number(e.target.value))} aria-label="Year">
              {selectableYears(now, bounds).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </>
        )}
        {period === 'quarter' && (
          <>
            <Select auto value={rangeQuarter} onChange={(e) => setRangeQuarter(Number(e.target.value))} aria-label="Quarter">
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>Q{q}</option>
              ))}
            </Select>
            <Select auto value={rangeYear} onChange={(e) => setRangeYear(Number(e.target.value))} aria-label="Year">
              {selectableYears(now, bounds).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </>
        )}
        {period === 'year' && (
          <Select auto value={rangeYear} onChange={(e) => setRangeYear(Number(e.target.value))} aria-label="Year">
            {selectableYears(now, bounds).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
        )}
        {period === 'custom' && (
          <>
            <Input type="date" auto value={customFrom} max={customTo || istToday()} onChange={(e) => setCustomFrom(e.target.value)} aria-label="From date" />
            <Input type="date" auto value={customTo} min={customFrom} max={istToday()} onChange={(e) => setCustomTo(e.target.value)} aria-label="To date" />
          </>
        )}

        {period === 'day'
          ? data && data.departments.length > 1 && (
              <Select auto value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
                <option value="">All departments</option>
                {data.departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </Select>
            )
          : rangeData && rangeData.departments.length > 1 && (
              <Select auto value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} aria-label="Department">
                <option value="">All departments</option>
                {rangeData.departments.map((department) => (
                  <option key={department.id} value={department.id}>{department.name}</option>
                ))}
              </Select>
            )}
        {period === 'day' && (
          <Select auto value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Submission status">
            {STATUS_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>{filter.label}</option>
            ))}
          </Select>
        )}
        <input type="text" value={search} placeholder="Search employee or department…" onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        {period !== 'day' && rangeData && rangeData.rows.length > 0 && (
          <Button variant="secondary" compact icon={<Download size={14} />} onClick={exportRangePdf}>Download PDF</Button>
        )}
      </FilterBar>

      {period === 'day' ? (
        <>
          {data && (
            <>
              {!data.is_working_day && (
                <div className={`${styles.banner} ${styles.bannerNotice}`}>
                  <span className={styles.bannerIcon}><ClipboardCheck size={17} /></span>
                  <div className={styles.bannerBody}>
                    <div className={styles.bannerHeadline}>Not a working day</div>
                    <div className={styles.bannerDetail}>No reports are expected for this date, so nobody here is counted as missing.</div>
                  </div>
                </div>
              )}
              <div className={styles.kpiRow}>
                <StatTile value={data.kpis.expected} label="Expected" />
                <StatTile value={data.kpis.submitted} label="Submitted" tone="success" />
                <StatTile value={data.kpis.submitted_late} label="Submitted late" tone="warning" />
                <StatTile value={data.kpis.missing} label="Missing" tone="danger" />
                <StatTile value={data.kpis.pending_leave} label="Pending leave" tone="info" />
                <StatTile value={data.kpis.approved_leave} label="Approved leave" tone="accent" />
                {data.kpis.not_configured > 0 && <StatTile value={data.kpis.not_configured} label="Not expected" />}
              </div>
              <p className={styles.sectionHint}>
                Deadline for {date}: {formatDateTime(data.deadline_at)}. Drafts are private to their owner and count as missing until submitted.
              </p>
            </>
          )}

          {loading && !data ? (
            <div className={historyStyles.tableWrap}><SkeletonRows rows={6} columns={6} /></div>
          ) : !data || data.rows.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Nothing to show for this date"
              message={
                data && data.kpis.expected === 0
                  ? 'No employee in your scope is expected to file on this date — either it is not a working day, or their department has no approved report format yet.'
                  : 'No rows match these filters. Try clearing the search or the status filter.'
              }
            />
          ) : (
            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Reporting date</th>
                    <th>Submission</th>
                    <th>Submitted at</th>
                    <th>Leave</th>
                    <th>Review</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.employee_id}>
                      <td>
                        {row.employee_name}
                        {row.filed_by_name && (
                          <>
                            {' '}
                            <span className={`${styles.badge} ${styles.badgeManagerFiled}`}>Filed by {row.filed_by_name}</span>
                          </>
                        )}
                      </td>
                      <td>{row.department_name}</td>
                      <td>{row.report_date}</td>
                      <td><SubmissionBadge row={row} /></td>
                      <td>{row.submitted_at ? formatDateTime(row.submitted_at) : '—'}</td>
                      <td>{row.leave_status ? <span className={`${styles.badge} ${styles.badgeLeave}`}>{row.leave_status.toLowerCase()}</span> : '—'}</td>
                      <td>
                        {row.review_status === 'REVIEWED'
                          ? 'Reviewed'
                          : row.review_status === 'CHANGES_REQUESTED'
                            ? 'Changes requested'
                            : row.report_id
                              ? 'Not reviewed'
                              : '—'}
                      </td>
                      <td>
                        <div className={historyStyles.rowActionsInline}>
                          {row.report_id ? (
                            <>
                              <button type="button" className={historyStyles.rowAction} onClick={() => openReport(row, 'view')}>
                                <Eye size={14} /> View
                              </button>
                              <button type="button" className={historyStyles.rowAction} onClick={() => openReport(row, 'edit')}>
                                <Pencil size={14} /> Edit
                              </button>
                            </>
                          ) : data.can_file_for_others ? (
                            <button type="button" className={`${historyStyles.rowAction} ${historyStyles.rowActionPrimary}`} onClick={() => openFileForThem(row)}>
                              <FilePlus2 size={14} /> File for Them
                            </button>
                          ) : (
                            <span className={calcStyles.small}>—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          {rangeData && (
            <>
              <div className={styles.kpiRow}>
                <StatTile value={rangeData.totals.expected} label="Expected" />
                <StatTile value={rangeData.totals.submitted} label="Submitted" tone="success" />
                <StatTile value={rangeData.totals.submitted_late} label="Submitted late" tone="warning" />
                <StatTile value={rangeData.totals.missing} label="Missing" tone="danger" />
                <StatTile value={rangeData.totals.leave_covered} label="Leave covered" tone="info" />
              </div>
              <p className={styles.sectionHint}>{rangeData.label} ({rangeData.from} to {rangeData.to}) — working days only.</p>
            </>
          )}

          {loading && !rangeData ? (
            <div className={historyStyles.tableWrap}><SkeletonRows rows={6} columns={6} /></div>
          ) : !activeRange ? (
            <EmptyState icon={ClipboardCheck} title="Pick a valid range" message="The 'from' date must not be after the 'to' date." />
          ) : !rangeData || rangeData.rows.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Nothing to show for this period"
              message="No employee in your scope was expected to file in this range, or no rows match the search."
            />
          ) : (
            <div className={historyStyles.tableWrap}>
              <table className={historyStyles.table}>
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Expected</th>
                    <th>Submitted</th>
                    <th>Late</th>
                    <th>Missing</th>
                    <th>Leave</th>
                    <th>Compliance</th>
                  </tr>
                </thead>
                <tbody>
                  {rangeData.rows.map((row) => (
                    <tr key={row.employee_id}>
                      <td>{row.employee_name}</td>
                      <td>{row.department_name}</td>
                      <td>{row.expected}</td>
                      <td>{row.submitted}</td>
                      <td>{row.submitted_late}</td>
                      <td>{row.missing}</td>
                      <td>{row.leave_covered}</td>
                      <td>{row.compliance_percent}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {dialog && (
        <Modal
          size="full"
          title={
            dialog.kind === 'file'
              ? `File a report for ${dialog.row.employee_name} — ${date}`
              : `${dialog.row.employee_name} · ${date}${dialog.kind === 'edit' ? ' (editing)' : ''}`
          }
          ariaLabel={dialog.kind === 'file' ? 'File a daily report on behalf of an employee' : 'Daily report'}
          onClose={() => setDialog(null)}
          dismissible={!dialogSaving}
          footer={
            <>
              <ModalCancelButton onClick={() => setDialog(null)} disabled={dialogSaving}>Close</ModalCancelButton>
              {dialog.kind === 'edit' && (
                <ModalOkButton onClick={saveEdit} disabled={dialogSaving}>{dialogSaving ? 'Saving…' : 'Save Changes'}</ModalOkButton>
              )}
              {dialog.kind === 'file' && (
                <ModalOkButton onClick={fileForThem} disabled={dialogSaving}>{dialogSaving ? 'Filing…' : 'File & Submit'}</ModalOkButton>
              )}
            </>
          }
        >
          {dialogLoading ? (
            <SkeletonRows rows={5} columns={3} />
          ) : dialog.kind === 'file' ? (
            <>
              <div className={`${styles.banner} ${styles.bannerNotice}`}>
                <span className={styles.bannerIcon}><FilePlus2 size={17} /></span>
                <div className={styles.bannerBody}>
                  <div className={styles.bannerHeadline}>Filing on {dialog.row.employee_name}&apos;s behalf</div>
                  <div className={styles.bannerDetail}>
                    They stay the owner of this report and will be notified that you filed it. It is recorded as manager-filed, and the usual deadline
                    applies — if the deadline for {date} has passed it will be marked as submitted late.
                  </div>
                </div>
              </div>
              {dialogTemplate && (
                <DailyReportForm
                  template={dialogTemplate}
                  value={dialogPayload}
                  onChange={setDialogPayload}
                  issues={dialogIssues}
                  reportDate={date}
                  employeeId={dialog.row.employee_id}
                />
              )}
            </>
          ) : (
            dialogTemplate &&
            dialogReport && (
              <>
                <div className={styles.metaRow}>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Submission</span>
                    <span className={styles.metaValue}>
                      <span className={`${styles.badge} ${dialogReport.is_late ? styles.badgeLate : styles.badgeSubmitted}`}>
                        {dialogReport.is_late ? 'Submitted late' : 'Submitted'}
                      </span>
                    </span>
                  </div>
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Submitted at</span>
                    <span className={styles.metaValue}>{formatDateTime(dialogReport.submitted_at)}</span>
                  </div>
                  {lastEditAfterSubmission && (
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Changed since</span>
                      <span className={styles.metaValue}>
                        {formatDateTime(lastEditAfterSubmission.at)}
                        {lastEditAfterSubmission.actor_name ? ` by ${lastEditAfterSubmission.actor_name}` : ''}
                      </span>
                    </div>
                  )}
                  <div className={styles.metaItem}>
                    <span className={styles.metaLabel}>Deadline was</span>
                    <span className={styles.metaValue}>{formatDateTime(dialogReport.deadline_at)}</span>
                  </div>
                  {dialogReport.filed_by_name && (
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Filed by</span>
                      <span className={styles.metaValue}>{dialogReport.filed_by_name}</span>
                    </div>
                  )}
                  {dialogReport.reviewed_by_name && (
                    <div className={styles.metaItem}>
                      <span className={styles.metaLabel}>Reviewed by</span>
                      <span className={styles.metaValue}>{dialogReport.reviewed_by_name}</span>
                    </div>
                  )}
                </div>

                <DailyReportForm
                  template={dialogTemplate}
                  value={dialogPayload}
                  onChange={setDialogPayload}
                  issues={dialogIssues}
                  disabled={dialog.kind === 'view'}
                  reportDate={dialogReport.report_date}
                  employeeId={dialog.row.employee_id}
                />

                {/* Collapsed: useful when something looks wrong, noise otherwise.
                    Mirrors the same panel on the employee's own page. */}
                {dialogRevisions.length > 0 && (
                  <details className={styles.detailsBlock}>
                    <summary className={styles.detailsSummary}>
                      <History size={15} />
                      Change history
                      <span className={styles.detailsCount}>({dialogRevisions.length})</span>
                    </summary>
                    <div className={styles.detailsBody}>
                      <div className={historyStyles.tableWrap}>
                        <table className={historyStyles.table}>
                          <thead>
                            <tr><th>When</th><th>Who</th><th>Action</th><th>Note</th></tr>
                          </thead>
                          <tbody>
                            {dialogRevisions.map((revision) => (
                              <tr key={revision.id}>
                                <td>{formatDateTime(revision.at)}</td>
                                <td>{revision.actor_name || '—'}</td>
                                <td>{revision.action.replace(/_/g, ' ')}</td>
                                <td>{revision.note || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </details>
                )}

                {dialog.kind === 'view' && (
                  <>
                    <div className={styles.sectionHead}>
                      <h3 className={styles.sectionTitle}>Review</h3>
                    </div>
                    <p className={styles.sectionHint}>
                      Review is informational and never blocks a submission — the report is already filed. Requesting changes notifies the employee.
                    </p>
                    <div className={calcStyles.field}>
                      <label className={calcStyles.label} htmlFor="review-note">Note{' '}<span className={calcStyles.small}>(required to request changes)</span></label>
                      <Textarea id="review-note" rows={2} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
                    </div>
                    <div className={styles.footerActions}>
                      <Button variant="success" onClick={() => review('REVIEWED')} disabled={dialogSaving}>Mark Reviewed</Button>
                      <Button variant="secondary" onClick={() => review('CHANGES_REQUESTED')} disabled={dialogSaving}>Request Changes</Button>
                    </div>
                  </>
                )}
              </>
            )
          )}
        </Modal>
      )}
    </>
  );
}
