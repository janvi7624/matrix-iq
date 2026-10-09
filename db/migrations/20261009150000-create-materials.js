'use strict';

// Material library (Marketing → Materials). A read-only mirror of the
// company's Google Drive collateral folder: datasheets, case studies,
// brochures, presentations, certificates and media, so anyone in MatrixIQ can
// find a document without being given access to Drive itself.
//
// Drive stays the source of truth for the FILES — nothing is uploaded or
// copied here, each row just records where the file is and what it is
// (lib/materialSync.ts refreshes them from lib/googleDriveClient.ts). The one
// column Drive cannot hold is `description`, which marketing types in
// MatrixIQ and which the sync deliberately never overwrites.
//
// The unique index is partial (WHERE deleted_at IS NULL) so a material that
// was removed from Drive — and therefore soft-deleted here — never blocks the
// same file reappearing later.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('materials', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      drive_file_id: { type: Sequelize.STRING(128), allowNull: false },
      title: { type: Sequelize.STRING, allowNull: false },
      // 'datasheet' | 'case_study' | 'brochure' | 'presentation' |
      // 'certificate' | 'video' | 'other' — see lib/materialCategories.ts.
      // Kept as a plain string, not a PG enum, because an unrecognised Drive
      // subfolder must be able to land as 'other' without a migration, and
      // because enum values can never be dropped once added.
      category: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'other' },
      // The Drive subfolder the file sat in, verbatim — typically a product
      // or client when collateral is nested one level deeper.
      section: { type: Sequelize.STRING, allowNull: true },
      mime_type: { type: Sequelize.STRING(128), allowNull: true },
      // BIGINT: Drive reports bytes, and a product video clears INT4.
      // Google-native files (Docs/Slides) report no size at all, so NULL
      // here means "unknown", not "empty".
      size_bytes: { type: Sequelize.BIGINT, allowNull: true },
      web_view_link: { type: Sequelize.TEXT, allowNull: false },
      thumbnail_link: { type: Sequelize.TEXT, allowNull: true },
      icon_link: { type: Sequelize.TEXT, allowNull: true },
      drive_modified_at: { type: Sequelize.DATE, allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      last_synced_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    await queryInterface.addIndex('materials', ['drive_file_id'], {
      unique: true,
      name: 'materials_drive_file_id_unique',
      where: { deleted_at: null }
    });
    await queryInterface.addIndex('materials', ['category'], { name: 'materials_category_idx' });
    await queryInterface.addIndex('materials', ['title'], { name: 'materials_title_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('materials');
  }
};
