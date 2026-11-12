'use strict';

// db/models/marketingRequest.js declares product_categories (JSONB, multi-
// category support added alongside the existing single product_category
// string) but no migration ever added the column — every query selecting
// the model's full attribute list (e.g. the sidebar's "my marketing
// requests" count) failed with "column MarketingRequest.product_categories
// does not exist", which also broke the Leads/Projects/TMS pages since they
// all load via the same sidebar endpoint.

module.exports = {
  async up(queryInterface, Sequelize) {
    const tableDesc = await queryInterface.describeTable('marketing_requests');
    if (!tableDesc.product_categories) {
      await queryInterface.addColumn('marketing_requests', 'product_categories', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      });
    }
  },

  async down(queryInterface) {
    const tableDesc = await queryInterface.describeTable('marketing_requests');
    if (tableDesc.product_categories) {
      await queryInterface.removeColumn('marketing_requests', 'product_categories');
    }
  }
};
