// Sales Target period math — Indian financial year (April-March), the one
// this app's own spec examples use ("FY 2026-27"). Pure date arithmetic only,
// no DB access, so it's safe to import from both server routes and (if ever
// needed) client components.

export type TargetPeriodType = 'monthly' | 'quarterly' | 'half_yearly' | 'annual';

export interface PeriodRange {
  periodType: TargetPeriodType;
  fiscalYear: string; // "2026-27"
  periodKey: string;  // 'YYYY-MM' | 'Q1'..'Q4' | 'H1'|'H2' | '' (annual)
  periodStart: string; // 'YYYY-MM-DD', inclusive
  periodEnd: string;   // 'YYYY-MM-DD', inclusive
  displayPeriod: string;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ymd(year: number, month1: number, day: number): string {
  return `${year}-${pad(month1)}-${pad(day)}`;
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

// April(4)..December(12) belong to the FY starting THIS calendar year;
// January(1)..March(3) belong to the FY that started last calendar year.
export function fiscalYearLabel(date: Date): string {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const startYear = m >= 4 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function fiscalYearStartYear(fiscalYear: string): number {
  const startYear = Number(fiscalYear.split('-')[0]);
  if (!Number.isFinite(startYear)) throw new Error(`Invalid fiscal year: ${fiscalYear}`);
  return startYear;
}

export function fiscalYearBounds(fiscalYear: string): { start: string; end: string } {
  const startYear = fiscalYearStartYear(fiscalYear);
  return { start: ymd(startYear, 4, 1), end: ymd(startYear + 1, 3, 31) };
}

export function currentFiscalYear(now: Date = new Date()): string {
  return fiscalYearLabel(now);
}

// A small window around the current FY for a <select> — most recent first.
export function fiscalYearOptions(now: Date = new Date(), before = 1, after = 1): string[] {
  const currentStart = fiscalYearStartYear(currentFiscalYear(now));
  const options: string[] = [];
  for (let offset = after; offset >= -before; offset--) {
    const startYear = currentStart + offset;
    options.push(`${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`);
  }
  return options;
}

// Quarter/half boundaries, expressed as { startMonth1, endMonth1, yearOffsetForEnd }
// relative to the FY's start calendar year (offset 0) — Q4/H2 spill into the
// following calendar year (Jan-Mar), so their end month's year is startYear+1.
const QUARTERS: Record<string, { startMonth: number; startYearOffset: number; endMonth: number; endYearOffset: number }> = {
  Q1: { startMonth: 4, startYearOffset: 0, endMonth: 6, endYearOffset: 0 },
  Q2: { startMonth: 7, startYearOffset: 0, endMonth: 9, endYearOffset: 0 },
  Q3: { startMonth: 10, startYearOffset: 0, endMonth: 12, endYearOffset: 0 },
  Q4: { startMonth: 1, startYearOffset: 1, endMonth: 3, endYearOffset: 1 }
};

const HALVES: Record<string, { startMonth: number; startYearOffset: number; endMonth: number; endYearOffset: number }> = {
  H1: { startMonth: 4, startYearOffset: 0, endMonth: 9, endYearOffset: 0 },
  H2: { startMonth: 10, startYearOffset: 0, endMonth: 3, endYearOffset: 1 }
};

// Every FY-relative month, in April-first order, paired with its calendar
// month number and year-offset from the FY's start calendar year.
const FY_MONTHS: { month1: number; yearOffset: number }[] = [
  { month1: 4, yearOffset: 0 }, { month1: 5, yearOffset: 0 }, { month1: 6, yearOffset: 0 },
  { month1: 7, yearOffset: 0 }, { month1: 8, yearOffset: 0 }, { month1: 9, yearOffset: 0 },
  { month1: 10, yearOffset: 0 }, { month1: 11, yearOffset: 0 }, { month1: 12, yearOffset: 0 },
  { month1: 1, yearOffset: 1 }, { month1: 2, yearOffset: 1 }, { month1: 3, yearOffset: 1 }
];

export function buildPeriod(periodType: TargetPeriodType, fiscalYear: string, periodKey?: string): PeriodRange {
  const startYear = fiscalYearStartYear(fiscalYear);

  if (periodType === 'annual') {
    const { start, end } = fiscalYearBounds(fiscalYear);
    return { periodType, fiscalYear, periodKey: '', periodStart: start, periodEnd: end, displayPeriod: `FY ${fiscalYear}` };
  }

  if (periodType === 'monthly') {
    if (!periodKey || !/^\d{4}-\d{2}$/.test(periodKey)) throw new Error(`Invalid month period key: ${periodKey}`);
    const [yStr, mStr] = periodKey.split('-');
    const year = Number(yStr);
    const month1 = Number(mStr);
    const entry = FY_MONTHS.find((f) => f.month1 === month1 && startYear + f.yearOffset === year);
    if (!entry) throw new Error(`Month ${periodKey} is not within FY ${fiscalYear}`);
    const periodStart = ymd(year, month1, 1);
    const periodEnd = ymd(year, month1, lastDayOfMonth(year, month1));
    return { periodType, fiscalYear, periodKey, periodStart, periodEnd, displayPeriod: `${MONTH_NAMES[month1 - 1]} ${year}` };
  }

  if (periodType === 'quarterly') {
    const q = periodKey && QUARTERS[periodKey];
    if (!q) throw new Error(`Invalid quarter key: ${periodKey}`);
    const periodStart = ymd(startYear + q.startYearOffset, q.startMonth, 1);
    const periodEnd = ymd(startYear + q.endYearOffset, q.endMonth, lastDayOfMonth(startYear + q.endYearOffset, q.endMonth));
    return { periodType, fiscalYear, periodKey: periodKey as string, periodStart, periodEnd, displayPeriod: `${periodKey} FY${fiscalYear}` };
  }

  // half_yearly
  const h = periodKey && HALVES[periodKey];
  if (!h) throw new Error(`Invalid half key: ${periodKey}`);
  const periodStart = ymd(startYear + h.startYearOffset, h.startMonth, 1);
  const periodEnd = ymd(startYear + h.endYearOffset, h.endMonth, lastDayOfMonth(startYear + h.endYearOffset, h.endMonth));
  return { periodType, fiscalYear, periodKey: periodKey as string, periodStart, periodEnd, displayPeriod: `${periodKey} FY${fiscalYear}` };
}

export function listPeriodOptions(periodType: TargetPeriodType, fiscalYear: string): { key: string; label: string; periodStart: string; periodEnd: string }[] {
  if (periodType === 'annual') {
    const r = buildPeriod(periodType, fiscalYear);
    return [{ key: '', label: r.displayPeriod, periodStart: r.periodStart, periodEnd: r.periodEnd }];
  }
  if (periodType === 'monthly') {
    const startYear = fiscalYearStartYear(fiscalYear);
    return FY_MONTHS.map(({ month1, yearOffset }) => {
      const key = `${startYear + yearOffset}-${pad(month1)}`;
      const r = buildPeriod(periodType, fiscalYear, key);
      return { key, label: r.displayPeriod, periodStart: r.periodStart, periodEnd: r.periodEnd };
    });
  }
  const keys = periodType === 'quarterly' ? ['Q1', 'Q2', 'Q3', 'Q4'] : ['H1', 'H2'];
  return keys.map((key) => {
    const r = buildPeriod(periodType, fiscalYear, key);
    return { key, label: r.displayPeriod, periodStart: r.periodStart, periodEnd: r.periodEnd };
  });
}

// "Which period, of this type, contains `date`" — used to default the filter
// UI and for the Performance Graph's "current period" snapshot.
export function periodContainingDate(periodType: TargetPeriodType, date: Date = new Date()): PeriodRange {
  const fiscalYear = fiscalYearLabel(date);
  if (periodType === 'annual') return buildPeriod(periodType, fiscalYear);

  const month1 = date.getMonth() + 1;
  if (periodType === 'monthly') return buildPeriod(periodType, fiscalYear, `${date.getFullYear()}-${pad(month1)}`);

  // Calendar-month → FY-quarter/half is independent of which year the month
  // falls in (Q4/H2 always cover Jan-Mar regardless of calendar year), so
  // this is a plain month-range lookup rather than anything year-relative.
  if (periodType === 'quarterly') {
    const key = month1 >= 4 && month1 <= 6 ? 'Q1' : month1 >= 7 && month1 <= 9 ? 'Q2' : month1 >= 10 && month1 <= 12 ? 'Q3' : 'Q4';
    return buildPeriod(periodType, fiscalYear, key);
  }

  // half_yearly
  const key = month1 >= 4 && month1 <= 9 ? 'H1' : 'H2';
  return buildPeriod(periodType, fiscalYear, key);
}

// Exclusive upper bound for a `created_at < X` range query against a
// DATEONLY `periodEnd` ('YYYY-MM-DD') — i.e. periodEnd + 1 day.
export function periodEndExclusive(periodEnd: string): string {
  const [y, m, d] = periodEnd.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return ymd(next.getFullYear(), next.getMonth() + 1, next.getDate());
}
