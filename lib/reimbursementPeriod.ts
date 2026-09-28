// Which expense month a reimbursement sheet may be SUBMITTED for.
//
// A month has to be over before you can claim it. Submitting September's
// sheet on the 10th of September means the rest of September's bills have
// nowhere to go — the sheet is already with a manager, and every later bill
// either gets left out or forces a change-request round trip. So the rule is
// simply: the sheet's month must have finished.
//
// There is no lower bound (chosen deliberately): a sheet somebody forgot to
// send in June is still theirs to send. What bounds it in practice is the
// separate day-of-month deadline (lib/reimbursementDeadlineStore.ts), which
// governs WHEN you may submit, not WHICH month you may submit for. The two
// rules are independent and both apply.
//
// This module is pure — no database, no Sequelize — precisely so the server
// route and the React view can enforce the same rule from the same code
// instead of two copies that drift.

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export interface PeriodSubmitCheck {
  allowed: boolean;
  /** Empty when allowed; otherwise a sentence to show the employee as-is. */
  reason: string;
}

// Months since year 0, so "is this month before that month" is one comparison
// and December -> January needs no special case.
function monthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function monthName(month: number): string {
  return MONTH_NAMES[month] || '';
}

// The first day the given expense month becomes submittable — the 1st of the
// month after it. Used for the "you can submit it from ..." wording.
export function submittableFrom(year: number, month: number): Date {
  return month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
}

// `now` is injectable so this is testable without freezing the clock, and so
// the caller decides which clock counts. Server and browser both use local
// wall-clock time, matching every other date rule in this app
// (lib/dateHelpers.ts) — the office and its staff are in one timezone, and an
// employee's "is September over yet" must not depend on UTC.
export function checkSubmittablePeriod(year: number, month: number, now: Date = new Date()): PeriodSubmitCheck {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { allowed: false, reason: 'That is not a valid month.' };
  }

  const sheetIndex = monthIndex(year, month);
  const currentIndex = monthIndex(now.getFullYear(), now.getMonth() + 1);

  if (sheetIndex > currentIndex) {
    return { allowed: false, reason: `${monthName(month)} ${year} hasn’t started yet — you can only claim a month that is over.` };
  }
  if (sheetIndex === currentIndex) {
    const opensOn = submittableFrom(year, month);
    const opensOnText = opensOn.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    return {
      allowed: false,
      reason: `${monthName(month)} ${year} isn’t over yet. Keep adding this month’s bills — you can submit the sheet from ${opensOnText}. Sheets for earlier months can be submitted now.`
    };
  }
  return { allowed: true, reason: '' };
}

// HR-mandated (2026-09): new bills may only be logged for the current,
// still-running month (bills as they happen) or the one right before it
// (catching up once it's just closed) — not any older forgotten month, and
// not a future one. This governs which month a NEW entry may be dated, not
// which month a sheet may be SUBMITTED for (checkSubmittablePeriod above,
// unchanged, still has no lower bound on submission).
export function lastClaimableMonth(now: Date = new Date()): { year: number; month: number } {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

// True for exactly the current month or the one right before it.
export function isWithinAddWindow(year: number, month: number, now: Date = new Date()): boolean {
  const idx = monthIndex(year, month);
  const currentIdx = monthIndex(now.getFullYear(), now.getMonth() + 1);
  return idx === currentIdx || idx === currentIdx - 1;
}

export interface PeriodAddCheck {
  allowed: boolean;
  /** Empty when allowed; otherwise a sentence to show the employee as-is. */
  reason: string;
}

// `sheetStatus` is the one carve-out: an entry belonging to a sheet already
// sent back for correction (manager/HR change-requested) must stay
// addable/editable no matter how long ago its month was — otherwise a
// correction a manager or HR explicitly asked for could become permanently
// impossible to satisfy once enough time has passed.
export function checkAddPeriod(dateStr: string, now: Date = new Date(), sheetStatus?: string | null): PeriodAddCheck {
  if (sheetStatus === 'manager_change_requested' || sheetStatus === 'hr_change_requested') {
    return { allowed: true, reason: '' };
  }

  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(dateStr);
  if (!match) return { allowed: false, reason: 'That is not a valid date.' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (isWithinAddWindow(year, month, now)) return { allowed: true, reason: '' };

  const { year: lastYear, month: lastMonth } = lastClaimableMonth(now);
  return {
    allowed: false,
    reason: `You can only add bills for ${monthName(now.getMonth() + 1)} ${now.getFullYear()} or ${monthName(lastMonth)} ${lastYear} right now.`
  };
}
