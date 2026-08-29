'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('meta_integration_configs', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      webhook_verified: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      last_connection_test_at: { type: Sequelize.DATE },
      last_connection_test_ok: { type: Sequelize.BOOLEAN },
      last_connection_test_message: { type: Sequelize.TEXT },
      last_webhook_received_at: { type: Sequelize.DATE },
      last_successful_sync_at: { type: Sequelize.DATE },
      // 'fixed' | 'round_robin' | 'campaign'
      assignment_mode: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'fixed' },
      default_department_id: { type: Sequelize.UUID, references: { model: 'departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      default_owner_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      // Array of user ids the round-robin mode rotates through.
      round_robin_pool: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      round_robin_cursor: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      // { [campaignId]: { departmentId?: string, ownerId?: string } }
      campaign_routing_map: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_by_id: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('meta_integration_configs');
  }
};
