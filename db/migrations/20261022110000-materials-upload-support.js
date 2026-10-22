'use strict';

/**
 * Adding a material now has two paths, not one: paste a Google Drive link
 * (unchanged), or upload a file directly — stored through the app's own
 * generic attachment storage (lib/fileStorage.ts, same as expense bills and
 * PO documents), served back through /api/uploads/file/...
 *
 * REINTRODUCING source/mime_type — read this before assuming it's the same
 * mistake twice. Both columns existed before, for a DIFFERENT reason (telling
 * a Drive-FOLDER-SYNC-created row from a hand-pasted one — see
 * 20261009170000-materials-manual-source.js), and were dropped when that sync
 * feature was removed entirely (20261009180000-materials-drop-drive-sync.js).
 * That removal's note on mime_type specifically was "guessing them from a
 * pasted URL would put unverified numbers on screen, so they go rather than
 * being faked" — true of a Drive link, where nothing here can read the file.
 * It does NOT apply here: for an upload, mime_type is the real
 * File.type of the bytes actually received, not a guess, so it is honest data
 * worth keeping (lib/materialCategories.ts's fileKindFromMime can then give
 * an uploaded file an accurate icon instead of only guessing from its typed
 * title the way a Drive link still has to).
 *
 * source now means 'drive' | 'upload' — which of the two paths a row came
 * from — not the old sync/manual distinction, which no longer exists at all.
 *
 * Idempotent via describeTable, matching 20261021100000-dc-demo-cost.js.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('materials');

    if (!table.source) {
      await queryInterface.addColumn('materials', 'source', {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: 'drive'
      });
      await queryInterface.addIndex('materials', ['source'], { name: 'materials_source_idx' });
    }

    if (!table.mime_type) {
      await queryInterface.addColumn('materials', 'mime_type', {
        type: Sequelize.STRING(128),
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('materials');
    if (table.mime_type) await queryInterface.removeColumn('materials', 'mime_type');
    if (table.source) {
      await queryInterface.removeIndex('materials', 'materials_source_idx').catch(() => {});
      await queryInterface.removeColumn('materials', 'source');
    }
  }
};
