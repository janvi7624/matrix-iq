'use strict';

// Adds 'team' as a third general_tasks.source_module value alongside the
// existing 'admin' (cross-department Assign Task, admin/superadmin-only) and
// 'hr' (HR's own department-scoped task tool) — backs the new Team Tasks
// feature (app/api/team-tasks/route.ts), which generalizes HR Tasks'
// "manager can only assign within their own department" pattern to every
// department's recognized manager, not just HR.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query('ALTER TYPE "enum_general_tasks_source_module" ADD VALUE IF NOT EXISTS \'team\';');
  },

  async down() {
    // Postgres can't drop individual enum values on rollback (harmless — same
    // precedent as 20260907130000-tms-task-workflow.js).
  }
};
