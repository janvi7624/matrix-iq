'use strict';

// Project Dashboard — no price/value field exists anywhere on Project today
// (money only lives on related Quotation/PurchaseOrder/Negotiation records).
// Nullable at the DB level so historical rows and auto-created-from-lead
// projects (whose price is deliberately left for the assignee to fill in —
// see lib/leadProjectAutomation.ts) don't need a backfilled value; the
// "mandatory" requirement is enforced at the API layer for normal manual
// project creation (app/api/projects/route.ts), not the schema.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'approx_price', { type: Sequelize.DECIMAL(14, 2), allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'approx_price');
  }
};
