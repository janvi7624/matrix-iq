import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RolePermissions, RoleRecord } from '../../lib/types';

// Authorization for the module's four surfaces. These are the checks that
// actually matter — the pages redirect unauthorized viewers as a courtesy,
// but these functions are what stop someone reaching the data by calling
// the endpoints directly.
//
// Mocked at the store boundary, the same way tests/unit/permissions.test.ts
// does it, so the rules are tested without a database.

vi.mock('../../lib/moduleConfigStore', () => ({ isModuleAccessAllowed: vi.fn() }));
vi.mock('../../lib/permissions', () => ({ hasCapability: vi.fn() }));
vi.mock('../../lib/roleStore', () => ({ findRoleByKey: vi.fn() }));
vi.mock('../../lib/departmentStore', () => ({
  departmentsManagedBy: vi.fn(),
  listDepartmentManagers: vi.fn(),
  findHrManagers: vi.fn()
}));
vi.mock('../../lib/hrAccess', () => ({ isHrManager: vi.fn() }));
// Mocked rather than driven through the db mock: who reports to whom is its
// own unit with its own tests, and stubbing it here keeps every assertion
// below about the DEPARTMENT rules it was written for.
vi.mock('../../lib/reportingManagers', () => ({
  directReportIdsForUsername: vi.fn(),
  reportingManagerIdFor: vi.fn()
}));
vi.mock('../../lib/db', () => ({
  db: { Department: { findAll: vi.fn() }, User: { findByPk: vi.fn(), findAll: vi.fn() } },
  isUuid: (v: string) => /^[0-9a-f-]{36}$/i.test(v)
}));

import { isModuleAccessAllowed } from '../../lib/moduleConfigStore';
import { hasCapability } from '../../lib/permissions';
import { findRoleByKey } from '../../lib/roleStore';
import { departmentsManagedBy, findHrManagers, listDepartmentManagers } from '../../lib/departmentStore';
import { isHrManager } from '../../lib/hrAccess';
import { directReportIdsForUsername } from '../../lib/reportingManagers';
import { db } from '../../lib/db';
import {
  canAccessDailyReportConfig,
  canAccessHrReview,
  canAccessTeamDashboard,
  resolveDailyReportScope,
  resolveEmployeeAccess
} from '../../lib/dailyReportAccess';

const moduleAllowed = vi.mocked(isModuleAccessAllowed);
const capability = vi.mocked(hasCapability);
const role = vi.mocked(findRoleByKey);
const managed = vi.mocked(departmentsManagedBy);
const hrManager = vi.mocked(isHrManager);
const directReports = vi.mocked(directReportIdsForUsername);

const SELF = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';

function viewer(over: Partial<{ userId: string; username: string; name: string; role: string; isPrivileged: boolean }> = {}) {
  return { userId: SELF, username: 'priya', name: 'Priya', role: 'user', isPrivileged: false, ...over };
}

function makeRole(modules: RolePermissions['modules']): RoleRecord {
  return {
    id: 'r1',
    key: 'custom',
    label: 'Custom',
    description: '',
    isSystem: false,
    isPrivileged: false,
    status: 'active',
    order: 0,
    permissions: { modules, manageSettings: false, manageUsers: false, manageRoles: false, manageDepartments: false, viewAllDepartments: false },
    created_at: '',
    created_by: '',
    updated_at: '',
    updated_by: ''
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  moduleAllowed.mockResolvedValue(true);
  capability.mockResolvedValue(false);
  managed.mockResolvedValue([]);
  hrManager.mockResolvedValue(false);
  // Nobody manages the HR department unless a test says so.
  vi.mocked(listDepartmentManagers).mockResolvedValue({} as never);
  vi.mocked(findHrManagers).mockReturnValue([]);
  role.mockResolvedValue(undefined);
  // Nobody reports to anybody unless a test says so.
  directReports.mockResolvedValue([]);
  vi.mocked(db.Department.findAll).mockResolvedValue([] as never);
  vi.mocked(db.User.findByPk).mockResolvedValue(null as never);
});

