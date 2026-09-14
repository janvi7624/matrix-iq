'use strict';

// Office Operation Expenses had no status column at all — a pure
// already-incurred expense register with zero Accounts involvement. Same
// backfill reasoning as the Admin Expenses payment-fields migration: every
// EXISTING row becomes 'paid' (today's real semantics), only rows created
// after this migration start as 'payment_required'.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('office_operation_expenses', 'payment_status', { type: Sequelize.STRING(20), allowNull: true });
    await queryInterface.addColumn('office_operation_expenses', 'paid_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('office_operation_expenses', 'paid_by', {
      type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('office_operation_expenses', 'payment_method', { type: Sequelize.STRING(30), allowNull: true });
    await queryInterface.addColumn('office_operation_expenses', 'payment_reference', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('office_operation_expenses', 'payment_proof_urls', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });

    await queryInterface.sequelize.query(`UPDATE office_operation_expenses SET payment_status = 'paid'`);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('office_operation_expenses', 'payment_proof_urls');
    await queryInterface.removeColumn('office_operation_expenses', 'payment_reference');
    await queryInterface.removeColumn('office_operation_expenses', 'payment_method');
    await queryInterface.removeColumn('office_operation_expenses', 'paid_by');
    await queryInterface.removeColumn('office_operation_expenses', 'paid_at');
    await queryInterface.removeColumn('office_operation_expenses', 'payment_status');
  }
};
