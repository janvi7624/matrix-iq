import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModuleConfigRecord } from '../../lib/types';

// moduleConfigStore talks to Sequelize through lib/db; mock the store's own
// reader instead of the database, so these tests exercise the GATE (the
// thing being asserted) rather than seeding and query plumbing.
vi.mock('../../lib/db', () => ({ db: {}, isUuid: () => true }));
// listModuleConfigs reads through cached(); short-circuiting the cache is
// what lets these tests supply a module list without a database. Mocking the
// store's own exported reader would not work — isModuleAccessAllowed calls it
// internally, and an ESM module's self-call cannot be spied on from outside.
vi.mock('../../lib/memoCache', () => ({
  cached: vi.fn(async () => currentModules),
  invalidateCache: vi.fn()
}));
vi.mock('../../lib/hrExpenseAccess', () => ({
  canAccessHrExpenseModule: vi.fn(async () => false),
  isHrExpenseModule: vi.fn(() => false)
}));

import { isModuleAccessAllowed, listVisibleModules } from '../../lib/moduleConfigStore';

function mod(key: string, over: Partial<ModuleConfigRecord> = {}): ModuleConfigRecord {
  return {
    id: key,
    key,
    label: key,
    desc: '',
    icon: '',
    href: `/${key}`,
    section: 'Sales',
    order: 1,
    enabled: true,
    isCustom: false,
    visibleToRoles: ['superadmin', 'admin', 'manager', 'user'],
    ...over
  } as ModuleConfigRecord;
}

const MODULES: ModuleConfigRecord[] = [
  mod('projects'),
  mod('quotation'),
  mod('partners', { visibleToRoles: ['superadmin', 'admin', 'manager'] }),
  mod('partner-dashboard', { section: 'Partner Portal', visibleToRoles: ['partner-admin', 'partner-user'] }),
  mod('partner-projects', { section: 'Partner Portal', visibleToRoles: ['partner-admin', 'partner-user'] }),
  mod('partner-support', { section: 'Partner Portal', visibleToRoles: ['partner-admin', 'partner-user'] })
];

// Mutable so a single test can swap the registry (see the disabled-module
// case at the bottom). Declared with `var` because vi.mock factories are
// hoisted above the file body and would otherwise hit the TDZ.
// eslint-disable-next-line no-var
var currentModules: ModuleConfigRecord[] = [];

beforeEach(() => {
  currentModules = MODULES;
});

const PARTNER = { role: 'partner-admin', isPrivileged: false, partnerId: 'partner-1', username: 'acme' };
const SALES = { role: 'user', isPrivileged: false, username: 'rep' };
const MANAGER = { role: 'manager', isPrivileged: true, username: 'mgr' };
const SUPERADMIN = { role: 'superadmin', isPrivileged: true, username: 'root' };

describe('partner module gate — partners are confined to the portal', () => {
  it('grants a partner the portal modules', async () => {
    expect(await isModuleAccessAllowed('partner-dashboard', PARTNER)).toBe(true);
    expect(await isModuleAccessAllowed('partner-projects', PARTNER)).toBe(true);
  });

  it('denies a partner every internal module', async () => {
    expect(await isModuleAccessAllowed('projects', PARTNER)).toBe(false);
    expect(await isModuleAccessAllowed('quotation', PARTNER)).toBe(false);
    // The internal partner-MANAGEMENT screen is the sharpest case: a partner
    // reaching it would see every other partner in the system.
    expect(await isModuleAccessAllowed('partners', PARTNER)).toBe(false);
  });

  it('denies internal modules even when the partner somehow holds a privileged role', async () => {
    // Defence in depth: partnerId wins over role and over isPrivileged, so a
    // mis-assigned role cannot widen a partner's reach.
    const confused = { role: 'superadmin', isPrivileged: true, partnerId: 'partner-1', username: 'oops' };
    expect(await isModuleAccessAllowed('projects', confused)).toBe(false);
    expect(await isModuleAccessAllowed('partners', confused)).toBe(false);
    expect(await isModuleAccessAllowed('partner-dashboard', confused)).toBe(true);
  });

  it('lists only portal modules in a partner nav', async () => {
    const visible = await listVisibleModules(PARTNER);
    expect(visible.map((m) => m.key).sort()).toEqual(['partner-dashboard', 'partner-projects', 'partner-support']);
  });
});

describe('partner module gate — staff are kept out of the portal', () => {
  it('denies portal modules to internal roles, privileged ones included', async () => {
    for (const viewer of [SALES, MANAGER, SUPERADMIN]) {
      expect(await isModuleAccessAllowed('partner-dashboard', viewer)).toBe(false);
      expect(await isModuleAccessAllowed('partner-support', viewer)).toBe(false);
    }
  });

  it('keeps portal tiles out of an internal sidebar', async () => {
    for (const viewer of [SALES, MANAGER, SUPERADMIN]) {
      const keys = (await listVisibleModules(viewer)).map((m) => m.key);
      expect(keys.some((k) => k.startsWith('partner-'))).toBe(false);
    }
  });

  it('still grants staff the internal partner-management module', async () => {
    // The feature must remain usable by the people who run it — this is what
    // stops the gate above from being "deny everything partner-shaped".
    expect(await isModuleAccessAllowed('partners', MANAGER)).toBe(true);
    expect(await isModuleAccessAllowed('partners', SUPERADMIN)).toBe(true);
    expect(await isModuleAccessAllowed('partners', SALES)).toBe(false);
  });
});

describe('partner module gate — Module Manager still wins', () => {
  it('denies a disabled portal module to a partner', async () => {
    currentModules = [mod('partner-dashboard', { section: 'Partner Portal', enabled: false, visibleToRoles: ['partner-admin'] })];
    expect(await isModuleAccessAllowed('partner-dashboard', PARTNER)).toBe(false);
  });
});
