'use strict';

// The Material library is browsed BY PRODUCT, not by file: inside Datasheet
// you want "Product 1 → its Drive link, Product 2 → its Drive link", and the
// same inside Case Study. These three columns are what make that grouping a
// stored fact rather than something the UI re-guesses on every render.
//
//   product              -- what the material is FOR. The Drive subfolder
//                           name when collateral is foldered per product
//                           (Datasheets/X200/...), otherwise recovered from
//                           the file name (Datasheets/X200 Datasheet.pdf).
//   product_folder_id    -- the Drive id of that per-product folder, when
//   product_folder_link     there is one. This is what lets a product row
//                           link straight to its folder in Drive instead of
//                           to one arbitrary file inside it.
//
// Additive and nullable, so it applies cleanly whether or not the library has
// already been synced. Existing rows get their product backfilled from
// `section` (the column this supersedes) in one statement — no re-sync
// needed to make the grouping work, though a re-sync is what fills in the
// folder links.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('materials', 'product', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('materials', 'product_folder_id', { type: Sequelize.STRING(128), allowNull: true });
    await queryInterface.addColumn('materials', 'product_folder_link', { type: Sequelize.TEXT, allowNull: true });

    // `section` held exactly this when it held anything at all.
    await queryInterface.sequelize.query(`
      UPDATE materials
         SET product = section
       WHERE section IS NOT NULL AND section <> '' AND product IS NULL
    `);

    await queryInterface.addIndex('materials', ['category', 'product'], { name: 'materials_category_product_idx' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('materials', 'materials_category_product_idx');
    await queryInterface.removeColumn('materials', 'product_folder_link');
    await queryInterface.removeColumn('materials', 'product_folder_id');
    await queryInterface.removeColumn('materials', 'product');
  }
};
