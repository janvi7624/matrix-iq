'use strict';

/**
 * Records what a demo actually cost, captured when the Delivery Challan for it
 * is closed.
 *
 * WHY A COLUMN AND NOT AN EXISTING TABLE
 * The obvious instinct is to reuse an expense table, and there are two:
 * `reimbursements` and `office_operation_expenses`. Neither works — neither has
 * a project_id or a demo_id, so nothing in this app currently records "a cost
 * incurred against a project or a demo". Putting a demo's cost in either would
 * mean inventing that link as well, for one number asked about at one moment in
 * one workflow. The DC is already the record of the materials going out and
 * coming back, so the cost of that trip belongs on it.
 *
 * The shape copies `travel_schedules.actual_cost`
 * (db/migrations/20260822120000-travel-schedule-workflow.js:66) almost exactly:
 * a nullable DECIMAL captured at a workflow completion step. Nullable is
 * load-bearing — NULL means "nobody was asked" or "nothing was spent", and 0.00
 * would claim the question had been answered with zero for all 100-odd existing
 * challans.
 *
 * Idempotent via describeTable, matching
 * db/migrations/20261016120000-sales-pipeline-fields.js.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('delivery_challans');
    if (table.demo_cost_amount) return;

    await queryInterface.addColumn('delivery_challans', 'demo_cost_amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('delivery_challans');
    if (table.demo_cost_amount) await queryInterface.removeColumn('delivery_challans', 'demo_cost_amount');
  }
};
