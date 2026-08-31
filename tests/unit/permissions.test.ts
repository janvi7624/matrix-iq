import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RoleRecord, RolePermissions } from '../../lib/types';

vi.mock('../../lib/roleStore', () => ({ findRoleByKey: vi.fn() }));
vi.mock('../../lib/departmentStore', () => ({ listDepartmentManagers: vi.fn() }));

import { findRoleByKey } from '../../lib/roleStore';
import { listDepartmentManagers } from '../../lib/departmentStore';
import {
  resolveIsPrivileged,
  canViewRole,
  hasCapability,
  isModuleActionAllowed,
  canAssignLeads,
  isMarketingManager
} from '../../lib/permissions';

const findRoleByKeyMock = vi.mocked(findRoleByKey);
const listDepartmentManagersMock = vi.mocked(listDepartmentManagers);

function makePermissions(over: Partial<RolePermissions> = {}): RolePermissions {
  return {
    modules: {},
    manageSettings: false,
    manageUsers: false,
    manageRoles: false,
    manageDepartments: false,
    viewAllDepartments: false,
    ...over
  };
}

function makeRole(over: Partial<RoleRecord> = {}): RoleRecord {
  return {
    id: 'role-1',
    key: 'custom',
    label: 'Custom',
    description: '',
    isSystem: false,
    isPrivileged: false,
    status: 'active',
    order: 0,
    permissions: makePermissions(),
    created_at: '',
    created_by: '',
    updated_at: '',
    updated_by: '',
    ...over
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('resolveIsPrivileged', () => {
  it('active role with isPrivileged true -> true', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', isPrivileged: true }));
    expect(await resolveIsPrivileged('custom')).toBe(true);
  });

  it('active role with isPrivileged false -> false', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', isPrivileged: false }));
    expect(await resolveIsPrivileged('custom')).toBe(false);
  });

  it('inactive role with isPrivileged true -> false', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'inactive', isPrivileged: true }));
    expect(await resolveIsPrivileged('custom')).toBe(false);
  });

  it.each(['admin', 'superadmin', 'manager'])('role not found, legacy privileged key %s -> true', async (key) => {
    findRoleByKeyMock.mockResolvedValue(undefined);
    expect(await resolveIsPrivileged(key)).toBe(true);
  });

  it.each(['user', 'engineer', 'marketing', ''])('role not found, non-privileged key %p -> false', async (key) => {
    findRoleByKeyMock.mockResolvedValue(undefined);
    expect(await resolveIsPrivileged(key)).toBe(false);
  });
});

describe('canViewRole', () => {
  it('non-superadmin viewer can never view a superadmin target', () => {
    expect(canViewRole('admin', 'superadmin')).toBe(false);
    expect(canViewRole('manager', 'superadmin')).toBe(false);
    expect(canViewRole('user', 'superadmin')).toBe(false);
  });

  it('a superadmin viewer can view a superadmin target', () => {
    expect(canViewRole('superadmin', 'superadmin')).toBe(true);
  });

  it('anyone can view a non-superadmin target', () => {
    expect(canViewRole('user', 'admin')).toBe(true);
    expect(canViewRole('admin', 'user')).toBe(true);
  });
});

describe('hasCapability', () => {
  it('role not found -> false', async () => {
    findRoleByKeyMock.mockResolvedValue(undefined);
    expect(await hasCapability('custom', 'manageUsers')).toBe(false);
  });

  it('inactive role -> false even if the capability is true', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'inactive', permissions: makePermissions({ manageUsers: true }) }));
    expect(await hasCapability('custom', 'manageUsers')).toBe(false);
  });

  it('active role reflects the capability value', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ manageUsers: true }) }));
    expect(await hasCapability('custom', 'manageUsers')).toBe(true);

    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ manageUsers: false }) }));
    expect(await hasCapability('custom', 'manageUsers')).toBe(false);
  });
});

describe('isModuleActionAllowed', () => {
  it('an explicit true entry wins even when viewer.isPrivileged is false', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ modules: { leads: { assign: true } } }) }));
    expect(await isModuleActionAllowed({ role: 'custom', isPrivileged: false }, 'leads', 'assign')).toBe(true);
  });

  it('an explicit false entry wins even when viewer.isPrivileged is true', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ modules: { leads: { assign: false } } }) }));
    expect(await isModuleActionAllowed({ role: 'custom', isPrivileged: true }, 'leads', 'assign')).toBe(false);
  });

  it('falls back to viewer.isPrivileged when the action key is absent from the module entry', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ modules: { leads: {} } }) }));
    expect(await isModuleActionAllowed({ role: 'custom', isPrivileged: true }, 'leads', 'assign')).toBe(true);
    expect(await isModuleActionAllowed({ role: 'custom', isPrivileged: false }, 'leads', 'assign')).toBe(false);
  });

  it('falls back to viewer.isPrivileged when there is no module entry at all', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ modules: {} }) }));
    expect(await isModuleActionAllowed({ role: 'custom', isPrivileged: true }, 'leads', 'assign')).toBe(true);
  });

  it('falls back to viewer.isPrivileged when the role is not found', async () => {
    findRoleByKeyMock.mockResolvedValue(undefined);
    expect(await isModuleActionAllowed({ role: 'custom', isPrivileged: false }, 'leads', 'assign')).toBe(false);
  });

  it('falls back to viewer.isPrivileged when the role is inactive, even with an explicit true entry', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'inactive', permissions: makePermissions({ modules: { leads: { assign: true } } }) }));
    expect(await isModuleActionAllowed({ role: 'custom', isPrivileged: false }, 'leads', 'assign')).toBe(false);
  });
});

