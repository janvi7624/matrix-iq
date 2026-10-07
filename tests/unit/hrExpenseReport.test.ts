import { describe, it, expect } from 'vitest';
import {
  aggregateHrExpenses,
  bucketKeyFor,
  bucketLabelFor,
  bucketsBetween,
  ExpenseEntry,
  HrExpenseReportParams
} from '../../lib/hrExpenseReportStore';
import { parseHrExpenseReportQuery } from '../../lib/hrExpenseReportQuery';

function params(overrides: Partial<HrExpenseReportParams> = {}): HrExpenseReportParams {
  return {
    from: '2026-01-01',
    to: '2026-12-31',
    granularity: 'month',
    groupBy: 'employee',
    sources: ['reimbursement', 'admin_expense', 'office_operation'],
    approvedOnly: false,
    ...overrides
  };
}

function entry(overrides: Partial<ExpenseEntry> = {}): ExpenseEntry {
  return {
    source: 'reimbursement',
    date: '2026-01-15',
    amount: 1000,
    employeeId: 'emp-1',
    employeeName: 'Asha',
    employeeCode: 'NT0001',
    department: 'Sales',
    ...overrides
  };
}

describe('bucketKeyFor', () => {
  it('buckets by calendar month, quarter, and year', () => {
    expect(bucketKeyFor('2026-02-09', 'month')).toBe('2026-02');
    expect(bucketKeyFor('2026-02-09', 'quarter')).toBe('2026-Q1');
    expect(bucketKeyFor('2026-02-09', 'year')).toBe('2026');
  });

  it('puts each quarter boundary month in the right quarter', () => {
    expect(bucketKeyFor('2026-03-31', 'quarter')).toBe('2026-Q1');
    expect(bucketKeyFor('2026-04-01', 'quarter')).toBe('2026-Q2');
    expect(bucketKeyFor('2026-12-31', 'quarter')).toBe('2026-Q4');
  });

  // A DATEONLY parsed via `new Date()` is UTC midnight, which renders as the
  // previous day west of Greenwich — a 1st-of-month expense would then be
  // filed under the previous month.
  it('does not shift a first-of-month date into the previous month', () => {
    expect(bucketKeyFor('2026-07-01', 'month')).toBe('2026-07');
  });
});

describe('bucketLabelFor', () => {
  it('labels each granularity readably', () => {
    expect(bucketLabelFor('2026-03', 'month')).toBe('Mar 2026');
    expect(bucketLabelFor('2026-Q3', 'quarter')).toBe('Q3 2026');
    expect(bucketLabelFor('2026', 'year')).toBe('2026');
  });
});

