import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Op } from 'sequelize';

// Backs the AI Daily Report's "Project / Category" dropdown: every Sales
// Project this employee is personally an assigned technical person on,
// whatever its status.
//
// Two rules this pins, both of which were wrong before:
//
//   * ALL statuses, not `status: 'active'` exactly. That filter hid WON
//     projects — the ones in delivery, which is when daily technical work
//     actually happens.
//   * THEIR OWN assignments only. An intermediate version scoped this like
//     the Projects page, which for a manager pulled in their whole
//     department's deals; the ask was for their own.
//
// Op comes from the real `sequelize` package (projectStore imports it from
// there, not from ./db), so the where-clause the real function builds
// carries the real Op.or/Op.in symbols and this mock's findAll evaluates
// them against fixtures instead of hitting Postgres.

const assignmentRows = vi.hoisted(() => [] as { project_id: string }[]);
const projectRows = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock('../../lib/db', () => ({
  db: {
    ProjectTechnicalAssignment: {
      findAll: vi.fn(async () => assignmentRows.map((r) => ({ get: () => r.project_id })))
    },
    Project: {
      findAll: vi.fn(async ({ where }: { where: Record<string | symbol, unknown> }) => {
        const orClauses = (where[Op.or as unknown as string] ?? []) as Record<string, unknown>[];
        const primaryId = orClauses.find((c) => 'assigned_technical_person_id' in c)?.assigned_technical_person_id as string | undefined;
        const inIds =
          (orClauses.find((c) => 'id' in c)?.id as Record<string | symbol, string[]> | undefined)?.[Op.in as unknown as string] ?? [];
        return projectRows.filter((p) => p.id === primaryId || inIds.includes(p.id as string)).map((p) => ({ get: () => p }));
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
});

describe('listSelectableSalesProjects', () => {
  it('returns a project where they are the PRIMARY assigned technical person', async () => {
    projectRows.push({ id: 'p1', project_name: 'MeetIQ Rollout', status: 'active' });
    expect(await listSelectableSalesProjects('p1')).toEqual([{ id: 'p1', name: 'MeetIQ Rollout', status: 'active' }]);
  });

  it('returns a project where they are an ADDITIONAL co-assignee', async () => {
    projectRows.push({ id: 'p2', client_name: 'Adani', status: 'active' });
    assignmentRows.push({ project_id: 'p2' });
    expect(await listSelectableSalesProjects('emp-1')).toEqual([{ id: 'p2', name: 'Adani', status: 'active' }]);
  });

  describe('every status is offered', () => {
    // The headline fix: a won deal is in delivery, which is exactly when
    // somebody files daily work against it.
    it('includes won, on_hold and lost assignments', async () => {
      projectRows.push({ id: 'p1', project_name: 'Won', status: 'won' });
      projectRows.push({ id: 'p2', project_name: 'Paused', status: 'on_hold' });
      projectRows.push({ id: 'p3', project_name: 'Gone', status: 'lost' });
      assignmentRows.push({ project_id: 'p1' }, { project_id: 'p2' }, { project_id: 'p3' });
      const result = await listSelectableSalesProjects('emp-1');
      expect(result.map((p) => p.status).sort()).toEqual(['lost', 'on_hold', 'won']);
    });

    // Belt and braces: the query itself must carry no status constraint, so
    // a filter cannot creep back in unnoticed.
    it('sends no status constraint to the database', async () => {
      projectRows.push({ id: 'p1', project_name: 'A', status: 'active' });
      await listSelectableSalesProjects('p1');
      const { db } = await import('../../lib/db');
      const call = (db.Project.findAll as unknown as { mock: { calls: [{ where: Record<string, unknown> }][] } }).mock.calls[0][0];
      expect(call.where).not.toHaveProperty('status');
    });

    it('reports the status so the picker can label a non-active project', async () => {
      projectRows.push({ id: 'p1', project_name: 'Won Deal', status: 'won' });
      expect((await listSelectableSalesProjects('p1'))[0].status).toBe('won');
    });
  });

  describe('their own assignments only', () => {
    // The scope correction: a project they can merely SEE is not offered.
    it('excludes a project they are not assigned to', async () => {
      projectRows.push({ id: 'p9', project_name: 'Someone else’s', status: 'active' });
      expect(await listSelectableSalesProjects('emp-1')).toEqual([]);
    });

    it('asks only about this employee, not a department scope', async () => {
      projectRows.push({ id: 'p1', project_name: 'A', status: 'active' });
      await listSelectableSalesProjects('emp-1');
      const { db } = await import('../../lib/db');
      const call = (db.ProjectTechnicalAssignment.findAll as unknown as {
        mock: { calls: [{ where: { user_id: string } }][] };
      }).mock.calls[0][0];
      expect(call.where.user_id).toBe('emp-1');
    });
  });

  it('falls back through project_name -> client_name -> company', async () => {
    projectRows.push({ id: 'p1', client_name: 'Reliance', company: 'Reliance Industries', status: 'active' });
    expect((await listSelectableSalesProjects('p1'))[0].name).toBe('Reliance');
  });

  it('returns nothing for a non-uuid employee id without querying', async () => {
    const { db } = await import('../../lib/db');
    expect(await listSelectableSalesProjects('not-a-uuid')).toEqual([]);
    expect(db.ProjectTechnicalAssignment.findAll).not.toHaveBeenCalled();
  });
});
