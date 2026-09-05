'use strict';

// Controlled "Project -> Extend Deadline" workflow (Manager/Admin only,
// enforced in lib/tmsAccess.ts's canExtendTmsDeadline + the new
// extend-deadline route, not just hidden in the UI). `deadline` is a NEW,
// separate field from the existing estimated_close_date/actual_close_date —
// those already drive other behavior (free-form pipeline forecasting,
// completion email trigger in app/api/tms/projects/[id]/route.ts) that must
// keep working unchanged. Every extension is an immutable history row, never
// an overwrite.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tms_projects', 'deadline', { type: Sequelize.DATEONLY, allowNull: true });
    await queryInterface.sequelize.query('UPDATE tms_projects SET deadline = estimated_close_date WHERE estimated_close_date IS NOT NULL;');

    await queryInterface.createTable('tms_project_deadline_extensions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      tms_project_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'tms_projects', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      previous_deadline: { type: Sequelize.DATEONLY, allowNull: true },
      new_deadline: { type: Sequelize.DATEONLY, allowNull: false },
      remark: { type: Sequelize.TEXT, allowNull: false },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      extended_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('tms_project_deadline_extensions', ['tms_project_id'], { name: 'tms_project_deadline_extensions_project_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tms_project_deadline_extensions');
    await queryInterface.removeColumn('tms_projects', 'deadline');
  }
};
