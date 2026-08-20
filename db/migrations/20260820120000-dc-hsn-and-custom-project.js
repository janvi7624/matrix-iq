'use strict';

/**
 * Two small additive fields for Delivery Challans:
 *   1. delivery_challan_items.hsn_code — optional, skippable HSN code per
 *      line item, shown on the generated PDF alongside the description.
 *   2. delivery_challans.custom_project_name — a free-text project label
 *      Back Office can type when creating a manual DC that has no real
 *      linked Project record (project_id stays empty in that case; this is
 *      purely a display field, not a second FK).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('delivery_challan_items', 'hsn_code', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('delivery_challans', 'custom_project_name', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('delivery_challans', 'custom_project_name');
    await queryInterface.removeColumn('delivery_challan_items', 'hsn_code');
  }
};
