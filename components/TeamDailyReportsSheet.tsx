'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TeamMatrixCell, TeamMatrixEmployee, TeamMatrixResponse } from '@/lib/dailyReportTypes';
import historyStyles from './quotationHistory.module.css';
import calcStyles from './calculator.module.css';
import styles from './teamSheet.module.css';

// Team Daily Reports, as a workbook.
//
// Modelled on the Team Task Tracker spreadsheet this replaces: a tab per
// person along the top, and inside each one a flat "Daily Task Sheet" —
// ONE ROW PER TASK PER DAY, with the date repeated down the rows rather
// than merged. The repetition is deliberate: it is what makes the sheet
// sortable, filterable and exportable, and it is the shape people already
// read.
//
// The "All employees" tab keeps the at-a-glance grid, because the manager
// still needs to see who has not filed at all — a question no single
// person's sheet can answer.

type Preset = 'week' | 'fortnight' | 'month';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

function rangeFor(preset: Preset): { from: string; to: string } {
  const today = iso(new Date());
  if (preset === 'week') return { from: shiftDays(today, -6), to: today };
  if (preset === 'fortnight') return { from: shiftDays(today, -18), to: today };
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function columnLabel(date: string): { weekday: string; day: string } {
  const d = new Date(`${date}T00:00:00Z`);
  return {
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' }),
    day: String(d.getUTCDate())
  };
}

/** 'Mon, 22 Oct' — the sheet's own date column, readable at a glance. */
function sheetDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function cellClass(cell: TeamMatrixCell | undefined): string {
  if (!cell || !cell.owed) return styles.cellOff;
  if (cell.status === 'SUBMITTED') return styles.cellOk;
  if (cell.status === 'SUBMITTED_LATE') return styles.cellLate;
  if (cell.leave_status === 'APPROVED') return styles.cellLeave;
  if (cell.leave_status === 'PENDING') return styles.cellLeavePending;
  return styles.cellMissing;
}

function cellTitle(cell: TeamMatrixCell | undefined, date: string): string {
  if (!cell || !cell.owed) return `${date} — not a reporting day`;
  if (cell.status === 'SUBMITTED') return `${date} — submitted, ${cell.entry_count} task(s)`;
  if (cell.status === 'SUBMITTED_LATE') return `${date} — submitted LATE, ${cell.entry_count} task(s)`;
  if (cell.leave_status) return `${date} — leave ${cell.leave_status.toLowerCase()}`;
  return cell.warning_status === 'ACTIVE' ? `${date} — missing, warned` : `${date} — missing`;
}

function cellText(cell: TeamMatrixCell | undefined): string {
  if (!cell || !cell.owed) return '';
  if (cell.status === 'SUBMITTED' || cell.status === 'SUBMITTED_LATE') return cell.entry_count ? String(cell.entry_count) : '✓';
  if (cell.leave_status) return 'L';
  return '';
}

/**
 * Colour a status cell the way the tracker does.
 *
 * Matched on substrings because every department's template names its own
 * statuses ('Done', 'Completed', 'Closed'), and hard-coding one department's
 * vocabulary would leave the others unpainted.
 */
function statusTone(value: string): string {
  const v = value.toLowerCase();
  if (!v) return '';
  if (v.includes('done') || v.includes('complete') || v.includes('closed')) return styles.tagDone;
  if (v.includes('progress') || v.includes('ongoing')) return styles.tagProgress;
  if (v.includes('hold') || v.includes('block')) return styles.tagHold;
  if (v.includes('pending') || v.includes('not started')) return styles.tagPending;
  return styles.tagNeutral;
}

function priorityTone(value: string): string {
  const v = value.toLowerCase();
  if (v.includes('critical') || v.includes('urgent')) return styles.tagCritical;
  if (v.includes('high')) return styles.tagHigh;
  if (v.includes('medium')) return styles.tagMedium;
  if (v.includes('low')) return styles.tagLow;
  return '';
}

/** Which template columns get chip treatment rather than plain text. */
function isStatusColumn(key: string): boolean {
  return key === 'status' || key.endsWith('_status') || key === 'current_status';
}
function isPriorityColumn(key: string): boolean {
  return key === 'priority';
}

function csvCell(value: string): string {
  const text = value ?? '';
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function download(name: string, rows: string[][]) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TeamDailyReportsSheet({ onOpenDay }: { onOpenDay?: (employeeId: string, date: string) => void }) {
  const [preset, setPreset] = useState<Preset>('fortnight');
  const [range, setRange] = useState(() => rangeFor('fortnight'));
  const [departmentId, setDepartmentId] = useState('');
  const [search, setSearch] = useState('');
  /** '' is the All-employees grid; otherwise the open person's sheet. */
  const [active, setActive] = useState('');
  const [data, setData] = useState<TeamMatrixResponse | null>(null);
  const [status, setStatus] = useState('Loading…');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ from: range.from, to: range.to });
        if (departmentId) params.set('departmentId', departmentId);
        if (search.trim()) params.set('search', search.trim());
        if (active) params.set('expand', active);
        const response = await fetch(`/api/daily-reports/team/matrix?${params.toString()}`);
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setStatus(body?.error || 'Could not load the sheet.');
          setData(null);
          return;
        }
        setData(body as TeamMatrixResponse);
        setStatus((body as TeamMatrixResponse).employees.length ? '' : 'Nobody in your scope owes a report in this range.');
      } catch {
        if (!cancelled) setStatus('Could not reach the server.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to, departmentId, search, active, reloadKey]);

  const choosePreset = useCallback((next: Preset) => {
    setPreset(next);
    setRange(rangeFor(next));
  }, []);

  const activeEmployee = useMemo(
    () => data?.employees.find((e) => e.employee_id === active) ?? null,
    [data, active]
  );

  /** One row per task per day — the sheet, and the CSV, share this. */
  const sheetRows = useMemo(() => {
    if (!data?.expansion) return [];
    const out: { date: string; late: boolean; values: Record<string, string>; filed: boolean }[] = [];
    for (const day of data.expansion.days) {
      if (day.entries.length) {
        for (const entry of day.entries) out.push({ date: day.report_date, late: day.is_late, values: entry, filed: true });
      } else if (Object.keys(day.narrative).length) {
        out.push({ date: day.report_date, late: day.is_late, values: day.narrative, filed: true });
      } else {
        // Kept as a row: a day with nothing filed is the finding, and
        // dropping it would silently close the gap.
        out.push({ date: day.report_date, late: false, values: {}, filed: false });
      }
    }
    return out;
  }, [data]);

  const exportActive = useCallback(() => {
    if (!data?.expansion) return;
    const cols = data.expansion.columns;
    const rows: string[][] = [[`Daily Task Sheet — ${data.expansion.employee_name}`], [`${data.from} to ${data.to}`], []];
    rows.push(['Date', ...cols.map((c) => c.label)]);
    for (const row of sheetRows) {
      rows.push([row.date, ...cols.map((c) => (row.filed ? row.values[c.key] || '' : ''))]);
    }
    download(`daily-task-sheet-${data.expansion.employee_name.replace(/\s+/g, '-').toLowerCase()}-${data.from}.csv`, rows);
  }, [data, sheetRows]);

  const exportOverview = useCallback(() => {
    if (!data) return;
    const rows: string[][] = [
      ['Employee', 'Department', ...data.dates, 'Owed', 'Submitted', 'Late', 'Missing', 'Leave', 'Tasks']
    ];
    for (const e of data.employees) {
      rows.push([
        e.employee_name,
        e.department_name,
        ...data.dates.map((d) => {
          const c = e.cells[d];
          if (!c?.owed) return '';
          if (c.status === 'SUBMITTED') return `Submitted (${c.entry_count})`;
          if (c.status === 'SUBMITTED_LATE') return `Late (${c.entry_count})`;
          if (c.leave_status) return `Leave ${c.leave_status.toLowerCase()}`;
          return 'Missing';
        }),
        String(e.totals.owed),
        String(e.totals.submitted),
        String(e.totals.submitted_late),
        String(e.totals.missing),
        String(e.totals.leave),
        String(e.totals.entries)
      ]);
    }
    download(`team-daily-reports-${data.from}-to-${data.to}.csv`, rows);
  }, [data]);

  const compliance = data?.totals.owed ? Math.round((data.totals.submitted / data.totals.owed) * 100) : 0;

  return (
    <div>
      {/* --- controls --- */}
      <div className={historyStyles.toolbar}>
        <div className={styles.presetGroup} role="group" aria-label="Date range">
          {(
            [
              ['week', 'Last 7 days'],
              ['fortnight', 'Last 3 weeks'],
              ['month', 'This month']
            ] as [Preset, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${styles.preset} ${preset === key ? styles.presetActive : ''}`}
              onClick={() => choosePreset(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          type="date"
          className={calcStyles.formControl}
          value={range.from}
          max={range.to}
          onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
        />
        <span className={calcStyles.small}>to</span>
        <input
          type="date"
          className={calcStyles.formControl}
          value={range.to}
          min={range.from}
          onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
        />

        {data && data.departments.length > 1 && (
          <select className={calcStyles.formControl} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All my departments</option>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}

        <input type="text" placeholder="Search a person…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className={historyStyles.button} onClick={() => setReloadKey((k) => k + 1)}>Refresh</button>
        <button
          type="button"
          className={historyStyles.button}
          onClick={active ? exportActive : exportOverview}
          disabled={!data?.employees.length}
        >
          Export CSV
        </button>
      </div>

      {/* --- the workbook's tabs: All employees, then one per person --- */}
      {data && data.employees.length > 0 && (
        <div className={styles.tabStrip} role="tablist" aria-label="Employee sheets">
          <button
            type="button"
            role="tab"
            aria-selected={!active}
            className={`${styles.tab} ${!active ? styles.tabActive : ''}`}
            onClick={() => setActive('')}
          >
            All employees
            <span className={styles.tabCount}>{data.employees.length}</span>
          </button>
          {data.employees.map((e) => (
            <button
              key={e.employee_id}
              type="button"
              role="tab"
              aria-selected={active === e.employee_id}
              className={`${styles.tab} ${active === e.employee_id ? styles.tabActive : ''} ${e.totals.missing ? styles.tabFlag : ''}`}
              onClick={() => setActive(e.employee_id)}
              title={`${e.employee_name} — ${e.department_name}`}
            >
              {e.employee_name.split(' ')[0]}
              <span className={styles.tabCount}>{e.totals.entries}</span>
            </button>
          ))}
        </div>
      )}

      {status && <div className={historyStyles.status}>{status}</div>}

      {/* --- All employees: the at-a-glance grid --- */}
      {data && !active && data.employees.length > 0 && (
        <>
          <div className={styles.kpiRow}>
            <div className={styles.kpi}><span className={styles.kpiLabel}>People</span><span className={styles.kpiValue}>{data.totals.employees}</span></div>
            <div className={styles.kpi}><span className={styles.kpiLabel}>Working days</span><span className={styles.kpiValue}>{data.dates.length}</span></div>
            <div className={styles.kpi}><span className={styles.kpiLabel}>Submitted</span><span className={styles.kpiValue}>{data.totals.submitted}<span className={styles.kpiOf}>/{data.totals.owed}</span></span></div>
            <div className={styles.kpi}><span className={styles.kpiLabel}>Late</span><span className={`${styles.kpiValue} ${styles.kpiWarn}`}>{data.totals.submitted_late}</span></div>
            <div className={styles.kpi}><span className={styles.kpiLabel}>Missing</span><span className={`${styles.kpiValue} ${data.totals.missing ? styles.kpiBad : ''}`}>{data.totals.missing}</span></div>
            <div className={styles.kpi}><span className={styles.kpiLabel}>Compliance</span><span className={styles.kpiValue}>{compliance}%</span></div>
          </div>

          <div className={styles.legend}>
            <span><i className={`${styles.swatch} ${styles.cellOk}`} /> submitted (number = tasks)</span>
            <span><i className={`${styles.swatch} ${styles.cellLate}`} /> late</span>
            <span><i className={`${styles.swatch} ${styles.cellMissing}`} /> missing</span>
            <span><i className={`${styles.swatch} ${styles.cellLeave}`} /> leave</span>
            <span><i className={`${styles.swatch} ${styles.cellOff}`} /> not a reporting day</span>
          </div>

          <div className={styles.gridWrap}>
            <table className={styles.grid}>
              <thead>
                <tr>
                  <th className={styles.stickyHead}>Employee</th>
                  {data.dates.map((date) => {
                    const label = columnLabel(date);
                    return (
                      <th key={date} className={styles.dayHead} title={date}>
                        <span className={styles.dayWeek}>{label.weekday}</span>
                        <span className={styles.dayNum}>{label.day}</span>
                      </th>
                    );
                  })}
                  <th className={styles.totalHead}>Done</th>
                  <th className={styles.totalHead}>Miss</th>
                  <th className={styles.totalHead}>Tasks</th>
                </tr>
              </thead>
              <tbody>
                {data.employees.map((employee: TeamMatrixEmployee) => (
                  <tr key={employee.employee_id}>
                    <th className={styles.stickyCell}>
                      <button type="button" className={styles.nameBtn} onClick={() => setActive(employee.employee_id)}>
                        <span className={styles.chevron}>▸</span>
                        <span>
                          <span className={styles.name}>{employee.employee_name}</span>
                          <span className={styles.dept}>{employee.department_name}</span>
                        </span>
                      </button>
                    </th>
                    {data.dates.map((date) => {
                      const cell = employee.cells[date];
                      return (
                        <td key={date} className={styles.dayCell}>
                          <span
                            className={`${styles.square} ${cellClass(cell)}`}
                            title={cellTitle(cell, date)}
                            onClick={() => cell?.report_id && onOpenDay?.(employee.employee_id, date)}
                            role={cell?.report_id ? 'button' : undefined}
                          >
                            {cellText(cell)}
                          </span>
                        </td>
                      );
                    })}
                    <td className={styles.totalCell}>{employee.totals.submitted}</td>
                    <td className={`${styles.totalCell} ${employee.totals.missing ? styles.totalBad : ''}`}>{employee.totals.missing}</td>
                    <td className={styles.totalCell}>{employee.totals.entries}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* --- One person: the Daily Task Sheet --- */}
      {data?.expansion && activeEmployee && (
        <section className={styles.sheet}>
          <header className={styles.sheetBanner}>
            <h3 className={styles.sheetTitle}>Daily Task Sheet — {data.expansion.employee_name}</h3>
            <span className={styles.sheetSub}>
              {activeEmployee.department_name} · {data.from} to {data.to}
            </span>
          </header>

          <div className={styles.sheetStats}>
            <span><strong>{activeEmployee.totals.entries}</strong> tasks</span>
            <span><strong>{activeEmployee.totals.submitted}</strong>/{activeEmployee.totals.owed} days filed</span>
            {activeEmployee.totals.submitted_late > 0 && (
              <span className={styles.statWarn}><strong>{activeEmployee.totals.submitted_late}</strong> late</span>
            )}
            {activeEmployee.totals.missing > 0 && (
              <span className={styles.statBad}><strong>{activeEmployee.totals.missing}</strong> missing</span>
            )}
            {activeEmployee.totals.leave > 0 && <span><strong>{activeEmployee.totals.leave}</strong> on leave</span>}
          </div>

          <div className={styles.sheetWrap}>
            <table className={styles.sheetTable}>
              <thead>
                <tr>
                  <th className={styles.sheetDateHead}>Date</th>
                  {data.expansion.columns.map((c) => (
                    <th key={c.key}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheetRows.map((row, index) => {
                  // The date is REPEATED on every row rather than merged —
                  // that is what keeps the sheet sortable and exportable, and
                  // it matches the tracker this replaces.
                  const firstOfDay = index === 0 || sheetRows[index - 1].date !== row.date;
                  if (!row.filed) {
                    return (
                      <tr key={`${row.date}-empty`} className={styles.sheetEmptyRow}>
                        <th className={`${styles.sheetDateCell} ${firstOfDay ? styles.dayBreak : ''}`}>{sheetDate(row.date)}</th>
                        <td colSpan={data.expansion!.columns.length || 1} className={styles.sheetEmptyCell}>
                          No report filed
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={`${row.date}-${index}`} className={firstOfDay ? styles.dayBreakRow : ''}>
                      <th className={`${styles.sheetDateCell} ${firstOfDay ? styles.dayBreak : ''}`}>
                        {sheetDate(row.date)}
                        {row.late && <span className={styles.lateTag}>late</span>}
                      </th>
                      {data.expansion!.columns.map((c) => {
                        const value = row.values[c.key] || '';
                        if (!value) return <td key={c.key} className={styles.dim}>—</td>;
                        if (isStatusColumn(c.key)) {
                          return (
                            <td key={c.key}>
                              <span className={`${styles.tag} ${statusTone(value)}`}>{value}</span>
                            </td>
                          );
                        }
                        if (isPriorityColumn(c.key)) {
                          return (
                            <td key={c.key}>
                              <span className={`${styles.tag} ${priorityTone(value)}`}>{value}</span>
                            </td>
                          );
                        }
                        return <td key={c.key}>{value}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
