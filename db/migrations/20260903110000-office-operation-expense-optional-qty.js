'use strict';

// Item Qty is no longer mandatory. Dropping NOT NULL *and* the DEFAULT 1 so a
// blank field records "no quantity given" (NULL) rather than silently claiming
// a quantity of 1 — for lines like an electricity bill or an internet invoice
// there is no meaningful count, and a fabricated "1" would read as real data
// in the register and the Excel export.
//
// Existing rows keep whatever quantity they already hold; widening a column to
// nullable never rewrites stored values.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('office_operation_expenses', 'item_qty', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null
    });
  },

  // Re-tightening has to put a value back in every NULL row first, or the
  // NOT NULL constraint can't be applied. 1 is the old column default, so this
  // restores exactly the pre-migration shape.
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('UPDATE office_operation_expenses SET item_qty = 1 WHERE item_qty IS NULL');
    await queryInterface.changeColumn('office_operation_expenses', 'item_qty', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 1
    });
  }
};
