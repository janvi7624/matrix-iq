import { describe, it, expect, vi, beforeEach } from 'vitest';

// Accounts and Back Office both seeded as 'not_configured' before their
// formats existed. Seed defaults are never re-applied to a row that already
// exists — that is what protects an admin's own choice — so an explicit
// reconciliation is the only thing that can upgrade them.
//
// It shipped broken once: the call sat behind `if (!missing.length) return`,
// so it ran only when a department row was MISSING. On any installed system
// every row exists, `missing` is empty, and the reconcile never executed —
// Accounts staff kept seeing "No report format for your department yet"
// while the code looked correct. Nothing on screen says a reconcile did not
// run, which is exactly why it is pinned here.

const m = vi.hoisted(() => ({
  findAll: vi.fn(),
  bulkCreate: vi.fn(),
  userFindAll: vi.fn()
}));

vi.mock('../../lib/memoCache', () => ({
  cached: async (_k: string, _t: number, loader: () => Promise<unknown>) => loader(),
  invalidateCache: vi.fn()
}));
vi.mock('../../lib/departmentStore', () => ({
  listActiveDepartments: vi.fn(),
  listDepartmentManagers: vi.fn(async () => ({}))
}));
vi.mock('../../lib/db', () => ({
  db: {
    DailyReportTemplate: { findAll: m.findAll, bulkCreate: m.bulkCreate },
    User: { findAll: m.userFindAll, count: vi.fn() },
    Sequelize: { fn: vi.fn(() => 'COUNT'), col: vi.fn(() => 'id') }
  },
  isUuid: () => true
}));

import { listActiveDepartments } from '../../lib/departmentStore';
import { invalidateTemplateAssignmentsCache, listTemplateAssignments } from '../../lib/dailyReportTemplateStore';

const departments = vi.mocked(listActiveDepartments);

/** A stored assignment row with a spyable update(). */
function row(departmentId: string, templateKey: string, status: string) {
  const plain = {
    id: 'row-' + departmentId,
    department_id: departmentId,
    template_key: templateKey,
    status,
    overrides: {},
    extra_manager_ids: [],
    notes: '',
    updatedAt: null,
    updater: null
  };
  return { get: (arg?: unknown) => (arg === 'department_id' ? plain.department_id : plain), update: vi.fn() };
}

const DEPTS = [
  { id: 'd-accounts', name: 'Accounts' },
  { id: 'd-backoffice', name: 'Back Office' },
  { id: 'd-admin', name: 'Administration' },
  { id: 'd-ai', name: 'AI' }
];

beforeEach(() => {
  vi.clearAllMocks();
  invalidateTemplateAssignmentsCache();
  departments.mockResolvedValue(DEPTS as never);
  m.userFindAll.mockResolvedValue([]);
  m.bulkCreate.mockResolvedValue([]);
});

describe('reconciling a newly-approved report format', () => {
  it('runs even when NO department row is missing', async () => {
    const accounts = row('d-accounts', 'not_configured', 'not_configured');
    const backoffice = row('d-backoffice', 'not_configured', 'not_configured');
    const admin = row('d-admin', 'not_configured', 'not_configured');
    const ai = row('d-ai', 'ai', 'active');

    m.findAll
      // ensureSeeded's existence probe — every department already has a row,
      // so `missing` is empty. This is the case the bug skipped.
      .mockResolvedValueOnce([accounts, backoffice, admin, ai])
      // the reconcile's own query for still-unconfigured rows
      .mockResolvedValueOnce([accounts, backoffice, admin])
      // the final listing
      .mockResolvedValueOnce([accounts, backoffice, admin, ai]);

    await listTemplateAssignments();

    expect(m.bulkCreate).not.toHaveBeenCalled();
    expect(accounts.update).toHaveBeenCalledWith({ template_key: 'accounts', status: 'active' });
    expect(backoffice.update).toHaveBeenCalledWith({ template_key: 'backoffice', status: 'active' });
  });

  it('leaves a department with no approved format alone', async () => {
    const admin = row('d-admin', 'not_configured', 'not_configured');
    m.findAll.mockResolvedValueOnce([admin]).mockResolvedValueOnce([admin]).mockResolvedValueOnce([admin]);
    departments.mockResolvedValue([{ id: 'd-admin', name: 'Administration' }] as never);

    await listTemplateAssignments();

    // Administration was never part of the approved set — forcing a format
    // onto it is the thing the brief explicitly said not to do.
    expect(admin.update).not.toHaveBeenCalled();
  });

  it('never touches a department an admin has already configured', async () => {
    const ai = row('d-ai', 'ai', 'active');
    m.findAll
      .mockResolvedValueOnce([ai])
      // The reconcile only ever queries rows still at BOTH untouched
      // defaults, so a configured row is not even a candidate.
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ai]);
    departments.mockResolvedValue([{ id: 'd-ai', name: 'AI' }] as never);

    await listTemplateAssignments();
    expect(ai.update).not.toHaveBeenCalled();
  });
});
