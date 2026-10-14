'use strict';

/**
 * Per-employee exemption from daily reports.
 *
 * Until now "who must file" was answered purely by DEPARTMENT: an employee
 * owed a report if their department had an approved format. There was no way
 * to excuse one person — so an admin account sitting in a department that
 * files, or a manager who does not do daily activity reporting, could only
 * be dealt with by switching off their whole department, which also silenced
 * everyone else in it.
 *
 * Stored as a JSONB array of user ids on the existing singleton config row
 * rather than as a flag on `users`, for two reasons: it keeps a Daily Report
 * policy inside the Daily Report module instead of widening the shared user
 * table every other feature reads, and it makes the exemption a single list
 * an admin edits in one place (Daily Report Configuration) rather than a
 * field buried in each person's profile.
 *
 * Additive and reversible: one column with a default, no data rewritten.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('daily_report_config', 'exempt_employee_ids', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: []
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('daily_report_config', 'exempt_employee_ids');
  }
};
