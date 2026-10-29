'use strict';

// Sales projects used to carry exactly one technical person
// (projects.assigned_technical_person_id) — the moment a second candidate's
// request was approved, lib/projectTechnicalRequest.ts's applyTechnicalAssignment
// auto-withdrew every other still-pending request for the project, because
// a single column has no room for a second name. That made "assign two
// technical people to the same project" look like a bug (approve one,
// the other silently disappears) when it was actually the single-column
// model working as designed.
//
// This table is the real multi-person model: every CURRENTLY assigned
// technical person on a project gets a row here, all equal — no "lead" vs
// "support" distinction. assigned_technical_person_id/_name on `projects`
// are kept as a backward-compatible PRIMARY pointer (the first person
// assigned, used by the ~15 existing call sites that only ever show one
// name — dashboards, TMS handoff, lifecycle emails) rather than ripped out
// across the whole app in one change; every place that actually needs the
// full team reads this table instead (lib/projectStore.ts's
// findProjectById, canAccessProject, resolveOwnerWhere).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('project_technical_assignments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      project_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'projects', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      user_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      // Who approved/assigned them — null on the rows this migration backfills,
      // since the single-column model never recorded that separately from the
      // project's own timeline/audit log.
      assigned_by_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    // The same person can't be assigned to the same project twice.
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS project_technical_assignments_project_user ON project_technical_assignments (project_id, user_id)'
    );
    // listTechnicalRoster-style "which projects is this person on" lookups,
    // and resolveOwnerWhere's visibility expansion, both filter by user_id.
    await queryInterface.sequelize.query(
      'CREATE INDEX IF NOT EXISTS project_technical_assignments_user_id ON project_technical_assignments (user_id)'
    );

    // Backfill: every project that already has a single assigned technical
    // person gets that same person carried over as their first row here, so
    // existing assignments aren't silently lost when this ships.
    await queryInterface.sequelize.query(`
      INSERT INTO project_technical_assignments (id, project_id, user_id, assigned_by_id, created_at, updated_at)
      SELECT gen_random_uuid(), id, assigned_technical_person_id, NULL, NOW(), NOW()
      FROM projects
      WHERE assigned_technical_person_id IS NOT NULL
      ON CONFLICT (project_id, user_id) DO NOTHING
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('project_technical_assignments');
  }
};
