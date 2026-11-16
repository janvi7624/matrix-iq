'use strict';

// Lets HR rename, re-icon or delete the seven built-in Company Celebration
// folders. Their names live in code, so a row in this table whose key is a
// built-in key acts as an override; `hidden` marks one HR has deleted.
// Idempotent via describeTable.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('company_celebration_categories');
    if (!table.hidden) {
      await queryInterface.addColumn('company_celebration_categories', 'hidden', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('company_celebration_categories');
    if (table.hidden) await queryInterface.removeColumn('company_celebration_categories', 'hidden');
  }
};
