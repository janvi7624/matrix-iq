'use strict';

/**
 * Recurring days off — specifically "the third Saturday of every month".
 *
 * Deliberately a RULE rather than twelve dates a year appended to the
 * existing `holidays` list: that list would have to be topped up every
 * December, and the policy would silently lapse the first year nobody
 * remembered. A rule is correct forever.
 *
 * Shape: [{ "nth": 1-5, "weekday": 0-6 }], 0 = Sunday. The default below is
 * the third Saturday, which is this company's policy. Because the column is
 * added WITH that default and NOT NULL, Postgres backfills the existing
 * singleton config row with it too — so this one statement covers both a
 * fresh install and the running one, with no separate UPDATE.
 *
 * Everything downstream (deadlines, the Saturday→Monday rule, reminder
 * scheduling, the sweep window, analytics' expected count) is built on
 * isWorkingDay in lib/dailyReportTime.ts, so a third Saturday now behaves
 * exactly like a Sunday everywhere without any of those being touched.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('daily_report_config', 'off_nth_weekdays', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [{ nth: 3, weekday: 6 }]
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('daily_report_config', 'off_nth_weekdays');
  }
};
