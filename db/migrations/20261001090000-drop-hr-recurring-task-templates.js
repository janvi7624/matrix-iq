'use strict';

// Removes the Recurring Task Templates feature entirely — it was decided
// not to be needed. Task Categories (hr_task_categories) is a separate,
// still-used feature and is untouched.
//
// general_tasks.recurrence_template_id / recurrence_period_key only ever
// existed to link an auto-generated task back to the template that spawned
// it (see the now-deleted lib/hrRecurringTaskStore.ts) — dropping them does
// not touch the task rows themselves, which stay exactly as they are, just
// as ordinary one-off tasks with no recurrence metadata.
//
// Order matters: the unique index and the FK-carrying column on
// general_tasks must go before the table they reference, or Postgres
// refuses to drop a table something still points at.
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeIndex('general_tasks', 'general_tasks_recurrence_instance_unique');
    await queryInterface.removeColumn('general_tasks', 'recurrence_template_id');
    await queryInterface.removeColumn('general_tasks', 'recurrence_period_key');
    await queryInterface.dropTable('hr_recurring_task_templates');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_hr_recurring_task_templates_priority";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_hr_recurring_task_templates_recurrence_type";');
  },

  // Best-effort structural reversal only — a rolled-back `down` gets back
  // the columns/table/constraint, not the templates or the task-to-template
  // links that existed before `up` ran; that data is gone once `up` commits.
  async down(queryInterface, Sequelize) {
    await queryInterface.createTable('hr_recurring_task_templates', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      title: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT },
      department_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      assignee_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      category_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'hr_task_categories', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      priority: { type: Sequelize.ENUM('low', 'medium', 'high', 'critical'), allowNull: false, defaultValue: 'medium' },
      requires_review: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      recurrence_type: { type: Sequelize.ENUM('daily', 'weekly', 'monthly'), allowNull: false },
      recurrence_config: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('hr_recurring_task_templates', ['active'], { name: 'hr_recurring_task_templates_active_idx' });
    await queryInterface.addColumn('general_tasks', 'recurrence_template_id', {
      type: Sequelize.UUID, allowNull: true, references: { model: 'hr_recurring_task_templates', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('general_tasks', 'recurrence_period_key', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addIndex('general_tasks', ['recurrence_template_id', 'recurrence_period_key'], {
      unique: true,
      name: 'general_tasks_recurrence_instance_unique',
      where: { recurrence_template_id: { [Sequelize.Op.ne]: null } }
    });
  }
};