describe('scope', () => {
  it('gives a plain employee no team at all', () => {
    return resolveDailyReportScope(viewer()).then((scope) => {
      expect(scope.seesOrgWide).toBe(false);
      expect(scope.departmentIds).toEqual([]);
      // No managed department means no "File for Them", whatever the module
      // permission matrix says.
      expect(scope.canFileForOthers).toBe(false);
    });
  });

  it('gives a department manager exactly their own departments', async () => {
    managed.mockResolvedValue([{ id: 'dept-1', name: 'Marketing' }]);
    const scope = await resolveDailyReportScope(viewer());
    expect(scope.seesOrgWide).toBe(false);
    expect(scope.departmentIds).toEqual(['dept-1']);
    expect(scope.canFileForOthers).toBe(true);
  });

  it('gives an org-wide viewer every active department', async () => {
    capability.mockResolvedValue(true);
    vi.mocked(db.Department.findAll).mockResolvedValue([
      { get: (k: string) => ({ id: 'dept-1', name: 'Sales' }[k]) },
      { get: (k: string) => ({ id: 'dept-2', name: 'AV' }[k]) }
    ] as never);
    const scope = await resolveDailyReportScope(viewer());
    expect(scope.seesOrgWide).toBe(true);
    expect(scope.departmentIds).toEqual(['dept-1', 'dept-2']);
  });

  // The manager role is isPrivileged (lib/permissions.ts:10), so an
  // isPrivileged fallback here handed every department manager the whole
  // company's daily reports. A manager gets the departments they manage and
  // nothing else; only the two admin tiers see everything.
  it('does NOT give a privileged manager the whole company', async () => {
    capability.mockResolvedValue(false);
    managed.mockResolvedValue([{ id: 'dept-1', name: 'Marketing' }]);
    vi.mocked(db.Department.findAll).mockResolvedValue([
      { get: (k: string) => ({ id: 'dept-1', name: 'Marketing' }[k]) },
      { get: (k: string) => ({ id: 'dept-2', name: 'Sales' }[k]) }
    ] as never);
    const scope = await resolveDailyReportScope(viewer({ role: 'manager', isPrivileged: true }));
    expect(scope.seesOrgWide).toBe(false);
    expect(scope.departmentIds).toEqual(['dept-1']);
  });

  it('keeps the built-in admin tiers org-wide even with the capability cleared', async () => {
    // The floor that stops an admin losing the whole module if somebody
    // unticks viewAllDepartments in the role matrix.
    capability.mockResolvedValue(false);
    vi.mocked(db.Department.findAll).mockResolvedValue([
      { get: (k: string) => ({ id: 'dept-1', name: 'Sales' }[k]) }
    ] as never);
    for (const adminRole of ['admin', 'superadmin']) {
      const scope = await resolveDailyReportScope(viewer({ role: adminRole, isPrivileged: true }));
      expect(scope.seesOrgWide).toBe(true);
      expect(scope.departmentIds).toEqual(['dept-1']);
    }
  });

  // An hr-ROLE account that is not the manager of the HR department gets no
  // wider reach — the company-wide read belongs to the HR manager only.
  it('gives an hr-role user who is not the HR manager only what they manage', async () => {
    capability.mockResolvedValue(false);
    hrManager.mockResolvedValue(true);
    managed.mockResolvedValue([{ id: 'dept-hr', name: 'HR & Admin' }]);
    vi.mocked(db.Department.findAll).mockResolvedValue([
      { get: (k: string) => ({ id: 'dept-hr', name: 'HR & Admin' }[k]) },
      { get: (k: string) => ({ id: 'dept-2', name: 'Sales' }[k]) }
    ] as never);
    const scope = await resolveDailyReportScope(viewer({ role: 'hr' }));
    expect(scope.seesOrgWide).toBe(false);
    expect(scope.departmentIds).toEqual(['dept-hr']);
    expect(scope.manageDepartmentIds).toEqual(['dept-hr']);
  });
});

describe('the team dashboard', () => {
  it('is closed to an employee who manages nobody', async () => {
    expect(await canAccessTeamDashboard(viewer())).toBe(false);
  });

  it('is open to a real department manager of any role', async () => {
    // A department's manager can hold any role at all, which is why this
    // cannot be a role-list check.
    managed.mockResolvedValue([{ id: 'dept-1', name: 'Robotics' }]);
    expect(await canAccessTeamDashboard(viewer({ role: 'technician' }))).toBe(true);
  });

  it('is still closed if Module Manager has the module switched off', async () => {
    managed.mockResolvedValue([{ id: 'dept-1', name: 'Robotics' }]);
    moduleAllowed.mockResolvedValue(false);
    expect(await canAccessTeamDashboard(viewer())).toBe(false);
  });
});

