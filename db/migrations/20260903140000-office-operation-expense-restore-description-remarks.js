'use strict';

// Description and Remarks reinstated. They were dropped in
// 20260903120000 when the field set was trimmed, then reintroduced once the
// Excel sheet grew Description/Remarks columns — this keeps the form, the API
// and the sheet reading from the same stored values instead of printing two
// permanently blank columns.
//
// Both are nullable TEXT, exactly as before; existing rows simply start empty.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('office_operation_expenses', 'description', { type: Sequelize.TEXT });
    await queryInterface.addColumn('office_operation_expenses', 'remarks', { type: Sequelize.TEXT });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('office_operation_expenses', 'description');
    await queryInterface.removeColumn('office_operation_expenses', 'remarks');
  }
};
