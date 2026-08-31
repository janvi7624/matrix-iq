'use strict';

// Description and Remarks dropped from Office Operation Expenses — the field
// set is now Sr No / Date / Usecase (+detail) / Expense Head / Item (+sub-item)
// / Qty / Amount. Both columns were verified empty across every existing row
// before this ran, so no recorded information is lost.
//
// `down` recreates them as the same nullable TEXT columns rather than trying to
// restore content, since there was none to preserve.
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('office_operation_expenses', 'description');
    await queryInterface.removeColumn('office_operation_expenses', 'remarks');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('office_operation_expenses', 'description', { type: Sequelize.TEXT });
    await queryInterface.addColumn('office_operation_expenses', 'remarks', { type: Sequelize.TEXT });
  }
};
