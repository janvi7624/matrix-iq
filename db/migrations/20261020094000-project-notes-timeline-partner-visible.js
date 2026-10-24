'use strict';

// Which project activity a partner may read.
//
// DEFAULT FALSE is the whole point, and it applies to every existing row as
// well as every future one. The project timeline and notes are where sales
// people record internal assessments — competitor pricing, how serious the
// customer actually is, margin discussions. Opening that to the submitting
// partner would be the single worst leak this feature could introduce, so
// the schema makes silence the default and visibility the deliberate act.
//
// Consequence worth stating plainly: a freshly migrated partner project
// shows the partner an EMPTY timeline until someone marks something
// visible, or until the partner-facing workflow events start writing
// partner_visible = true themselves (lib/partnerProjectStore.ts does this
// for submission/review/assignment, which are the partner's own milestones).
// An empty timeline is the correct failure mode; a full one is not.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('project_timeline_events', 'partner_visible', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn('project_notes', 'partner_visible', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });

    // The partner-facing read is always "this project's visible events", so
    // the index carries both columns rather than the flag alone.
    await queryInterface.addIndex('project_timeline_events', ['project_id', 'partner_visible'], {
      name: 'project_timeline_partner_visible_idx'
    });
    await queryInterface.addIndex('project_notes', ['project_id', 'partner_visible'], {
      name: 'project_notes_partner_visible_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('project_notes', 'project_notes_partner_visible_idx');
    await queryInterface.removeIndex('project_timeline_events', 'project_timeline_partner_visible_idx');
    await queryInterface.removeColumn('project_notes', 'partner_visible');
    await queryInterface.removeColumn('project_timeline_events', 'partner_visible');
  }
};
