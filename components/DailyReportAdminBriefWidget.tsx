'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './dailyReportAdminBrief.module.css';

interface BriefRow {
  department_id: string;
  department_name: string;
  expected: number;
  submitted: number;
  submitted_late: number;
  missing: number;
  leave_covered: number;
  compliance_percent: number;
}

interface BriefPayload {
  monthLabel: string;
  rows: BriefRow[];
  totals: { expected: number; submitted: number; submitted_late: number; missing: number; leave_covered: number };
  /** The window actually reported — never runs past today. */
  from?: string;
  to?: string;
  /** True when the month is still in progress, so the window stops at today. */
  partialMonth?: boolean;
  /** True when the previous month predated tracking and this is the current one. */
  showingCurrentMonthBecausePreviousHadNoData?: boolean;
}

// All-departments Daily Report brief — last month, every department, one
// row each. Same data app/api/cron/daily-report-monthly-summary emails to
// Mayank Jani; this is the "in dashboard" half of that request, computed
// fresh on every load rather than replaying the mailed snapshot (see the API
// route's own comment on why).
//
// Renders nothing for anyone without org-wide visibility — same
// "render nothing until the data says so" convention as MyTargetPanel,
// so most dashboards are completely unaffected by this existing at all.
export default function DailyReportAdminBriefWidget() {
  const [data, setData] = useState<BriefPayload | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard/daily-report-brief')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => { if (active && body) setData(body); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!data || data.rows.length === 0) return null;

  const t = data.totals;
  // Leave is excluded from the denominator rather than counted either way —
  // the same rule every other row in this module uses (see
  // computeDailyReportRangeSummary and aggregateRangeRowsByDepartment).
  const denominator = t.expected - t.leave_covered;
  // A month with nothing expected is NOT a compliant month. The old code
  // returned 100% here, so a month that predates daily-report tracking
  // (TRACKING_START_DATE, currently 2026-10-24 — workingDaysBetween floors
  // the range at it and yields no days at all before it) rendered as
  // "0 / 0 / 0 / 100%", which reads as perfect compliance instead of no data.
  const hasData = t.expected > 0;
  const compliance = denominator > 0 ? Math.round((t.submitted / denominator) * 100) : null;
  const pct = (expected: number, value: number | null) => (expected > 0 && value !== null ? `${value}%` : '—');

  return (
    <section className={styles.panel} aria-label="Daily Report — all departments">
      <div className={styles.head}>
        <div>
          <span className={styles.title}>Daily Report — All Departments</span>
          <span className={styles.period}>{data.monthLabel}</span>
        </div>
        <Link href="/daily-reports?tab=team">Open Team Daily Reports →</Link>
      </div>

      {hasData ? (
        <div className={styles.summaryStrip}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Expected</span>
            <span className={styles.statValue}>{t.expected}</span>
            <span className={styles.statSub}>report-days owed</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Submitted</span>
            <span className={styles.statValue}>{t.submitted}</span>
            <span className={styles.statSub}>{t.submitted_late} late</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Missing</span>
            <span className={`${styles.statValue} ${t.missing > 0 ? styles.statValueMissing : ''}`}>{t.missing}</span>
            <span className={styles.statSub}>{t.leave_covered} on leave</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Compliance</span>
            <span className={styles.statValue}>{pct(t.expected, compliance)}</span>
            <span className={styles.statSub}>{t.submitted} / {denominator}</span>
          </div>
        </div>
      ) : (
        <div className={styles.noData}>
          No daily reports were tracked in {data.monthLabel} — nothing was expected, so there is nothing to
          report. This is not 100% compliance.
        </div>
      )}

      {hasData && (data.partialMonth || data.showingCurrentMonthBecausePreviousHadNoData) && (
        <div className={styles.windowNote}>
          {data.partialMonth && data.to
            ? `Counted up to ${data.to} — today and later days are not yet due, so they are not counted as missing.`
            : ''}
          {data.showingCurrentMonthBecausePreviousHadNoData
            ? ' Showing the current month because the previous one has no tracked report days.'
            : ''}
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Department</th>
              <th>Expected</th>
              <th>Submitted</th>
              <th>Missing</th>
              <th>Compliance</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.department_id}>
                <td>{row.department_name}</td>
                <td>{row.expected}</td>
                <td>{row.submitted}</td>
                <td className={row.missing > 0 ? styles.missingCell : undefined}>{row.missing}</td>
                {/* A department with nothing expected shows '—', not 100%. */}
                <td>{pct(row.expected, row.compliance_percent)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{t.expected}</td>
              <td>{t.submitted}</td>
              <td className={t.missing > 0 ? styles.missingCell : undefined}>{t.missing}</td>
              {/* Same figure as the Compliance stat above — computed once, so
                  the footer can no longer disagree with the summary strip. */}
              <td>{pct(t.expected, compliance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
