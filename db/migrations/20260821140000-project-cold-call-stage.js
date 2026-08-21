'use strict';

/**
 * Extends the Project pipeline with two new early-funnel stages, ahead of
 * Site Visit: Cold Call -> Catalogue Offered -> Site Visit -> ... (unchanged
 * from here). Everything else in the existing pipeline (Quotation, tech
 * assignment via assigned_technical_person_id, Customer Response, win/loss
 * via status, Expected Closing Date) already covered the rest of the
 * requested flow — only these two touchpoints were missing.
 *
 * cold_call_responded is a plain string ('yes'|'no'|''), not an enum, so no
 * ALTER TYPE needed for it — only the stage enum itself gets the two new
 * values.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('ALTER TYPE "enum_projects_stage" ADD VALUE IF NOT EXISTS \'cold_call\';');
    await queryInterface.sequelize.query('ALTER TYPE "enum_projects_stage" ADD VALUE IF NOT EXISTS \'catalogue_offered\';');

    await queryInterface.addColumn('projects', 'cold_call_responded', { type: Sequelize.STRING, allowNull: false, defaultValue: '' });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'cold_call_responded');
    // Postgres can't drop individual enum values — 'cold_call'/
    // 'catalogue_offered' stay in the type on rollback (harmless: no code
    // path writes them once this migration is reverted).
  }
};
