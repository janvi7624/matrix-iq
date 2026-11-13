'use strict';

/**
 * users.reportingManagerId — a per-person reporting line.
 *
 * Until now "who manages this person" had exactly one answer in the schema:
 * Department.managerIds. Everyone in Sales reported to the Sales manager
 * (Manoj Menon), because the department WAS the reporting line. The
 * requirement is narrower than a department: Ajay Shankar BP reports to
 * Mahendra Singh Chauhan, while every other Sales person still reports to
 * Manoj, and Mahendra himself continues to report to Manoj.
 *
 * Why a column on users and not a second department: splitting Sales into
 * "Sales" and "Sales - South" would move Ajay out of Sales for every OTHER
 * purpose too — department health scores, targets, dashboards, the sales
 * scope rules — to express one reporting line. A nullable self-reference is
 * the smaller change and says exactly the thing that is true.
 *
 * NULL means "no personal override, use the department manager", which is
 * every one of the 40 active accounts the moment this runs. So the migration
 * changes no behaviour by itself; the one row that differs is set afterwards.
 *
 * ON DELETE SET NULL, not CASCADE: a manager leaving must never delete their
 * reports' accounts. The reportee falls back to the department manager, which
 * is the pre-override behaviour and a safe place to land.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'reportingManagerId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    // Looked up in the "who reports to me" direction on every manager's
    // request/visibility check, so it needs the index on this side.
    await queryInterface.addIndex('users', ['reportingManagerId'], {
      name: 'users_reporting_manager_id_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('users', 'users_reporting_manager_id_idx');
    await queryInterface.removeColumn('users', 'reportingManagerId');
  }
};
