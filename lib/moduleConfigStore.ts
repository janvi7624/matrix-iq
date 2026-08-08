import { Model } from 'sequelize';
import { ModuleConfigRecord, UserRole } from './types';
import { db, isUuid } from './db';

const ALL_ROLES: UserRole[] = ['superadmin', 'admin', 'manager', 'technical', 'backoffice', 'user'];
const PRIVILEGED_ROLES: UserRole[] = ['superadmin', 'admin', 'manager'];

// Seeded from the tiles that used to be hardcoded in components/Dashboard.tsx
// — first read produces the exact same dashboard as before Module Manager
// existed. From here on, Admin edits this instead of a developer editing
// Dashboard.tsx. Any built-in route not listed here (e.g. brand-new pages
// added later without a matching seed) simply won't appear until an admin
// adds it via Module Manager.
const SEED_MODULES: Omit<ModuleConfigRecord, 'id'>[] = [
  { key: 'projects', label: 'Project Dashboard', desc: 'Every sales project — site visit to close — with a full pipeline timeline.', icon: '📁', href: '/projects', section: 'Sales Pipeline', order: 1, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'quotation', label: 'New Quotation', desc: 'Create a new quotation — AV, Robotics, AI Video Analytics, System Integration & VisitIQ VMS.', icon: '🧾', href: '/quotation', section: 'Sales Pipeline', order: 2, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'my-quotations', label: 'Existing Quotations', desc: "Every quotation you've created, with status, versions, and follow-ups.", icon: '📋', href: '/my-quotations', section: 'Sales Pipeline', order: 3, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'site-visits', label: 'Site Visit Report', desc: 'Register a visit and keep logging project updates over time.', icon: '📍', href: '/site-visits', section: 'Sales Pipeline', order: 4, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'leads', label: 'Lead Capture', desc: 'Scan a business card at an event and qualify the lead on the spot.', icon: '📇', href: '/leads', section: 'Sales Pipeline', order: 6, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'demo-schedule', label: 'Demo Schedule', desc: 'Request and approve product demos.', icon: '🖥️', href: '/demo-schedule', section: 'Sales Pipeline', order: 7, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'travel-schedule', label: 'Travel Schedule', desc: 'Log rep travel for client visits.', icon: '🚗', href: '/travel-schedule', section: 'Sales Pipeline', order: 8, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'backoffice', label: 'Back Office Operations', desc: 'Delivery Challans — prepare, dispatch, verify returns, close.', icon: '📦', href: '/backoffice', section: 'Operations', order: 1, enabled: true, isCustom: false, visibleToRoles: ['backoffice', 'admin', 'superadmin', 'manager'] },
  { key: 'marketing-requests', label: 'Marketing Requests', desc: 'Request marketing support — brochures, banners, social posts, and more — and track delivery timelines.', icon: '📣', href: '/marketing-requests', section: 'Marketing', order: 1, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'user-management', label: 'User Management', desc: 'Create and manage login accounts, roles, and access.', icon: '👤', href: '/admin/users', section: 'Administration', order: 1, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'role-management', label: 'Role Management', desc: 'What each role can see and do across the platform.', icon: '🛡️', href: '/admin/roles', section: 'Administration', order: 2, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'department-master', label: 'Department Master', desc: 'Departments used across user profiles.', icon: '🏢', href: '/admin/departments', section: 'Administration', order: 3, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'performance-review', label: 'Performance Review', desc: 'A full performance dashboard for one employee at a time — CRM, sales, projects, and activity history.', icon: '📊', href: '/admin/performance-review', section: 'Reports', order: 1, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'analytics', label: 'Analytics', desc: 'Quotation, project, and pipeline performance at a glance.', icon: '📈', href: '/analytics', section: 'Reports', order: 2, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'audit-log', label: 'Audit Log', desc: 'Every status-changing action across the Back Office workflow.', icon: '🕒', href: '/admin/audit-log', section: 'Administration', order: 4, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'product-master', label: 'Product Master', desc: 'Manage the product catalog used across quotations.', icon: '🏷️', href: '/admin/products', section: 'Administration', order: 5, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'app-settings', label: 'Application Settings', desc: 'Company details, tax, terms, and numbering.', icon: '⚙️', href: '/admin/settings', section: 'Administration', order: 6, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'module-manager', label: 'Module Manager', desc: 'Enable, disable, rename, and reorder every module.', icon: '🧩', href: '/admin/modules', section: 'Administration', order: 7, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'custom-modules', label: 'Custom Module Builder', desc: 'Create new business modules without writing code.', icon: '🛠️', href: '/admin/custom-modules', section: 'Administration', order: 8, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES }
];

// One-time forced relabels for built-in modules renamed in a later release
// (section 23: Quotation -> New Quotation, My Quotations -> Existing
// Quotations) — only applied if the stored label still matches the OLD
// default exactly, so an admin's own custom label is never overwritten.
const FORCED_RELABELS: Record<string, string> = {
  quotation: 'New Quotation',
  'my-quotations': 'Existing Quotations'
};
const OLD_DEFAULT_LABELS: Record<string, string> = {
  quotation: 'Quotation',
  'my-quotations': 'My Quotations'
};

// CRM was merged into Projects (section 23) — its own module tile/route no
// longer exists, so strip it from any already-persisted config instead of
// leaving a dead tile pointing at a removed page.
const RETIRED_KEYS = new Set(['crm']);

// The Dashboard section these modules used to be grouped under was literally
// named "CRM" — renamed to "Sales Pipeline" now that CRM itself is gone, so
// the section header on screen doesn't still say "CRM". Same
// don't-clobber-an-admin-edit guard as FORCED_RELABELS above.
const RESECTIONED_KEYS = new Set(['projects', 'quotation', 'my-quotations', 'site-visits', 'leads', 'demo-schedule', 'travel-schedule']);
const OLD_SECTION = 'CRM';
const NEW_SECTION = 'Sales Pipeline';

