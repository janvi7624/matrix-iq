import { BRAND } from '@/lib/branding';
import { escapeHtml, renderButton, renderEmailShell, renderInfoBox, renderWarningBox, RenderedEmail } from './layout';

// Every email the Daily Report module sends, as one template with a `kind`
// discriminator rather than five near-identical files — the five differ only
// in headline, urgency and which facts they list, and keeping them together
// is what stops the deadline being worded one way in the 9 PM nudge and
// another way in the 10 AM one.

export type DailyReportEmailKind =
  /** 9:00 PM on the reporting date, if nothing is submitted. */
  | 'reminder_evening'
  /** 10:00 AM on the deadline day — must say one hour remains. */
  | 'reminder_final'
  /** Recorded after the deadline passed with no report and no leave claim. */
  | 'warning'
  /** Threshold crossed — to HR, about one employee. */
  | 'hr_escalation'
  /** A submitted report, to the employee's manager(s). */
  | 'submitted'
  /** A new leave claim, to HR. */
  | 'leave_claim'
  /** HR's decision, back to the employee. */
  | 'leave_decision';

export interface DailyReportEmailData {
  kind: DailyReportEmailKind;
  /** Who is being written to. */
  name: string;
  /** The employee the mail is ABOUT — same as `name` on the self-addressed kinds. */
  employeeName?: string;
  departmentName?: string;
  /** 'YYYY-MM-DD' IST. */
  reportDate: string;
  /** Pre-formatted IST stamp, e.g. '2026-10-15 11:00 IST'. */
  deadlineLabel: string;
  /** Deep link to the page that resolves this mail. */
  actionUrl: string;
  actionLabel?: string;
  /** Escalation / warning context. */
  activeWarnings?: number;
  threshold?: number;
  missedDates?: string[];
  /** Leave-claim context. */
  reason?: string;
  decision?: 'APPROVED' | 'REJECTED';
  decisionReason?: string;
  rejectionOutcome?: 'reinstated' | 'waived' | null;
  /** Submission context. */
  submittedAtLabel?: string;
  late?: boolean;
  entryCount?: number;
}

const ACCENT = {
  reminder_evening: '#2563eb',
  reminder_final: '#d97706',
  warning: '#b91c1c',
  hr_escalation: '#b91c1c',
  submitted: '#059669',
  leave_claim: '#2563eb',
  leave_decision: '#059669'
} as const;

interface Composed {
  subject: string;
  intro: string;
  /** Plain "Label: value" lines — rendered into the info box and the text part. */
  facts: string[];
  /** Optional emphasised line, rendered as a warning box. */
  emphasis?: string;
  actionLabel: string;
}

