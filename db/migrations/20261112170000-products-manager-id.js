'use strict';

// Separate from products.createdBy (an audit fact — who actually clicked
// Add Product, never changes) — managerId is the reassignable Product
// Manager assignment surfaced by the Product Master screen's "Assign
// Manager" action. Nullable: a product with no managerId falls back to its
// creator (see lib/productManagerStore.ts), which is exactly every product
// that existed before this column did.
module.exports = {
  async up(queryInterface, Sequelize) {
    const cols = await queryInterface.describeTable('products');
    if (!cols.managerId) {
      await queryInterface.addColumn('products', 'managerId', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    }
  },

  async down(queryInterface) {
    const cols = await queryInterface.describeTable('products');
    if (cols.managerId) {
      await queryInterface.removeColumn('products', 'managerId');
    }
  }
};
