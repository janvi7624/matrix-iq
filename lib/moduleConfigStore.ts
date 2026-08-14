import { Model } from 'sequelize';
import { ModuleConfigRecord, UserRole } from './types';
import { db, isUuid } from './db';
import { cached, invalidateCache } from './memoCache';

// listModuleConfigs() (and its seed/reconcile pass) used to run in full on
// every module-gated request — proxy.ts's own comment already flagged this
// as "a redundant round trip paid constantly." Caching the resolved list
// (with a short TTL as a backstop, and an explicit invalidate on every write
// path below) turns that into one seed/reconcile pass per TTL window instead
// of one per request, everywhere from Sidebar/Dashboard down to every single
// module's own access-control check (isModuleAccessAllowed).
const MODULES_CACHE_KEY = 'modules:all';
const MODULES_CACHE_TTL_MS = 30_000;

const ALL_ROLES: UserRole[] = ['superadmin', 'admin', 'manager', 'technical', 'backoffice', 'user'];
const PRIVILEGED_ROLES: UserRole[] = ['superadmin', 'admin', 'manager'];

// Seeded from the tiles that used to be hardcoded in components/Dashboard.tsx
// — first read produces the exact same dashboard as before Module Manager
// existed. From here on, Admin edits this instead of a developer editing
// Dashboard.tsx. Any built-in route not listed here (e.g. brand-new pages
// added later without a matching seed) simply won't appear until an admin
// adds it via Module Manager.
const SEED_MODULES: Omit<ModuleConfigRecord, 'id'>[] = [
  { key: 'projects', label: 'Project Dashboard', desc: 'Every sales project — site visit to close — with a full pipeline timeline.', icon: 'folder-kanban', href: '/projects', section: 'Sales', order: 1, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'quotation', label: 'New Quotation', desc: 'Create a new quotation — AV, Robotics, AI Video Analytics, System Integration & VisitIQ VMS.', icon: 'file-text', href: '/quotation', section: 'Sales', order: 2, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'my-quotations', label: 'Existing Quotations', desc: "Every quotation you've created, with status, versions, and follow-ups.", icon: 'clipboard-list', href: '/my-quotations', section: 'Sales', order: 3, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'site-visits', label: 'Site Visit Report', desc: 'Register a visit and keep logging project updates over time.', icon: 'map-pin', href: '/site-visits', section: 'Sales', order: 4, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'leads', label: 'Lead Capture', desc: 'Scan a business card at an event and qualify the lead on the spot.', icon: 'contact', href: '/leads', section: 'Sales', order: 6, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'demo-schedule', label: 'Demo Schedule', desc: 'Request and approve product demos.', icon: 'monitor', href: '/demo-schedule', section: 'Sales', order: 7, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'travel-schedule', label: 'Travel Schedule', desc: 'Log rep travel for client visits.', icon: 'car', href: '/travel-schedule', section: 'Sales', order: 8, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'backoffice', label: 'Back Office Operations', desc: 'Delivery Challans — prepare, dispatch, verify returns, close.', icon: 'package', href: '/backoffice', section: 'Operations', order: 1, enabled: true, isCustom: false, visibleToRoles: ['backoffice', 'admin', 'superadmin', 'manager'] },
  { key: 'marketing-requests', label: 'Marketing Requests', desc: 'Request marketing support — brochures, banners, social posts, and more — and track delivery timelines.', icon: 'megaphone', href: '/marketing-requests', section: 'Marketing', order: 1, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'user-management', label: 'User Management', desc: 'Create and manage login accounts, roles, and access.', icon: 'user', href: '/admin/users', section: 'Administration', order: 1, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'role-management', label: 'Role Management', desc: 'What each role can see and do across the platform.', icon: 'shield', href: '/admin/roles', section: 'Administration', order: 2, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'department-master', label: 'Department Master', desc: 'Departments used across user profiles.', icon: 'building', href: '/admin/departments', section: 'Administration', order: 3, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'performance-review', label: 'Performance Review', desc: 'A full performance dashboard for one employee at a time — CRM, sales, projects, and activity history.', icon: 'bar-chart', href: '/admin/performance-review', section: 'Reports', order: 1, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'analytics', label: 'Analytics', desc: 'Quotation, project, and pipeline performance at a glance.', icon: 'trending-up', href: '/analytics', section: 'Reports', order: 2, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'audit-log', label: 'Audit Log', desc: 'Every status-changing action across the Back Office workflow.', icon: 'clock', href: '/admin/audit-log', section: 'Administration', order: 4, enabled: true, isCustom: false, visibleToRoles: ['superadmin'] },
  { key: 'product-master', label: 'Product Master', desc: 'Manage the product catalog used across quotations.', icon: 'tag', href: '/admin/products', section: 'Administration', order: 5, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'product-catalog-overrides', label: 'Product Catalog', desc: 'Rename or reprice any AV, Robotics, AI Analytics & VisitIQ product used in quotations.', icon: 'dollar-sign', href: '/admin/product-catalog', section: 'Administration', order: 6, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'app-settings', label: 'Application Settings', desc: 'Company details, tax, terms, and numbering.', icon: 'settings', href: '/admin/settings', section: 'Administration', order: 7, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'module-manager', label: 'Module Manager', desc: 'Enable, disable, rename, and reorder every module.', icon: 'puzzle', href: '/admin/modules', section: 'Administration', order: 8, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  { key: 'custom-modules', label: 'Custom Module Builder', desc: 'Create new business modules without writing code.', icon: 'wrench', href: '/admin/custom-modules', section: 'Administration', order: 9, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES }
];

// Icon values above changed from free-typed emoji to curated icon keys
// (lib/icons.tsx's MODULE_ICON_REGISTRY) as part of the enterprise UI
// refinement — forced onto any already-seeded row whose icon still matches
// the OLD emoji default, same don't-clobber-an-admin-edit guard as
// FORCED_RELABELS (an admin who already picked their own icon keeps it).
const OLD_DEFAULT_ICONS: Record<string, string> = {
  projects: '📁',
  quotation: '🧾',
  'my-quotations': '📋',
  'site-visits': '📍',
  leads: '📇',
  'demo-schedule': '🖥️',
  'travel-schedule': '🚗',
  backoffice: '📦',
  'marketing-requests': '📣',
  'user-management': '👤',
  'role-management': '🛡️',
  'department-master': '🏢',
  'performance-review': '📊',
  analytics: '📈',
  'audit-log': '🕒',
  'product-master': '🏷️',
  'product-catalog-overrides': '💲',
  'app-settings': '⚙️',
  'module-manager': '🧩',
  'custom-modules': '🛠️'
};
const FORCED_ICON_KEYS = new Set(Object.keys(OLD_DEFAULT_ICONS));
const NEW_DEFAULT_ICONS = new Map(SEED_MODULES.map((m) => [m.key, m.icon]));

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

// "Sales Pipeline" was then shortened to "Sales" (section 24: collapsible
// category nav) so the sidebar/dashboard category button reads as a short,
// clickable label. Same don't-clobber-an-admin-edit guard.
const RESECTIONED_KEYS_V2 = new Set(['projects', 'quotation', 'my-quotations', 'site-visits', 'leads', 'demo-schedule', 'travel-schedule']);
const OLD_SECTION_V2 = 'Sales Pipeline';
const NEW_SECTION_V2 = 'Sales';

// Audit Log tightened from "any privileged role" to Super Admin only —
// pre-launch security hardening. Only overwrites a row that still holds the
// exact old default, so an admin's own custom visibility edit (via Module
// Manager) is never clobbered.
const FORCED_VISIBILITY_KEYS = new Set(['audit-log']);
const OLD_VISIBILITY: UserRole[] = PRIVILEGED_ROLES;
const NEW_VISIBILITY: UserRole[] = ['superadmin'];

function sameRoles(a: UserRole[], b: UserRole[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((role, i) => role === sortedB[i]);
}

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
    if (RESECTIONED_KEYS_V2.has(key) && plain.section === OLD_SECTION_V2) attrs.section = NEW_SECTION_V2;
    if (FORCED_VISIBILITY_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_VISIBILITY)) attrs.visibleToRoles = NEW_VISIBILITY;
    if (FORCED_ICON_KEYS.has(key) && plain.icon === OLD_DEFAULT_ICONS[key]) attrs.icon = NEW_DEFAULT_ICONS.get(key);
    if (Object.keys(attrs).length) await row.update(attrs as never);
  }

  // Reuses the keys already fetched above instead of re-querying the same
  // table a second time — this function runs on every module-gated request
  // (see proxy.ts), so a redundant round trip here is paid constantly.
  const missing = SEED_MODULES.filter((m) => !existingKeys.has(m.key));
  if (missing.length) await db.ModuleConfig.bulkCreate(missing.map((m) => ({ ...m })) as never);
}

