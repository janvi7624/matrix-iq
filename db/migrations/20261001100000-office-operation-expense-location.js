'use strict';

// Which office (Ahmedabad / Mumbai — lib/officeOperationExpenseOptions.ts)
// an expense belongs to. Required on every new entry going forward (see
// lib/officeOperationExpenseValidation.ts); nullable here only because
// entries recorded before this field existed have nothing to backfill it
// with — a guessed office would be worse than a blank one in this register.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('office_operation_expenses', 'office_location', { type: Sequelize.STRING(20) });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('office_operation_expenses', 'office_location');
  }
};
