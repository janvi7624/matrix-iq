import { describe, it, expect } from 'vitest';
import {
  resolvePeriodRange,
  trailingMonthKeys,
  buildSalesPersonRows,
  buildMonthlyTrend,
  buildEmployeeLookup,
  resolveAssignedEngineer,
  monthKeyOf,
  monthLabelOf
} from '../../lib/backOfficeDemoSummary';
import { DeliveryChallanRecord } from '../../lib/types';

function dc(overrides: Partial<DeliveryChallanRecord> = {}): DeliveryChallanRecord {
  return {
    id: overrides.id ?? `dc-${Math.random()}`,
    dc_number: 'NT-DC-0001',
    created_at: '2026-10-01T00:00:00.000Z',
    created_by: 'backoffice-user',
    project_id: '',
    project_name: '',
    custom_project_name: '',
    demo_id: '',
    client_name: 'Client',
    client_address: '',
    client_phone: '',
    items: [],
    demo_cost_amount: '',
    issued_by: 'backoffice-user',
    issued_by_phone: '',
    issued_date: '2026-10-05',
    expected_return_date: '',
    assigned_engineer: '',
    status: 'closed',
    material_return: {
      returned: true,
      condition: 'good',
      missing: false,
      damaged: false,
      accessories: { powerCable: false, remote: false, adapter: false, stand: false, packing: false },
      serialNumberVerified: true,
      remarkTags: [],
      remarks: ''
    },
    updated_at: '2026-10-05T00:00:00.000Z',
    ...overrides
  };
}

describe('monthKeyOf / monthLabelOf', () => {
  it('pads single-digit months', () => {
    expect(monthKeyOf(2026, 3)).toBe('2026-03');
  });

  it('labels a month key as "Month YYYY"', () => {
    expect(monthLabelOf('2026-10')).toBe('October 2026');
  });
});

