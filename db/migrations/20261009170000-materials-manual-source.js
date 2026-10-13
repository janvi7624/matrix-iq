'use strict';

// Materials can now be added by pasting a Drive link, not only by syncing the
// whole folder — which is what makes the library usable before (or without) a
// Google service account being set up.
//
// `source` is what keeps the two from fighting. The sync soft-deletes every
// row Drive no longer returns, and a hand-added material is BY DEFINITION
// not something the sync walked, so without this column the first sync would
// silently wipe every manual entry. Deletion is now scoped to source='drive'.
//
// Existing rows are all sync-created, so 'drive' is the correct default and
// the correct backfill.
//
// drive_file_id also becomes nullable: a link whose id can't be parsed still
// deserves to be saved. Postgres allows unlimited NULLs under a unique index,
// so the existing partial unique index keeps working untouched.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('materials', 'source', {
      type: Sequelize.STRING(16),
      allowNull: false,
      defaultValue: 'drive'
    });
    await queryInterface.changeColumn('materials', 'drive_file_id', {
      type: Sequelize.STRING(128),
      allowNull: true
    });
    // Who pasted the link — only meaningful for manual rows, so nullable.
    await queryInterface.addColumn('materials', 'created_by', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addIndex('materials', ['source'], { name: 'materials_source_idx' });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('materials', 'materials_source_idx');
    await queryInterface.removeColumn('materials', 'created_by');
    // Rows with a null drive_file_id are the manual ones; they have to go
    // before the column can be NOT NULL again.
    await queryInterface.sequelize.query(`DELETE FROM materials WHERE drive_file_id IS NULL`);
    await queryInterface.changeColumn('materials', 'drive_file_id', {
      type: Sequelize.STRING(128),
      allowNull: false
    });
    await queryInterface.removeColumn('materials', 'source');
  }
};