describe('canAssignLeads', () => {
  const viewer = (over: Partial<{ username: string; role: string; isPrivileged: boolean }> = {}) => ({
    username: 'alice',
    role: 'custom',
    isPrivileged: false,
    ...over
  });

  it('viewAllDepartments capability -> true, without ever consulting department managers', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ viewAllDepartments: true }) }));
    expect(await canAssignLeads(viewer())).toBe(true);
    expect(listDepartmentManagersMock).not.toHaveBeenCalled();
  });

  it('a manager of "Sales" by username -> true', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions() }));
    listDepartmentManagersMock.mockResolvedValue({ Sales: [{ id: '1', username: 'alice', name: 'Alice' }] });
    expect(await canAssignLeads(viewer())).toBe(true);
  });

  it('a manager of "GEM - Sales" by username -> true', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions() }));
    listDepartmentManagersMock.mockResolvedValue({ 'GEM - Sales': [{ id: '1', username: 'alice', name: 'Alice' }] });
    expect(await canAssignLeads(viewer())).toBe(true);
  });

  it('a Marketing-only manager falls through (not a lead manager)', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions() }));
    listDepartmentManagersMock.mockResolvedValue({ Marketing: [{ id: '1', username: 'alice', name: 'Alice' }] });
    expect(await canAssignLeads(viewer())).toBe(false);
  });

  it('not a sales manager but isPrivileged -> true', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions() }));
    listDepartmentManagersMock.mockResolvedValue({});
    expect(await canAssignLeads(viewer({ isPrivileged: true }))).toBe(true);
  });

  it('not privileged, falls back to the leads.assign module permission', async () => {
    listDepartmentManagersMock.mockResolvedValue({});
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ modules: { leads: { assign: true } } }) }));
    expect(await canAssignLeads(viewer())).toBe(true);

    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ modules: { leads: { assign: false } } }) }));
    expect(await canAssignLeads(viewer())).toBe(false);

    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ modules: {} }) }));
    expect(await canAssignLeads(viewer())).toBe(false);
  });

  it('an empty department-managers map does not throw', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions() }));
    listDepartmentManagersMock.mockResolvedValue({});
    await expect(canAssignLeads(viewer())).resolves.toBe(false);
  });
});

describe('isMarketingManager', () => {
  const viewer = (over: Partial<{ username: string; role: string; isPrivileged: boolean }> = {}) => ({
    username: 'alice',
    role: 'custom',
    isPrivileged: false,
    ...over
  });

  it('viewAllDepartments capability -> true, without ever consulting department managers', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ viewAllDepartments: true }) }));
    expect(await isMarketingManager(viewer())).toBe(true);
    expect(listDepartmentManagersMock).not.toHaveBeenCalled();
  });

  it('Marketing managers include the viewer -> true', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions() }));
    listDepartmentManagersMock.mockResolvedValue({ Marketing: [{ id: '1', username: 'alice', name: 'Alice' }] });
    expect(await isMarketingManager(viewer())).toBe(true);
  });

  // Flagged finding: asymmetric with canAssignLeads. Here, once Marketing has
  // ANY managers configured, a non-manager is denied even if isPrivileged is
  // true — canAssignLeads checks isPrivileged before falling through to
  // exclusivity. Locking current behavior, not asserting it's correct.
  it('locks current asymmetry: Marketing managers exist but exclude the viewer -> false, even if isPrivileged', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions() }));
    listDepartmentManagersMock.mockResolvedValue({ Marketing: [{ id: '1', username: 'bob', name: 'Bob' }] });
    expect(await isMarketingManager(viewer({ isPrivileged: true }))).toBe(false);
  });

  it('no Marketing managers configured + isPrivileged -> true', async () => {
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions() }));
    listDepartmentManagersMock.mockResolvedValue({});
    expect(await isMarketingManager(viewer({ isPrivileged: true }))).toBe(true);
  });

  it('no Marketing managers configured + not privileged -> delegates to isModuleActionAllowed', async () => {
    listDepartmentManagersMock.mockResolvedValue({});
    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ modules: { 'marketing-requests': { approve: true } } }) }));
    expect(await isMarketingManager(viewer())).toBe(true);

    findRoleByKeyMock.mockResolvedValue(makeRole({ status: 'active', permissions: makePermissions({ modules: { 'marketing-requests': { approve: false } } }) }));
    expect(await isMarketingManager(viewer())).toBe(false);
  });
});
