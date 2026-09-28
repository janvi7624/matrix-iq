'use strict';

// Attachment storage inside our own database.
//
// Files used to live in a Supabase bucket. That project no longer exists, so
// every upload failed and every existing attachment became unreachable. S3 is
// supported too (lib/fileStorage.ts), but it needs a bucket and an IAM policy
// that do not exist yet — whereas this database is already running, already
// backed up and already reachable from the app, so attachments work the moment
// this migration is applied.
//
// `path` is the storage key the rest of the app already uses, e.g.
//   uploads/reimbursement/tahir/1788520686402-37962125-Mundra_Hotel.jpeg
// and is what /api/uploads/file/<path> resolves. Keeping that key identical to
// the old scheme is deliberate: if the Supabase files are ever recovered they
// can be loaded straight in under their original keys and every stored link
// starts working again, with no database rewrite.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('file_objects', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      // The storage key. Unique because it IS the address of the file.
      path: { type: Sequelize.TEXT, allowNull: false, unique: true },
      content_type: { type: Sequelize.STRING(255), allowNull: false, defaultValue: 'application/octet-stream' },
      size_bytes: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // The bytes themselves. Postgres TOASTs and compresses this out of line,
      // so a wide row never slows down queries that do not select it — and
      // nothing selects it except the download route.
      data: { type: Sequelize.BLOB, allowNull: false },
      // Username, matching how the rest of the app records authorship.
      uploaded_by: { type: Sequelize.STRING(255) },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    // Every read is by exact path; the unique constraint already indexes it,
    // so this only adds the lookup used for housekeeping and reporting.
    await queryInterface.addIndex('file_objects', ['uploaded_by'], { name: 'file_objects_uploaded_by' });
    await queryInterface.addIndex('file_objects', ['created_at'], { name: 'file_objects_created_at' });
  },

  async down(queryInterface) {
    // Irreversible in substance: dropping this table destroys the files it
    // holds. Kept only so the migration is complete and testable.
    await queryInterface.dropTable('file_objects');
  }
};
