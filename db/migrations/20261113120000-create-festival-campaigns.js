'use strict';

// Client-facing festival greeting campaigns — one per festival, layered on
// top of the existing HR-managed `festivals` table (which keeps driving the
// internal staff greeting unchanged).
//
// Lifecycle (see lib/festivalCampaignStore.ts):
//   awaiting_creative  MatrixIQ itself raised a Marketing Request for the
//                      banner; waiting for Marketing to deliver it
//   pending_approval   Marketing delivered; HR / Marketing manager / Admin
//                      must approve before anything reaches a client
//   approved           will send on the festival day
//   sending -> sent    the festival-day send, claimed by a guarded UPDATE so
//                      two overlapping sweeps can never both send
//   skipped            festival day arrived without an approval — nothing sent
//
// festival_campaign_sends has a UNIQUE (campaign_id, email): the row is
// written BEFORE the email goes out, so a crash or a re-run can never mail
// the same client twice for the same festival.
//
// email_unsubscribes is global (not per-campaign): one opt-out stops every
// future festival mail to that address.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('festival_campaigns', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      festival_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'festivals', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      marketing_request_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'marketing_requests', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'awaiting_creative' },
      headline: { type: Sequelize.STRING(200), allowNull: false, defaultValue: '' },
      message: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      // Storage pathname (lib/fileStorage.ts) of the banner Marketing
      // delivered — served publicly ONLY once approved, via
      // app/api/public/festival-banner/[id].
      banner_path: { type: Sequelize.STRING(600), allowNull: true },
      approved_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      approved_at: { type: Sequelize.DATE, allowNull: true },
      rejection_reason: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      sent_at: { type: Sequelize.DATE, allowNull: true },
      recipient_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      sent_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      failed_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      dry_run: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.sequelize.query('CREATE UNIQUE INDEX festival_campaigns_festival_unique ON festival_campaigns (festival_id)');
    await queryInterface.addIndex('festival_campaigns', ['status'], { name: 'festival_campaigns_status_idx' });

    await queryInterface.createTable('festival_campaign_sends', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      campaign_id: { type: Sequelize.UUID, allowNull: false, references: { model: 'festival_campaigns', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      email: { type: Sequelize.STRING(320), allowNull: false },
      name: { type: Sequelize.STRING(200), allowNull: false, defaultValue: '' },
      company: { type: Sequelize.STRING(300), allowNull: false, defaultValue: '' },
      // pending | sent | failed | dry_run
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      error: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.sequelize.query('CREATE UNIQUE INDEX festival_campaign_sends_unique ON festival_campaign_sends (campaign_id, email)');

    await queryInterface.createTable('email_unsubscribes', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      email: { type: Sequelize.STRING(320), allowNull: false },
      source: { type: Sequelize.STRING(60), allowNull: false, defaultValue: 'festival' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.sequelize.query('CREATE UNIQUE INDEX email_unsubscribes_email_unique ON email_unsubscribes (email)');
  },

  async down(queryInterface) {
    await queryInterface.dropTable('email_unsubscribes');
    await queryInterface.dropTable('festival_campaign_sends');
    await queryInterface.dropTable('festival_campaigns');
  }
};
