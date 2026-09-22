'use strict';

// Technical-person approval for Sales projects. Picking a technical person on
// a Sales project used to assign them on the spot — "A project was assigned
// to you" email, TMS project created, no say for the engineer or their
// manager. Now the sales side raises a REQUEST here; only the requested
// engineer, their department manager, or an admin can approve it, and
// nothing reaches Project.assigned_technical_person_id / TMS until they do.
//
// assigned_user_id can differ from requested_user_id: a department manager
// approving may send someone else from their team instead.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('project_technical_requests', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      project_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'projects', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      requested_user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      requested_by_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      // pending | approved | declined | withdrawn
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      note: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      needed_by: { type: Sequelize.DATEONLY, allowNull: true },
      decided_by_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      decided_at: { type: Sequelize.DATE, allowNull: true },
      assigned_user_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      response_remarks: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    // At most one open request per project, enforced by Postgres — a second
    // request replaces the first (withdrawn) rather than piling up beside it.
    await queryInterface.sequelize.query(
      "CREATE UNIQUE INDEX project_technical_requests_one_pending ON project_technical_requests (project_id) WHERE status = 'pending'"
    );
    await queryInterface.addIndex('project_technical_requests', ['requested_user_id', 'status']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('project_technical_requests');
  }
};
