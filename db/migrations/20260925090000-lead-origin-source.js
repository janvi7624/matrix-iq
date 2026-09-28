'use strict';

// Where a lead came from — the event/campaign/channel a rep picks when
// capturing it (InfoComm 2026, Google Leads, Meta Leads, Website, Meeting,
// Expo, Other). See lib/leadSources.ts.
//
// A NEW column rather than a reuse of `leads.source`: that one records how
// the lead entered the system (business card scan, CSV import, typed by hand,
// Meta webhook) and is set automatically. Overwriting it would have thrown
// away, for 500+ already-captured leads, the record of which were scanned at
// the stand and which were bulk-imported afterwards.
//
// '' means "not set" — every lead captured before this field existed, other
// than the InfoComm backfill below. It is a real, findable state, not a null
// to hide.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('leads');
    if (!table.lead_source) {
      await queryInterface.addColumn('leads', 'lead_source', {
        type: Sequelize.STRING(40), allowNull: false, defaultValue: ''
      });
    }

    // The Leads list filters and counts by this on every render, over a table
    // that an expo pushes past a thousand rows.
    await queryInterface.sequelize.query('CREATE INDEX IF NOT EXISTS leads_lead_source ON leads (lead_source)');

    // Backfill: everything captured from 16 September 2026 onwards is InfoComm
    // 2026. The team imported and scanned that whole batch before this field
    // existed, so it would otherwise read as "Not set" forever and the event
    // would show zero leads.
    //
    // The boundary is 16 Sep 00:00 IST, written as its UTC instant. Using a
    // bare '2026-09-16' would be read in the server's own timezone and, on a
    // UTC server, silently drop everything captured between midnight and
    // 05:30 IST on the 16th.
    await queryInterface.sequelize.query(
      "UPDATE leads SET lead_source = 'infocomm_2026' WHERE created_at >= '2026-09-15T18:30:00Z' AND lead_source = ''"
    );

    // Meta leads are attributed by their own pipeline and are never InfoComm —
    // correct regardless of when they arrived, including any that land later.
    await queryInterface.sequelize.query(
      "UPDATE leads SET lead_source = 'meta_leads' WHERE source = 'meta_lead_ads' AND lead_source IN ('', 'infocomm_2026')"
    );
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS leads_lead_source');
    await queryInterface.removeColumn('leads', 'lead_source');
  }
};
