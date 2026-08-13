'use strict';

/**
 * Real technical-person assignment (Demo Schedule + Projects) and
 * department-level manager mapping, replacing the hardcoded name lists in
 * lib/teamMembers.ts / lib/domainLeads.ts:
 *   1. departments.managerIds — JSONB array of user UUIDs ("who manages this
 *      department", supports more than one, e.g. Sales has two).
 *   2. demo_schedule.assigned_technical_person_id — nullable FK to users.id.
 *      The existing assigned_technical_person STRING column is kept as a
 *      dual-written display/back-compat value (same pattern already used for
 *      users.department / users.departmentId).
 *   3. projects.assigned_technical_person_id — nullable FK to users.id, net
 *      new (no legacy string counterpart needed).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('departments', 'managerIds', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: []
    });

    await queryInterface.addColumn('demo_schedule', 'assigned_technical_person_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    await queryInterface.addColumn('projects', 'assigned_technical_person_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'assigned_technical_person_id');
    await queryInterface.removeColumn('demo_schedule', 'assigned_technical_person_id');
    await queryInterface.removeColumn('departments', 'managerIds');
  }
};
