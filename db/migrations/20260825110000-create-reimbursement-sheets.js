'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('reimbursement_sheets', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      created_by: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      sheet_code: { type: Sequelize.STRING(30) },
      month: { type: Sequelize.INTEGER, allowNull: false },
      year: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'draft' },
      manager_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      manager_action_at: { type: Sequelize.DATE },
      manager_remarks: { type: Sequelize.TEXT },
      hr_reviewer_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      hr_reviewed_at: { type: Sequelize.DATE },
      hr_remarks: { type: Sequelize.TEXT },
      accounts_handler_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      accounts_completed_at: { type: Sequelize.DATE },
      accounts_remarks: { type: Sequelize.TEXT },
      payment_reference: { type: Sequelize.STRING },
      change_request_remarks: { type: Sequelize.TEXT },
      change_requested_by: { type: Sequelize.STRING },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.addIndex('reimbursement_sheets', ['created_by', 'year', 'month'], { unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('reimbursement_sheets');
  }
};
