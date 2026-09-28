import { describe, it, expect } from 'vitest';
import { buildSalesTeamSummary, isSalesLeadership } from '../../lib/salesTeamSummary';

// The exact structural shapes the builder reads, so these fixtures can't
// drift from its own parameter types.
type Roster = Parameters<typeof buildSalesTeamSummary>[0];
type Leads = Parameters<typeof buildSalesTeamSummary>[1];
type Projects = Parameters<typeof buildSalesTeamSummary>[2];
type Quotations = Parameters<typeof buildSalesTeamSummary>[3];

const ROSTER: Roster = [
  { id: 'u-asha', username: 'asha', name: 'Asha R' },
  { id: 'u-vikram', username: 'vikram', name: 'Vikram S' }
];

function lead(overrides: Partial<Leads[number]> = {}): Leads[number] {
  return { created_by: 'asha', assigned_to: '', ...overrides };
}

function project(overrides: Partial<Projects[number]> = {}): Projects[number] {
  return { id: 'p1', created_by: 'asha', status: 'active', ...overrides };
}

function quotation(overrides: Partial<Quotations[number]> = {}): Quotations[number] {
  return { created_by: 'asha', status: 'draft', project_id: '', total: 0, ...overrides };
}

function rowFor(rows: ReturnType<typeof buildSalesTeamSummary>, username: string) {
  const row = rows.find((r) => r.username === username);
  if (!row) throw new Error(`no row for ${username}`);
  return row;
}

describe('buildSalesTeamSummary', () => {
  it('returns one zeroed row per roster member and nothing else', () => {
    const rows = buildSalesTeamSummary(ROSTER, [], [], []);
    expect(rows.map((r) => r.username).sort()).toEqual(['asha', 'vikram']);
    expect(rows.every((r) => r.leads === 0 && r.enquiries === 0 && r.quotations === 0 && r.billing === 0 && r.won === 0 && r.lost === 0)).toBe(true);
  });

  it('credits a lead to its assignee, falling back to the capturer while unassigned', () => {
    const rows = buildSalesTeamSummary(
      ROSTER,
      [
        lead({ created_by: 'asha', assigned_to: 'vikram' }),
        lead({ created_by: 'asha', assigned_to: '' })
      ],
      [],
      []
    );
    expect(rowFor(rows, 'asha').leads).toBe(1);
    expect(rowFor(rows, 'vikram').leads).toBe(1);
  });

  it('ignores records owned by someone outside the roster', () => {
    const rows = buildSalesTeamSummary(
      ROSTER,
      [lead({ created_by: 'outsider', assigned_to: '' })],
      [project({ id: 'p9', created_by: 'outsider', status: 'won' })],
      [quotation({ created_by: 'outsider', status: 'approved', project_id: 'p9', total: 500 })]
    );
    expect(rows.reduce((n, r) => n + r.leads + r.enquiries + r.quotations + r.billing, 0)).toBe(0);
  });

  it('counts projects as enquiries and splits won/lost off the same pass', () => {
    const rows = buildSalesTeamSummary(
      ROSTER,
      [],
      [
        project({ id: 'p1', status: 'won' }),
        project({ id: 'p2', status: 'lost' }),
        project({ id: 'p3', status: 'active' }),
        project({ id: 'p4', created_by: 'vikram', status: 'won' })
      ],
      []
    );
    const asha = rowFor(rows, 'asha');
    expect([asha.enquiries, asha.won, asha.lost]).toEqual([3, 1, 1]);
    const vikram = rowFor(rows, 'vikram');
    expect([vikram.enquiries, vikram.won, vikram.lost]).toEqual([1, 1, 0]);
  });

  it('bills only an approved quotation attached to a won project', () => {
    const rows = buildSalesTeamSummary(
      ROSTER,
      [],
      [project({ id: 'won-1', status: 'won' }), project({ id: 'active-1', status: 'active' })],
      [
        // Qualifies.
        quotation({ status: 'approved', project_id: 'won-1', total: 1000 }),
        // Approved, but the deal isn't won.
        quotation({ status: 'approved', project_id: 'active-1', total: 2000 }),
        // Won project, but the quotation was never approved.
        quotation({ status: 'sent', project_id: 'won-1', total: 4000 }),
        // Approved with no project at all — the documented disqualifier in
        // lib/salesAchievement.ts.
        quotation({ status: 'approved', project_id: '', total: 8000 })
      ]
    );
    const asha = rowFor(rows, 'asha');
    expect(asha.quotations).toBe(4);
    expect(asha.billing).toBe(1000);
  });

  it('bills against a won project owned by someone else on the roster', () => {
    // The qualifying rule is about the quotation's own owner and the linked
    // project's status — not about the two matching.
    const rows = buildSalesTeamSummary(
      ROSTER,
      [],
      [project({ id: 'p-v', created_by: 'vikram', status: 'won' })],
      [quotation({ created_by: 'asha', status: 'approved', project_id: 'p-v', total: 700 })]
    );
    expect(rowFor(rows, 'asha').billing).toBe(700);
    expect(rowFor(rows, 'vikram').billing).toBe(0);
  });

  it('orders by billing desc, then name, so the ranking is stable with no billing', () => {
    const rows = buildSalesTeamSummary(
      [{ id: 'u-z', username: 'zoya', name: 'Zoya' }, ...ROSTER],
      [],
      [project({ id: 'p-v', created_by: 'vikram', status: 'won' })],
      [quotation({ created_by: 'vikram', status: 'approved', project_id: 'p-v', total: 10 })]
    );
    expect(rows.map((r) => r.name)).toEqual(['Vikram S', 'Asha R', 'Zoya']);
  });
});

describe('isSalesLeadership', () => {
  const base = { role: 'manager', username: 'asha', department: '', seesOrgWide: false, managersByDepartment: {} };

  it('turns down any role outside Manager / Admin / Super Admin, even org-wide', () => {
    for (const role of ['user', 'engineer', 'backoffice', 'hr', 'marketing', 'technical-manager']) {
      expect(isSalesLeadership({ ...base, role, seesOrgWide: true })).toBe(false);
    }
  });

  it('admits Admin and Super Admin, who see every department', () => {
    expect(isSalesLeadership({ ...base, role: 'admin', seesOrgWide: true })).toBe(true);
    expect(isSalesLeadership({ ...base, role: 'superadmin', seesOrgWide: true })).toBe(true);
  });

  it('admits a Manager through their own sales-side department', () => {
    expect(isSalesLeadership({ ...base, department: 'Sales' })).toBe(true);
    expect(isSalesLeadership({ ...base, department: 'GEM - Sales' })).toBe(true);
  });

  it('admits a Manager listed in Department Master as a sales department manager', () => {
    expect(isSalesLeadership({ ...base, department: 'Technical', managersByDepartment: { Sales: [{ username: 'asha' }] } })).toBe(true);
  });

  it('turns down a Manager with no sales-side link at all', () => {
    // The case canManageTargets would wrongly wave through: the seeded
    // `manager` role is isPrivileged, so its escape hatch fires regardless of
    // department (see lib/salesTeamSummary.ts's header comment).
    expect(isSalesLeadership({ ...base, department: 'HR', managersByDepartment: { HR: [{ username: 'asha' }], Sales: [{ username: 'other' }] } })).toBe(false);
  });
});
