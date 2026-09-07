'use strict';

// Recurring HR task DEFINITIONS. Instances are real general_tasks rows,
// lazily created the first time a relevant page loads on/after the
// instance's due period (see lib/hrRecurringTaskStore.ts) — there is no
// scheduler/cron anywhere in this app, so nothing auto-fires overnight.
module.exports = {
  async up(queryInterface, Sequelize) {
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
      // weekly: { "weekday": 1-7 (Mon-Sun) }. monthly: { "dayOfMonth": 1-28 }. daily: {}.
      recurrence_config: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('hr_recurring_task_templates', ['active'], { name: 'hr_recurring_task_templates_active_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hr_recurring_task_templates');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_hr_recurring_task_templates_priority";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_hr_recurring_task_templates_recurrence_type";');
  }
};
