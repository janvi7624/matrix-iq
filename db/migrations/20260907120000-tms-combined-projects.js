'use strict';

// Combined/multi-department TMS projects. `department_id` keeps meaning
// "primary/owning department" for every existing single-department caller
// (tmsHandoff.ts, lifecycle emails, moduleConfigStore's department gate) —
// none of them need to change. tms_project_departments is the real source of
// truth for "which departments touch this project": exactly one row for a
// plain department project, 2+ for a combined one. Backfilled one row per
// existing project from its current department_id.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tms_projects', 'project_type', {
      type: Sequelize.ENUM('department', 'combined'),
      allowNull: false,
      defaultValue: 'department'
    });

    await queryInterface.createTable('tms_project_departments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      tms_project_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'tms_projects', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      department_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('tms_project_departments', ['tms_project_id', 'department_id'], { unique: true, name: 'tms_project_departments_unique' });

    await queryInterface.sequelize.query(`
      INSERT INTO tms_project_departments (id, tms_project_id, department_id, created_at)
      SELECT gen_random_uuid(), id, department_id, NOW() FROM tms_projects WHERE department_id IS NOT NULL;
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tms_project_departments');
    await queryInterface.removeColumn('tms_projects', 'project_type');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_tms_projects_project_type";');
  }
};
