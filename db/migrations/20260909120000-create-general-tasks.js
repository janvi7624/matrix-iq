'use strict';

// The shared, department-agnostic task engine used by BOTH the Admin
// "assign task to Department -> Employee" flow and the new HR operational
// module — deliberately NOT tms_tasks (that model is bound to tms_projects,
// itself scoped to the 4 TMS-only departments). `source_module` tells the
// two callers apart for UI/permission purposes while they share one
// workflow, table, and audit trail.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('general_tasks', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      source_module: { type: Sequelize.ENUM('admin', 'hr'), allowNull: false },
      title: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT },
      department_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      assignee_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // Who decides Approved/Rework/Rejected when requires_review is true —
      // defaults to the creator if not explicitly set (see generalTaskStore.ts).
      reviewer_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      priority: { type: Sequelize.ENUM('low', 'medium', 'high', 'critical'), allowNull: false, defaultValue: 'medium' },
      status: {
        type: Sequelize.ENUM('pending', 'in_progress', 'under_review', 'rework_required', 'approved', 'rejected', 'cancelled', 'completed'),
        allowNull: false,
        defaultValue: 'pending'
      },
      // false = a plain submission finalizes the task straight to 'completed'
      // with no separate reviewer step (see lib/generalTaskStore.ts).
      requires_review: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      category: { type: Sequelize.STRING, allowNull: true },
      project_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'projects', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      start_date: { type: Sequelize.DATEONLY },
      deadline: { type: Sequelize.DATEONLY, allowNull: false },
      remarks: { type: Sequelize.TEXT },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      // Lazy recurrence instantiation (no scheduler in this app). Both null
      // for a one-off task.
      recurrence_template_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'hr_recurring_task_templates', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      recurrence_period_key: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    await queryInterface.addIndex('general_tasks', ['assignee_id', 'status'], { name: 'general_tasks_assignee_status_idx' });
    await queryInterface.addIndex('general_tasks', ['department_id', 'status'], { name: 'general_tasks_dept_status_idx' });
    await queryInterface.addIndex('general_tasks', ['deadline'], { name: 'general_tasks_deadline_idx' });
    await queryInterface.addIndex('general_tasks', ['department_id', 'assignee_id', 'status', 'deadline'], { name: 'general_tasks_dept_assignee_status_deadline_idx' });
    await queryInterface.addIndex('general_tasks', ['recurrence_template_id', 'recurrence_period_key'], {
      unique: true,
      name: 'general_tasks_recurrence_instance_unique',
      where: { recurrence_template_id: { [Sequelize.Op.ne]: null } }
    });

    await queryInterface.createTable('general_task_updates', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      task_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'general_tasks', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      status_at_update: { type: Sequelize.STRING(30), allowNull: false },
      work_summary: { type: Sequelize.TEXT },
      remarks: { type: Sequelize.TEXT },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('general_task_updates', ['task_id'], { name: 'general_task_updates_task_idx' });

    await queryInterface.createTable('general_task_deadline_changes', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      task_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'general_tasks', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      previous_deadline: { type: Sequelize.DATEONLY, allowNull: false },
      new_deadline: { type: Sequelize.DATEONLY, allowNull: false },
      remark: { type: Sequelize.TEXT, allowNull: false },
      changed_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('general_task_deadline_changes', ['task_id'], { name: 'general_task_deadline_changes_task_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('general_task_deadline_changes');
    await queryInterface.dropTable('general_task_updates');
    await queryInterface.dropTable('general_tasks');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_general_tasks_source_module";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_general_tasks_priority";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_general_tasks_status";');
  }
};
