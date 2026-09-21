'use strict';

// "Prepared By" was always a free-text snapshot (prepared_by/_phone/_email —
// STRING columns, never an FK) — correct for historical accuracy (a
// quotation should keep showing the contact details as they were when it
// was made, even if that person's profile changes later), but with no way
// to reliably tell WHICH user it was, or to let one person (Khushi/Maulik)
// create a quotation "on behalf of" someone else while still recording who
// actually did the work. This adds an FK alongside the existing snapshot
// columns — additive only, nothing existing changes meaning. Nullable and
// backfilled to nothing: an existing quotation's prepared_by/_phone/_email
// still display exactly as before, they just have no linked user id (the
// UI/API treat that the same as "self", not as broken data).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'prepared_by_user_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'prepared_by_user_id');
  }
};
