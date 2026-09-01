'use strict';

// The free-text "Expense Head" field is retired: that label now belongs to the
// Item Name dropdown, so a single picked value identifies the head of expense
// instead of a typed name sitting alongside it. Keeping both would mean two
// competing answers to "what was this spent on".
//
// The four rows that existed when this ran held 'Sameer', 'Om', 'Amit' and
// 'Stationary' here — free-text values with no equivalent slot in the new
// shape, so they are dropped rather than migrated somewhere they don't belong.
// `down` recreates the column (empty); the text itself is not recoverable.
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn('office_operation_expenses', 'expense_head');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('office_operation_expenses', 'expense_head', { type: Sequelize.STRING });
  }
};
