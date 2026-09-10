'use strict';

// Admin Expenses' Hotel Booking type only had one plain `date` — not enough
// to actually capture a stay (a hotel booking is a date RANGE, not a single
// day). Adds an optional check_out_date column; `date` keeps its existing
// meaning (check-in date for a Hotel admin entry, the one/only travel date
// for ticket admin entries, and the existing expense date for every normal
// employee reimbursement — untouched, this column is additive and nullable).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('reimbursements', 'check_out_date', { type: Sequelize.DATEONLY, allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('reimbursements', 'check_out_date');
  }
};
