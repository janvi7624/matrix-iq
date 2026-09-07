'use strict';

// Admin-configurable HR task category list (HR Settings) — real rows rather
// than a hardcoded array (like lib/officeOperationExpenseOptions.ts's
// OFFICE_EXPENSE_ITEMS) because this one needs to be editable without a
// code change.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('hr_task_categories', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false, unique: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      order: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    const seed = [
      'Recruitment', 'Employee Documentation', 'Onboarding', 'Attendance', 'Leave Management',
      'Payroll Coordination', 'Employee Engagement', 'Compliance', 'Policy', 'Performance', 'Training', 'General HR', 'Other'
    ];
    await queryInterface.bulkInsert(
      'hr_task_categories',
      seed.map((name, i) => ({ id: Sequelize.literal('gen_random_uuid()'), name, active: true, order: i, created_at: new Date(), updated_at: new Date() }))
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hr_task_categories');
  }
};
