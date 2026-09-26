'use strict';

// A demo can be done remotely — a screen share instead of hauling equipment to
// the client's site. Such a demo has nothing to dispatch and nothing to get
// back, so the whole Back Office half of the pipeline (delivery challan →
// material dispatched → material returned → DC closed) does not apply to it.
//
// Two changes make that expressible:
//   mode              'onsite' (every existing row, and the default) or 'virtual'
//   'ready_for_demo'  a new status: manager-approved and waiting for the demo
//                     date, with no Back Office step in between. It is what a
//                     virtual demo gets on approval instead of
//                     'pending_backoffice', which is what keeps virtual demos
//                     out of the Back Office queue without that queue needing
//                     to know this feature exists.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('demo_schedule', 'mode', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'onsite'
    });

    // ADD VALUE cannot be used in the same transaction that then writes the
    // value, so this runs on its own. IF NOT EXISTS keeps the migration
    // re-runnable.
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_demo_schedule_status" ADD VALUE IF NOT EXISTS 'ready_for_demo' AFTER 'pending_backoffice'`
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('demo_schedule', 'mode');
    // Postgres cannot drop a value from an enum. Any row still sitting on
    // 'ready_for_demo' is moved back to the equivalent onsite status so the
    // value is at least unused after a rollback.
    await queryInterface.sequelize.query(
      `UPDATE demo_schedule SET status = 'pending_backoffice' WHERE status = 'ready_for_demo'`
    );
  }
};
