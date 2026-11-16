'use strict';

// Lets HR pick an emoji for a custom Company Celebration folder when they
// add it — otherwise every custom folder renders with the same generic
// folder icon (components/CompanyCelebrationsView.tsx's CUSTOM_CATEGORY_ICON),
// which is hard to tell apart at a glance once there's more than one.
// Idempotent via describeTable, matching 20261022110000-materials-upload-support.js.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('company_celebration_categories');
    if (!table.icon) {
      await queryInterface.addColumn('company_celebration_categories', 'icon', {
        type: Sequelize.STRING(8),
        allowNull: true
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('company_celebration_categories');
    if (table.icon) await queryInterface.removeColumn('company_celebration_categories', 'icon');
  }
};