describe('HR review', () => {
  it('requires being an actual HR manager, not merely holding the hr role', async () => {
    // The module key is HR-restricted in Module Manager, but an 'hr'-role
    // account that isn't mapped as a manager of the HR department must not
    // get to decide other people's leave claims.
    hrManager.mockResolvedValue(false);
    expect(await canAccessHrReview(viewer({ role: 'hr' }))).toBe(false);
    hrManager.mockResolvedValue(true);
    expect(await canAccessHrReview(viewer({ role: 'hr' }))).toBe(true);
  });

  it('is closed when the module itself is unavailable', async () => {
    hrManager.mockResolvedValue(true);
    moduleAllowed.mockResolvedValue(false);
    expect(await canAccessHrReview(viewer())).toBe(false);
  });
});

describe('configuration', () => {
  it('is open to admin and superadmin', async () => {
    expect(await canAccessDailyReportConfig(viewer({ role: 'admin', isPrivileged: true }))).toBe(true);
    expect(await canAccessDailyReportConfig(viewer({ role: 'superadmin', isPrivileged: true }))).toBe(true);
  });

  it('is CLOSED to a generic privileged manager', async () => {
    // The regression this guards: isPrivileged is true for every department
    // 'manager' account, and this page arms a job that emails the whole
    // company. A permissive fallback here would hand it to all of them.
    role.mockResolvedValue(undefined);
    expect(await canAccessDailyReportConfig(viewer({ role: 'manager', isPrivileged: true }))).toBe(false);
  });

  it('is open to a custom role with an explicit manage grant', async () => {
    role.mockResolvedValue(makeRole({ 'daily-report-config': { manage: true } }));
    expect(await canAccessDailyReportConfig(viewer({ role: 'ops-lead' }))).toBe(true);
  });

  it('is closed to a custom role whose grant is false or absent', async () => {
    role.mockResolvedValue(makeRole({ 'daily-report-config': { manage: false } }));
    expect(await canAccessDailyReportConfig(viewer({ role: 'ops-lead' }))).toBe(false);
    role.mockResolvedValue(makeRole({}));
    expect(await canAccessDailyReportConfig(viewer({ role: 'ops-lead' }))).toBe(false);
  });

  it('is closed to a role that has been deactivated', async () => {
    role.mockResolvedValue({ ...makeRole({ 'daily-report-config': { manage: true } }), status: 'inactive' });
    expect(await canAccessDailyReportConfig(viewer({ role: 'ops-lead' }))).toBe(false);
  });
});

describe('per-employee access', () => {
  it('lets anyone manage their own reports but not file "for" themselves', async () => {
    const access = await resolveEmployeeAccess(viewer(), SELF);
    expect(access).toEqual({ canView: true, canEdit: true, canFileForThem: false, isSelf: true });
  });

  it('refuses a colleague outright for a plain employee', async () => {
    const access = await resolveEmployeeAccess(viewer(), OTHER);
    expect(access.canView).toBe(false);
    expect(access.canEdit).toBe(false);
    expect(access.canFileForThem).toBe(false);
  });

  it('allows a manager within their own department', async () => {
    managed.mockResolvedValue([{ id: 'dept-1', name: 'Marketing' }]);
    vi.mocked(db.User.findByPk).mockResolvedValue({ get: (k: string) => ({ id: OTHER, departmentId: 'dept-1' }[k]) } as never);
    const access = await resolveEmployeeAccess(viewer(), OTHER);
    expect(access).toEqual({ canView: true, canEdit: true, canFileForThem: true, isSelf: false });
  });

  it('refuses a manager an employee from a department they do not manage', async () => {
    managed.mockResolvedValue([{ id: 'dept-1', name: 'Marketing' }]);
    vi.mocked(db.User.findByPk).mockResolvedValue({ get: (k: string) => ({ id: OTHER, departmentId: 'dept-9' }[k]) } as never);
    const access = await resolveEmployeeAccess(viewer(), OTHER);
    expect(access.canView).toBe(false);
    expect(access.canFileForThem).toBe(false);
  });

  it('refuses an employee who cannot be found', async () => {
    managed.mockResolvedValue([{ id: 'dept-1', name: 'Marketing' }]);
    vi.mocked(db.User.findByPk).mockResolvedValue(null as never);
    expect((await resolveEmployeeAccess(viewer(), OTHER)).canView).toBe(false);
  });

  it('allows an org-wide viewer any employee', async () => {
    capability.mockResolvedValue(true);
    vi.mocked(db.Department.findAll).mockResolvedValue([] as never);
    const access = await resolveEmployeeAccess(viewer(), OTHER);
    expect(access).toEqual({ canView: true, canEdit: true, canFileForThem: true, isSelf: false });
  });
});


