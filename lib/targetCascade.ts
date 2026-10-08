import { buildPeriod, listPeriodOptions, TargetPeriodType } from './targetPeriod';

// A Sales target set for ANY period sets every other period of the same
// fiscal year, because the four period types are the same number expressed
// at four scales: ₹1,00,000 a month IS ₹3,00,000 a quarter, ₹6,00,000 a half
// and ₹12,00,000 a year. Entering one and leaving the others blank (or
// inconsistent) was the old behaviour and made "is this rep on track?"
// depend on which filter you happened to be looking at.
//
// The entered figure is therefore a RATE, not a one-off: a monthly target of
// ₹1,00,000 means every month of that FY, which is what makes the annual
// ₹12,00,000 rather than ₹1,00,000. Setting a single month to a different
// number is deliberately not expressible here — see the doc note on
// buildCascadedTargets.
//
// Pure date/÷ arithmetic, no DB access, so the API and the dialog's live
// preview compute the same figures from the same function.

export const MONTHS_IN_PERIOD: Record<TargetPeriodType, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annual: 12
};

export const CASCADE_PERIOD_TYPES: TargetPeriodType[] = ['monthly', 'quarterly', 'half_yearly', 'annual'];

export interface CascadedTarget {
  periodType: TargetPeriodType;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  displayPeriod: string;
  fiscalYear: string;
  targetAmount: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// What one month is worth, given an amount quoted at some other scale.
export function monthlyRateFrom(periodType: TargetPeriodType, amount: number): number {
  return amount / MONTHS_IN_PERIOD[periodType];
}

// What a period of `periodType` is worth at that monthly rate.
export function amountForPeriod(periodType: TargetPeriodType, monthlyRate: number): number {
  return round2(monthlyRate * MONTHS_IN_PERIOD[periodType]);
}

// Every period of the fiscal year — 12 months, 4 quarters, 2 halves and the
// year itself — priced off the one figure that was entered.
//
// The entered period type keeps the EXACT amount typed; the others are
// derived. That matters when the number doesn't divide evenly: an annual
// ₹10,00,000 gives a monthly ₹83,333.33, and twelve of those come to
// ₹9,99,999.96. The year stays the ₹10,00,000 that was actually asked for
// rather than being silently restated as the sum of its rounded months.
export function buildCascadedTargets(
  fiscalYear: string,
  enteredPeriodType: TargetPeriodType,
  enteredAmount: number
): CascadedTarget[] {
  const monthlyRate = monthlyRateFrom(enteredPeriodType, enteredAmount);
  const out: CascadedTarget[] = [];

  for (const periodType of CASCADE_PERIOD_TYPES) {
    const amount = periodType === enteredPeriodType ? round2(enteredAmount) : amountForPeriod(periodType, monthlyRate);
    for (const option of listPeriodOptions(periodType, fiscalYear)) {
      const period = buildPeriod(periodType, fiscalYear, option.key || undefined);
      out.push({
        periodType,
        periodKey: period.periodKey,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        displayPeriod: period.displayPeriod,
        fiscalYear,
        targetAmount: amount
      });
    }
  }

  return out;
}

// The one-line-per-scale summary the dialog previews and the API echoes back,
// so "what did setting this actually do" is answerable without reading 19
// rows.
export function cascadeSummary(enteredPeriodType: TargetPeriodType, enteredAmount: number): Record<TargetPeriodType, number> {
  const monthlyRate = monthlyRateFrom(enteredPeriodType, enteredAmount);
  return {
    monthly: enteredPeriodType === 'monthly' ? round2(enteredAmount) : amountForPeriod('monthly', monthlyRate),
    quarterly: enteredPeriodType === 'quarterly' ? round2(enteredAmount) : amountForPeriod('quarterly', monthlyRate),
    half_yearly: enteredPeriodType === 'half_yearly' ? round2(enteredAmount) : amountForPeriod('half_yearly', monthlyRate),
    annual: enteredPeriodType === 'annual' ? round2(enteredAmount) : amountForPeriod('annual', monthlyRate)
  };
}
