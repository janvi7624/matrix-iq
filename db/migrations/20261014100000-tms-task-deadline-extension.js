'use strict';

// "Task -> Extend Deadline" for TMS tasks, mirroring the project-level
// workflow in 20260907110000-tms-project-deadline-extension.js plus the
// approval chain added by 20260909180000-deadline-extension-approval.js —
// created complete here rather than in two steps.
//
// Why a task needs the same controls the project already has: a task's
// due_date is scored directly. lib/departmentScoring.ts pools every TMS task
// assigned to someone and counts it on-time, late, or overdue-and-open against
// that date, and the result is the department's health gauge. So moving a due
// date moves somebody's score — a task that was late becomes on time. That
// makes this an approval-and-audit action, not a field edit: every extension
// is an immutable history row recording who asked, who approved, what the date
// was before, and why.
//
// No new column on tms_tasks: due_date already exists and stays the single
// source of truth. It is updated only when an extension reaches 'approved'.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tms_task_deadline_extensions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      task_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'tms_tasks', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      // Nullable because a task may have had no due date at all — setting one
      // for the first time still deserves the same record.
      previous_deadline: { type: Sequelize.DATEONLY, allowNull: true },
      new_deadline: { type: Sequelize.DATEONLY, allowNull: false },
      reason: { type: Sequelize.ENUM('user_end', 'client_end'), allowNull: false, defaultValue: 'user_end' },
      remark: { type: Sequelize.TEXT, allowNull: false },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      // The requester. Named to match tms_project_deadline_extensions.
      extended_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      status: {
        type: Sequelize.ENUM('pending_manager', 'pending_admin', 'approved', 'rejected'),
        allowNull: false,
        defaultValue: 'approved'
      },
      approved_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      approved_at: { type: Sequelize.DATE, allowNull: true },
      decision_remark: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.addIndex('tms_task_deadline_extensions', ['task_id'], {
      name: 'tms_task_deadline_extensions_task_idx'
    });
    // The approvals queue reads "everything still pending", across all tasks.
    await queryInterface.addIndex('tms_task_deadline_extensions', ['status'], {
      name: 'tms_task_deadline_extensions_status_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tms_task_deadline_extensions');
    // Dropping the table leaves its two enum types behind in Postgres, which
    // then collide with this migration's own CREATE TYPE if it is re-run.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tms_task_deadline_extensions_reason";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tms_task_deadline_extensions_status";');
  }
};
