'use strict';

// Each employee's own sidebar Quick Actions — the module keys they chose,
// in their order. Replaces the hard-coded four (Quotations, Site Visit Report,
// Demo Schedule, Project Dashboard) that every user used to get regardless of
// department.
//
// A table of its own rather than a column on users ON PURPOSE: the User model
// is read on every request, so a column the code expects but the database
// lacks (code deployed before this migration ran) would break login for
// everyone. Only lib/quickActionStore.ts touches this table, and it treats a
// missing table as "nothing chosen yet".
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_quick_actions', {
      user_id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      module_keys: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_quick_actions');
  }
};
