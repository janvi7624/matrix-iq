'use strict';

// Adds an optional remarks column to every sales-pipeline stage that had no
// remark support at all (Site Visit registration, Site Visit updates,
// Negotiation, Purchase Order, Installation) — sales managers report
// remarks are hard to find/missing across the pipeline. Every column is
// nullable text; existing rows are unaffected.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('site_visits', 'remarks', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('site_visit_updates', 'remarks', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('negotiations', 'remarks', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('purchase_orders', 'remarks', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('installations', 'remarks', { type: Sequelize.TEXT, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('installations', 'remarks');
    await queryInterface.removeColumn('purchase_orders', 'remarks');
    await queryInterface.removeColumn('negotiations', 'remarks');
    await queryInterface.removeColumn('site_visit_updates', 'remarks');
    await queryInterface.removeColumn('site_visits', 'remarks');
  }
};
