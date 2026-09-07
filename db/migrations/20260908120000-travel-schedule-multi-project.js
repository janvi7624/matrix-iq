'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('travel_schedule', 'project_ids', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await queryInterface.addColumn('travel_schedule', 'travel_suggestion', { type: Sequelize.TEXT, allowNull: true });
    // Backfill: an existing single project_id becomes a one-element project_ids array.
    await queryInterface.sequelize.query(
      `UPDATE travel_schedule SET project_ids = jsonb_build_array(project_id::text) WHERE project_id IS NOT NULL`
    );
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('travel_schedule', 'project_ids');
    await queryInterface.removeColumn('travel_schedule', 'travel_suggestion');
  }
};
