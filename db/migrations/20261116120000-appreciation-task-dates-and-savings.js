'use strict';

// Employee Appreciation's nomination form is redesigned: Category,
// Achievement date and Recommended reward are no longer asked for — in
// their place, Task given date / Task deadline date / Task completion date
// (all mandatory), plus an optional Savings breakdown. "What did they do?"
// stays as-is.
//
// category and achievement_date are relaxed to nullable rather than
// dropped — existing rows (and reward_type/reward_amount, which the form no
// longer offers but which approved rows may still carry) keep reading
// exactly as before; nothing here is destructive. Idempotent via
// describeTable, matching 20261022110000-materials-upload-support.js.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('employee_appreciations');

    if (table.category && table.category.allowNull === false) {
      await queryInterface.changeColumn('employee_appreciations', 'category', {
        type: Sequelize.STRING(60),
        allowNull: true
      });
    }
    if (table.achievement_date && table.achievement_date.allowNull === false) {
      await queryInterface.changeColumn('employee_appreciations', 'achievement_date', {
        type: Sequelize.DATEONLY,
        allowNull: true
      });
    }

    if (!table.task_given_date) {
      await queryInterface.addColumn('employee_appreciations', 'task_given_date', {
        type: Sequelize.DATEONLY,
        allowNull: true
      });
    }
    if (!table.task_deadline_date) {
      await queryInterface.addColumn('employee_appreciations', 'task_deadline_date', {
        type: Sequelize.DATEONLY,
        allowNull: true
      });
    }
    if (!table.task_completion_date) {
      await queryInterface.addColumn('employee_appreciations', 'task_completion_date', {
        type: Sequelize.DATEONLY,
        allowNull: true
      });
    }
    // {costSavingsPerMonth, timeSavingsValue, timeSavingsUnit, energySavings,
    // teamCostSavings, miscellaneous} — every field optional, see
    // lib/appreciationStore.ts's SavingsInput.
    if (!table.savings) {
      await queryInterface.addColumn('employee_appreciations', 'savings', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {}
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('employee_appreciations');
    if (table.savings) await queryInterface.removeColumn('employee_appreciations', 'savings');
    if (table.task_completion_date) await queryInterface.removeColumn('employee_appreciations', 'task_completion_date');
    if (table.task_deadline_date) await queryInterface.removeColumn('employee_appreciations', 'task_deadline_date');
    if (table.task_given_date) await queryInterface.removeColumn('employee_appreciations', 'task_given_date');
  }
};
