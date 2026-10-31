import { describe, it, expect, vi, beforeEach } from 'vitest';

// Backs the AI Daily Report's "Project / Category" dropdown — which Sales
// Projects it may offer.
//
// This replaced listOngoingAssignedProjects, which matched only
// `assigned_technical_person_id` plus co-assignments and filtered
// `status: 'active'` exactly. Both were too narrow: one AI manager saw 33
// active projects on the Projects page and was offered 18 here, and WON
// projects — the ones in delivery, where the daily work actually is — were
// excluded altogether.
//
// The scope itself comes from resolveOwnerWhere, the same rule the Projects
// page uses, so the two screens agree. That is mocked here: what this test
// pins is the STATUS rule, the `mine` flag and the ordering, which are this
// function's own decisions.

const assignmentRows = vi.hoisted(() => [] as { project_id: string }[]);
const projectRows = vi.hoisted(() => [] as Record<string, unknown>[]);
const scopeMock = vi.hoisted(() => ({ value: { seesOrgWide: false, scopedUserIds: ['emp-1'] } as Record<string, unknown> }));

vi.mock('../../lib/departmentScope', () => ({
  resolveVisibilityScope: vi.fn(async () => scopeMock.value)
}));

vi.mock('../../lib/db', () => ({
  db: {
    ProjectTechnicalAssignment: {
      findAll: vi.fn(async () => assignmentRows.map((r) => ({ get: () => r.project_id })))
    },
    Project: {
      // The real where-clause is exercised by the Projects page's own tests;
      // here it is enough that the status rule is applied to the fixtures.
      findAll: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // The status clause is `{ [Op.ne]: 'lost' }` — a SYMBOL key, which
        // Object.values/keys skip entirely. Reading it the obvious way made
        // this filter a no-op and the "excludes lost" case passed on
        // nothing, so the symbol is looked up explicitly.
        const statusClause = where.status as Record<symbol, string> | undefined;
        const excluded = statusClause
          ? Object.getOwnPropertySymbols(statusClause).map((sym) => statusClause[sym])[0]
          : null;
        return projectRows
          .filter((p) => !excluded || p.status !== excluded)
          .map((p) => ({ get: () => p }));
      })
    },
    User: { findOne: vi.fn(async () => null) }
  },
  sequelize: { transaction: vi.fn() },
  isUuid: (v: string) => v !== 'not-a-uuid'
}));

import { listSelectableSalesProjects } from '../../lib/projectStore';

beforeEach(() => {
  vi.clearAllMocks();
  assignmentRows.length = 0;
  projectRows.length = 0;
  scopeMock.value = { seesOrgWide: false, scopedUserIds: ['emp-1'] };
});

describe('listSelectableSalesProjects', () => {
  it('offers an active project', async () => {
    projectRows.push({ id: 'p1', project_name: 'MeetIQ Rollout', status: 'active', assigned_technical_person_id: 'emp-1' });
    const result = await listSelectableSalesProjects('manali', 'emp-1');
    expect(result).toEqual([{ id: 'p1', name: 'MeetIQ Rollout', status: 'active', mine: true }]);
  });

  // The headline change: a won deal is in delivery, which is exactly when
  // somebody files daily work against it.
  it('offers WON and ON HOLD projects, which the old version dropped', async () => {
    projectRows.push({ id: 'p1', project_name: 'Won Deal', status: 'won', assigned_technical_person_id: 'emp-1' });
    projectRows.push({ id: 'p2', project_name: 'Paused', status: 'on_hold', assigned_technical_person_id: 'emp-1' });
    const result = await listSelectableSalesProjects('manali', 'emp-1');
    expect(result.map((p) => p.status).sort()).toEqual(['on_hold', 'won']);
  });

  // Only a lost deal has no future work.
  it('excludes lost projects', async () => {
    projectRows.push({ id: 'p1', project_name: 'Gone', status: 'lost', assigned_technical_person_id: 'emp-1' });
    const result = await listSelectableSalesProjects('manali', 'emp-1');
    expect(result).toEqual([]);
  });

  describe('the mine flag', () => {
    it('is true for the primary assigned technical person', async () => {
      projectRows.push({ id: 'p1', project_name: 'A', status: 'active', assigned_technical_person_id: 'emp-1' });
      expect((await listSelectableSalesProjects('manali', 'emp-1'))[0].mine).toBe(true);
    });

    it('is true for a non-primary co-assignee', async () => {
      projectRows.push({ id: 'p2', project_name: 'B', status: 'active', assigned_technical_person_id: 'someone-else' });
      assignmentRows.push({ project_id: 'p2' });
      expect((await listSelectableSalesProjects('manali', 'emp-1'))[0].mine).toBe(true);
    });

    // A project visible only through department scope is offered, but not
    // claimed as theirs — the picker groups the two separately.
    it('is false for a project they can see but are not on', async () => {
      projectRows.push({ id: 'p3', project_name: 'Team mate’s', status: 'active', assigned_technical_person_id: 'someone-else' });
      expect((await listSelectableSalesProjects('manali', 'emp-1'))[0].mine).toBe(false);
    });
  });

  it('sorts their own projects first, keeping the newest-first order within each group', async () => {
    projectRows.push({ id: 'p1', project_name: 'Team A', status: 'active', assigned_technical_person_id: 'other' });
    projectRows.push({ id: 'p2', project_name: 'Mine A', status: 'active', assigned_technical_person_id: 'emp-1' });
    projectRows.push({ id: 'p3', project_name: 'Team B', status: 'active', assigned_technical_person_id: 'other' });
    projectRows.push({ id: 'p4', project_name: 'Mine B', status: 'active', assigned_technical_person_id: 'emp-1' });
    const result = await listSelectableSalesProjects('manali', 'emp-1');
    expect(result.map((p) => p.name)).toEqual(['Mine A', 'Mine B', 'Team A', 'Team B']);
  });

  it('falls back through project_name -> client_name -> company', async () => {
    projectRows.push({ id: 'p1', client_name: 'Reliance', company: 'Reliance Industries', status: 'active' });
    expect((await listSelectableSalesProjects('manali', 'emp-1'))[0].name).toBe('Reliance');
  });

  it('returns nothing for a non-uuid employee id without querying', async () => {
    const { db } = await import('../../lib/db');
    expect(await listSelectableSalesProjects('manali', 'not-a-uuid')).toEqual([]);
    expect(db.Project.findAll).not.toHaveBeenCalled();
  });

  // The scope is resolved for the employee whose report it is; without a
  // username there is nothing to resolve and guessing would be worse.
  it('returns nothing when the employee username is unknown', async () => {
    const { db } = await import('../../lib/db');
    expect(await listSelectableSalesProjects('', 'emp-1')).toEqual([]);
    expect(db.Project.findAll).not.toHaveBeenCalled();
  });
});
