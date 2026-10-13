import { PaymentQueueItem, PaymentSource, PaymentQueueStatus } from './types';
import { buildPeriod, periodEndExclusive, TargetPeriodType } from './targetPeriod';

// One filter implementation for the whole Accounts Payments module — the
// queue, the history and the CSV export all run items through this, so an
// export can never disagree with the list that produced it, and a filter
// added here appears in all three at once.
//
// Pure: no DB, no request parsing. The routes turn query params into a
// PaymentFilters and call applyPaymentFilters; the tests exercise it
// directly.

// Which date a period/date filter is measured against. The queue is about
// work arriving ("raised in September"), history is about money leaving
// ("paid in September") — filtering both on the same field would answer the
// wrong question in one of them.
export type PaymentDateBasis = 'createdAt' | 'paidAt' | 'dueDate';

export interface PaymentPeriodFilter {
  periodType: TargetPeriodType;
  fiscalYear: string;
  // '' for annual, which has no sub-period.
  periodKey: string;
}

export interface PaymentFilters {
  source?: PaymentSource | 'all';
  status?: PaymentQueueStatus | 'all';
  search?: string;
  department?: string;
  // Matched against payee AND requestedBy: for a reimbursement the employee
  // is the payee, for a BOM request they're the requester, and someone
  // filtering by a person's name means "anything to do with them".
  employee?: string;
  period?: PaymentPeriodFilter | null;
  // Explicit dates, for a range that isn't a whole month/quarter/year. Used
  // only when `period` is absent — a period and a custom range are two ways
  // of saying the same thing, and honouring both would silently intersect.
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number | null;
  maxAmount?: number | null;
  // Only items already past their due date, still unpaid — the "what am I
  // late on" view, which is the first question every morning.
  overdueOnly?: boolean;
  dateBasis?: PaymentDateBasis;
}

function dateValueOf(item: PaymentQueueItem, basis: PaymentDateBasis): string | null {
  if (basis === 'paidAt') return item.paidAt;
  if (basis === 'dueDate') return item.dueDate;
  return item.createdAt;
}

// Inclusive of both ends. periodEndExclusive turns the stored 'YYYY-MM-DD'
// end into the following midnight, so an item timestamped 14:30 on the last
// day of the period is inside it — comparing against the bare date would
// drop the whole final day.
function withinRange(value: string | null, startIso: string | null, endExclusiveIso: string | null): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  if (startIso && time < new Date(startIso).getTime()) return false;
  if (endExclusiveIso && time >= new Date(endExclusiveIso).getTime()) return false;
  return true;
}

export function isOverdue(item: PaymentQueueItem, now: Date = new Date()): boolean {
  if (item.status === 'paid' || !item.dueDate) return false;
  const due = new Date(item.dueDate).getTime();
  return !Number.isNaN(due) && due < now.getTime();
}

// Resolves a period filter to a concrete [start, endExclusive) pair, or null
// if the period can't be built (a malformed key from a hand-edited URL) —
// null meaning "don't filter by date", never "match nothing", because
// silently showing an empty list is the worst way to report a bad parameter.
export function periodBounds(period: PaymentPeriodFilter | null | undefined): { start: string; endExclusive: string } | null {
  if (!period) return null;
  try {
    const range = buildPeriod(period.periodType, period.fiscalYear, period.periodKey || undefined);
    return { start: range.periodStart, endExclusive: periodEndExclusive(range.periodEnd) };
  } catch {
    return null;
  }
}

