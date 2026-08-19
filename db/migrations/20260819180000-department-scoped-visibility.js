'use strict';

/**
 * Decouples data-visibility scope from `isPrivileged`. Adds a new role
 * capability, `permissions.viewAllDepartments` (JSONB, no column change —
 * `roles.permissions` already exists), and backfills it on every existing
 * role row so nothing changes for anyone until this ships:
 *   - superadmin / admin: true (stay genuinely org-wide, as they are today).
 *   - manager: explicitly false — the one built-in role being deliberately
 *     narrowed to department-scoped visibility (Department.managerIds),
 *     while keeping isPrivileged: true (admin-panel access, quotation
 *     pricing/markup rights, delete rights all stay exactly as-is — see
 *     lib/departmentScope.ts, which reads viewAllDepartments and nothing
 *     else for this decision).
 *   - technical / backoffice / user: explicitly false — already own-only
 *     today via isPrivileged, unaffected either way.
 *   - any OTHER (custom, admin-created) role that currently has
 *     isPrivileged: true: true — preserves exactly what that role does
 *     today; nothing about a role this migration has no context on gets
 *     silently narrowed. A custom privileged role that should actually be
 *     department-scoped can be flipped off afterward in Role Management.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `UPDATE roles SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{viewAllDepartments}', 'true'::jsonb, true) WHERE key IN ('superadmin', 'admin')`
    );
    await queryInterface.sequelize.query(
      `UPDATE roles SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{viewAllDepartments}', 'false'::jsonb, true) WHERE key IN ('manager', 'technical', 'backoffice', 'user')`
    );
    await queryInterface.sequelize.query(
      `UPDATE roles SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{viewAllDepartments}', 'true'::jsonb, true) WHERE "isSystem" = false AND "isPrivileged" = true`
    );
    await queryInterface.sequelize.query(
      `UPDATE roles SET permissions = jsonb_set(COALESCE(permissions, '{}'::jsonb), '{viewAllDepartments}', 'false'::jsonb, true) WHERE "isSystem" = false AND "isPrivileged" = false`
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`UPDATE roles SET permissions = permissions - 'viewAllDepartments'`);
  }
};
