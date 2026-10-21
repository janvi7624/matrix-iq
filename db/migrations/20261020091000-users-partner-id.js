'use strict';

// The tenancy claim itself: which partner company a login account belongs to.
//
// NULL for every internal employee — that is the discriminator the whole
// Partner Portal is built on. `partner_id IS NULL` means "internal staff",
// and nothing else needs to be asked.
//
// ON DELETE RESTRICT: a partner company holding login accounts cannot be
// deleted out from under them. Deactivating a partner is a `status` change
// (see the partners table), never a row delete.
//
// Deliberately NOT given a DEFAULT: an account's partner binding must always
// be an explicit decision at creation time, never something a row drifts into.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'partnerId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'partners', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT'
    });

    // Partial index: internal staff are the overwhelming majority of this
    // table and all carry NULL here, so indexing them wastes space and buys
    // nothing — every query against this column looks for a specific partner.
    await queryInterface.sequelize.query(
      'CREATE INDEX users_partner_id_idx ON users ("partnerId") WHERE "partnerId" IS NOT NULL'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS users_partner_id_idx');
    await queryInterface.removeColumn('users', 'partnerId');
  }
};
