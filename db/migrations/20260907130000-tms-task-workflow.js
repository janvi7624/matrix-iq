'use strict';

// Engineer task workflow: two new statuses (blocked / ready_for_review) so
// the pipeline reads Pending(to_do) -> In Progress -> Blocked <-> In Progress
// -> Ready for Review -> Completed, plus a per-task progress figure and an
// immutable update/progress history (tms_task_updates) — today a task only
// has status/audit-log lines, no progress %, no "what changed and why" trail
// separate from the manager-only PATCH audit line.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('ALTER TYPE "enum_tms_tasks_status" ADD VALUE IF NOT EXISTS \'blocked\';');
    await queryInterface.sequelize.query('ALTER TYPE "enum_tms_tasks_status" ADD VALUE IF NOT EXISTS \'ready_for_review\';');

    await queryInterface.addColumn('tms_tasks', 'progress_percent', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });

    await queryInterface.createTable('tms_task_updates', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      task_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'tms_tasks', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      progress_percent: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status_at_update: { type: Sequelize.STRING(30), allowNull: false },
      remark: { type: Sequelize.TEXT, allowNull: true },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('tms_task_updates', ['task_id'], { name: 'tms_task_updates_task_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tms_task_updates');
    await queryInterface.removeColumn('tms_tasks', 'progress_percent');
    // Postgres can't drop individual enum values on rollback (harmless — see
    // the identical precedent in 20260821100000-bom-multistage-approval.js).
  }
};
