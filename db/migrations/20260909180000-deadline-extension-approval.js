'use strict';

// Adds a reason (user end / client end) and a tiered approval workflow to
// TMS's existing deadline-extension history, and creates the equivalent
// table for Sales Projects (which previously had no deadline-change history
// at all — expected_closing_date was silently overwritten). Every existing
// TMS extension row was already an immediately-applied change made by a
// Manager/Admin under the old rule, so it backfills to status='approved',
// reason='user_end' — both fully additive, no data loss.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tms_project_deadline_extensions', 'reason', {
      type: Sequelize.ENUM('user_end', 'client_end'),
      allowNull: false,
      defaultValue: 'user_end'
    });
    await queryInterface.addColumn('tms_project_deadline_extensions', 'status', {
      type: Sequelize.ENUM('pending_manager', 'pending_admin', 'approved', 'rejected'),
      allowNull: false,
      defaultValue: 'approved'
    });
    await queryInterface.addColumn('tms_project_deadline_extensions', 'approved_by', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('tms_project_deadline_extensions', 'approved_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.addColumn('tms_project_deadline_extensions', 'decision_remark', { type: Sequelize.TEXT, allowNull: true });

    await queryInterface.createTable('project_deadline_extensions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      project_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'projects', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      previous_deadline: { type: Sequelize.DATEONLY, allowNull: true },
      new_deadline: { type: Sequelize.DATEONLY, allowNull: false },
      reason: { type: Sequelize.ENUM('user_end', 'client_end'), allowNull: false },
      remark: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.ENUM('pending_manager', 'pending_admin', 'approved', 'rejected'), allowNull: false, defaultValue: 'pending_manager' },
      requested_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      approved_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      approved_at: { type: Sequelize.DATE, allowNull: true },
      decision_remark: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('project_deadline_extensions', ['project_id'], { name: 'project_deadline_extensions_project_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('project_deadline_extensions');
    await queryInterface.removeColumn('tms_project_deadline_extensions', 'decision_remark');
    await queryInterface.removeColumn('tms_project_deadline_extensions', 'approved_at');
    await queryInterface.removeColumn('tms_project_deadline_extensions', 'approved_by');
    await queryInterface.removeColumn('tms_project_deadline_extensions', 'status');
    await queryInterface.removeColumn('tms_project_deadline_extensions', 'reason');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_project_deadline_extensions_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_project_deadline_extensions_reason";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tms_project_deadline_extensions_status";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tms_project_deadline_extensions_reason";');
  }
};
