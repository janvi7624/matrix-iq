'use strict';

/**
 * Supports manual (no linked demo request) Delivery Challans and a
 * Back-Office-only price per line item:
 *   1. delivery_challans.demo_id -> allowNull: true (was NOT NULL — every DC
 *      used to require a demo request; a manual DC has none).
 *   2. delivery_challans.client_address / client_phone — nullable. A
 *      demo-linked DC can derive these from the linked Project; a manual DC
 *      has no Project/Demo to derive them from, so they need to exist as
 *      real columns.
 *   3. delivery_challans.issued_by_phone — nullable. Resolved from the
 *      issuing employee's own User.phone once, at DC-creation time, and
 *      stored on the record — same reasoning as client_phone: the PDF is
 *      generated client-side from the already-fetched DC record, and a
 *      live phone lookup would need a new broadly-accessible endpoint
 *      exposing every employee's phone number to any logged-in user.
 *   4. delivery_challan_items.price — nullable DECIMAL, default 0.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('delivery_challans', 'demo_id', {
      type: Sequelize.UUID,
      allowNull: true
    });

    await queryInterface.addColumn('delivery_challans', 'client_address', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('delivery_challans', 'client_phone', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('delivery_challans', 'issued_by_phone', {
      type: Sequelize.STRING,
      allowNull: true
    });

    await queryInterface.addColumn('delivery_challan_items', 'price', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
      defaultValue: 0
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('delivery_challan_items', 'price');
    await queryInterface.removeColumn('delivery_challans', 'issued_by_phone');
    await queryInterface.removeColumn('delivery_challans', 'client_phone');
    await queryInterface.removeColumn('delivery_challans', 'client_address');
    await queryInterface.changeColumn('delivery_challans', 'demo_id', {
      type: Sequelize.UUID,
      allowNull: false
    });
  }
};
