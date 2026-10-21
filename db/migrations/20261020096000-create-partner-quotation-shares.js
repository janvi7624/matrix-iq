'use strict';

// Which quotations a partner may read.
//
// A JOIN TABLE rather than a flag on `quotations`, and that is the whole
// design. Visibility is not a property of the quotation — it is a decision
// someone made, at a time, about a specific partner, and one that must be
// reversible without destroying the record of it having happened. A boolean
// column could answer "is this shared" but not "who shared it, when, and was
// it later withdrawn", and the requirement asks for the history of shared
// versions.
//
// Absence of a row is the default: a quotation nobody has explicitly shared
// is invisible to every partner. There is no "share everything on this
// project" shortcut, because quotation revisions are created freely during
// negotiation and a project-level grant would publish every future draft
// automatically.
//
// revoked_at rather than a delete: withdrawing access must leave a trace.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('partner_quotation_shares', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      quotation_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'quotations', key: 'id' },
        onUpdate: 'CASCADE',
        // CASCADE here, unlike everywhere else in this feature: a share is
        // meaningless once the quotation itself is gone, and quotations are
        // genuinely deletable by a superadmin (see lib/quotationStore.ts's
        // deleteQuotation). Leaving orphaned shares would mean a partner's
        // list referencing rows that no longer exist.
        onDelete: 'CASCADE'
      },
      partner_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'partners', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT'
      },
      shared_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      shared_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      revoked_at: { type: Sequelize.DATE, allowNull: true },
      revoked_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // Optional covering note shown to the partner alongside the quotation.
      note: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    // One LIVE share per (quotation, partner). Partial on revoked_at IS NULL
    // so the same quotation can be re-shared after a withdrawal — which is a
    // real sequence (shared, withdrawn to correct a price, shared again) —
    // while still making a double-grant impossible.
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX partner_quotation_shares_live_unique ON partner_quotation_shares (quotation_id, partner_id) WHERE revoked_at IS NULL'
    );
    // The partner's own list: "everything live for me", newest first.
    await queryInterface.sequelize.query(
      'CREATE INDEX partner_quotation_shares_partner_idx ON partner_quotation_shares (partner_id, shared_at DESC) WHERE revoked_at IS NULL'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS partner_quotation_shares_partner_idx');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS partner_quotation_shares_live_unique');
    await queryInterface.dropTable('partner_quotation_shares');
  }
};
