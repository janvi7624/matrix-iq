import { Model } from 'sequelize';
import { ModuleConfigRecord, UserRole } from './types';
import { db, isUuid } from './db';
import { cached, invalidateCache } from './memoCache';
import { TMS_ROLE_KEYS } from './tmsConstants';

// listModuleConfigs() (and its seed/reconcile pass) used to run in full on
// every module-gated request — proxy.ts's own comment already flagged this
// as "a redundant round trip paid constantly." Caching the resolved list
// (with a short TTL as a backstop, and an explicit invalidate on every write
// path below) turns that into one seed/reconcile pass per TTL window instead
// of one per request, everywhere from Sidebar/Dashboard down to every single
// module's own access-control check (isModuleAccessAllowed).
const MODULES_CACHE_KEY = 'modules:all';
const MODULES_CACHE_TTL_MS = 30_000;

// 'technical' role retired (Sept 2026), merged into TMS's 'engineer' role —
// see lib/roleStore.ts. 'engineer' takes over its spot here.
const ALL_ROLES: UserRole[] = ['superadmin', 'admin', 'manager', 'engineer', 'backoffice', 'user', 'marketing', 'accounts', 'hr'];
const PRIVILEGED_ROLES: UserRole[] = ['superadmin', 'admin', 'manager'];

// TMS (Technical Management System) — Robotics/AI/AV/Marketing-only, see
// lib/tmsAccess.ts. Only Admin/Super Admin get automatic oversight here —
// deliberately NOT the generic 'manager' role (PRIVILEGED_ROLES), which
// would otherwise let a Sales/HR/Accounts/... manager see TMS too, since
// isPrivileged is true for every manager account. TMS's own roster
// (technical-manager/team-lead/engineer/technician) is what a real TMS
// department head should actually be given, not the main app's 'manager'
// role — see isModuleAccessAllowed's TMS special-case below, which is what
// actually enforces this (this list alone isn't enough: the generic
// isPrivileged bypass there would still let a manager through).
const TMS_OVERSIGHT_ROLES: UserRole[] = ['superadmin', 'admin'];
const TMS_ALL_ROLES: UserRole[] = [...TMS_OVERSIGHT_ROLES, 'technical-manager', 'team-lead', 'engineer', 'technician'];
const TMS_MANAGER_ONLY_ROLES: UserRole[] = [...TMS_OVERSIGHT_ROLES, 'technical-manager'];
const TMS_DEPARTMENTS = ['Robotics', 'AI', 'AV', 'Marketing'];

// TMS accounts also need a handful of Sales-section modules (their project
// dashboard is tied to Project.assigned_technical_person_id, and they work
// alongside Sales day to day) — added on top of the standard 6 roles, not
// instead of them. Demo Schedule is included here for VISIBILITY only; TMS
// roles are additionally blocked from actually creating a request (see
// app/api/demo-schedule/route.ts POST and components/DemoScheduleView.tsx)
// — they can see the queue, not submit new requests.
const SALES_ROLES_WITH_TMS: UserRole[] = [...ALL_ROLES, ...TMS_ROLE_KEYS];

