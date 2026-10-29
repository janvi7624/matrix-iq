import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectRecord, UserRecord } from '../../lib/types';

// The actual bug report: a project was requested with two technical people,
// but the moment one got approved, lib/projectTechnicalRequest.ts's
// applyTechnicalAssignment auto-withdrew the OTHER still-pending request
// (a leftover rule from when assigned_technical_person_id was a single
// column and only one person could ever really be assigned). These tests
// pin the fix: both people end up genuinely assigned, nobody's pending
// request is silently closed out from under them, and removal only ever
// touches the one person it's asked to.

vi.mock('../../lib/userStore', () => ({ findUserById: vi.fn() }));
vi.mock('../../lib/departmentStore', () => ({ listDepartmentManagers: vi.fn(async () => ({})) }));
vi.mock('../../lib/auditLogStore', () => ({ logAudit: vi.fn() }));
vi.mock('../../lib/notificationStore', () => ({ notifyUsers: vi.fn() }));
vi.mock('../../lib/email/notifications', () => ({ sendProjectLifecycleEmail: vi.fn() }));
vi.mock('../../lib/tmsHandoff', () => ({ syncTmsProjectForAssignment: vi.fn() }));

// project_technical_assignments modeled as a plain in-memory array, since
// the fix's whole point is "does this table end up with both people in it,
// not just one" — a mock that just returns canned values would hide exactly
// the bug this is pinning.
const assignmentRows = vi.hoisted(() => [] as { project_id: string; user_id: string; assigned_by_id: string | null }[]);
const requestRows = vi.hoisted(() => [] as { id: string; project_id: string; requested_user_id: string; status: string }[]);

vi.mock('../../lib/db', () => ({
  db: {
    // Only findPendingRequestForPerson's lookup is exercised by these
    // tests (always "no pending request") — the request-creation path
    // itself isn't under test here.
    ProjectTechnicalRequest: { findOne: vi.fn(async () => null) },
    ProjectTechnicalAssignment: {
      findOne: vi.fn(async ({ where }: { where: { project_id: string; user_id: string } }) =>
        assignmentRows.find((r) => r.project_id === where.project_id && r.user_id === where.user_id) ? { get: () => null } : null
      ),
      findAll: vi.fn(async ({ where }: { where: { project_id?: string; user_id?: string } }) => {
        const rows = assignmentRows.filter(
          (r) => (where.project_id === undefined || r.project_id === where.project_id) && (where.user_id === undefined || r.user_id === where.user_id)
        );
        return rows.map((r) => ({
          get: (opts?: unknown) => (opts ? { ...r, person: PEOPLE_BY_ID[r.user_id] } : r.project_id)
        }));
      }),
      create: vi.fn(async (attrs: { project_id: string; user_id: string; assigned_by_id: string | null }) => {
        assignmentRows.push(attrs);
        return { get: () => attrs };
      }),
      destroy: vi.fn(async ({ where }: { where: { project_id: string; user_id: string } }) => {
        const before = assignmentRows.length;
        const keep = assignmentRows.filter((r) => !(r.project_id === where.project_id && r.user_id === where.user_id));
        assignmentRows.length = 0;
        assignmentRows.push(...keep);
        return before - keep.length;
      })
    }
  },
  isUuid: () => true
}));

const PEOPLE_BY_ID: Record<string, { id: string; username: string; name: string }> = {
  'person-a': { id: 'person-a', username: 'alice', name: 'Alice' },
  'person-b': { id: 'person-b', username: 'bob', name: 'Bob' }
};

// findProjectById/projectStore.update/listAssignedTechnicalPeople all mocked
// together — findProjectById reflects the CURRENT fake project state
// (including whatever assignmentRows now holds) so a test can assert on what
// the function's own return value says, not just on the mocked DB rows.
const fakeProject = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('../../lib/projectStore', () => ({
  projectStore: { update: vi.fn(async (id: string, patch: Record<string, unknown>) => { Object.assign(fakeProject.current!, patch); return fakeProject.current; }) },
  findProjectById: vi.fn(async () => (fakeProject.current ? { ...fakeProject.current, assigned_technical_people: assignmentRows.map((r) => PEOPLE_BY_ID[r.user_id]) } : undefined)),
  appendProjectTimeline: vi.fn(async () => fakeProject.current),
  listAssignedTechnicalPeople: vi.fn(async (projectId: string) => assignmentRows.filter((r) => r.project_id === projectId).map((r) => PEOPLE_BY_ID[r.user_id]))
}));

import { findUserById } from '../../lib/userStore';
import {
  applyTechnicalAssignment,
  removeTechnicalPerson,
  requestTechnicalPerson,
  TechnicalRequestError
} from '../../lib/projectTechnicalRequest';

const findUserMock = vi.mocked(findUserById);

const PROJECT_ID = 'proj-1';
const ACTOR = { userId: 'actor-1', username: 'priya', name: 'Priya', role: 'admin' };

function baseProject(over: Record<string, unknown> = {}): ProjectRecord {
  return {
    id: PROJECT_ID,
    stage: 'negotiation',
    assigned_technical_person_id: '',
    assigned_technical_person_name: '',
    assigned_technical_people: [],
    ...over
  } as unknown as ProjectRecord;
}

