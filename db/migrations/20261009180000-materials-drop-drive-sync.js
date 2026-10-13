'use strict';

// The Drive folder sync is gone. Materials are added by Marketing in
// MatrixIQ — product, category and the Drive link — and everyone else reads
// them. Nothing walks Drive any more, so every column that only existed to
// mirror Drive's own metadata is dead weight and comes out.
//
// Dropped, and why each was only ever a sync artifact:
//   source             -- told a synced row from a hand-added one. Every row
//                         is hand-added now.
//   last_synced_at     -- there is no sync to timestamp.
//   drive_modified_at  -- Drive's mtime, which nothing can read without
//                         credentials. updated_at already says when the entry
//                         changed here, which is the honest figure.
//   mime_type,         -- all read from the Drive API. Guessing them from a
//   size_bytes,           pasted URL would put unverified numbers on screen,
//   thumbnail_link,       so they go rather than being faked.
//   icon_link
//   section            -- the raw Drive subfolder name; `product` superseded it.
//   product_folder_id  -- replaced by the plain `is_folder` flag below:
//   product_folder_link   with one link per row, a separate folder column is
//                         just the same URL stored twice.
//
// `is_folder` is what remains of that pair — whether the row's link opens a
// Drive folder (everything for a product) or a single file. The UI needs it
// to label the action honestly, and it can't be re-derived once a URL has
// been normalised.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('materials', 'is_folder', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    // Carry the one fact worth keeping out of the columns being dropped.
    await queryInterface.sequelize.query(`
      UPDATE materials SET is_folder = true WHERE product_folder_link IS NOT NULL AND product_folder_link <> ''
    `);

    await queryInterface.addColumn('materials', 'updated_by', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.removeIndex('materials', 'materials_source_idx');
    for (const column of [
      'source',
      'last_synced_at',
      'drive_modified_at',
      'mime_type',
      'size_bytes',
      'thumbnail_link',
      'icon_link',
      'section',
      'product_folder_id',
      'product_folder_link'
    ]) {
      await queryInterface.removeColumn('materials', column);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('materials', 'source', { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'manual' });
    await queryInterface.addColumn('materials', 'last_synced_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('materials', 'drive_modified_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('materials', 'mime_type', { type: Sequelize.STRING(128), allowNull: true });
    await queryInterface.addColumn('materials', 'size_bytes', { type: Sequelize.BIGINT, allowNull: true });
    await queryInterface.addColumn('materials', 'thumbnail_link', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('materials', 'icon_link', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.addColumn('materials', 'section', { type: Sequelize.STRING, allowNull: true });
    await queryInterface.addColumn('materials', 'product_folder_id', { type: Sequelize.STRING(128), allowNull: true });
    await queryInterface.addColumn('materials', 'product_folder_link', { type: Sequelize.TEXT, allowNull: true });
    await queryInterface.sequelize.query(`
      UPDATE materials SET product_folder_link = web_view_link WHERE is_folder = true
    `);
    await queryInterface.addIndex('materials', ['source'], { name: 'materials_source_idx' });
    await queryInterface.removeColumn('materials', 'updated_by');
    await queryInterface.removeColumn('materials', 'is_folder');
  }
};