export async function listModuleConfigs(): Promise<ModuleConfigRecord[]> {
  return cached(MODULES_CACHE_KEY, MODULES_CACHE_TTL_MS, async () => {
    await ensureSeededAndReconciled();
    const rows = await db.ModuleConfig.findAll();
    const records = rows.map(toRecord);
    return records.sort((a, b) => (a.section === b.section ? a.order - b.order : a.section.localeCompare(b.section)));
  });
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
  invalidateCache(MODULES_CACHE_KEY);
  return toRecord(row);
}

export async function reorderModules(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => db.ModuleConfig.update({ order: i + 1 } as never, { where: { id } as never })));
  invalidateCache(MODULES_CACHE_KEY);
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
    await existing.update({ label: input.label, icon: input.icon || 'wrench', section: input.section || 'Custom Modules', enabled: input.enabled } as never);
    invalidateCache(MODULES_CACHE_KEY);
    return;
  }

  const section = input.section || 'Custom Modules';
  const rowsInSection = await db.ModuleConfig.findAll({ where: { section } as never, attributes: ['order'] });
  const maxOrder = rowsInSection.reduce((acc, r) => Math.max(acc, r.get('order') as number), 0);

  await db.ModuleConfig.create({
    key: fullKey,
    label: input.label,
    desc: 'Custom module',
    icon: input.icon || 'wrench',
    href: `/modules/${input.key}`,
    section,
    order: maxOrder + 1,
    enabled: input.enabled,
    isCustom: true,
    visibleToRoles: ['superadmin', 'admin', 'manager']
  } as never);
  invalidateCache(MODULES_CACHE_KEY);
}

export async function removeCustomModuleTile(key: string): Promise<void> {
  await db.ModuleConfig.destroy({ where: { key: `custom:${key}` } as never });
  invalidateCache(MODULES_CACHE_KEY);
}
