'use strict';

// 1. Adds Product.type (standard/custom/project_based) — fixed per product,
//    see db/models/product.js.
// 2. Creates product_manager_notes — a Product Manager's own running
//    timeline of feedback received / action taken / next plan, scoped to
//    the person (every product they created), not to one product. Mirrors
//    feedback_responses' shape: SET NULL on the user FK so a note survives
//    the account it was written about/by.
module.exports = {
  async up(queryInterface, Sequelize) {
    const productCols = await queryInterface.describeTable('products');
    if (!productCols.type) {
      await queryInterface.addColumn('products', 'type', {
        type: Sequelize.ENUM('standard', 'custom', 'project_based'),
        allowNull: false,
        defaultValue: 'standard'
      });
    }

    await queryInterface.createTable('product_manager_notes', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      // Whose timeline this note belongs to — the Product Manager (every
      // product they created), not one specific product.
      product_manager_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      type: { type: Sequelize.ENUM('feedback', 'action', 'plan'), allowNull: false },
      text: { type: Sequelize.TEXT, allowNull: false },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.addIndex('product_manager_notes', ['product_manager_id', 'created_at'], {
      name: 'product_manager_notes_pm_created_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('product_manager_notes', 'product_manager_notes_pm_created_idx');
    await queryInterface.dropTable('product_manager_notes');

    const productCols = await queryInterface.describeTable('products');
    if (productCols.type) {
      await queryInterface.removeColumn('products', 'type');
    }
  }
};
