'use strict';

// Admin Expenses (Reimbursement rows with is_admin_entry:true) had NO
// payment tracking at all — created directly with mode_of_payment:'Company
// Paid' and treated as already disbursed the moment they're entered, with
// zero Accounts confirmation step. These columns are only ever populated for
// is_admin_entry rows; a normal employee reimbursement row's payment state
// lives on ReimbursementSheet instead and never touches these.
//
// Backfill sets every EXISTING admin-entry row to 'paid' — that matches
// today's real semantics (already spent, nothing left to confirm) — so this
// migration doesn't flood the new Accounts Payment Queue with historical
// entries. Only admin-entry rows created AFTER this migration (see
// app/api/admin-expenses/route.ts) start life as 'payment_required'.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('reimbursements', 'payment_status', { type: Sequelize.STRING(20), allowNull: true });
    await queryInterface.addColumn('reimbursements', 'paid_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('reimbursements', 'paid_by', {
      type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('reimbursements', 'payment_method', { type: Sequelize.STRING(30), allowNull: true });
    await queryInterface.addColumn('reimbursements', 'payment_reference', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('reimbursements', 'payment_proof_urls', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });

    await queryInterface.sequelize.query(
      `UPDATE reimbursements SET payment_status = 'paid' WHERE is_admin_entry = true`
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('reimbursements', 'payment_proof_urls');
    await queryInterface.removeColumn('reimbursements', 'payment_reference');
    await queryInterface.removeColumn('reimbursements', 'payment_method');
    await queryInterface.removeColumn('reimbursements', 'paid_by');
    await queryInterface.removeColumn('reimbursements', 'paid_at');
    await queryInterface.removeColumn('reimbursements', 'payment_status');
  }
};