// Seeded from the tiles that used to be hardcoded in components/Dashboard.tsx
// — first read produces the exact same dashboard as before Module Manager
// existed. From here on, Admin edits this instead of a developer editing
// Dashboard.tsx. Any built-in route not listed here (e.g. brand-new pages
// added later without a matching seed) simply won't appear until an admin
// adds it via Module Manager.
const SEED_MODULES: Omit<ModuleConfigRecord, 'id'>[] = [
  { key: 'projects', label: 'Project Dashboard', desc: 'Every sales project — site visit to close — with a full pipeline timeline.', icon: 'folder-kanban', href: '/projects', section: 'Sales', order: 1, enabled: true, isCustom: false, visibleToRoles: SALES_ROLES_WITH_TMS },
  { key: 'quotation', label: 'New Quotation', desc: 'Create a new quotation — AV, Robotics, AI Video Analytics, System Integration & VisitIQ VMS.', icon: 'file-text', href: '/quotation', section: 'Sales', order: 2, enabled: true, isCustom: false, visibleToRoles: SALES_ROLES_WITH_TMS },
  { key: 'my-quotations', label: 'Existing Quotations', desc: "Every quotation you've created, with status, versions, and follow-ups.", icon: 'clipboard-list', href: '/my-quotations', section: 'Sales', order: 3, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'site-visits', label: 'Site Visit Report', desc: 'Register a visit and keep logging project updates over time.', icon: 'map-pin', href: '/site-visits', section: 'Sales', order: 4, enabled: true, isCustom: false, visibleToRoles: SALES_ROLES_WITH_TMS },
  { key: 'leads', label: 'Lead Capture / Inquiry', desc: 'Scan a business card at an event, or bulk-import from CSV or multiple photos, and qualify each lead on the spot.', icon: 'contact', href: '/leads', section: 'Sales', order: 6, enabled: true, isCustom: false, visibleToRoles: SALES_ROLES_WITH_TMS },
  { key: 'demo-schedule', label: 'Demo Schedule', desc: 'Request and approve product demos.', icon: 'monitor', href: '/demo-schedule', section: 'Sales', order: 7, enabled: true, isCustom: false, visibleToRoles: SALES_ROLES_WITH_TMS },
  { key: 'hr-dashboard', label: 'HR Dashboard', desc: 'Upcoming birthdays and work anniversaries.', icon: 'cake', href: '/hr-dashboard', section: 'HR', order: 0, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'travel-schedule', label: 'Travel Schedule', desc: 'Log rep travel for client visits.', icon: 'car', href: '/travel-schedule', section: 'HR', order: 1, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'reimbursement', label: 'Reimbursement', desc: 'Submit and track expense reimbursement bills.', icon: 'receipt-indian-rupee', href: '/reimbursement', section: 'HR', order: 2, enabled: true, isCustom: false, visibleToRoles: ALL_ROLES },
  { key: 'admin-expenses', label: 'Admin Expenses', desc: 'Add hotel & ticket expenses split across employees (admin only).', icon: 'briefcase', href: '/admin-expenses', section: 'HR', order: 3, enabled: true, isCustom: false, visibleToRoles: ['superadmin', 'admin'] },
  { key: 'backoffice', label: 'Back Office Operations', desc: 'Delivery Challans — prepare, dispatch, verify returns, close.', icon: 'package', href: '/backoffice', section: 'Operations', order: 1, enabled: true, isCustom: false, visibleToRoles: ['backoffice', 'admin', 'superadmin', 'manager'] },
  { key: 'marketing-requests', label: 'Marketing Requests', desc: 'Request marketing support — brochures, banners, social posts, and more — and track delivery timelines.', icon: 'megaphone', href: '/marketing-requests', section: 'Marketing', order: 1, enabled: true, isCustom: false, visibleToRoles: SALES_ROLES_WITH_TMS },
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
  { key: 'custom-modules', label: 'Custom Module Builder', desc: 'Create new business modules without writing code.', icon: 'wrench', href: '/admin/custom-modules', section: 'Administration', order: 9, enabled: true, isCustom: false, visibleToRoles: PRIVILEGED_ROLES },
  // Narrower than PRIVILEGED_ROLES (excludes 'manager') — Meta credentials
  // and lead-routing rules are Admin/Super Admin only, same restriction
  // 'audit-log' already uses. See lib/metaConfig.ts.
  { key: 'meta-lead-integration', label: 'Meta Lead Integration', desc: 'Connect Facebook & Instagram Lead Ads to Lead Capture / Inquiry.', icon: 'share-2', href: '/admin/meta-integration', section: 'Administration', order: 10, enabled: true, isCustom: false, visibleToRoles: ['superadmin', 'admin'] },

  // TMS (Technical Management System) — Robotics/AI/AV/Marketing-only, see
  // lib/tmsAccess.ts. visibleToRoles covers the 4 TMS roles + privileged
  // roles (who bypass the department gate below); visibleToDepartments is
  // the department gate itself, checked by departmentAllowsModule().
  { key: 'tms-dashboard', label: 'TMS Dashboard', desc: 'Project, task, BOM, and procurement overview for the Technical Team.', icon: 'layout-dashboard', href: '/tms', section: 'TMS', order: 1, enabled: true, isCustom: false, visibleToRoles: TMS_ALL_ROLES, visibleToDepartments: TMS_DEPARTMENTS },
  { key: 'tms-projects', label: 'Projects', desc: 'Technical execution projects — team, budget, status, and progress.', icon: 'layers', href: '/tms/projects', section: 'TMS', order: 2, enabled: true, isCustom: false, visibleToRoles: TMS_ALL_ROLES, visibleToDepartments: TMS_DEPARTMENTS },
  { key: 'tms-tasks', label: 'Tasks', desc: 'Day-by-day task tracking with a Daily Task View.', icon: 'clipboard-list', href: '/tms/tasks', section: 'TMS', order: 3, enabled: true, isCustom: false, visibleToRoles: TMS_ALL_ROLES, visibleToDepartments: TMS_DEPARTMENTS },
  { key: 'tms-bom-requests', label: 'BOM Request', desc: 'Bill of materials requests, review, and approval.', icon: 'list', href: '/tms/bom-requests', section: 'TMS', order: 4, enabled: true, isCustom: false, visibleToRoles: TMS_ALL_ROLES, visibleToDepartments: TMS_DEPARTMENTS },
  { key: 'tms-procurement', label: 'Procurement', desc: 'Purchase and delivery tracking from approved BOM requests.', icon: 'shopping-cart', href: '/tms/procurement', section: 'TMS', order: 5, enabled: true, isCustom: false, visibleToRoles: TMS_ALL_ROLES.filter((r) => r !== 'technician'), visibleToDepartments: TMS_DEPARTMENTS },
  { key: 'tms-users', label: 'Users', desc: 'Manage technical team accounts, department, role, and project access.', icon: 'user', href: '/tms/users', section: 'TMS', order: 6, enabled: true, isCustom: false, visibleToRoles: TMS_MANAGER_ONLY_ROLES, visibleToDepartments: TMS_DEPARTMENTS },
  { key: 'tms-tab-access', label: 'Tab Access', desc: 'Configure which TMS roles can view, create, edit, delete, approve, or manage each TMS tab.', icon: 'shield', href: '/tms/tab-access', section: 'TMS', order: 7, enabled: true, isCustom: false, visibleToRoles: TMS_MANAGER_ONLY_ROLES, visibleToDepartments: TMS_DEPARTMENTS }
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
  'my-quotations': 'Existing Quotations',
  leads: 'Lead Capture / Inquiry'
};
const OLD_DEFAULT_LABELS: Record<string, string> = {
  quotation: 'Quotation',
  'my-quotations': 'My Quotations',
  leads: 'Lead Capture'
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

// TMS roles gained access to these 6 Sales-section modules (see
// SALES_ROLES_WITH_TMS above) — same don't-clobber-an-admin-edit guard: only
// overwrites a row still holding the exact old (pre-TMS-access) default.
const TMS_SALES_ACCESS_KEYS = new Set(['projects', 'quotation', 'site-visits', 'leads', 'demo-schedule', 'marketing-requests']);
const OLD_VISIBILITY_SALES: UserRole[] = ALL_ROLES;
const NEW_VISIBILITY_SALES: UserRole[] = SALES_ROLES_WITH_TMS;

// TMS tightened from "any privileged role" (including the generic 'manager'
// — Sales, HR, Accounts, ...) to Admin/Super Admin only, see
// TMS_OVERSIGHT_ROLES above. Same don't-clobber-an-admin-edit guard.
const OLD_TMS_ALL_ROLES: UserRole[] = [...PRIVILEGED_ROLES, 'technical-manager', 'team-lead', 'engineer', 'technician'];
const OLD_TMS_MANAGER_ONLY_ROLES: UserRole[] = [...PRIVILEGED_ROLES, 'technical-manager'];
const OLD_TMS_PROCUREMENT_ROLES: UserRole[] = OLD_TMS_ALL_ROLES.filter((r) => r !== 'technician');
const TMS_ALL_ROLES_KEYS = new Set(['tms-dashboard', 'tms-projects', 'tms-tasks', 'tms-bom-requests']);
const TMS_MANAGER_ONLY_KEYS = new Set(['tms-users', 'tms-tab-access']);

// Marketing role added (lib/roleStore.ts) — every module already visible to
// the plain ALL_ROLES set, or its TMS-extended SALES_ROLES_WITH_TMS
// derivative, should show to Marketing too, same as it already does to
// 'user'/Sales. Literal arrays here (not `= ALL_ROLES`) so this "old"
// snapshot can't silently drift if ALL_ROLES changes again later. Same
// don't-clobber-an-admin-edit guard as every reconciliation above.
const OLD_ALL_ROLES_NO_MARKETING: UserRole[] = ['superadmin', 'admin', 'manager', 'technical', 'backoffice', 'user'];
const MARKETING_ALL_ROLES_KEYS = new Set(['my-quotations', 'travel-schedule', 'analytics']);
const OLD_SALES_ROLES_NO_MARKETING: UserRole[] = [...OLD_ALL_ROLES_NO_MARKETING, ...TMS_ROLE_KEYS];

// 'technical' role retired, merged into 'engineer' — every module already
// visible to 'technical' should now show to 'engineer' instead. Literal
// snapshot of the pre-merge ALL_ROLES (not `= ALL_ROLES`) so this can't
// drift if ALL_ROLES changes again later. Same don't-clobber-an-admin-edit
// guard as every reconciliation above. Covers both the plain-ALL_ROLES keys
// (TECHNICAL_MERGE_KEYS) and the TMS-extended SALES_ROLES_WITH_TMS keys
// (TMS_SALES_ACCESS_KEYS below) — the latter still functionally worked for
// 'engineer' even before this reconciliation (it's already in TMS_ROLE_KEYS,
// separately spread into that array), but the stored row itself needs the
// swap too, or a later ALL_ROLES-only role addition (e.g. Accounts) can
// never reach it through the ALL_ROLES portion of that array.
const OLD_ALL_ROLES_WITH_TECHNICAL: UserRole[] = ['superadmin', 'admin', 'manager', 'technical', 'backoffice', 'user', 'marketing'];
const TECHNICAL_MERGE_KEYS = new Set(['my-quotations', 'travel-schedule', 'analytics']);
const OLD_SALES_ROLES_WITH_TECHNICAL: UserRole[] = [...OLD_ALL_ROLES_WITH_TECHNICAL, ...TMS_ROLE_KEYS];

// Accounts role added (lib/roleStore.ts) — same reasoning as Marketing
// above: every module already visible to the plain ALL_ROLES set, or its
// TMS-extended SALES_ROLES_WITH_TMS derivative, should show to Accounts too.
// Literal snapshot of the pre-Accounts ALL_ROLES (not `= ALL_ROLES`), same
// don't-clobber-an-admin-edit guard as every reconciliation above.
const OLD_ALL_ROLES_NO_ACCOUNTS: UserRole[] = ['superadmin', 'admin', 'manager', 'engineer', 'backoffice', 'user', 'marketing'];
const ACCOUNTS_ALL_ROLES_KEYS = new Set(['my-quotations', 'travel-schedule', 'analytics']);
const OLD_SALES_ROLES_NO_ACCOUNTS: UserRole[] = [...OLD_ALL_ROLES_NO_ACCOUNTS, ...TMS_ROLE_KEYS];

// HR role added (lib/roleStore.ts) — same reasoning as Marketing/Accounts
// above. Literal snapshot of the pre-HR ALL_ROLES (not `= ALL_ROLES`), same
// don't-clobber-an-admin-edit guard as every reconciliation above.
const OLD_ALL_ROLES_NO_HR: UserRole[] = ['superadmin', 'admin', 'manager', 'engineer', 'backoffice', 'user', 'marketing', 'accounts'];
const HR_ALL_ROLES_KEYS = new Set(['my-quotations', 'travel-schedule', 'analytics']);
const OLD_SALES_ROLES_NO_HR: UserRole[] = [...OLD_ALL_ROLES_NO_HR, ...TMS_ROLE_KEYS];

// Travel Schedule moved from Sales to the new HR section — same
// don't-clobber-an-admin-edit guard: only rewrites a row that still holds
// the old default 'Sales' section value.
const RESECTIONED_TO_HR_KEYS = new Set(['travel-schedule']);
const OLD_SECTION_FOR_HR = 'Sales';
const NEW_SECTION_FOR_HR = 'HR';

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
    visibleToRoles: (plain.visibleToRoles as UserRole[]) ?? [],
    visibleToDepartments: (plain.visibleToDepartments as string[]) ?? []
  };
}