function compose(data: DailyReportEmailData): Composed {
  const subject = (s: string) => s;
  const employee = data.employeeName || data.name;
  const base = [`Reporting date: ${data.reportDate}`, `Deadline: ${data.deadlineLabel}`];

  switch (data.kind) {
    case 'reminder_evening':
      return {
        subject: subject(`Daily report pending — ${data.reportDate}`),
        intro: `Your daily report for ${data.reportDate} has not been submitted yet. You can file it now, or any time before the deadline.`,
        facts: base,
        actionLabel: 'File My Report'
      };

    case 'reminder_final':
      return {
        subject: subject(`Final reminder: daily report for ${data.reportDate} is due in one hour`),
        intro: `Your daily report for ${data.reportDate} is still outstanding.`,
        facts: base,
        // The brief requires the final reminder to state explicitly that one
        // hour remains, so it is an emphasised line rather than buried in
        // the body copy.
        emphasis: `You have one hour left — this report is due at ${data.deadlineLabel}. After that it will be recorded as a missed report.`,
        actionLabel: 'File My Report Now'
      };

    case 'warning':
      return {
        subject: subject(`Missed daily report recorded — ${data.reportDate}`),
        intro: `A missed-report warning has been recorded for ${data.reportDate}, because the deadline passed with no report submitted and no leave claim for that date.`,
        facts: [
          ...base,
          `Active warnings this month: ${data.activeWarnings ?? 0} of ${data.threshold ?? 3}`
        ],
        emphasis:
          (data.activeWarnings ?? 0) >= (data.threshold ?? 3)
            ? 'HR has been informed. You can still file this report, and you can raise a leave claim if you were away on this date.'
            : `You can still file this report — it will be marked as submitted late. If you were on leave on this date, raise a leave claim and HR can waive the warning.`,
        actionLabel: 'Open Daily Report'
      };

    case 'hr_escalation':
      return {
        subject: subject(`Daily report escalation — ${employee} has ${data.activeWarnings ?? 0} missed reports this month`),
        intro: `${employee} has reached ${data.activeWarnings ?? 0} active missed-report warnings this calendar month, which is the configured escalation threshold.`,
        facts: [
          `Employee: ${employee}`,
          ...(data.departmentName ? [`Department: ${data.departmentName}`] : []),
          `Active warnings: ${data.activeWarnings ?? 0} of ${data.threshold ?? 3}`,
          `Missed dates: ${(data.missedDates ?? []).join(', ') || '—'}`
        ],
        emphasis: 'Only one escalation is sent per employee per calendar month. Further missed reports this month are still recorded as warnings but will not send another escalation.',
        actionLabel: 'Review in HR Daily Report Review'
      };

    case 'submitted':
      return {
        subject: subject(`${employee} submitted their daily report for ${data.reportDate}${data.late ? ' (late)' : ''}`),
        intro: `${employee} has submitted their daily report for ${data.reportDate}.`,
        facts: [
          `Employee: ${employee}`,
          ...(data.departmentName ? [`Department: ${data.departmentName}`] : []),
          `Submitted: ${data.submittedAtLabel || '—'}${data.late ? ' (after the deadline)' : ''}`,
          ...(typeof data.entryCount === 'number' ? [`Entries: ${data.entryCount}`] : [])
        ],
        actionLabel: 'View Report'
      };

    case 'leave_claim':
      return {
        subject: subject(`Leave claim for ${data.reportDate} — ${employee}`),
        intro: `${employee} has claimed they were on leave on ${data.reportDate} and has asked for that reporting date to be exempted.`,
        facts: [
          `Employee: ${employee}`,
          ...(data.departmentName ? [`Department: ${data.departmentName}`] : []),
          `Reporting date: ${data.reportDate}`,
          `Reason: ${data.reason || '—'}`
        ],
        emphasis: 'While this claim is pending, the date is excluded from new reminders and warnings.',
        actionLabel: 'Review Leave Claim'
      };

    case 'leave_decision': {
      const approved = data.decision === 'APPROVED';
      const outcome = approved
        ? 'Any missed-report warning already recorded for that date has been waived.'
        : data.rejectionOutcome === 'waived'
          ? 'The reporting obligation for that date has been waived, so no warning will be recorded.'
          : 'The reporting obligation for that date stands. Please file the report — it will be marked as submitted late.';
      return {
        subject: subject(`Leave claim ${approved ? 'approved' : 'rejected'} — ${data.reportDate}`),
        intro: `Your leave claim for ${data.reportDate} has been ${approved ? 'approved' : 'rejected'}.`,
        facts: [`Reporting date: ${data.reportDate}`, `Decision: ${approved ? 'Approved' : 'Rejected'}`, `Reason given: ${data.decisionReason || '—'}`],
        emphasis: outcome,
        actionLabel: 'Open Daily Report'
      };
    }
  }
}

export function renderDailyReportEmail(data: DailyReportEmailData): RenderedEmail {
  const composed = compose(data);
  const accent = ACCENT[data.kind];
  const actionLabel = data.actionLabel || composed.actionLabel;

  const text = [
    `Hello ${data.name},`,
    '',
    composed.intro,
    '',
    ...composed.facts,
    ...(composed.emphasis ? ['', composed.emphasis] : []),
    '',
    `${actionLabel}: ${data.actionUrl}`,
    '',
    'Regards,',
    `${BRAND.appName} Team`
  ].join('\n');

  const bodyHtml = `
                <p style="margin:0 0 16px; font-size:15px; color:#111827;">Hello ${escapeHtml(data.name)},</p>
                <p style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.5;">${escapeHtml(composed.intro)}</p>
                ${renderInfoBox(composed.facts.map((line) => `<p style="margin:0 0 6px; font-size:14px; color:#111827;">${escapeHtml(line)}</p>`).join(''))}
                ${composed.emphasis ? `<div style="margin:0 0 24px;">${renderWarningBox(escapeHtml(composed.emphasis), accent)}</div>` : ''}
                ${renderButton(data.actionUrl, actionLabel, accent)}`;

  return { subject: composed.subject, html: renderEmailShell(composed.subject, bodyHtml), text };
}
