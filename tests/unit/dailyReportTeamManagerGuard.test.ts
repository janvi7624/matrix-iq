import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// The actual bug report: "Manager not able to do mark leave in daily report
// — comes Forbidden." Root cause: four routes (team/mark-leave,
// team/file-for-employee, team/range, analytics) guarded themselves with
// guardDailyReport(request, 'team-daily-reports'). But 'team-daily-reports'
// is MANAGER_GATED (lib/moduleConfigStore.ts): isModuleAccessAllowed requires
// viewer.isPrivileged || viewer.isDepartmentManager for that key, bypassing
// the normal role-list check entirely. guardDailyReport (lib/dailyReportApi.ts)
// calls getViewerContext and hands its result straight to
// isModuleAccessAllowed — and getViewerContext never sets isDepartmentManager
// on anyone; nothing does until a caller explicitly resolves it (see
// canAccessTeamDashboard / isUserADepartmentManager) and injects it. So
// guardDailyReport(request, 'team-daily-reports') could only ever pass for an
// already-isPrivileged viewer, 403ing every genuine non-privileged department
// manager — exactly who this module is for, and exactly why testing as an
// admin account never caught it.
//
// The fix: guard these four routes on 'daily-report' (which every
// authenticated daily-report user has) and let each route's own
// canAccessTeamDashboard / resolveDailyReportScope call do the real,
// correctly-resolved authorization — the same split
// app/api/daily-reports/team/route.ts already used correctly. This pins the
// mechanism directly: a viewer shaped exactly as getViewerContext really
// returns one (no isDepartmentManager property at all) is rejected by the
// old key and admitted by the new one.

vi.mock('../../lib/viewerContext', () => ({ getViewerContext: vi.fn() }));
vi.mock('../../lib/memoCache', () => ({
  // Straight through — this test is about the gate, not the cache.
  cached: async (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
  invalidateCache: vi.fn()
}));
vi.mock('../../lib/hrExpenseAccess', () => ({
  isHrExpenseModule: () => false,
  canAccessHrExpenseModule: () => false
}));

const m = vi.hoisted(() => ({ findAll: vi.fn(), count: vi.fn(), destroy: vi.fn(), bulkCreate: vi.fn() }));
vi.mock('../../lib/db', () => ({
  db: { ModuleConfig: { findAll: m.findAll, count: m.count, destroy: m.destroy, bulkCreate: m.bulkCreate } },
  isUuid: () => true
}));

import { getViewerContext } from '../../lib/viewerContext';
import { guardDailyReport, isGuardFailure } from '../../lib/dailyReportApi';

const viewerMock = vi.mocked(getViewerContext);

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

const MODULES = [row({ key: 'daily-report' }), row({ key: 'team-daily-reports' })];

// Exactly the shape getViewerContext really returns for a plain department
// manager: a 'user'/'technical-manager'/legacy-'manager' role who manages a
// department via Department.managerIds. No isDepartmentManager property —
// that is the whole bug. isUserADepartmentManager would say yes, but nothing
// here computes or injects that.
const REAL_DEPARTMENT_MANAGER = { userId: 'u-1', username: 'priya', name: 'Priya', role: 'user', isPrivileged: false };

function request() {
  return new NextRequest('https://app.example.com/api/daily-reports/team/mark-leave');
}

beforeEach(() => {
  vi.clearAllMocks();
  m.count.mockResolvedValue(MODULES.length);
  m.destroy.mockResolvedValue(0);
  m.bulkCreate.mockResolvedValue([]);
  m.findAll.mockResolvedValue(MODULES);
  viewerMock.mockResolvedValue(REAL_DEPARTMENT_MANAGER as never);
});

describe('guardDailyReport for a real (non-privileged) department manager', () => {
  it('403s on the old "team-daily-reports" key — MANAGER_GATED needs isDepartmentManager, which getViewerContext never sets', async () => {
    const guard = await guardDailyReport(request(), 'team-daily-reports');
    expect(isGuardFailure(guard)).toBe(true);
    if (isGuardFailure(guard)) expect(guard.response.status).toBe(403);
  });

  it('passes on "daily-report" — the key the fix now uses; real authorization happens after, via canAccessTeamDashboard', async () => {
    const guard = await guardDailyReport(request(), 'daily-report');
    expect(isGuardFailure(guard)).toBe(false);
    if (!isGuardFailure(guard)) expect(guard.viewer.username).toBe('priya');
  });

  it('still 401s with no session at all, regardless of which key is used', async () => {
    viewerMock.mockResolvedValue(null);
    const guard = await guardDailyReport(request(), 'daily-report');
    expect(isGuardFailure(guard)).toBe(true);
    if (isGuardFailure(guard)) expect(guard.response.status).toBe(401);
  });
});
