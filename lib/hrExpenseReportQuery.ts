import {
  EXPENSE_SOURCES,
  ExpenseSourceKey,
  HrExpenseReportParams,
  isExpenseSource,
  isGranularity,
  isGroupBy,
  isValidDate
} from './hrExpenseReportStore';

// Shared by app/api/hr/reports/route.ts and .../export/route.ts — the report
// and its spreadsheet must read the exact same filters from the exact same
// query string, which is only guaranteed if they parse it in one place.
export function parseHrExpenseReportQuery(
  searchParams: URLSearchParams
): { params: HrExpenseReportParams } | { error: string } {
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  if (!isValidDate(from) || !isValidDate(to)) return { error: 'from and to must be YYYY-MM-DD dates' };
  if (from > to) return { error: 'from cannot be after to' };

  const granularity = searchParams.get('granularity') || 'month';
  if (!isGranularity(granularity)) return { error: 'granularity must be month, quarter, or year' };

  const groupBy = searchParams.get('groupBy') || 'employee';
  if (!isGroupBy(groupBy)) return { error: 'groupBy must be employee, department, or source' };

  // Absent means "every expense type" — an explicitly empty list is a
  // deliberate no-op filter and would report zero, which is never what a
  // missing parameter should mean.
  const raw = searchParams.get('sources');
  const sources: ExpenseSourceKey[] = raw === null
    ? [...EXPENSE_SOURCES]
    : raw.split(',').map((s) => s.trim()).filter(isExpenseSource);
  if (!sources.length) return { error: 'Select at least one expense type' };

  return {
    params: {
      from,
      to,
      granularity,
      groupBy,
      sources,
      department: searchParams.get('department') || undefined,
      employeeId: searchParams.get('employeeId') || undefined,
      approvedOnly: searchParams.get('approvedOnly') === '1'
    }
  };
}