// Department gate layered on top of visibleToRoles — used by both
// isModuleAccessAllowed (below) and lib/tmsPageGuard.ts's page-level guard,
// so "can't see it in the sidebar" and "can't reach its page/API" can never
// drift apart. A privileged viewer bypasses this entirely, mirroring the
// existing isModuleAccessAllowed precedent for isPrivileged.
export function departmentAllowsModule(config: ModuleConfigRecord, department: string | undefined | null, isPrivileged: boolean): boolean {
  if (isPrivileged) return true;
  if (!config.visibleToDepartments?.length) return true;
  return !!department && config.visibleToDepartments.includes(department);
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
    if (TMS_SALES_ACCESS_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_VISIBILITY_SALES)) attrs.visibleToRoles = NEW_VISIBILITY_SALES;
    if (TMS_ALL_ROLES_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_TMS_ALL_ROLES)) attrs.visibleToRoles = TMS_ALL_ROLES;
    if (key === 'tms-procurement' && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_TMS_PROCUREMENT_ROLES)) attrs.visibleToRoles = TMS_ALL_ROLES.filter((r) => r !== 'technician');
    if (TMS_MANAGER_ONLY_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_TMS_MANAGER_ONLY_ROLES)) attrs.visibleToRoles = TMS_MANAGER_ONLY_ROLES;
    if (MARKETING_ALL_ROLES_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_ALL_ROLES_NO_MARKETING)) attrs.visibleToRoles = ALL_ROLES;
    if (TMS_SALES_ACCESS_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_SALES_ROLES_NO_MARKETING)) attrs.visibleToRoles = SALES_ROLES_WITH_TMS;
    if (TECHNICAL_MERGE_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_ALL_ROLES_WITH_TECHNICAL)) attrs.visibleToRoles = ALL_ROLES;
    if (TMS_SALES_ACCESS_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_SALES_ROLES_WITH_TECHNICAL)) attrs.visibleToRoles = SALES_ROLES_WITH_TMS;
    if (ACCOUNTS_ALL_ROLES_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_ALL_ROLES_NO_ACCOUNTS)) attrs.visibleToRoles = ALL_ROLES;
    if (TMS_SALES_ACCESS_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_SALES_ROLES_NO_ACCOUNTS)) attrs.visibleToRoles = SALES_ROLES_WITH_TMS;
    if (HR_ALL_ROLES_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_ALL_ROLES_NO_HR)) attrs.visibleToRoles = ALL_ROLES;
    if (TMS_SALES_ACCESS_KEYS.has(key) && sameRoles((plain.visibleToRoles as UserRole[]) ?? [], OLD_SALES_ROLES_NO_HR)) attrs.visibleToRoles = SALES_ROLES_WITH_TMS;
    if (RESECTIONED_TO_HR_KEYS.has(key) && plain.section === OLD_SECTION_FOR_HR) { attrs.section = NEW_SECTION_FOR_HR; attrs.order = 1; }
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

