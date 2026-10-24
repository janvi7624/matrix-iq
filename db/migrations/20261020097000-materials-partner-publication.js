'use strict';

// Publishing marketing collateral to partners.
//
// DEFAULT FALSE on every existing row, deliberately. The Materials library
// is currently visible to every internal role precisely because it is
// internal — it holds competitor comparisons, internal sales decks, pricing
// collateral and training guides alongside the customer-facing brochures.
// Flipping the whole library open to external partners on migration would
// publish all of it at once, so instead nothing is published until Marketing
// explicitly says so, item by item.
//
// TWO gates, not one:
//   materials.partner_visible        this document may be published
//   material_folders.partner_visible this folder may be browsed
// A published document inside an unpublished folder stays hidden. That is
// intentional rather than an oversight: folders are how the library is
// organised and how Marketing thinks about batches, so an un-published
// folder acts as a containing boundary even if someone ticks a document
// inside it by mistake.
//
// partner_audience narrows further: [] means "every partner" (once visible),
// a populated array means only those partner ids. An array rather than a
// join table because this is a short, rarely-read list attached to one
// document, not a relationship anyone queries from the other side.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('materials', 'partner_visible', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn('materials', 'partner_audience', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: []
    });
    await queryInterface.addColumn('material_folders', 'partner_visible', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    // The partner-facing read is "everything published", which on a library
    // that is mostly internal is a small slice — so index only those rows.
    await queryInterface.sequelize.query(
      'CREATE INDEX materials_partner_visible_idx ON materials (partner_visible) WHERE partner_visible = true'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX material_folders_partner_visible_idx ON material_folders (partner_visible) WHERE partner_visible = true'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS material_folders_partner_visible_idx');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS materials_partner_visible_idx');
    await queryInterface.removeColumn('material_folders', 'partner_visible');
    await queryInterface.removeColumn('materials', 'partner_audience');
    await queryInterface.removeColumn('materials', 'partner_visible');
  }
};
