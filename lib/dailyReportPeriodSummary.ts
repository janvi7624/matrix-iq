// Daily Report compliance over a PERIOD rather than a single day.
//
// The existing team view answers "who owed a report today and did they file
// it". Three separate asks all need the same thing one level up — filtering by
// month/quarter/year/custom range, downloading a department's reports as a PDF,
// and the monthly summary mailed to managers — so the fold lives here once,
// pure, instead of three times.
//
// Pure: no DB, no fs, no React. The caller supplies the obligations (from
// expandSubjects, the same helper the sweep uses, so these totals agree with
// the sweep's by construction), the reports that exist, and the leave claims.
//
// WHAT COUNTS AS WHAT, and why — these are the decisions the numbers rest on:
//
//   APPROVED leave   excuses the day. It is removed from the denominator
//                    rather than counted as missing: somebody on sanctioned
//                    leave has not failed to do anything.
//   PENDING leave     does NOT excuse. The claim has not been granted yet, so
//                    the report is still owed. Counting it as excused would
//                    let a compliance figure be improved by filing a claim
//                    nobody has looked at.
//   DRAFT             counts as MISSING. A draft is not a filed report, and
//                    treating it as one would report work as done because
//                    somebody opened the form.
//   SUBMITTED_LATE    counts as filed but not on time, and is reported
//                    separately — "did it arrive" and "did it arrive by the
//                    deadline" are different questions and a manager needs
//                    both.

export type PeriodSubmissionStatus = 'DRAFT' | 'SUBMITTED' | 'SUBMITTED_LATE';

/** One (employee, date) obligation — from expandSubjects. */
export interface PeriodSubject {
  employeeId: string;
  reportDate: string;
}

export interface PeriodReport {
  employeeId: string;
  reportDate: string;
  submissionStatus: PeriodSubmissionStatus;
}

export interface PeriodLeave {
  employeeId: string;
  reportDate: string;
  /** Only 'APPROVED' excuses the day. */
  status: string;
}

export interface PeriodTotals {
  /** Obligations in the range, before leave is taken out. */
  owed: number;
  /** Days excused by an approved leave claim. */
  onLeave: number;
  /** owed - onLeave: the days a report was genuinely due. */
  expected: number;
  onTime: number;
  late: number;
  /** onTime + late. */
  filed: number;
  missing: number;
  /**
   * filed / expected, 0-100, rounded. NULL when nothing was expected — a
   * person who owed nothing has no compliance figure, and 0% would read as a
   * failure where there was no obligation. Same for onTimePercent.
   */
  filedPercent: number | null;
  onTimePercent: number | null;
}

export interface EmployeePeriodSummary extends PeriodTotals {
  employeeId: string;
}

export function emptyTotals(): PeriodTotals {
  return {
    owed: 0,
    onLeave: 0,
    expected: 0,
    onTime: 0,
    late: 0,
    filed: 0,
    missing: 0,
    filedPercent: null,
    onTimePercent: null
  };
}

function key(employeeId: string, reportDate: string): string {
  return `${employeeId}|${reportDate}`;
}

function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

function finalise(t: PeriodTotals): PeriodTotals {
  const expected = Math.max(0, t.owed - t.onLeave);
  const filed = t.onTime + t.late;
  return {
    ...t,
    expected,
    filed,
    // Derived, never accumulated: missing is whatever was expected and did not
    // arrive, so it cannot drift away from the other counts.
    missing: Math.max(0, expected - filed),
    filedPercent: percent(filed, expected),
    onTimePercent: percent(t.onTime, expected)
  };
}

/**
 * Folds obligations, reports and leave into per-employee totals.
 *
 * Reports outside the obligation set are ignored rather than counted: a report
 * filed for a non-working day, or by somebody who was not eligible that day,
 * is real but it is not evidence of compliance with an obligation that did not
 * exist — and counting it could push a percentage above 100.
 */
export function summarisePeriodByEmployee(
  subjects: PeriodSubject[],
  reports: PeriodReport[],
  leave: PeriodLeave[] = []
): EmployeePeriodSummary[] {
  const reportByKey = new Map<string, PeriodSubmissionStatus>();
  for (const r of reports) reportByKey.set(key(r.employeeId, r.reportDate), r.submissionStatus);

  const approvedLeave = new Set<string>();
  for (const l of leave) {
    if (l.status === 'APPROVED') approvedLeave.add(key(l.employeeId, l.reportDate));
  }

  const byEmployee = new Map<string, PeriodTotals>();
  for (const s of subjects) {
    const k = key(s.employeeId, s.reportDate);
    const t = byEmployee.get(s.employeeId) ?? emptyTotals();
    t.owed += 1;

    if (approvedLeave.has(k)) {
      t.onLeave += 1;
    } else {
      const status = reportByKey.get(k);
      if (status === 'SUBMITTED') t.onTime += 1;
      else if (status === 'SUBMITTED_LATE') t.late += 1;
      // DRAFT and absent both fall through to missing, which finalise derives.
    }

    byEmployee.set(s.employeeId, t);
  }

  return [...byEmployee.entries()].map(([employeeId, t]) => ({ employeeId, ...finalise(t) }));
}

/** Rolls per-employee totals into one figure for a department or a whole org. */
export function rollUp(rows: PeriodTotals[]): PeriodTotals {
  const t = emptyTotals();
  for (const r of rows) {
    t.owed += r.owed;
    t.onLeave += r.onLeave;
    t.onTime += r.onTime;
    t.late += r.late;
  }
  return finalise(t);
}

export interface DepartmentPeriodSummary extends PeriodTotals {
  departmentId: string;
  departmentName: string;
  /** How many people in this department owed anything in the range. */
  people: number;
}

/**
 * Per-department totals.
 *
 * `departmentOf` maps an employee to a department; an employee with no
 * department is grouped under '' rather than dropped, so the department rows
 * still add up to the org total. A summary whose parts do not sum to its whole
 * is worse than one with an awkward row in it.
 */
export function summarisePeriodByDepartment(
  employees: EmployeePeriodSummary[],
  departmentOf: (employeeId: string) => { id: string; name: string } | null
): DepartmentPeriodSummary[] {
  const groups = new Map<string, { name: string; rows: EmployeePeriodSummary[] }>();
  for (const e of employees) {
    const dept = departmentOf(e.employeeId);
    const id = dept?.id ?? '';
    const name = dept?.name ?? 'No department';
    const g = groups.get(id) ?? { name, rows: [] };
    g.rows.push(e);
    groups.set(id, g);
  }

  return [...groups.entries()]
    .map(([departmentId, g]) => ({
      departmentId,
      departmentName: g.name,
      people: g.rows.length,
      ...rollUp(g.rows)
    }))
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName));
}

/**
 * The departments worth drawing a manager's attention to, worst first.
 *
 * Ordered by what is actually wrong — the count of missing reports — rather
 * than by percentage: a department of nine people at 80% has more unfiled
 * reports than one person at 0%, and the nine are the bigger problem. Rows
 * with nothing expected are dropped, since there is nothing to act on.
 */
export function worstFirst(rows: DepartmentPeriodSummary[]): DepartmentPeriodSummary[] {
  return rows
    .filter((r) => r.expected > 0)
    .sort((a, b) => b.missing - a.missing || (a.filedPercent ?? 0) - (b.filedPercent ?? 0));
}
