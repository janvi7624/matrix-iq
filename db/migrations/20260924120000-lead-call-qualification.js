'use strict';

// Lead qualification by phone call, before any project exists.
//
// Assigning a lead used to create a Sales project immediately
// (lib/leadProjectAutomation.ts). After an expo that means 600+ business
// cards turn into 600 junk projects, burying the real pipeline and wrecking
// every conversion/win-rate chart. Now the assignee CALLS first and records
// the outcome here; only 'suitable' becomes a project. Everything else stays
// a contact — still searchable, still in Client Master, never in the pipeline.
//
// call_outcome values: '' (not called yet) | 'suitable' | 'not_suitable' |
// 'callback'. Nullable/'' everywhere so all existing leads simply read as
// "not called yet" with no backfill.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('leads', 'call_outcome', { type: Sequelize.STRING(20), allowNull: false, defaultValue: '' });
    await queryInterface.addColumn('leads', 'called_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('leads', 'called_by_id', {
      type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('leads', 'call_remark', { type: Sequelize.TEXT, allowNull: false, defaultValue: '' });
    // Only set when the outcome is 'callback' — the date the rep promised to
    // ring back, which is what the follow-up queue then counts from.
    await queryInterface.addColumn('leads', 'callback_at', { type: Sequelize.DATEONLY, allowNull: true });

    // The Leads list filters and counts by outcome constantly (and after an
    // expo that's thousands of rows), so index the column it sorts into.
    await queryInterface.addIndex('leads', ['call_outcome']);

    // Backfill the leads that were ALREADY converted under the old flow. They
    // have a project, so somebody decided they were worth one — leaving them
    // as "never called" would show every one of them as work still to do, and
    // zero out Qualified/Suitable on day one. called_at is the best evidence
    // available (when it was assigned, else when it was last touched).
    await queryInterface.sequelize.query(
      "UPDATE leads SET call_outcome = 'suitable', called_at = COALESCE(assigned_at, updated_at, created_at) WHERE project_id IS NOT NULL AND call_outcome = ''"
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('leads', ['call_outcome']);
    await queryInterface.removeColumn('leads', 'callback_at');
    await queryInterface.removeColumn('leads', 'call_remark');
    await queryInterface.removeColumn('leads', 'called_by_id');
    await queryInterface.removeColumn('leads', 'called_at');
    await queryInterface.removeColumn('leads', 'call_outcome');
  }
};