function userRecord(id: string): UserRecord | undefined {
  const p = PEOPLE_BY_ID[id];
  return p ? ({ id: p.id, username: p.username, name: p.name, email: '', department: '', status: 'active' } as unknown as UserRecord) : undefined;
}

beforeEach(() => {
  assignmentRows.length = 0;
  requestRows.length = 0;
  fakeProject.current = { id: PROJECT_ID, stage: 'negotiation', assigned_technical_person_id: '', assigned_technical_person_name: '' };
  vi.clearAllMocks();
});

describe('applyTechnicalAssignment — multiple people on one project', () => {
  it('a second approval does not remove the first — both end up genuinely assigned', async () => {
    const project = baseProject();
    const alice = userRecord('person-a');
    const bob = userRecord('person-b');

    const afterFirst = await applyTechnicalAssignment(project, alice, ACTOR, '');
    expect(afterFirst?.assigned_technical_people.map((p) => p.id)).toEqual(['person-a']);

    // Re-fetch the project the way a real caller would before the second
    // approval, same as decideTechnicalRequest does.
    const projectAfterFirst = baseProject({ assigned_technical_person_id: 'person-a', assigned_technical_person_name: 'Alice' });
    const afterSecond = await applyTechnicalAssignment(projectAfterFirst, bob, ACTOR, '');

    expect(afterSecond?.assigned_technical_people.map((p) => p.id).sort()).toEqual(['person-a', 'person-b']);
    // The primary (backward-compat single field) stays Alice — Bob is an
    // ADDITIONAL assignee, not a replacement.
    expect(fakeProject.current?.assigned_technical_person_id).toBe('person-a');
  });

  it('keeps the primary as whoever was assigned FIRST even if approved out of order', async () => {
    const bob = userRecord('person-b');
    await applyTechnicalAssignment(baseProject(), bob, ACTOR, '');
    expect(fakeProject.current?.assigned_technical_person_id).toBe('person-b');
  });
});

describe('requestTechnicalPerson — already-assigned guard checks the full team', () => {
  it('rejects requesting someone who is a SECOND (non-primary) assignee, not just the primary', async () => {
    assignmentRows.push({ project_id: PROJECT_ID, user_id: 'person-a', assigned_by_id: null });
    assignmentRows.push({ project_id: PROJECT_ID, user_id: 'person-b', assigned_by_id: null });
    findUserMock.mockResolvedValue(userRecord('person-b'));

    const project = baseProject({ assigned_technical_person_id: 'person-a', assigned_technical_person_name: 'Alice' });
    await expect(requestTechnicalPerson(project, 'person-b', ACTOR, { note: '', neededBy: '' }, '')).rejects.toMatchObject({
      message: expect.stringContaining('already on this project')
    });
  });
});

describe('removeTechnicalPerson', () => {
  beforeEach(() => {
    assignmentRows.push({ project_id: PROJECT_ID, user_id: 'person-a', assigned_by_id: null });
    assignmentRows.push({ project_id: PROJECT_ID, user_id: 'person-b', assigned_by_id: null });
    fakeProject.current = { id: PROJECT_ID, stage: 'negotiation', assigned_technical_person_id: 'person-a', assigned_technical_person_name: 'Alice' };
    findUserMock.mockImplementation(async (id: string) => userRecord(id));
  });

  it('removing a non-primary person leaves the other one untouched, including the primary pointer', async () => {
    const project = baseProject({ assigned_technical_person_id: 'person-a' });
    const result = await removeTechnicalPerson(project, 'person-b', ACTOR, '');

    expect(result?.assigned_technical_people.map((p) => p.id)).toEqual(['person-a']);
    expect(fakeProject.current?.assigned_technical_person_id).toBe('person-a');
  });

  it('removing the primary promotes the next remaining assignee rather than leaving the project unassigned', async () => {
    const project = baseProject({ assigned_technical_person_id: 'person-a' });
    const result = await removeTechnicalPerson(project, 'person-a', ACTOR, '');

    expect(result?.assigned_technical_people.map((p) => p.id)).toEqual(['person-b']);
    expect(fakeProject.current?.assigned_technical_person_id).toBe('person-b');
  });

  it('removing the last remaining person clears the primary to empty, same as the old single-person "Remove"', async () => {
    assignmentRows.length = 0;
    assignmentRows.push({ project_id: PROJECT_ID, user_id: 'person-a', assigned_by_id: null });
    const project = baseProject({ assigned_technical_person_id: 'person-a' });

    const result = await removeTechnicalPerson(project, 'person-a', ACTOR, '');

    expect(result?.assigned_technical_people).toEqual([]);
    expect(fakeProject.current?.assigned_technical_person_id).toBe('');
  });

  it('rejects removing someone who is not actually on the project', async () => {
    const project = baseProject({ assigned_technical_person_id: 'person-a' });
    await expect(removeTechnicalPerson(project, 'someone-else', ACTOR, '')).rejects.toBeInstanceOf(TechnicalRequestError);
  });
});
