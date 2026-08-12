'use strict';

/**
 * Two additive columns plus two additive enum values, all backing the
 * Marketing ticket system upgrade (Marketing Owner + assignment):
 *   1. app_config.marketingOwnerId — the default person new marketing
 *      tickets route to. Distinct from the existing role-level "approve"
 *      capability on the marketing-requests module, which governs who CAN
 *      review tickets, not who they land on by default.
 *   2. marketing_requests.assigned_to_id — who is actively working a given
 *      ticket. Kept as its own column rather than folded into `status`,
 *      since a ticket can be in_progress AND assigned — independent facts.
 *   3/4. Two additional work-in-progress statuses (waiting_info,
 *      ready_for_review), added the same additive way audit_logs.entity_type
 *      was widened in 20260806120000 — existing rows/values are untouched.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('app_config', 'marketingOwnerId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    await queryInterface.addColumn('marketing_requests', 'assigned_to_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    await queryInterface.sequelize.query('ALTER TYPE "enum_marketing_requests_status" ADD VALUE IF NOT EXISTS \'waiting_info\';');
    await queryInterface.sequelize.query('ALTER TYPE "enum_marketing_requests_status" ADD VALUE IF NOT EXISTS \'ready_for_review\';');
  },

  async down(queryInterface) {
    // Postgres cannot drop a single enum value without rebuilding the type
    // (and any row already using it) — down only removes the columns.
    await queryInterface.removeColumn('marketing_requests', 'assigned_to_id');
    await queryInterface.removeColumn('app_config', 'marketingOwnerId');
  }
};
