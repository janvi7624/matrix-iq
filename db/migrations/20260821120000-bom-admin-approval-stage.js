'use strict';

/**
 * Inserts an Administration department approval step into the BOM Request
 * chain, between the existing Technical Manager and Finance stages:
 *   Engineer submits -> Technical Manager approves ('approved') ->
 *   Administration approves ('admin_approved') -> Finance Approver approves
 *   ('finance_approved') -> Accounts marks payment done -> requester marks
 *   material received.
 *
 * The approver is resolved from Department.managerIds for the real
 * "Administration" department (Department Master), same mechanism already
 * used for the Accounts stage — see lib/tmsAccess.ts's isAccountsManager
 * and its new isAdministrationManager counterpart.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('ALTER TYPE "enum_tms_bom_requests_status" ADD VALUE IF NOT EXISTS \'admin_approved\';');

    await queryInterface.addColumn('tms_bom_requests', 'admin_reviewed_by_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
    await queryInterface.addColumn('tms_bom_requests', 'admin_reviewed_at', { type: Sequelize.DATE });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tms_bom_requests', 'admin_reviewed_at');
    await queryInterface.removeColumn('tms_bom_requests', 'admin_reviewed_by_id');
    // Postgres can't drop individual enum values — 'admin_approved' stays in
    // the type on rollback (harmless: no code path writes it once this
    // migration is reverted).
  }
};
