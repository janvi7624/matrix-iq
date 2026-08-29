'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('meta_webhook_events', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      leadgen_id: { type: Sequelize.STRING, allowNull: false },
      page_id: { type: Sequelize.STRING },
      form_id: { type: Sequelize.STRING },
      raw_payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      // 'pending' | 'processed' | 'failed' | 'ignored_duplicate'
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      last_error: { type: Sequelize.TEXT },
      resulting_lead_id: { type: Sequelize.UUID },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      processed_at: { type: Sequelize.DATE }
    });

    // Not unique — this table is a write-ahead event log (the same
    // leadgen_id can legitimately appear more than once here if Meta
    // retries delivery); leads.meta_lead_id's unique index is the actual
    // idempotency guarantee. This index just speeds up the lookup used to
    // short-circuit a retried event.
    await queryInterface.addIndex('meta_webhook_events', ['leadgen_id'], { name: 'meta_webhook_events_leadgen_id_idx' });
    await queryInterface.addIndex('meta_webhook_events', ['status'], { name: 'meta_webhook_events_status_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('meta_webhook_events');
  }
};
