'use strict';

// Which delivery department(s) a Sales project belongs to — AI, AV or
// Robotics (see lib/projectDepartmentOptions.ts). An array rather than a
// single column so a deal spanning two departments is one project carrying
// both, not a duplicate row per department; "Combined" in the UI is simply a
// selection of length > 1, never a stored value of its own.
//
// JSONB (not a Postgres enum array) to match projects.skipped_stages and
// projects.attachments, which are the app's existing list-valued columns —
// adding a value later is then a code change, not a migration against a live
// enum type.
//
// Empty for every project that predates this field. Nothing backfills a
// guess: which department an old deal belonged to isn't derivable from what
// is stored, and a wrong department is worse than a blank one for the
// reporting this exists to support.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'departments', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: []
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'departments');
  }
};
