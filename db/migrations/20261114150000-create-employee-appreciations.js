'use strict';

// Employee Appreciation (HR module). A manager / department head / admin
// nominates an employee; the HR Manager approves or rejects. Approved rows are
// shown on the company dashboard and on the employee's own profile.
//
// Names and departments are copied onto the row at submission time so the
// record still reads correctly if the person later moves department or leaves.
// Only lib/appreciationStore.ts reads or writes this table.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('employee_appreciations', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      employee_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      employee_name: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      employee_department: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      employee_designation: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      nominated_by: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      nominated_by_name: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      category: { type: Sequelize.STRING(60), allowNull: false },
      achievement_date: { type: Sequelize.DATEONLY, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      attachment_url: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      reward_type: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'none' },
      reward_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      hr_reviewer_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      hr_reviewer_name: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      hr_remarks: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      decided_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('employee_appreciations', ['status', 'decided_at']);
    await queryInterface.addIndex('employee_appreciations', ['employee_id']);
    await queryInterface.addIndex('employee_appreciations', ['nominated_by']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('employee_appreciations');
  }
};
