'use strict';

// Task Planner upgrade of the existing GeneralTask engine (Admin's "Assign
// Task" -> Task Planner). Three small, additive changes, no new task engine:
// - assignee_id becomes nullable, backing the new "Leave Unassigned"
//   assignment mode (see lib/generalTaskStore.ts's list() and the reassign
//   route, both already tolerant of/working with a null assignee).
// - tms_project_id optionally links a management task to a TMS project,
//   alongside the existing Sales project_id — purely additive, does not
//   touch tms_tasks/tms_projects themselves.
// - labels is a plain string array for the new Labels feature.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('general_tasks', 'assignee_id', { type: Sequelize.UUID, allowNull: true });

    await queryInterface.addColumn('general_tasks', 'tms_project_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'tms_projects', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });

    await queryInterface.addColumn('general_tasks', 'labels', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('general_tasks', 'labels');
    await queryInterface.removeColumn('general_tasks', 'tms_project_id');
    await queryInterface.changeColumn('general_tasks', 'assignee_id', { type: Sequelize.UUID, allowNull: false });
  }
};
