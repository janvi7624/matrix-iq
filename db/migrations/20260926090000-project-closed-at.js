'use strict';

// Feeds the Projects list's 90-day auto-hide of closed (Won/Lost) deals —
// a dedicated timestamp for exactly when that happened, separate from
// updated_at, since a later edit on an already-closed project (a note, a
// remark) must not reset the clock. NULL for every open project, and for
// every already-closed project until the next status-changing PATCH touches
// it (see lib/projectStore.ts).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'closed_at', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'closed_at');
  }
};
