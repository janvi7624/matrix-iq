'use strict';

/**
 * Extends BOM Request approval into the full chain requested:
 *   Engineer submits -> Technical Manager approves (existing 'approved') ->
 *   Finance Approver approves ('finance_approved') -> Accounts marks
 *   payment done with a proof attachment ('payment_done') -> the requester
 *   marks material received ('received').
 *
 * The Finance Approver is a single configurable person (app_config, same
 * pattern as the existing marketingOwnerId) rather than a hardcoded
 * username — settable in Application Settings, so who holds that step
 * never requires a code change. The Accounts stage instead reuses the
 * existing Department.managerIds / listDepartmentManagers() mechanism
 * (same as demo-schedule's manager-approval and marketing-requests) against
 * the real "Accounts" department already seeded in Department Master.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('ALTER TYPE "enum_tms_bom_requests_status" ADD VALUE IF NOT EXISTS \'finance_approved\';');
    await queryInterface.sequelize.query('ALTER TYPE "enum_tms_bom_requests_status" ADD VALUE IF NOT EXISTS \'payment_done\';');
    await queryInterface.sequelize.query('ALTER TYPE "enum_tms_bom_requests_status" ADD VALUE IF NOT EXISTS \'received\';');

    const userFk = () => ({ type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL', onUpdate: 'CASCADE' });

    await queryInterface.addColumn('tms_bom_requests', 'finance_reviewed_by_id', userFk());
    await queryInterface.addColumn('tms_bom_requests', 'finance_reviewed_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('tms_bom_requests', 'payment_marked_by_id', userFk());
    await queryInterface.addColumn('tms_bom_requests', 'payment_marked_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('tms_bom_requests', 'payment_proof_attachments', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await queryInterface.addColumn('tms_bom_requests', 'received_by_id', userFk());
    await queryInterface.addColumn('tms_bom_requests', 'received_at', { type: Sequelize.DATE });

    await queryInterface.addColumn('app_config', 'bomFinanceApproverId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('app_config', 'bomFinanceApproverId');
    await queryInterface.removeColumn('tms_bom_requests', 'received_at');
    await queryInterface.removeColumn('tms_bom_requests', 'received_by_id');
    await queryInterface.removeColumn('tms_bom_requests', 'payment_proof_attachments');
    await queryInterface.removeColumn('tms_bom_requests', 'payment_marked_at');
    await queryInterface.removeColumn('tms_bom_requests', 'payment_marked_by_id');
    await queryInterface.removeColumn('tms_bom_requests', 'finance_reviewed_at');
    await queryInterface.removeColumn('tms_bom_requests', 'finance_reviewed_by_id');
    // Postgres can't drop individual enum values — the added statuses stay
    // in the type on rollback (harmless: no code path writes them once this
    // migration is reverted).
  }
};
