'use strict';

/**
 * "HR has dealt with this" — and the nagging that happens until they have.
 *
 * daily_report_escalations recorded only that HR was TOLD (notified_at,
 * notified_usernames, email_status). There was no way to record that anybody
 * then did anything, which meant an escalation could sit unread forever with
 * nothing in the system noticing.
 *
 * Acknowledgement is deliberately separate from waiving a warning. HR's
 * correct response is often NOT a waiver — the employee really did miss four
 * reports, and the action is a conversation, not an exemption. Inferring
 * "handled" from a waiver would have left exactly the honest cases nagging
 * forever, so handled is its own explicit act with its own note.
 *
 * reminder_last_sent_at/reminder_count drive the follow-up to the HR
 * MANAGER: they are what make the reminder repeat on a schedule instead of
 * once, and stop the moment acknowledged_at is set.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('daily_report_escalations', 'acknowledged_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('daily_report_escalations', 'acknowledged_by', { type: Sequelize.UUID });
    // What HR actually did. Required by the API, not by the column, so an
    // older row acknowledged before this existed is still representable.
    await queryInterface.addColumn('daily_report_escalations', 'action_note', { type: Sequelize.TEXT });
    await queryInterface.addColumn('daily_report_escalations', 'reminder_last_sent_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('daily_report_escalations', 'reminder_count', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0
    });

    // The sweep's reminder query is "notified, not yet acknowledged" — a
    // partial index so it stays cheap as the table grows month on month.
    await queryInterface.addIndex('daily_report_escalations', ['notified_at'], {
      name: 'daily_report_escalations_pending_action_idx',
      where: { acknowledged_at: null }
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('daily_report_escalations', 'daily_report_escalations_pending_action_idx');
    await queryInterface.removeColumn('daily_report_escalations', 'reminder_count');
    await queryInterface.removeColumn('daily_report_escalations', 'reminder_last_sent_at');
    await queryInterface.removeColumn('daily_report_escalations', 'action_note');
    await queryInterface.removeColumn('daily_report_escalations', 'acknowledged_by');
    await queryInterface.removeColumn('daily_report_escalations', 'acknowledged_at');
  }
};
