'use strict';

// Project Lead / Mentor — mandatory on every new Sales project (one of a
// fixed short list, see lib/projectLeadOptions.ts). A real user FK rather than
// a label so the lead's own Project Dashboard can include the projects they
// lead (lib/projectStore.ts resolveOwnerWhere) and a rename never orphans it.
// NULL for every project that predates this field until someone sets it —
// the API and forms require it going forward, but nothing backfills a guess.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'project_lead_id', {
      type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL'
    });
    await queryInterface.addIndex('projects', ['project_lead_id'], { name: 'projects_project_lead_id_idx' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('projects', 'projects_project_lead_id_idx');
    await queryInterface.removeColumn('projects', 'project_lead_id');
  }
};
