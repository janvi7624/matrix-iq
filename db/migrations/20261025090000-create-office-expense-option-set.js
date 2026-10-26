'use strict';

// Editable picklists for Office Operation Expenses.
//
// lib/officeOperationExpenseOptions.ts says these lists are "a fixed business
// vocabulary, not admin-editable master data". That was true until the people
// recording the spend needed to add a category without a code change. The
// hardcoded lists stay exactly where they are and remain the BASE — this
// table holds only what has been edited on top, so a column left NULL keeps
// following the code as it changes.
//
// One row, like app_config: this vocabulary is company-wide, not per
// department or per office. Enforced by the partial unique index below rather
// than by convention, so a second row cannot be inserted by accident.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('office_expense_option_set', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true, allowNull: false },
      // Each column is NULL until someone edits that list, which is what
      // makes "never customised" distinguishable from "customised to exactly
      // the built-in values" — only the first keeps following the code.
      usecases: { type: Sequelize.JSONB, allowNull: true },
      usecase_sub_options: { type: Sequelize.JSONB, allowNull: true },
      items: { type: Sequelize.JSONB, allowNull: true },
      item_sub_options: { type: Sequelize.JSONB, allowNull: true },
      singleton: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      updated_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
    });

    await queryInterface.addIndex('office_expense_option_set', ['singleton'], {
      name: 'office_expense_option_set_singleton_idx',
      unique: true
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('office_expense_option_set');
  }
};