describe('the HR manager reads every team, but manages only its own', () => {
  // Business decision (2026-11-14): the HR manager — whoever Department
  // Master lists as manager of the HR department — must be able to read each
  // and every team's daily reports. READ only: edit, file-for-them and
  // edit-request decisions still come from manageDepartmentIds.

  const DEPTS = [
    { id: 'd-hr', name: 'HR & Admin' },
    { id: 'd-ai', name: 'AI' },
    { id: 'd-av', name: 'AV' }
  ];

  function asHrManager() {
    hrManager.mockResolvedValue(true);
    managed.mockResolvedValue([DEPTS[0]] as never);
    vi.mocked(findHrManagers).mockReturnValue([{ id: SELF, username: 'priya', name: 'Priya' }]);
    vi.mocked(db.Department.findAll).mockResolvedValue(
      DEPTS.map((d) => ({ get: (k: string) => (d as Record<string, string>)[k] })) as never
    );
  }

  it('reads every active department', async () => {
    asHrManager();
    const scope = await resolveDailyReportScope(viewer({ role: 'hr' }));
    expect(scope.departmentIds).toEqual(['d-hr', 'd-ai', 'd-av']);
    expect(scope.departments).toHaveLength(3);
  });

  it('manages only the department it actually manages', async () => {
    asHrManager();
    const scope = await resolveDailyReportScope(viewer({ role: 'hr' }));
    expect(scope.manageDepartmentIds).toEqual(['d-hr']);
  });

  it('is NOT marked as seeing org-wide', async () => {
    // seesOrgWide grants edit and file rights unconditionally in
    // resolveEmployeeAccess; HR must not get those through that door.
    asHrManager();
    const scope = await resolveDailyReportScope(viewer({ role: 'hr' }));
    expect(scope.seesOrgWide).toBe(false);
  });

  it('can open the team dashboard', async () => {
    asHrManager();
    await expect(canAccessTeamDashboard(viewer({ role: 'hr' }))).resolves.toBe(true);
  });

  it('can VIEW an employee in another department, but not edit or file for them', async () => {
    asHrManager();
    vi.mocked(db.User.findByPk).mockResolvedValue({ get: (k: string) => (k === 'departmentId' ? 'd-ai' : OTHER) } as never);
    const access = await resolveEmployeeAccess(viewer({ role: 'hr' }), OTHER);
    expect(access.canView).toBe(true);
    expect(access.canEdit).toBe(false);
    expect(access.canFileForThem).toBe(false);
  });

  it('may still edit and file within its own department', async () => {
    asHrManager();
    vi.mocked(db.User.findByPk).mockResolvedValue({ get: (k: string) => (k === 'departmentId' ? 'd-hr' : OTHER) } as never);
    const access = await resolveEmployeeAccess(viewer({ role: 'hr' }), OTHER);
    expect(access.canView).toBe(true);
    expect(access.canEdit).toBe(true);
    expect(access.canFileForThem).toBe(true);
  });

  it('does not widen a privileged department manager just because isHrManager says yes', async () => {
    // isHrManager() is true for every isPrivileged account; the widening must
    // key off Department Master's HR manager only.
    hrManager.mockResolvedValue(true);
    managed.mockResolvedValue([DEPTS[1]] as never);
    vi.mocked(findHrManagers).mockReturnValue([{ id: OTHER, username: 'hardik', name: 'Hardik' }]);
    vi.mocked(db.Department.findAll).mockResolvedValue(
      DEPTS.map((d) => ({ get: (k: string) => (d as Record<string, string>)[k] })) as never
    );
    const scope = await resolveDailyReportScope(viewer({ role: 'manager', isPrivileged: true }));
    expect(scope.departmentIds).toEqual(['d-ai']);
  });
});

