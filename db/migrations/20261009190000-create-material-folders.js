'use strict';

// Folders for the Material library, created and arranged by Marketing inside
// MatrixIQ — "Robots", with the robot datasheets filed inside it.
//
// This is MatrixIQ's own structure, not a mirror of anything in Drive. A
// material still points at one Drive link; the folder only says where it
// sits in the library, so collateral can be organised the way the sales team
// thinks about it without anyone rearranging Drive.
//
// parent_id is a self-reference, so folders nest. The depth cap and the
// no-cycles rule live in lib/materialFolderTree.ts rather than in the schema
// — Postgres can't express either, and the store enforces them on every
// create and move.
//
// ON DELETE RESTRICT on both foreign keys is deliberate: a folder holding
// anything cannot be dropped out from under it. The API refuses with a count
// of what's inside, rather than silently cascading away someone's materials.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('material_folders', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      // Null = a top-level folder.
      parent_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'material_folders', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      description: { type: Sequelize.TEXT, allowNull: true },
      created_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      updated_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    await queryInterface.addIndex('material_folders', ['parent_id'], { name: 'material_folders_parent_idx' });

    // Null = the material sits at the library's top level, which is where
    // everything added before folders existed stays.
    await queryInterface.addColumn('materials', 'folder_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'material_folders', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });
    await queryInterface.addIndex('materials', ['folder_id'], { name: 'materials_folder_idx' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('materials', 'materials_folder_idx');
    await queryInterface.removeColumn('materials', 'folder_id');
    await queryInterface.dropTable('material_folders');
  }
};
