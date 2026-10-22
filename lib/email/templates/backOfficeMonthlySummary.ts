import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, RenderedEmail } from './layout';
import { SalesPersonDemoSummaryRow } from '@/lib/backOfficeDemoSummary';

// The 1st-of-month recap to the Back Office manager — "which sales person's
// demos we ran last month, and what they cost." One recipient per call, same
// convention every other sender in lib/email/notifications.ts follows.
export interface BackOfficeMonthlySummaryEmailData {
  name: string;
  monthLabel: string;
  rows: SalesPersonDemoSummaryRow[];
  totals: { demoCount: number; costRecordedCount: number; totalExpense: number };
  dashboardUrl: string;
}

function formatMoney(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

function rowHtml(row: SalesPersonDemoSummaryRow): string {
  const expenseLabel =
    row.costRecordedCount === 0
      ? '—'
      : `${formatMoney(row.totalExpense)}${row.costRecordedCount < row.demoCount ? ` (${row.costRecordedCount}/${row.demoCount} recorded)` : ''}`;
  return `<tr>
            <td style="padding:8px 10px; border-bottom:1px solid #e5e7eb; font-size:13px; color:#111827;">${escapeHtml(row.name)}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #e5e7eb; font-size:13px; color:#111827; text-align:right;">${row.demoCount}</td>
            <td style="padding:8px 10px; border-bottom:1px solid #e5e7eb; font-size:13px; color:#111827; text-align:right;">${escapeHtml(expenseLabel)}</td>
          </tr>`;
}

function tableHtml(rows: SalesPersonDemoSummaryRow[], totals: BackOfficeMonthlySummaryEmailData['totals']): string {
  const totalExpenseLabel = totals.costRecordedCount === 0 ? '—' : formatMoney(totals.totalExpense);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:24px;">
            <thead>
              <tr>
                <th style="padding:8px 10px; border-bottom:2px solid #d1d5db; font-size:12px; color:#6b7280; text-align:left;">Sales Person</th>
                <th style="padding:8px 10px; border-bottom:2px solid #d1d5db; font-size:12px; color:#6b7280; text-align:right;">Demos</th>
                <th style="padding:8px 10px; border-bottom:2px solid #d1d5db; font-size:12px; color:#6b7280; text-align:right;">Expense</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="3" style="padding:12px 10px; font-size:13px; color:#6b7280;">No Delivery Challans recorded.</td></tr>'}
            </tbody>
            <tfoot>
              <tr>
                <td style="padding:8px 10px; font-size:13px; font-weight:bold; color:#111827;">Total</td>
                <td style="padding:8px 10px; font-size:13px; font-weight:bold; color:#111827; text-align:right;">${totals.demoCount}</td>
                <td style="padding:8px 10px; font-size:13px; font-weight:bold; color:#111827; text-align:right;">${escapeHtml(totalExpenseLabel)}</td>
              </tr>
            </tfoot>
          </table>`;
}

export function renderBackOfficeMonthlySummaryEmail(data: BackOfficeMonthlySummaryEmailData): RenderedEmail {
  const subject = `Back Office summary — ${data.monthLabel}`;
  const unattributed = data.rows.find((r) => !r.username);
  const attributed = data.rows.filter((r) => r.username);

  const text = [
    `Hello ${data.name},`,
    '',
    `Here is the Back Office summary for ${data.monthLabel}: ${data.totals.demoCount} demo(s) across ${attributed.length} sales person(${attributed.length === 1 ? '' : 's'}).`,
    '',
    ...data.rows.map((r) => {
      const expense = r.costRecordedCount === 0 ? 'not recorded' : formatMoney(r.totalExpense);
      return `${r.name}: ${r.demoCount} demo(s), expense ${expense}`;
    }),
    '',
    `Total: ${data.totals.demoCount} demo(s), ${data.totals.costRecordedCount === 0 ? 'no expense recorded' : `total expense ${formatMoney(data.totals.totalExpense)}`}`,
    '',
    `Open the dashboard: ${data.dashboardUrl}`,
    '',
    'Regards,',
    `${BRAND.appName} Team`
  ].join('\n');

  const introLine = `Here is the Back Office summary for <strong>${escapeHtml(data.monthLabel)}</strong> — ${data.totals.demoCount} demo${data.totals.demoCount === 1 ? '' : 's'} across ${attributed.length} sales person${attributed.length === 1 ? '' : 's'}.`;

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${introLine}</p>
                ${tableHtml(data.rows, data.totals)}
                ${
                  unattributed && unattributed.demoCount > 0
                    ? renderInfoBox(
                        `<p style="margin:0; font-size:13px; color:#111827;">${unattributed.demoCount} Delivery Challan${unattributed.demoCount === 1 ? ' is' : 's are'} not linked to a project (manual/walk-in dispatch) and ${unattributed.demoCount === 1 ? 'is' : 'are'} not attributed to a sales person above.</p>`
                      )
                    : ''
                }
                ${renderButton(data.dashboardUrl, 'Open Back Office Dashboard', '#2563eb')}`;

  return { subject, html: renderEmailShell(subject, bodyHtml), text };
}
