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

  return (
    <section className={styles.panel} aria-label="Daily Report — all departments">
      <div className={styles.head}>
        <div>
          <span className={styles.title}>Daily Report — All Departments</span>
          <span className={styles.period}>{data.monthLabel}</span>
        </div>
        <Link href="/daily-reports?tab=team">Open Team Daily Reports →</Link>
      </div>

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
                <td>{row.compliance_percent}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td>{data.totals.expected}</td>
              <td>{data.totals.submitted}</td>
              <td className={data.totals.missing > 0 ? styles.missingCell : undefined}>{data.totals.missing}</td>
              <td>{data.totals.expected - data.totals.leave_covered > 0 ? Math.round((data.totals.submitted / (data.totals.expected - data.totals.leave_covered)) * 100) : 100}%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
