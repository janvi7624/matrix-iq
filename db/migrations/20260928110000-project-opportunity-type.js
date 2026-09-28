'use strict';

// Opportunity Type — 'distribution' | 'project' (see lib/projectLeadOptions.ts).
// It decides which Project Lead a new project is pre-filled with (Distribution
// -> Manoj Menon, Project -> Pankaj Sharma) and is kept on the project so the
// dashboard can show and filter by it. A plain string rather than a Postgres
// ENUM so adding a third type later doesn't need an enum migration. NULL for
// every project that predates the field; the API requires it on new ones.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'opportunity_type', { type: Sequelize.STRING(20), allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'opportunity_type');
  }
};
