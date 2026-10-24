'use strict';

/**
 * Two optional additions to lead capture:
 *  - reference: who personally referred this lead, when it was one of a
 *    fixed short list of named individuals — see lib/leadReferenceOptions.ts.
 *  - company_address: the company's full postal address, kept separate from
 *    the existing `city` (which stays — city alone is still useful for
 *    "leads by region" without anyone having typed a full address).
 *
 * Both nullable: neither is required, and NULL means "not given" for leads
 * captured before this migration and for every lead where nobody filled it
 * in, same convention as every other optional text column on this table.
 *
 * Idempotent via describeTable, matching
 * db/migrations/20261021100000-dc-demo-cost.js.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('leads');
    if (!table.reference) {
      await queryInterface.addColumn('leads', 'reference', {
        type: Sequelize.STRING,
        allowNull: true
      });
    }
    if (!table.company_address) {
      await queryInterface.addColumn('leads', 'company_address', {
        type: Sequelize.TEXT,
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('leads');
    if (table.reference) await queryInterface.removeColumn('leads', 'reference');
    if (table.company_address) await queryInterface.removeColumn('leads', 'company_address');
  }
};
