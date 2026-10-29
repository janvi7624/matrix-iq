import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Op } from 'sequelize';

// Backs the AI Daily Report's "Project / Category" dropdown's new second
// group: ongoing Sales Projects the employee is a formally assigned
// technical person on (primary OR an additional co-assignee), so work on a
// live deal — not just TMS tasks — has somewhere to be logged.
//
// Op comes from the real `sequelize` package (lib/projectStore.ts imports it
// from there directly, not from ./db) — mocking ./db alone is correct and
// the where-clause built by the real function still carries the REAL Op.or/
// Op.in symbols, which this mock's findAll evaluates against fixture rows
// instead of hitting Postgres.

const assignmentRows = vi.hoisted(() => [] as { project_id: string }[]);
const projectRows = vi.hoisted(() => [] as { id: string; project_name?: string; client_name?: string; company?: string; status: string }[]);

vi.mock('../../lib/db', () => ({
  db: {
    ProjectTechnicalAssignment: {
      findAll: vi.fn(async () => assignmentRows.map((r) => ({ get: () => r.project_id })))
    },
    Project: {
      findAll: vi.fn(async ({ where }: { where: Record<string | symbol, unknown> }) => {
        const orClauses = (where[Op.or as unknown as string] ?? []) as Record<string, unknown>[];
        const primaryId = orClauses.find((c) => 'assigned_technical_person_id' in c)?.assigned_technical_person_id as string | undefined;
        const inIds = (orClauses.find((c) => 'id' in c)?.id as Record<string | symbol, string[]> | undefined)?.[Op.in as unknown as string] ?? [];
        return projectRows.filter((p) => p.status === where.status && (p.id === primaryId || inIds.includes(p.id))).map((p) => ({ get: () => p }));
      })
    }
  },
  // A real-enough check that the one non-uuid test below actually exercises
  // — every fixture id above ('proj-1', 'emp-1', etc.) is deliberately NOT a
  // real UUID either, so this always returning true for those, and only
  // false for the one string the test cares about, keeps every other test
  // passing unchanged.
  isUuid: (v: string) => v !== 'not-a-uuid'
}));

import { listOngoingAssignedProjects } from '../../lib/projectStore';

beforeEach(() => {
  vi.clearAllMocks();
  assignmentRows.length = 0;
  projectRows.length = 0;
});

describe('listOngoingAssignedProjects', () => {
  it('returns an active project where the employee is the PRIMARY assigned technical person', async () => {
    projectRows.push({ id: 'proj-1', project_name: 'MeetIQ Rollout', status: 'active' });
    const result = await listOngoingAssignedProjects('proj-1');
    expect(result).toEqual([{ id: 'proj-1', name: 'MeetIQ Rollout' }]);
  });

  it('returns an active project where the employee is an ADDITIONAL (non-primary) co-assignee', async () => {
    projectRows.push({ id: 'proj-2', client_name: 'Adani', status: 'active' });
    assignmentRows.push({ project_id: 'proj-2' });
    const result = await listOngoingAssignedProjects('emp-1');
    expect(result).toEqual([{ id: 'proj-2', name: 'Adani' }]);
  });

  it('excludes a project that is no longer active (won/lost/on_hold)', async () => {
    projectRows.push({ id: 'proj-3', company: 'Closed Co', status: 'won' });
    assignmentRows.push({ project_id: 'proj-3' });
    const result = await listOngoingAssignedProjects('emp-1');
    expect(result).toEqual([]);
  });

  it('returns nothing for an employee with no assignments at all', async () => {
    projectRows.push({ id: 'proj-4', company: 'Unrelated', status: 'active' });
    const result = await listOngoingAssignedProjects('emp-1');
    expect(result).toEqual([]);
  });

  it('falls back through project_name -> client_name -> company, same as projectLabel everywhere else', async () => {
    projectRows.push({ id: 'proj-5', client_name: 'Reliance', company: 'Reliance Industries', status: 'active' });
    assignmentRows.push({ project_id: 'proj-5' });
    const result = await listOngoingAssignedProjects('emp-1');
    expect(result[0].name).toBe('Reliance');
  });

  it('returns nothing for a non-uuid employee id without querying', async () => {
    const { db } = await import('../../lib/db');
    const result = await listOngoingAssignedProjects('not-a-uuid' as never);
    expect(result).toEqual([]);
    expect(db.ProjectTechnicalAssignment.findAll).not.toHaveBeenCalled();
  });
});
