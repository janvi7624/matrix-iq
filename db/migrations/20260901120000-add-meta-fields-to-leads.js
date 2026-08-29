'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('leads', 'source', {
      type: Sequelize.STRING(30),
      allowNull: false,
      defaultValue: 'manual'
    });
    await queryInterface.addColumn('leads', 'meta_lead_id', { type: Sequelize.STRING });
    await queryInterface.addColumn('leads', 'meta_page_id', { type: Sequelize.STRING });
    await queryInterface.addColumn('leads', 'meta_form_id', { type: Sequelize.STRING });
    await queryInterface.addColumn('leads', 'meta_form_name', { type: Sequelize.STRING });
    await queryInterface.addColumn('leads', 'meta_campaign_id', { type: Sequelize.STRING });
    await queryInterface.addColumn('leads', 'meta_campaign_name', { type: Sequelize.STRING });
    await queryInterface.addColumn('leads', 'meta_adset_id', { type: Sequelize.STRING });
    await queryInterface.addColumn('leads', 'meta_adset_name', { type: Sequelize.STRING });
    await queryInterface.addColumn('leads', 'meta_ad_id', { type: Sequelize.STRING });
    await queryInterface.addColumn('leads', 'meta_ad_name', { type: Sequelize.STRING });
    await queryInterface.addColumn('leads', 'meta_platform', { type: Sequelize.STRING(10) });
    await queryInterface.addColumn('leads', 'meta_created_at', { type: Sequelize.DATE });
    await queryInterface.addColumn('leads', 'meta_raw_field_data', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: []
    });

    // Postgres unique indexes allow unlimited NULLs, so this is safe for
    // every pre-existing (non-Meta) row — it's the DB-level guarantee that
    // the same Meta lead can never create two MatrixIQ leads, even under
    // concurrent webhook delivery (a unique-violation on insert is treated
    // as "already processed" by the ingestion code, not just a pre-check).
    await queryInterface.addIndex('leads', ['meta_lead_id'], { unique: true, name: 'leads_meta_lead_id_unique' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('leads', 'leads_meta_lead_id_unique');
    await queryInterface.removeColumn('leads', 'meta_raw_field_data');
    await queryInterface.removeColumn('leads', 'meta_created_at');
    await queryInterface.removeColumn('leads', 'meta_platform');
    await queryInterface.removeColumn('leads', 'meta_ad_name');
    await queryInterface.removeColumn('leads', 'meta_ad_id');
    await queryInterface.removeColumn('leads', 'meta_adset_name');
    await queryInterface.removeColumn('leads', 'meta_adset_id');
    await queryInterface.removeColumn('leads', 'meta_campaign_name');
    await queryInterface.removeColumn('leads', 'meta_campaign_id');
    await queryInterface.removeColumn('leads', 'meta_form_name');
    await queryInterface.removeColumn('leads', 'meta_form_id');
    await queryInterface.removeColumn('leads', 'meta_page_id');
    await queryInterface.removeColumn('leads', 'meta_lead_id');
    await queryInterface.removeColumn('leads', 'source');
  }
};
