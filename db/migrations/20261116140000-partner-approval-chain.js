'use strict';

// Partner onboarding now goes through three sign-offs — Sales manager, then
// Accounts manager, then Admin manager — before the portal opens (see
// lib/partnerApprovalChain.ts). Adds where the partner is in that chain and
// the history of decisions.
//
// Partners already onboarded are marked 'approved' so nothing about their
// access changes. Idempotent via describeTable.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('partners');
    if (!table.approval_stage) {
      await queryInterface.addColumn('partners', 'approval_stage', { type: Sequelize.STRING(16), allowNull: true });
    }
    if (!table.approval_trail) {
      await queryInterface.addColumn('partners', 'approval_trail', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    }
    await queryInterface.sequelize.query(
      `UPDATE partners SET approval_stage = 'approved' WHERE onboarded_at IS NOT NULL AND approval_stage IS NULL`
    );
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('partners');
    if (table.approval_trail) await queryInterface.removeColumn('partners', 'approval_trail');
    if (table.approval_stage) await queryInterface.removeColumn('partners', 'approval_stage');
  }
};
