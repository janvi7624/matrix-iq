import { readJsonBlob, writeJsonBlob } from './blobStore';
import { ModuleConfigRecord, UserRole } from './types';

const DATA_PATHNAME = 'data/moduleConfig.json';
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

async function readAll(): Promise<ModuleConfigRecord[]> {
  const stored = await readJsonBlob<ModuleConfigRecord[]>(DATA_PATHNAME, []);
  if (stored.length === 0) {
    const seeded = SEED_MODULES.map((m, i) => ({ ...m, id: `seed-${i}` }));
    await writeJsonBlob(DATA_PATHNAME, seeded);
    return seeded;
  }

  // A built-in module added after the config was first seeded (e.g. a new
  // module shipped in a later release) won't be in an already-persisted
  // file — reconcile any missing SEED_MODULES keys in so it still appears,
  // without touching anything an admin has already customized.
  const existingKeys = new Set(stored.map((m) => m.key));
  const missing = SEED_MODULES.filter((m) => !existingKeys.has(m.key));

  let relabeled = false;
  const relabeledStored = stored
    .filter((m) => !RETIRED_KEYS.has(m.key))
    .map((m) => {
      let next = m;
      const forced = FORCED_RELABELS[m.key];
      if (forced && next.label === OLD_DEFAULT_LABELS[m.key]) {
        relabeled = true;
        next = { ...next, label: forced };
      }
      if (RESECTIONED_KEYS.has(m.key) && next.section === OLD_SECTION) {
        relabeled = true;
        next = { ...next, section: NEW_SECTION };
      }
      return next;
    });
  const removedAny = relabeledStored.length !== stored.length;

  if (missing.length === 0 && !relabeled && !removedAny) return stored;
  const result = [...relabeledStored, ...missing.map((m, i) => ({ ...m, id: `seed-new-${Date.now()}-${i}` }))];
  await writeJsonBlob(DATA_PATHNAME, result);
  return result;
}

async function writeAll(records: ModuleConfigRecord[]): Promise<void> {
  await writeJsonBlob(DATA_PATHNAME, records);
}

export async function listModuleConfigs(): Promise<ModuleConfigRecord[]> {
  const records = await readAll();
  return [...records].sort((a, b) => (a.section === b.section ? a.order - b.order : a.section.localeCompare(b.section)));
}

// What Dashboard actually renders — enabled modules visible to this role.
export async function listVisibleModules(role: UserRole): Promise<ModuleConfigRecord[]> {
  const all = await listModuleConfigs();
  return all.filter((m) => m.enabled && m.visibleToRoles.includes(role));
}

// Real access control for a custom module's record API (not just a
// dashboard-display concern) — used by /api/custom-modules/[key]/* so a role
// that isn't supposed to see a module can't reach its data by hitting the
// API directly even if they know the URL.
export async function isModuleVisibleToRole(fullKey: string, role: UserRole): Promise<boolean> {
  const all = await listModuleConfigs();
  const config = all.find((m) => m.key === fullKey);
  if (!config) return false;
  return config.enabled && config.visibleToRoles.includes(role);
}

export async function updateModuleConfig(id: string, patch: Partial<Omit<ModuleConfigRecord, 'id' | 'key' | 'isCustom'>>): Promise<ModuleConfigRecord | null> {
  const records = await readAll();
  const index = records.findIndex((m) => m.id === id);
  if (index === -1) return null;
  records[index] = { ...records[index], ...patch };
  await writeAll(records);
  return records[index];
}

export async function reorderModules(orderedIds: string[]): Promise<void> {
  const records = await readAll();
  const byId = new Map(records.map((m) => [m.id, m]));
  orderedIds.forEach((id, i) => {
    const record = byId.get(id);
    if (record) record.order = i + 1;
  });
  await writeAll([...byId.values()]);
}

// Called when a Custom Module is created/updated/deleted (see
// lib/customModuleStore.ts) to keep its Module Manager entry in sync — the
// module's fields/approval config live in CustomModuleDef, but whether it
// shows up on the Dashboard/sidebar is still controlled here like any other
// module.
export async function upsertCustomModuleTile(input: { key: string; label: string; icon: string; section: string; enabled: boolean }): Promise<void> {
  const records = await readAll();
  const fullKey = `custom:${input.key}`;
  const index = records.findIndex((m) => m.key === fullKey);
  const maxOrder = records.filter((m) => m.section === (input.section || 'Custom Modules')).reduce((acc, m) => Math.max(acc, m.order), 0);
  const tile: ModuleConfigRecord = {
    id: index >= 0 ? records[index].id : `custom-${Date.now()}`,
    key: fullKey,
    label: input.label,
    desc: 'Custom module',
    icon: input.icon || '🧩',
    href: `/modules/${input.key}`,
    section: input.section || 'Custom Modules',
    order: index >= 0 ? records[index].order : maxOrder + 1,
    enabled: input.enabled,
    isCustom: true,
    visibleToRoles: index >= 0 ? records[index].visibleToRoles : ['superadmin', 'admin', 'manager']
  };
  if (index >= 0) records[index] = tile;
  else records.push(tile);
  await writeAll(records);
}

export async function removeCustomModuleTile(key: string): Promise<void> {
  const records = await readAll();
  await writeAll(records.filter((m) => m.key !== `custom:${key}`));
}
