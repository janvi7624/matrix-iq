import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';

// The 1st-of-month recap — one template, two audiences:
//   'department' — a department manager, rows per EMPLOYEE in their team.
//   'organization' — the all-departments brief, rows per DEPARTMENT (a
//     per-employee table across the whole company would be unreadable at
//     that level — see lib/dailyReportService.ts's
//     aggregateRangeRowsByDepartment, which is what builds these rows).
// Row shape is deliberately generic (label/sublabel, not "employee"/
// "department") so this one template serves both without caring which.

export interface DailyReportSummaryEmailRow {
  label: string;
  sublabel?: string;
  expected: number;
  submitted: number;
  submitted_late: number;
  missing: number;
  leave_covered: number;
  compliance_percent: number;
}

export interface DailyReportMonthlySummaryEmailData {
  name: string;
  scope: 'department' | 'organization';
  /** e.g. "Sales" for a department summary, omitted for the org-wide brief. */
  scopeLabel?: string;
  monthLabel: string;
  rowLabel: string; // 'Employee' or 'Department' — the first column header
  rows: DailyReportSummaryEmailRow[];
  totals: { expected: number; submitted: number; submitted_late: number; missing: number; leave_covered: number };
  dashboardUrl: string;
}

function pct(expected: number, submitted: number, leaveCovered: number): number {
  const denominator = expected - leaveCovered;
  return denominator > 0 ? Math.round((submitted / denominator) * 100) : 100;
}

function rowHtml(row: DailyReportSummaryEmailRow): string {
  return `<tr>
            <td style="padding:8px 10px; border-bottom:1px solid #e5e7eb; font-size:13px; color:#111827;">${escapeHtml(row.label)}${row.sublabel ? `<br/><span style="font-size:11px; color:#6b7280;">${escapeHtml(row.sublabel)}</span>` : ''}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #e5e7eb; font-size:13px; color:#111827; text-align:right;">${row.expected}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #e5e7eb; font-size:13px; color:#111827; text-align:right;">${row.submitted}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #e5e7eb; font-size:13px; color:#111827; text-align:right;">${row.missing}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #e5e7eb; font-size:13px; color:#111827; text-align:right;">${row.compliance_percent}%</td>
          </tr>`;
}

function tableHtml(data: DailyReportMonthlySummaryEmailData): string {
  const totalCompliance = pct(data.totals.expected, data.totals.submitted, data.totals.leave_covered);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:24px;">
            <thead>
              <tr>
                <th style="padding:8px 10px; border-bottom:2px solid #d1d5db; font-size:12px; color:#6b7280; text-align:left;">${escapeHtml(data.rowLabel)}</th>
                <th style="padding:8px 10px; border-bottom:2px solid #d1d5db; font-size:12px; color:#6b7280; text-align:right;">Expected</th>
                <th style="padding:8px 10px; border-bottom:2px solid #d1d5db; font-size:12px; color:#6b7280; text-align:right;">Submitted</th>
                <th style="padding:8px 10px; border-bottom:2px solid #d1d5db; font-size:12px; color:#6b7280; text-align:right;">Missing</th>
                <th style="padding:8px 10px; border-bottom:2px solid #d1d5db; font-size:12px; color:#6b7280; text-align:right;">Compliance</th>
              </tr>
            </thead>
            <tbody>
              ${data.rows.length ? data.rows.map(rowHtml).join('') : `<tr><td colspan="5" style="padding:12px 10px; font-size:13px; color:#6b7280;">No one was expected to file in this period.</td></tr>`}
            </tbody>
            <tfoot>
              <tr>
                <td style="padding:8px 10px; font-size:13px; font-weight:bold; color:#111827;">Total</td>
                <td style="padding:8px 10px; font-size:13px; font-weight:bold; color:#111827; text-align:right;">${data.totals.expected}</td>
                <td style="padding:8px 10px; font-size:13px; font-weight:bold; color:#111827; text-align:right;">${data.totals.submitted}</td>
                <td style="padding:8px 10px; font-size:13px; font-weight:bold; color:#111827; text-align:right;">${data.totals.missing}</td>
                <td style="padding:8px 10px; font-size:13px; font-weight:bold; color:#111827; text-align:right;">${totalCompliance}%</td>
              </tr>
            </tfoot>
          </table>`;
}

export function renderDailyReportMonthlySummaryEmail(data: DailyReportMonthlySummaryEmailData): RenderedEmail {
  const subject =
    data.scope === 'department'
      ? `Daily Report summary — ${data.scopeLabel} — ${data.monthLabel}`
      : `Daily Report summary — All Departments — ${data.monthLabel}`;

  const totalCompliance = pct(data.totals.expected, data.totals.submitted, data.totals.leave_covered);
  const introLine =
    data.scope === 'department'
      ? `Here is the <strong>${escapeHtml(data.scopeLabel || '')}</strong> Daily Report summary for <strong>${escapeHtml(data.monthLabel)}</strong> — ${totalCompliance}% overall compliance across ${data.rows.length} team member${data.rows.length === 1 ? '' : 's'}.`
      : `Here is the Daily Report summary for <strong>${escapeHtml(data.monthLabel)}</strong>, across every department — ${totalCompliance}% overall compliance.`;

  const text = [
    `Hello ${data.name},`,
    '',
    data.scope === 'department'
      ? `${data.scopeLabel} Daily Report summary for ${data.monthLabel}: ${totalCompliance}% overall compliance.`
      : `Daily Report summary for ${data.monthLabel}, all departments: ${totalCompliance}% overall compliance.`,
    '',
    ...data.rows.map((r) => `${r.label}${r.sublabel ? ` (${r.sublabel})` : ''}: ${r.submitted}/${r.expected} submitted, ${r.missing} missing, ${r.compliance_percent}% compliance`),
    '',
    `Total: ${data.totals.submitted}/${data.totals.expected} submitted, ${data.totals.missing} missing, ${totalCompliance}% compliance`,
    '',
    `Open the dashboard: ${data.dashboardUrl}`,
    '',
    'Regards,',
    `${BRAND.appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${introLine}</p>
                ${tableHtml(data)}
                ${
                  data.totals.missing > 0
                    ? renderInfoBox(
                        `<p style="margin:0; font-size:13px; color:#111827;">${data.totals.missing} report${data.totals.missing === 1 ? ' is' : 's are'} still missing for the period — open Team Daily Reports to see exactly who.</p>`
                      )
                    : ''
                }
                ${renderButton(data.dashboardUrl, 'Open Daily Report', '#2563eb')}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
