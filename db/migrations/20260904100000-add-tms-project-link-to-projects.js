'use strict';

/**
 * Links a Sales `projects` row to the TMS `tms_projects` row auto-created
 * (or updated) when a technical person is assigned — see lib/tmsHandoff.ts.
 * Nullable: most projects never reach the "technical person assigned" point,
 * and older rows never had a chance to get one.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'tms_project_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'tms_projects', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'tms_project_id');
  }
};
