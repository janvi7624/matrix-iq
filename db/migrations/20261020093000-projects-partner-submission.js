'use strict';

// Partner-sourced projects.
//
// These columns are an OVERLAY on the existing projects table, not a new
// record type — the same arrangement lead_confirmation_status/confirmed_by/
// confirmed_at already use for the Lead -> Project automation. A partner
// submission is a real project from the moment it is created: same id, same
// stage machine, same children (quotations, demos, site visits). What the
// overlay adds is where it came from and whether Sales has accepted it yet.
//
// The alternative — a separate partner_submissions table that becomes a
// project on approval — was rejected because it forks the identifier. The
// requirement is explicit that an accepted submission keeps one reference
// ID and one history, and a two-table design cannot do that without copying
// rows and leaving the partner pointing at a dead id.
//
// Every column is NULL on every existing project, and NULL is the
// discriminator: `partner_id IS NULL` means an ordinary direct project, and
// nothing about those rows changes.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'partner_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'partners', key: 'id' },
      onUpdate: 'CASCADE',
      // RESTRICT: a partner with live projects cannot be deleted out from
      // under them. Ending a relationship is a status change — see
      // lib/partnerAccess.ts's PARTNERS_ARE_NEVER_DELETED.
      onDelete: 'RESTRICT'
    });

    // submitted | info_requested | approved | rejected.
    // NULL on every non-partner project, exactly like lead_confirmation_status.
    await queryInterface.addColumn('projects', 'partner_submission_status', {
      type: Sequelize.STRING(30),
      allowNull: true
    });

    await queryInterface.addColumn('projects', 'partner_reviewed_by', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('projects', 'partner_reviewed_at', { type: Sequelize.DATE, allowNull: true });
    // The reviewer's note. Partner-visible on purpose: a rejection the
    // partner cannot read a reason for is just an unexplained dead end, and
    // "request more information" is useless without saying what is missing.
    await queryInterface.addColumn('projects', 'partner_review_remarks', { type: Sequelize.TEXT, allowNull: true });

    // The partner's OWN estimate, deliberately kept apart from approx_price.
    // approx_price feeds the sales forecast and the department amount split;
    // an unvetted number typed in by an external party must not land there
    // before anyone at this company has looked at it. Sales sets approx_price
    // when it accepts the submission.
    await queryInterface.addColumn('projects', 'partner_submitted_value', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true
    });
    await queryInterface.addColumn('projects', 'partner_expected_timeline', {
      type: Sequelize.STRING(120),
      allowNull: true
    });

    // Partial: partner projects are a small minority of this table and every
    // query against these columns is looking for a specific partner or for
    // the review queue — indexing the NULL majority buys nothing.
    await queryInterface.sequelize.query(
      'CREATE INDEX projects_partner_id_idx ON projects (partner_id) WHERE partner_id IS NOT NULL'
    );
    await queryInterface.sequelize.query(
      'CREATE INDEX projects_partner_review_idx ON projects (partner_submission_status) WHERE partner_submission_status IS NOT NULL'
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS projects_partner_review_idx');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS projects_partner_id_idx');
    await queryInterface.removeColumn('projects', 'partner_expected_timeline');
    await queryInterface.removeColumn('projects', 'partner_submitted_value');
    await queryInterface.removeColumn('projects', 'partner_review_remarks');
    await queryInterface.removeColumn('projects', 'partner_reviewed_at');
    await queryInterface.removeColumn('projects', 'partner_reviewed_by');
    await queryInterface.removeColumn('projects', 'partner_submission_status');
    await queryInterface.removeColumn('projects', 'partner_id');
  }
};
