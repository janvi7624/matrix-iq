'use strict';

// New Project intake fields.
//
//   project_name    what the deal is called, e.g. "MeetIQ - Adani". Distinct
//                   from client_name/company, which say WHO it is for.
//   state / city    picked from lib/indiaLocations.ts, with "Other" plus free
//                   text for anywhere the list does not cover (international
//                   clients included). The existing free-text `address` column
//                   is kept as-is for the street address.
//   referral_name   who referred it, asked for only when source is 'Referral'.
//
// The tender_* block is asked for only when source is 'GeM / Tender'. CapEx and
// OpEx are separate amounts rather than one either/or choice, because a tender
// can be split across capital and operating budgets.
//
// All nullable: every existing project predates these fields, and none of them
// can be inferred from what is already stored.
module.exports = {
  async up(queryInterface, Sequelize) {
    const columns = {
      project_name: { type: Sequelize.STRING(255) },
      state: { type: Sequelize.STRING(120) },
      city: { type: Sequelize.STRING(120) },
      referral_name: { type: Sequelize.STRING(255) },

      tender_capex: { type: Sequelize.DECIMAL(14, 2) },
      tender_opex: { type: Sequelize.DECIMAL(14, 2) },
      tender_ref_number: { type: Sequelize.STRING(120) },
      tender_name: { type: Sequelize.STRING(255) },
      tender_deadline: { type: Sequelize.DATEONLY },
      tender_estimated_value: { type: Sequelize.DECIMAL(14, 2) },
      // Text, not a number: a PBG is normally expressed as a percentage over a
      // period ("10% for 3 years"), not a single figure.
      tender_pbg: { type: Sequelize.STRING(255) },
      // An Earnest Money Deposit is a rupee amount.
      tender_emd: { type: Sequelize.DECIMAL(14, 2) },
      payment_terms: { type: Sequelize.TEXT }
    };

    for (const [name, spec] of Object.entries(columns)) {
      await queryInterface.addColumn('projects', name, spec);
    }

    // The dropdown option was renamed GeM -> 'GeM / Tender'. Without this,
    // every historical GeM project would stop matching any option and show as
    // "Other" the next time someone opened it.
    const [updated] = await queryInterface.sequelize.query(
      `UPDATE projects SET source = 'GeM / Tender' WHERE source = 'GeM'`
    );
    console.log(`[project-intake-fields] GeM -> GeM / Tender: ${updated ? updated.rowCount ?? '' : ''} project(s) migrated`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`UPDATE projects SET source = 'GeM' WHERE source = 'GeM / Tender'`);
    for (const name of [
      'project_name', 'state', 'city', 'referral_name',
      'tender_capex', 'tender_opex', 'tender_ref_number', 'tender_name',
      'tender_deadline', 'tender_estimated_value', 'tender_pbg', 'tender_emd', 'payment_terms'
    ]) {
      await queryInterface.removeColumn('projects', name);
    }
  }
};
