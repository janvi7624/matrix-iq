'use strict';

// Feeds the Quotation list's 90-day auto-hide of closed quotes (Approved/
// Rejected/Expired) — a dedicated timestamp for when a quotation actually
// became Approved/Rejected, separate from updated_at, since a later edit
// (e.g. logging a follow-up) must not reset the clock. Backfills already-
// closed quotations from updated_at (the best available signal — there's no
// per-status-change history table for quotations the way Projects has a
// timeline) so existing old quotes age out too, not just future ones.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'status_changed_at', { type: Sequelize.DATE, allowNull: true });
    await queryInterface.sequelize.query(`
      UPDATE quotations
      SET status_changed_at = updated_at
      WHERE status IN ('approved', 'rejected') AND status_changed_at IS NULL;
    `);
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'status_changed_at');
  }
};
