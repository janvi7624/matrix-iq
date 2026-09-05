// Plain constants only — NO server-only imports (db/auth/viewerContext) here.
// lib/tmsAccess.ts pulls in Sequelize transitively (via lib/db.ts), so any
// 'use client' component that needs just these values must import from THIS
// file instead, or Next tries to bundle pg/sequelize for the browser and the
// build fails ("Module not found: Can't resolve 'fs'/'net'/'tls'").
export const TMS_DEPARTMENTS = ['AI', 'AV', 'Marketing', 'Robotics'] as const;
export const TMS_ROLE_KEYS = ['technical-manager', 'team-lead', 'engineer', 'technician'] as const;
export const TMS_MODULE_KEYS = ['tms-dashboard', 'tms-projects', 'tms-tasks', 'tms-bom-requests', 'tms-procurement', 'tms-users', 'tms-tab-access'] as const;
export type TmsModuleKey = (typeof TMS_MODULE_KEYS)[number];

// Client-safe mirror of lib/tmsAccess.ts's isTmsManagerTier + isPrivileged —
// UI-visibility only (e.g. showing the "Extend Deadline" button); every
// action this gates is re-checked server-side (canExtendTmsDeadline etc.),
// so this set being wrong/stale would only ever hide or show a button, never
// grant real access. Shared here instead of re-declared per component (was
// previously duplicated ad hoc as TmsDashboardView.tsx's MANAGER_TIER_ROLES).
export const TMS_MANAGER_TIER_ROLES = new Set(['technical-manager', 'team-lead', 'admin', 'superadmin']);
