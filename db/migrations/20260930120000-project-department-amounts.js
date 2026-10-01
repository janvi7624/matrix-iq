'use strict';

// Per-department value split for a Sales project — e.g. a 50L Adani deal
// recorded as { "ai": 2700000, "av": 2300000 } alongside departments
// ["ai","av"]. See lib/projectDepartmentOptions.ts.
//
// Why a separate column rather than reshaping `departments` into
// [{department, amount}]: `departments` already holds live data, and the
// array-of-strings shape is what every reader, filter and the dashboard card
// are built on. An additive column leaves all of that untouched and needs no
// data migration — consistency between the two (an amount only ever exists
// for a department the project actually has) is enforced in one place,
// parseDepartmentAmounts.
//
// JSONB to match projects.departments / skipped_stages / attachments, the
// app's existing list- and map-valued columns. Empty for every project that
// predates the field, and for single-department projects, which have nothing
// to divide — departmentValueOf falls back to approx_price there.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'department_amounts', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: {}
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'department_amounts');
  }
};
