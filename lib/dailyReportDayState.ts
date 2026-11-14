/**
 * Which of the day-strip's five states one reporting day is in.
 *
 * Pure and separate from the component so the precedence can be pinned by
 * tests — the same split as useAutoRefresh's shouldRefresh. The component
 * owns the colours; this owns the decision.
 *
 * The order states outrank each other:
 *
 *   warned (dark red) → leave (blue) → on-time (green) → late (red)
 *   → draft / pending (quiet grey) → missing (grey)
 *
 * A WARNING WINS OVER EVERYTHING, including a day that was filed. A warning
 * is a record against the person that stands until somebody waives it, so it
 * is never the state that gets dropped — if it were, the only way to find
 * which days carry one would be to hover every day in the month.
 *
 * That does mean a day can show as warned although the report eventually
 * landed: the sweep warns the day, the report arrives afterwards, and both
 * facts are true. `label` says which, so the colour flags it and the words
 * explain it.
 *
 * Warning outranks approved leave too. Those two should never coexist —
 * approving leave waives that day's warning — so when they do it is a data
 * problem, and showing it surfaces the problem instead of hiding it behind a
 * calm blue dot.
 */
export type DailyReportDayState = 'warned' | 'leave' | 'on-time' | 'late' | 'draft' | 'pending' | 'missing';

export interface DayStateInput {
  submission_status?: string;
  leave_status?: string;
  warning_status?: string;
}

/** How the day was actually filed, for the warned label's prefix. */
function describeHow(item: DayStateInput): string {
  if (item.leave_status === 'APPROVED') return 'On leave';
  switch (item.submission_status) {
    case 'SUBMITTED':
      return 'Filed';
    case 'SUBMITTED_LATE':
      return 'Filed late';
    case 'DRAFT':
      return 'Draft only';
    default:
      return 'Not filed';
  }
}

export function dailyReportDayState(item: DayStateInput): { state: DailyReportDayState; label: string } {
  if (item.warning_status === 'ACTIVE') {
    // Named by what the day actually was, so a warned day that WAS filed
    // does not read as a missed one.
    return { state: 'warned', label: `${describeHow(item)} — warning recorded` };
  }

  if (item.leave_status === 'APPROVED') return { state: 'leave', label: 'On leave' };

  switch (item.submission_status) {
    case 'SUBMITTED':
      return { state: 'on-time', label: 'Filed' };
    case 'SUBMITTED_LATE':
      return { state: 'late', label: 'Late' };
    case 'DRAFT':
      return { state: 'draft', label: 'Draft' };
    case 'PENDING':
      // Today, still open. Not filed, but not late either — a day's report is
      // due at 11:30 the NEXT morning, so "overdue" would overstate it.
      return { state: 'pending', label: 'Not due yet' };
    default:
      // Reaching here means missed with no warning recorded against it yet.
      return { state: 'missing', label: 'Missing' };
  }
}