// What Dashboard actually renders — enabled modules visible to this role AND
// (for the handful of department-gated modules, e.g. TMS) this department.
// `department` is optional so every pre-Section-TMS call site keeps
// compiling — it only matters for modules that actually set
// visibleToDepartments (departmentAllowsModule short-circuits true for every
// other module regardless).
export async function listVisibleModules(viewer: { role: UserRole; isPrivileged: boolean; department?: string | null }): Promise<ModuleConfigRecord[]> {
  const all = await listModuleConfigs();
  return all.filter((m) => m.enabled && m.visibleToRoles.includes(viewer.role) && departmentAllowsModule(m, viewer.department, viewer.isPrivileged));
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
export async function isModuleAccessAllowed(key: string, viewer: { role: UserRole; isPrivileged: boolean; department?: string | null }): Promise<boolean> {
  const all = await listModuleConfigs();
  const config = all.find((m) => m.key === key);
  if (!config || !config.enabled) return false;

  // TMS keys don't get the generic isPrivileged bypass — that flag is true
  // for every 'manager' account (Sales, HR, Accounts, ...), and TMS is meant
  // to stay Technical Team + Admin/Super Admin only. See TMS_OVERSIGHT_ROLES.
  const isPrivilegedHere = key.startsWith('tms') ? TMS_OVERSIGHT_ROLES.includes(viewer.role) : viewer.isPrivileged;

  if (!departmentAllowsModule(config, viewer.department, isPrivilegedHere)) return false;
  if (isPrivilegedHere) return true;
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