function toRecord(row: Model): ModuleConfigRecord {
  const plain = row.get({ plain: true }) as Record<string, unknown>;
  return {
    id: plain.id as string,
    key: plain.key as string,
    label: (plain.label as string) ?? '',
    desc: (plain.desc as string) ?? '',
    icon: (plain.icon as string) ?? '',
    href: (plain.href as string) ?? '',
    section: (plain.section as string) ?? '',
    order: plain.order as number,
    enabled: plain.enabled as boolean,
    isCustom: plain.isCustom as boolean,
    visibleToRoles: (plain.visibleToRoles as UserRole[]) ?? []
  };
}

async function ensureSeededAndReconciled(): Promise<void> {
  const count = await db.ModuleConfig.count();
  if (count === 0) {
    await db.ModuleConfig.bulkCreate(SEED_MODULES.map((m) => ({ ...m })) as never);
    return;
  }

  await db.ModuleConfig.destroy({ where: { key: [...RETIRED_KEYS] } as never });

  const stored = await db.ModuleConfig.findAll();
  const existingKeys = new Set<string>();
  for (const row of stored) {
    const plain = row.get({ plain: true }) as Record<string, unknown>;
    const key = plain.key as string;
    existingKeys.add(key);
    const attrs: Record<string, unknown> = {};
    const forced = FORCED_RELABELS[key];
    if (forced && plain.label === OLD_DEFAULT_LABELS[key]) attrs.label = forced;
    if (RESECTIONED_KEYS.has(key) && plain.section === OLD_SECTION) attrs.section = NEW_SECTION;
    if (Object.keys(attrs).length) await row.update(attrs as never);
  }

  // Reuses the keys already fetched above instead of re-querying the same
  // table a second time — this function runs on every module-gated request
  // (see proxy.ts), so a redundant round trip here is paid constantly.
  const missing = SEED_MODULES.filter((m) => !existingKeys.has(m.key));
  if (missing.length) await db.ModuleConfig.bulkCreate(missing.map((m) => ({ ...m })) as never);
}

export async function listModuleConfigs(): Promise<ModuleConfigRecord[]> {
  await ensureSeededAndReconciled();
  const rows = await db.ModuleConfig.findAll();
  const records = rows.map(toRecord);
  return records.sort((a, b) => (a.section === b.section ? a.order - b.order : a.section.localeCompare(b.section)));
}

// What Dashboard actually renders — enabled modules visible to this role.
export async function listVisibleModules(role: UserRole): Promise<ModuleConfigRecord[]> {
  const all = await listModuleConfigs();
  return all.filter((m) => m.enabled && m.visibleToRoles.includes(role));
}

// Real access control for a module's record/page API — the single source of
// truth for both built-in modules (see proxy.ts's BUILTIN_MODULE_GATES) and
// custom modules (see customModuleStore.ts's getModuleForViewer), keyed off
// THIS store's ModuleConfigRecord (what Module Manager actually edits), not
// any other per-module "enabled" flag a module's own admin surface might
// have. A disabled module blocks EVERYONE, including privileged roles; an
// enabled module restricted to certain roles only blocks non-privileged
// viewers — so a role that isn't supposed to see a module can't reach its
// data by hitting the API directly even if they know the URL.
export async function isModuleAccessAllowed(key: string, viewer: { role: UserRole; isPrivileged: boolean }): Promise<boolean> {
  const all = await listModuleConfigs();
  const config = all.find((m) => m.key === key);
  if (!config || !config.enabled) return false;
  if (viewer.isPrivileged) return true;
  return config.visibleToRoles.includes(viewer.role);
}

export async function updateModuleConfig(id: string, patch: Partial<Omit<ModuleConfigRecord, 'id' | 'key' | 'isCustom'>>): Promise<ModuleConfigRecord | null> {
  if (!isUuid(id)) return null;
  const row = await db.ModuleConfig.findByPk(id);
  if (!row) return null;
  await row.update(patch as never);
  return toRecord(row);
}

export async function reorderModules(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => db.ModuleConfig.update({ order: i + 1 } as never, { where: { id } as never })));
}

// Called when a Custom Module is created/updated/deleted (see
// lib/customModuleStore.ts) to keep its Module Manager entry in sync — the
// module's fields/approval config live in CustomModuleDef, but whether it
// shows up on the Dashboard/sidebar is still controlled here like any other
// module.
export async function upsertCustomModuleTile(input: { key: string; label: string; icon: string; section: string; enabled: boolean }): Promise<void> {
  const fullKey = `custom:${input.key}`;
  const existing = await db.ModuleConfig.findOne({ where: { key: fullKey } as never });

  if (existing) {
    await existing.update({ label: input.label, icon: input.icon || '🧩', section: input.section || 'Custom Modules', enabled: input.enabled } as never);
    return;
  }

  const section = input.section || 'Custom Modules';
  const rowsInSection = await db.ModuleConfig.findAll({ where: { section } as never, attributes: ['order'] });
  const maxOrder = rowsInSection.reduce((acc, r) => Math.max(acc, r.get('order') as number), 0);

  await db.ModuleConfig.create({
    key: fullKey,
    label: input.label,
    desc: 'Custom module',
    icon: input.icon || '🧩',
    href: `/modules/${input.key}`,
    section,
    order: maxOrder + 1,
    enabled: input.enabled,
    isCustom: true,
    visibleToRoles: ['superadmin', 'admin', 'manager']
  } as never);
}

export async function removeCustomModuleTile(key: string): Promise<void> {
  await db.ModuleConfig.destroy({ where: { key: `custom:${key}` } as never });
}