describe('trailingMonthKeys', () => {
  it('returns the requested count, oldest first, ending on the given month', () => {
    const now = new Date(2026, 9, 15); // October 2026
    expect(trailingMonthKeys(3, now)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('rolls the year over for free across a January boundary', () => {
    const now = new Date(2026, 1, 10); // February 2026
    expect(trailingMonthKeys(3, now)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('resolvePeriodRange', () => {
  const now = new Date(2026, 9, 15); // October 2026

  it("'this_month' resolves to the current calendar month, half-open", () => {
    expect(resolvePeriodRange('this_month', now)).toEqual({ from: '2026-10-01', to: '2026-11-01', label: 'October 2026' });
  });

  it("'last_month' resolves to the previous calendar month", () => {
    expect(resolvePeriodRange('last_month', now)).toEqual({ from: '2026-09-01', to: '2026-10-01', label: 'September 2026' });
  });

  it("'last_month' rolls across a January boundary into December of the prior year", () => {
    const jan = new Date(2026, 0, 10);
    expect(resolvePeriodRange('last_month', jan)).toEqual({ from: '2025-12-01', to: '2026-01-01', label: 'December 2025' });
  });

  it("'all' returns null (no filtering)", () => {
    expect(resolvePeriodRange('all', now)).toBeNull();
  });

  it('accepts an explicit YYYY-MM key', () => {
    expect(resolvePeriodRange('2026-05', now)).toEqual({ from: '2026-05-01', to: '2026-06-01', label: 'May 2026' });
  });

  it('falls back to this_month for an unrecognized value rather than throwing', () => {
    expect(resolvePeriodRange('garbage', now)).toEqual({ from: '2026-10-01', to: '2026-11-01', label: 'October 2026' });
  });
});

describe('buildSalesPersonRows', () => {
  const owners = new Map([
    ['proj-1', { username: 'rahul', name: 'Rahul Shah' }],
    ['proj-2', { username: 'priya', name: 'Priya Mehta' }]
  ]);

  it('attributes a DC to the linked project\'s owner, not assigned_engineer', () => {
    const rows = buildSalesPersonRows([dc({ project_id: 'proj-1', assigned_engineer: 'someone else entirely' })], owners);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ username: 'rahul', name: 'Rahul Shah', demoCount: 1 });
  });

  it('buckets a DC with no project_id as Unattributed / Manual, last regardless of its own total', () => {
    const rows = buildSalesPersonRows(
      [
        dc({ project_id: '', demo_cost_amount: 500000 }), // huge, unattributed
        dc({ project_id: 'proj-1', demo_cost_amount: 100 })
      ],
      owners
    );
    expect(rows).toHaveLength(2);
    expect(rows[rows.length - 1]).toMatchObject({ username: '', name: 'Unattributed / Manual', demoCount: 1, totalExpense: 500000 });
    expect(rows[0].username).toBe('rahul');
  });

  it('treats demo_cost_amount === "" as NOT recorded, never as a free 0', () => {
    const rows = buildSalesPersonRows(
      [dc({ project_id: 'proj-1', demo_cost_amount: '' }), dc({ project_id: 'proj-1', demo_cost_amount: 0 })],
      owners
    );
    const row = rows.find((r) => r.username === 'rahul')!;
    expect(row.demoCount).toBe(2);
    // Only the real stored 0 counts as "recorded" — the '' one must not.
    expect(row.costRecordedCount).toBe(1);
    expect(row.totalExpense).toBe(0);
  });

  it('sums demoCount and totalExpense per sales person across multiple DCs', () => {
    const rows = buildSalesPersonRows(
      [
        dc({ project_id: 'proj-2', demo_cost_amount: 1000 }),
        dc({ project_id: 'proj-2', demo_cost_amount: 2000 }),
        dc({ project_id: 'proj-2', demo_cost_amount: '' })
      ],
      owners
    );
    expect(rows).toEqual([{ username: 'priya', name: 'Priya Mehta', demoCount: 3, costRecordedCount: 2, totalExpense: 3000 }]);
  });

  it('sorts by total expense descending, then demo count, then name', () => {
    const rows = buildSalesPersonRows(
      [
        dc({ project_id: 'proj-1', demo_cost_amount: 100 }),
        dc({ project_id: 'proj-2', demo_cost_amount: 9000 })
      ],
      owners
    );
    expect(rows.map((r) => r.username)).toEqual(['priya', 'rahul']);
  });

  it('omits the Unattributed bucket entirely when every DC is attributed', () => {
    const rows = buildSalesPersonRows([dc({ project_id: 'proj-1' })], owners);
    expect(rows.find((r) => !r.username)).toBeUndefined();
  });

  it('returns an empty array for no DCs', () => {
    expect(buildSalesPersonRows([], owners)).toEqual([]);
  });
});

describe('buildEmployeeLookup', () => {
  it('indexes by username and by trimmed, lowercased name', () => {
    const lookup = buildEmployeeLookup([{ username: 'sachin', name: 'Sachin Kacha' }]);
    expect(lookup.byUsername.get('sachin')).toEqual({ username: 'sachin', name: 'Sachin Kacha' });
    expect(lookup.byNameLower.get('sachin kacha')).toEqual({ username: 'sachin', name: 'Sachin Kacha' });
  });

  it('drops a duplicate display name from the name index rather than guessing which one it means', () => {
    const lookup = buildEmployeeLookup([
      { username: 'rahul.shah', name: 'Rahul Shah' },
      { username: 'rahul.s2', name: 'Rahul Shah' }
    ]);
    expect(lookup.byNameLower.has('rahul shah')).toBe(false);
    // Usernames stay independently resolvable even though the name collided.
    expect(lookup.byUsername.get('rahul.shah')).toBeDefined();
    expect(lookup.byUsername.get('rahul.s2')).toBeDefined();
  });

  it('skips a blank name without throwing', () => {
    const lookup = buildEmployeeLookup([{ username: 'noname', name: '' }]);
    expect(lookup.byNameLower.size).toBe(0);
    expect(lookup.byUsername.get('noname')).toBeDefined();
  });
});

describe('resolveAssignedEngineer', () => {
  const lookup = buildEmployeeLookup([
    { username: 'sachin', name: 'Sachin Kacha' },
    { username: 'miral.katpara', name: 'Miral Katpara' }
  ]);

  it('matches an exact username first', () => {
    expect(resolveAssignedEngineer('sachin', lookup)).toEqual({ username: 'sachin', name: 'Sachin Kacha' });
  });

  it('falls back to a case-insensitive, trimmed name match for historical free text', () => {
    expect(resolveAssignedEngineer('  sachin kacha ', lookup)).toEqual({ username: 'sachin', name: 'Sachin Kacha' });
    expect(resolveAssignedEngineer('MIRAL KATPARA', lookup)).toEqual({ username: 'miral.katpara', name: 'Miral Katpara' });
  });

  it('returns undefined for free text matching nobody, rather than guessing', () => {
    expect(resolveAssignedEngineer('Some Random Walk-in Visitor', lookup)).toBeUndefined();
  });

  it('returns undefined for a blank value', () => {
    expect(resolveAssignedEngineer('', lookup)).toBeUndefined();
    expect(resolveAssignedEngineer('   ', lookup)).toBeUndefined();
  });
});

describe('buildSalesPersonRows — assigned_engineer fallback (the "automate and merge" behavior)', () => {
  const owners = new Map([['proj-1', { username: 'rahul', name: 'Rahul Shah' }]]);
  const employeeLookup = buildEmployeeLookup([
    { username: 'sachin', name: 'Sachin Kacha' },
    { username: 'rahul', name: 'Rahul Shah' }
  ]);

  it('merges a project-less DC into the matching employee via an exact username in assigned_engineer', () => {
    const rows = buildSalesPersonRows([dc({ project_id: '', assigned_engineer: 'sachin' })], owners, employeeLookup);
    expect(rows).toEqual([{ username: 'sachin', name: 'Sachin Kacha', demoCount: 1, costRecordedCount: 0, totalExpense: 0 }]);
  });

  it('merges a historical manual DC via a case-insensitive name match', () => {
    const rows = buildSalesPersonRows([dc({ project_id: '', assigned_engineer: 'sachin kacha' })], owners, employeeLookup);
    expect(rows.find((r) => r.username === 'sachin')).toMatchObject({ demoCount: 1 });
    expect(rows.find((r) => !r.username)).toBeUndefined(); // merged, not left Unattributed
  });

  it('still prefers the real project owner over assigned_engineer when both are present', () => {
    // project_id points at Rahul; assigned_engineer (unreliable free text)
    // names Sachin — the FK wins, exactly as the header comment states.
    const rows = buildSalesPersonRows([dc({ project_id: 'proj-1', assigned_engineer: 'sachin' })], owners, employeeLookup);
    expect(rows).toEqual([{ username: 'rahul', name: 'Rahul Shah', demoCount: 1, costRecordedCount: 0, totalExpense: 0 }]);
  });

  it('still buckets as Unattributed when assigned_engineer matches no real employee', () => {
    const rows = buildSalesPersonRows([dc({ project_id: '', assigned_engineer: 'Some Walk-in Visitor' })], owners, employeeLookup);
    expect(rows).toEqual([{ username: '', name: 'Unattributed / Manual', demoCount: 1, costRecordedCount: 0, totalExpense: 0 }]);
  });

  it('runs no fallback at all when employeeLookup is omitted (backward compatible)', () => {
    const rows = buildSalesPersonRows([dc({ project_id: '', assigned_engineer: 'sachin' })], owners);
    expect(rows).toEqual([{ username: '', name: 'Unattributed / Manual', demoCount: 1, costRecordedCount: 0, totalExpense: 0 }]);
  });

  it('sums multiple DCs resolved via different signals into the same employee row', () => {
    const rows = buildSalesPersonRows(
      [
        dc({ project_id: 'proj-1', demo_cost_amount: 100 }), // via project
        dc({ project_id: '', assigned_engineer: 'rahul', demo_cost_amount: 200 }) // via username fallback
      ],
      owners,
      employeeLookup
    );
    expect(rows).toEqual([{ username: 'rahul', name: 'Rahul Shah', demoCount: 2, costRecordedCount: 2, totalExpense: 300 }]);
  });
});

describe('buildMonthlyTrend', () => {
  const keys = ['2026-08', '2026-09', '2026-10'];

  it('zero-fills every requested month, even with no data', () => {
    const trend = buildMonthlyTrend([], keys);
    expect(trend).toEqual([
      { monthKey: '2026-08', label: 'August 2026', demoCount: 0, costRecordedCount: 0, totalExpense: 0 },
      { monthKey: '2026-09', label: 'September 2026', demoCount: 0, costRecordedCount: 0, totalExpense: 0 },
      { monthKey: '2026-10', label: 'October 2026', demoCount: 0, costRecordedCount: 0, totalExpense: 0 }
    ]);
  });

  it('buckets a DC by the month of its issued_date', () => {
    const trend = buildMonthlyTrend([dc({ issued_date: '2026-09-20', demo_cost_amount: 500 })], keys);
    expect(trend.find((t) => t.monthKey === '2026-09')).toMatchObject({ demoCount: 1, costRecordedCount: 1, totalExpense: 500 });
    expect(trend.find((t) => t.monthKey === '2026-08')).toMatchObject({ demoCount: 0 });
  });

  it('ignores a DC whose issued_date falls outside the requested window', () => {
    const trend = buildMonthlyTrend([dc({ issued_date: '2026-01-01' })], keys);
    expect(trend.every((t) => t.demoCount === 0)).toBe(true);
  });

  it('ignores a DC with no issued_date at all', () => {
    const trend = buildMonthlyTrend([dc({ issued_date: '' })], keys);
    expect(trend.every((t) => t.demoCount === 0)).toBe(true);
  });

  it('distinguishes a real recorded 0 from "not recorded" in costRecordedCount', () => {
    const trend = buildMonthlyTrend(
      [dc({ issued_date: '2026-10-01', demo_cost_amount: 0 }), dc({ issued_date: '2026-10-02', demo_cost_amount: '' })],
      keys
    );
    const oct = trend.find((t) => t.monthKey === '2026-10')!;
    expect(oct).toMatchObject({ demoCount: 2, costRecordedCount: 1, totalExpense: 0 });
  });
});
