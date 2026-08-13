'use strict';

/**
 * Persistent, Manager+ editable rename/reprice layer over the hardcoded
 * lib/data/*.ts product catalogs (AV, Robotics, AI Analytics, VisitIQ).
 * One row per (catalog, productKey) pair; `fields` is a partial JSON patch
 * merged onto the hardcoded base record at render time — deleting the row
 * reverts that product to its hardcoded default.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('product_catalog_overrides', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      },
      catalog: { type: Sequelize.STRING, allowNull: false },
      productKey: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: true },
      fields: { type: Sequelize.JSONB, allowNull: true },
      updatedBy: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false }
    });

    await queryInterface.addIndex('product_catalog_overrides', ['catalog', 'productKey'], {
      unique: true,
      name: 'product_catalog_overrides_catalog_product_key_uq'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_catalog_overrides');
  }
};