export function applyPaymentFilters(
  items: PaymentQueueItem[],
  filters: PaymentFilters,
  now: Date = new Date()
): PaymentQueueItem[] {
  const basis = filters.dateBasis ?? 'createdAt';
  const search = (filters.search ?? '').trim().toLowerCase();
  const department = (filters.department ?? '').trim().toLowerCase();
  const employee = (filters.employee ?? '').trim().toLowerCase();
  const bounds = periodBounds(filters.period);

  return items.filter((item) => {
    if (filters.source && filters.source !== 'all' && item.source !== filters.source) return false;
    if (filters.status && filters.status !== 'all' && item.status !== filters.status) return false;

    if (department && (item.department ?? '').trim().toLowerCase() !== department) return false;

    if (employee) {
      const payee = (item.payee ?? '').trim().toLowerCase();
      const requester = (item.requestedBy ?? '').trim().toLowerCase();
      if (payee !== employee && requester !== employee) return false;
    }

    if (search) {
      const haystack = [item.paymentId, item.payee, item.description, item.requestedBy, item.sourceLabel, item.paymentReference ?? '']
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (bounds) {
      if (!withinRange(dateValueOf(item, basis), bounds.start, bounds.endExclusive)) return false;
    } else if (filters.dateFrom || filters.dateTo) {
      // A bare 'YYYY-MM-DD' "to" means the END of that day, so it's pushed to
      // the next midnight — otherwise picking the same day for from and to
      // matches nothing, which is how date filters usually get this wrong.
      const endExclusive = filters.dateTo ? periodEndExclusive(filters.dateTo) : null;
      if (!withinRange(dateValueOf(item, basis), filters.dateFrom || null, endExclusive)) return false;
    }

    if (typeof filters.minAmount === 'number' && item.amount < filters.minAmount) return false;
    if (typeof filters.maxAmount === 'number' && item.amount > filters.maxAmount) return false;

    if (filters.overdueOnly && !isOverdue(item, now)) return false;

    return true;
  });
}

export interface PaymentFacets {
  departments: string[];
  employees: string[];
}

// The dropdown options, taken from the items themselves rather than a fixed
// list — a department with no payments shouldn't be offered, and a filter
// that can only ever return nothing is worse than no filter.
//
// Built from the UNFILTERED set, so choosing a department doesn't empty the
// employee dropdown and strand someone with no way back.
export function collectFacets(items: PaymentQueueItem[]): PaymentFacets {
  const departments = new Set<string>();
  const employees = new Set<string>();
  for (const item of items) {
    const department = (item.department ?? '').trim();
    if (department) departments.add(department);
    // Both roles, same list: "employee" to a person filtering means the
    // human involved, not which column they landed in.
    const payee = (item.payee ?? '').trim();
    if (payee) employees.add(payee);
    const requester = (item.requestedBy ?? '').trim();
    if (requester) employees.add(requester);
  }
  const sort = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  return { departments: sort(departments), employees: sort(employees) };
}

export interface FilteredTotals {
  count: number;
  amount: number;
  overdueCount: number;
  overdueAmount: number;
}

// What the current filter actually adds up to — the figure an accounts
// person is really after ("how much is Sales owed this quarter"), which a
// paginated list of 20 rows can't show.
export function summariseFiltered(items: PaymentQueueItem[], now: Date = new Date()): FilteredTotals {
  let amount = 0;
  let overdueCount = 0;
  let overdueAmount = 0;
  for (const item of items) {
    amount += item.amount || 0;
    if (isOverdue(item, now)) {
      overdueCount += 1;
      overdueAmount += item.amount || 0;
    }
  }
  return { count: items.length, amount, overdueCount, overdueAmount };
}

const VALID_PERIOD_TYPES: TargetPeriodType[] = ['monthly', 'quarterly', 'half_yearly', 'annual'];

// Query params → PaymentFilters, in one place so the queue, the history and
// the CSV export can't drift apart on how a parameter is read. `dateBasis`
// is the caller's to decide — it's the one thing that genuinely differs
// between the three.
export function parsePaymentFilters(params: URLSearchParams, dateBasis: PaymentDateBasis): PaymentFilters {
  const periodType = params.get('periodType');
  const fiscalYear = params.get('fiscalYear');
  const period =
    periodType && fiscalYear && VALID_PERIOD_TYPES.includes(periodType as TargetPeriodType)
      ? { periodType: periodType as TargetPeriodType, fiscalYear, periodKey: params.get('periodKey') ?? '' }
      : null;

  // A blank or non-numeric amount is "no bound", not zero — treating an
  // empty box as 0 would quietly exclude nothing on min and everything on max.
  const numberOrNull = (raw: string | null): number | null => {
    if (raw === null || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  return {
    source: (params.get('source') as PaymentSource) || 'all',
    status: (params.get('status') as PaymentQueueStatus) || 'all',
    search: params.get('search') ?? '',
    department: params.get('department') ?? '',
    employee: params.get('employee') ?? '',
    period,
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
    minAmount: numberOrNull(params.get('minAmount')),
    maxAmount: numberOrNull(params.get('maxAmount')),
    overdueOnly: params.get('overdueOnly') === 'true',
    dateBasis
  };
}