describe('an ordinary department manager is unaffected', () => {
  it('keeps the two lists identical', async () => {
    managed.mockResolvedValue([{ id: 'd-ai', name: 'AI' }] as never);
    const scope = await resolveDailyReportScope(viewer({ role: 'technical-manager' }));
    expect(scope.departmentIds).toEqual(['d-ai']);
    expect(scope.manageDepartmentIds).toEqual(['d-ai']);
  });

  it('cannot see a department it does not manage', async () => {
    managed.mockResolvedValue([{ id: 'd-ai', name: 'AI' }] as never);
    vi.mocked(db.User.findByPk).mockResolvedValue({ get: (k: string) => (k === 'departmentId' ? 'd-av' : OTHER) } as never);
    const access = await resolveEmployeeAccess(viewer({ role: 'technical-manager' }), OTHER);
    expect(access.canView).toBe(false);
    expect(access.canEdit).toBe(false);
  });
});

// Per-person reporting lines (users.reportingManagerId, lib/reportingManagers.ts).
//
// The case this exists for: Ajay Shankar BP is in Sales but reports to
// Mahendra Singh Chauhan, who is NOT a manager of the Sales department —
// Manoj Menon is. So "manages a department" and "has people reporting to
// them" have to be two independent grants, and the second one has to work
// on its own or the reporting line means nothing.
describe('direct reports', () => {
  const REPORTEE = '33333333-3333-3333-3333-333333333333';

  it('gives someone with reports but no department a team of exactly those people', async () => {
    managed.mockResolvedValue([]);
    directReports.mockResolvedValue([REPORTEE]);
    const scope = await resolveDailyReportScope(viewer());
    expect(scope.seesOrgWide).toBe(false);
    // No department is widened — this is the whole point of a named list.
    expect(scope.departmentIds).toEqual([]);
    expect(scope.manageUserIds).toEqual([REPORTEE]);
    // Filing on their behalf is a manager action, and they are a manager of
    // this person even though they manage no department.
    expect(scope.canFileForOthers).toBe(true);
  });

  it('adds reports alongside a managed department rather than replacing it', async () => {
    managed.mockResolvedValue([{ id: 'dept-1', name: 'Marketing' }]);
    directReports.mockResolvedValue([REPORTEE]);
    const scope = await resolveDailyReportScope(viewer());
    expect(scope.departmentIds).toEqual(['dept-1']);
    expect(scope.manageUserIds).toEqual([REPORTEE]);
  });

  it('lets a reporting manager open a reportee in a department they do not manage', async () => {
    managed.mockResolvedValue([]);
    directReports.mockResolvedValue([REPORTEE]);
    const access = await resolveEmployeeAccess(viewer(), REPORTEE);
    expect(access.canView).toBe(true);
    expect(access.canEdit).toBe(true);
    expect(access.canFileForThem).toBe(true);
    expect(access.isSelf).toBe(false);
  });

  // The grant is per named person, not "everyone near them".
  it('does not leak anyone else from the reportee\'s department', async () => {
    managed.mockResolvedValue([]);
    directReports.mockResolvedValue([REPORTEE]);
    const access = await resolveEmployeeAccess(viewer(), OTHER);
    expect(access.canView).toBe(false);
    expect(access.canEdit).toBe(false);
  });

  it('opens the team dashboard for someone whose only team is their reports', async () => {
    managed.mockResolvedValue([]);
    directReports.mockResolvedValue([REPORTEE]);
    expect(await canAccessTeamDashboard(viewer())).toBe(true);
  });

  // An employee with neither must stay exactly as locked out as before.
  it('still closes the dashboard to someone with no department and no reports', async () => {
    managed.mockResolvedValue([]);
    directReports.mockResolvedValue([]);
    expect(await canAccessTeamDashboard(viewer())).toBe(false);
  });
});
