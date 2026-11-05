'use strict';

/**
 * One new clock-time column: when the system submits, on ANY department's
 * behalf, a report that is already saved as a DRAFT but was never submitted.
 *
 * Deliberately a SEPARATE column from sales_auto_submit_time rather than
 * reusing it, because the two differ in a load-bearing way: the Sales switch
 * stands in with auto-fetched data even for a report with nothing typed at
 * all, while this one only ever promotes a draft that already has real,
 * validator-passing content — rescuing "forgot to press submit", never
 * "never opened it". Firing this for someone with no draft at all would
 * quietly gut the missed-report warning the module exists to raise.
 *
 * Blank (the default) means off, same convention as sales_auto_submit_time —
 * a deployment never starts auto-filing anyone's report merely because this
 * migration ran. Arming it is an explicit admin action in Daily Report
 * Configuration.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('daily_report_config', 'draft_auto_submit_time', {
      type: Sequelize.STRING(5),
      allowNull: false,
      defaultValue: ''
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('daily_report_config', 'draft_auto_submit_time');
  }
};
