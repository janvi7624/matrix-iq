'use strict';

// Phase-wise delivery for a TMS project — "Phase 1: Site survey, due 15 Nov",
// "Phase 2: Installation, due 20 Dec". A project delivered in stages needs a
// deadline per stage, not just the single project-level `deadline` column,
// which stays what it is: the whole project's controlled-extension date.
//
// Its own table rather than JSONB on tms_projects (the precedent
// team_member_ids sets) because a phase is a record in its own right: it is
// completed on a date, ordered against its siblings, and will be reported on.
// JSONB would make "every phase due this month across all projects" a scan.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tms_project_phases', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      tms_project_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'tms_projects', key: 'id' },
        onUpdate: 'CASCADE',
        // CASCADE, not SET NULL: a phase has no meaning without the project
        // it is a phase OF, unlike a quotation, which outlives one.
        onDelete: 'CASCADE'
      },
      name: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT },
      // The point of the feature.
      expected_end_date: { type: Sequelize.DATEONLY },
      // Display/delivery order, not an id — phases are reordered, and the
      // creation order is rarely the delivery order.
      sequence: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      status: {
        type: Sequelize.ENUM('pending', 'in_progress', 'completed'),
        allowNull: false,
        defaultValue: 'pending'
      },
      // Stamped when status becomes 'completed', cleared on reopen — same
      // pattern as projects.closed_at.
      completed_at: { type: Sequelize.DATEONLY },
      created_by: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      deleted_at: { type: Sequelize.DATE }
    });
    await queryInterface.addIndex('tms_project_phases', ['tms_project_id'], { name: 'tms_project_phases_project_idx' });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('tms_project_phases', 'tms_project_phases_project_idx');
    await queryInterface.dropTable('tms_project_phases');
    // createTable's ENUM leaves its type behind on drop.
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tms_project_phases_status";');
  }
};
