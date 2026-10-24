'use strict';

/**
 * One column: a free-text "Project Brief" a sales person writes so the
 * technical team taking the project over at Won has a plain-language
 * explanation of what it is, instead of having to reconstruct one from the
 * pipeline fields (Company, Approx. Price, Quotation total — none of which
 * say what is actually being delivered).
 *
 * Nullable, like `remarks` right next to it — NULL means "not written yet",
 * same convention as everywhere else free text sits alongside structured
 * fields on this table.
 *
 * The mandatory-at-Won side of this request (Project Name, Company Name, a
 * Quotation, PO details, and this Brief, all required before a project can
 * close as Won) needs no schema change — project_name/company already exist,
 * and "a quotation/PO exists" is a row-existence check, not a column. See
 * lib/salesStageRules.ts's STATUS_GATES.won and the won-closing gate in
 * app/api/projects/[id]/route.ts.
 *
 * Idempotent via describeTable, matching
 * db/migrations/20261021100000-dc-demo-cost.js.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('projects');
    if (table.project_brief) return;

    await queryInterface.addColumn('projects', 'project_brief', {
      type: Sequelize.TEXT,
      allowNull: true
    });
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('projects');
    if (table.project_brief) await queryInterface.removeColumn('projects', 'project_brief');
  }
};
