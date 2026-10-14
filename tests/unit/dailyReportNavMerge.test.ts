import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Daily Report / Team Daily Reports merge rests on one invariant that is
// easy to break by "tidying up": the 'team-daily-reports' module key is
// hidden from the NAV (it is a tab inside /daily-reports now) while still
// being a live, permission-gated row that every
// isModuleAccessAllowed('team-daily-reports', …) check in
// app/api/daily-reports/team/* depends on.
//
// Delete the row, or drop the key from MANAGER_GATED_KEYS, and the sidebar
// looks identical while the team API either 403s for real managers or opens
// to everyone. Neither failure is visible on screen, which is exactly why it
// is pinned here.

vi.mock('../../lib/memoCache', () => ({
  // Straight through — this test is about the filtering rules, not the cache.
  cached: async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
  invalidateCache: vi.fn()
}));
vi.mock('../../lib/hrExpenseAccess', () => ({
  isHrExpenseModule: () => false,
  canAccessHrExpenseModule: () => false
}));

// vi.hoisted, because vi.mock factories are lifted above ordinary const
// declarations — referencing a plain `const findAll = vi.fn()` from inside
// the factory throws "Cannot access 'findAll' before initialization".
const m = vi.hoisted(() => ({ findAll: vi.fn(), count: vi.fn(), destroy: vi.fn(), bulkCreate: vi.fn() }));
vi.mock('../../lib/db', () => ({
  db: { ModuleConfig: { findAll: m.findAll, count: m.count, destroy: m.destroy, bulkCreate: m.bulkCreate } },
  isUuid: () => true
}));

import { isModuleAccessAllowed, listVisibleModules } from '../../lib/moduleConfigStore';

const { findAll, count, destroy, bulkCreate } = m;

/** A stored ModuleConfig row, as Sequelize hands it back. */
function row(over: Record<string, unknown>) {
  const plain = {
    id: 'm-' + String(over.key),
    label: 'x',
    desc: 'x',
    icon: 'x',
    href: '/x',
    section: 'Workspace',
    order: 1,
    enabled: true,
    isCustom: false,
    visibleToRoles: ['superadmin', 'admin', 'manager', 'engineer', 'backoffice', 'user', 'marketing', 'accounts', 'hr'],
    visibleToDepartments: [],
    ...over
  };
  return { get: () => plain, update: vi.fn() };
}

const MODULES = [row({ key: 'daily-report' }), row({ key: 'team-daily-reports' }), row({ key: 'my-tasks' })];

beforeEach(() => {
  vi.clearAllMocks();
  // Non-zero so ensureSeededAndReconciled takes the reconcile path rather
  // than trying to seed the whole catalogue.
  count.mockResolvedValue(MODULES.length);
  destroy.mockResolvedValue(0);
  bulkCreate.mockResolvedValue([]);
  findAll.mockResolvedValue(MODULES);
});

const employee = { role: 'user', isPrivileged: false, isDepartmentManager: false };
const manager = { role: 'user', isPrivileged: false, isDepartmentManager: true };
const admin = { role: 'admin', isPrivileged: true, isDepartmentManager: false };

describe('nav listing after the merge', () => {
  it('hides the absorbed Team Daily Reports tile from everyone', async () => {
    for (const viewer of [employee, manager, admin]) {
      const keys = (await listVisibleModules(viewer)).map((m) => m.key);
      expect(keys).not.toContain('team-daily-reports');
    }
  });

  it('still lists the surviving Daily Report tile', async () => {
    const keys = (await listVisibleModules(employee)).map((m) => m.key);
    expect(keys).toContain('daily-report');
  });
});

describe('the API gate the absorbed key still provides', () => {
  it('stays OPEN for a real department manager', async () => {
    // This is what the Team tab and app/api/daily-reports/team/* rely on.
    expect(await isModuleAccessAllowed('team-daily-reports', manager)).toBe(true);
  });

  it('stays OPEN for an org-wide admin', async () => {
    expect(await isModuleAccessAllowed('team-daily-reports', admin)).toBe(true);
  });

  it('stays CLOSED for an employee who manages nobody', async () => {
    // Even though their role IS in visibleToRoles — MANAGER_GATED_KEYS
    // bypasses the role list entirely for this key.
    expect(await isModuleAccessAllowed('team-daily-reports', employee)).toBe(false);
  });

  it('closes for everyone if an admin disables the module', async () => {
    findAll.mockResolvedValue([row({ key: 'daily-report' }), row({ key: 'team-daily-reports', enabled: false })]);
    expect(await isModuleAccessAllowed('team-daily-reports', manager)).toBe(false);
    expect(await isModuleAccessAllowed('team-daily-reports', admin)).toBe(false);
  });

  it('leaves the employee tab reachable by someone who manages nobody', async () => {
    // The merge must not have made a personal daily report a manager
    // privilege.
    expect(await isModuleAccessAllowed('daily-report', employee)).toBe(true);
  });
});