describe('bucketsBetween', () => {
  it('includes empty months so the columns match the requested range', () => {
    const buckets = bucketsBetween('2026-01-10', '2026-04-02', 'month');
    expect(buckets.map((b) => b.key)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });

  it('walks quarters across a year boundary', () => {
    const buckets = bucketsBetween('2025-11-01', '2026-05-31', 'quarter');
    expect(buckets.map((b) => b.key)).toEqual(['2025-Q4', '2026-Q1', '2026-Q2']);
  });

  it('walks months across a year boundary', () => {
    const buckets = bucketsBetween('2025-12-01', '2026-02-28', 'month');
    expect(buckets.map((b) => b.key)).toEqual(['2025-12', '2026-01', '2026-02']);
  });

  it('returns one bucket per year', () => {
    expect(bucketsBetween('2024-06-01', '2026-02-01', 'year').map((b) => b.key)).toEqual(['2024', '2025', '2026']);
  });
});

describe('aggregateHrExpenses', () => {
  const entries: ExpenseEntry[] = [
    entry({ amount: 1000, date: '2026-01-15', source: 'reimbursement' }),
    entry({ amount: 500, date: '2026-02-20', source: 'admin_expense' }),
    entry({ amount: 250.555, date: '2026-02-21', source: 'office_operation', employeeId: 'emp-2', employeeName: 'Vikram', employeeCode: 'NT0002', department: 'HR & Admin' }),
    entry({ amount: 4000, date: '2026-05-01', source: 'reimbursement', employeeId: 'emp-2', employeeName: 'Vikram', employeeCode: 'NT0002', department: 'HR & Admin' })
  ];

  it('totals per period, per source, and overall', () => {
    const report = aggregateHrExpenses(entries, params());
    expect(report.grandTotal).toBeCloseTo(5750.56, 2);
    expect(report.entryCount).toBe(4);
    expect(report.periodTotals['2026-01']).toBe(1000);
    expect(report.periodTotals['2026-02']).toBeCloseTo(750.56, 2);
    expect(report.periodTotals['2026-03']).toBe(0);
    expect(report.sourceTotals.reimbursement).toBe(5000);
    expect(report.sourceTotals.admin_expense).toBe(500);
    expect(report.sourceTotals.office_operation).toBeCloseTo(250.56, 2);
  });

  it('groups by employee, biggest spender first', () => {
    const report = aggregateHrExpenses(entries, params());
    expect(report.rows.map((r) => r.label)).toEqual(['Vikram', 'Asha']);
    expect(report.rows[0].total).toBeCloseTo(4250.56, 2);
    expect(report.rows[1].sources.admin_expense).toBe(500);
    expect(report.rows[0].sublabel).toBe('NT0002 · HR & Admin');
  });

  it('groups by department and counts the employees behind each row', () => {
    const report = aggregateHrExpenses(entries, params({ groupBy: 'department' }));
    expect(report.rows.map((r) => r.label)).toEqual(['HR & Admin', 'Sales']);
    expect(report.rows[1].sublabel).toBe('1 employee');
    expect(report.rows[1].total).toBe(1500);
  });

  it('groups by expense type', () => {
    const report = aggregateHrExpenses(entries, params({ groupBy: 'source' }));
    expect(report.rows.map((r) => [r.label, r.total])).toEqual([
      ['Reimbursement', 5000],
      ['Admin Expense', 500],
      ['Office Operation', 250.56]
    ]);
  });

  it('rolls months up into quarters without losing anything', () => {
    const report = aggregateHrExpenses(entries, params({ granularity: 'quarter' }));
    expect(report.buckets.map((b) => b.key)).toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
    expect(report.periodTotals['2026-Q1']).toBeCloseTo(1750.56, 2);
    expect(report.periodTotals['2026-Q2']).toBe(4000);
    expect(report.grandTotal).toBeCloseTo(5750.56, 2);
  });

  it('filters to one department', () => {
    const report = aggregateHrExpenses(entries, params({ department: 'Sales' }));
    expect(report.entryCount).toBe(2);
    expect(report.grandTotal).toBe(1500);
  });

  it('filters to one employee', () => {
    const report = aggregateHrExpenses(entries, params({ employeeId: 'emp-2' }));
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].label).toBe('Vikram');
  });

  it('drops entries outside the requested range rather than inventing a column', () => {
    const report = aggregateHrExpenses(
      [...entries, entry({ date: '2025-11-02', amount: 9999 })],
      params({ from: '2026-01-01', to: '2026-03-31' })
    );
    expect(report.buckets.map((b) => b.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(report.grandTotal).toBeCloseTo(1750.56, 2);
    expect(report.entryCount).toBe(3);
  });

  it('files an entry with no department under its own row', () => {
    const report = aggregateHrExpenses([entry({ department: '' })], params({ groupBy: 'department' }));
    expect(report.rows[0].label).toBe('No department');
  });

  it('reports zeroes rather than failing when nothing matches', () => {
    const report = aggregateHrExpenses([], params());
    expect(report.rows).toEqual([]);
    expect(report.grandTotal).toBe(0);
    expect(report.entryCount).toBe(0);
    expect(report.periodTotals['2026-06']).toBe(0);
  });
});

describe('parseHrExpenseReportQuery', () => {
  function parse(query: string) {
    return parseHrExpenseReportQuery(new URLSearchParams(query));
  }

  it('defaults to every expense type when the parameter is absent', () => {
    const parsed = parse('from=2026-01-01&to=2026-12-31');
    expect('params' in parsed && parsed.params.sources).toEqual(['reimbursement', 'admin_expense', 'office_operation']);
    expect('params' in parsed && parsed.params.granularity).toBe('month');
    expect('params' in parsed && parsed.params.groupBy).toBe('employee');
    expect('params' in parsed && parsed.params.approvedOnly).toBe(false);
  });

  it('reads the filters it is given', () => {
    const parsed = parse('from=2026-04-01&to=2026-06-30&granularity=quarter&groupBy=department&sources=reimbursement&department=Sales&employeeId=emp-1&approvedOnly=1');
    expect('params' in parsed && parsed.params).toMatchObject({
      from: '2026-04-01',
      to: '2026-06-30',
      granularity: 'quarter',
      groupBy: 'department',
      sources: ['reimbursement'],
      department: 'Sales',
      employeeId: 'emp-1',
      approvedOnly: true
    });
  });

  it('rejects a missing, malformed, or backwards range', () => {
    expect(parse('to=2026-12-31')).toHaveProperty('error');
    expect(parse('from=01-01-2026&to=2026-12-31')).toHaveProperty('error');
    expect(parse('from=2026-12-31&to=2026-01-01')).toHaveProperty('error');
  });

  it('rejects unknown granularity and groupBy values', () => {
    expect(parse('from=2026-01-01&to=2026-12-31&granularity=weekly')).toHaveProperty('error');
    expect(parse('from=2026-01-01&to=2026-12-31&groupBy=designation')).toHaveProperty('error');
  });

  it('rejects a source list that selects nothing', () => {
    expect(parse('from=2026-01-01&to=2026-12-31&sources=')).toHaveProperty('error');
    expect(parse('from=2026-01-01&to=2026-12-31&sources=payroll')).toHaveProperty('error');
  });
});
