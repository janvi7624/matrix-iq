'use strict';

// Not every deal goes through every stage. The clearest case is a demo given
// virtually: no one visits the site, so Site Visit is not "pending forever",
// it simply does not apply. Recording that decision beats leaving a stage
// looking unfinished and beats deleting it from the pipeline for everyone.
//
// A list of ProjectStage values the project has been marked as not needing.
// Empty for every existing project, which is the same as today's behaviour.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'skipped_stages', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: []
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'skipped_stages');
  }
};
