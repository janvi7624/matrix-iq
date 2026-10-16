'use strict';

/**
 * One new clock-time column for the Sales/GEM-Sales auto-submit feature:
 * the daily report for an employee on an auto-measures template (today,
 * only Sales/GEM-Sales — see TemplateDefinition.autoMeasures in
 * lib/dailyReportTemplates.ts) is filed by the system itself, using
 * whatever was auto-fetched plus whatever the employee already typed, if
 * the employee has not submitted it themselves by this time on the next
 * working day.
 *
 * Deliberately a SEPARATE column from deadline_time rather than reusing it:
 * deadline_time governs lateness for every department, while this is a
 * narrower, Sales-only "submit it for them" trigger that the brief asked
 * for at a different clock time (10:30), and the two must be free to move
 * independently — an admin tightening the global deadline must not silently
 * retime the auto-submit, and vice versa.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('daily_report_config', 'sales_auto_submit_time', {
      type: Sequelize.STRING(5),
      allowNull: false,
      defaultValue: '10:30'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('daily_report_config', 'sales_auto_submit_time');
  }
};
