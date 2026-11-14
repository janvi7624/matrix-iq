'use strict';

// A plain, standalone client contact record — "Add Client" on Client Master
// previously had no table of its own, so it silently created a Lead instead
// (and required leadSource, which it never sent, failing with "Pick where
// this lead came from."). This is pure storage: no call-outcome workflow,
// no lead pipeline, nothing else reads or writes this table except
// lib/clientMasterStore.ts folding its rows into the directory as prospects.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('manual_clients', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      client_name: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      company: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      phone: { type: Sequelize.STRING(40), allowNull: false, defaultValue: '' },
      email: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      address: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      notes: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      created_by: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('manual_clients');
  }
};
