'use strict';

/**
 * Supports Section 27 (bulk employee import from Excel):
 *   1. users.location — the one real EmpDetails.xlsx column with nowhere to
 *      go in the existing schema (see lib/userImportStore.ts).
 *   2. users.mustChangePassword — set true only for bulk-imported accounts;
 *      existing accounts default false and are unaffected (see lib/auth.ts,
 *      proxy.ts, and app/change-password).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'location', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.addColumn('users', 'mustChangePassword', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'mustChangePassword');
    await queryInterface.removeColumn('users', 'location');
  }
};
