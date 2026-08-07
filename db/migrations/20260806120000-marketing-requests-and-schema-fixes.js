'use strict';

/**
 * Additive follow-up to 20260804000000-initial-schema.js, applied while the
 * schema is still empty (0 rows) so these corrections are free:
 *   1. Adds the marketing_requests + marketing_request_comments tables,
 *      entirely missing from the initial schema despite being a live app
 *      module (lib/marketingRequestStore.ts, /marketing-requests).
 *   2. Widens audit_logs.entity_type from a narrow ENUM to a plain string,
 *      so new auditable entity types never need a schema migration again.
 *   3. Adds a real users.departmentId FK alongside the existing free-text
 *      users.department column (kept for API compatibility, see
 *      db/models/user.js) — was previously an unenforced string match.
 *   4. Corrects quotation_follow_ups.created_by from STRING to a UUID FK,
 *      matching every other created_by/createdBy column in the schema.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const idColumn = () => ({
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
        allowNull: false
      }
    });

    const timestamps = ({ paranoid } = {}) => {
      const cols = {
        created_at: { type: Sequelize.DATE, allowNull: false },
        updated_at: { type: Sequelize.DATE, allowNull: false }
      };
      if (paranoid) {
        cols.deleted_at = { type: Sequelize.DATE, allowNull: true };
      }
      return cols;
    };

    const userFk = () => ({
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    // -----------------------------------------------------------------
    // 1. Marketing Requests
    // -----------------------------------------------------------------
    await queryInterface.createTable('marketing_requests', {
      ...idColumn(),
      created_by: userFk(),
      project_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'projects', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      },
      title: { type: Sequelize.STRING },
      request_type: {
        type: Sequelize.ENUM(
          'brochure_flyer', 'social_media', 'banner_standee', 'video_reel', 'email_campaign',
          'website_update', 'product_photography', 'event_collateral', 'other'
        )
      },
      description: { type: Sequelize.TEXT },
      priority: { type: Sequelize.ENUM('low', 'medium', 'high', 'urgent'), allowNull: false, defaultValue: 'medium' },
      needed_by_date: { type: Sequelize.DATEONLY },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      status: {
        type: Sequelize.ENUM('submitted', 'timeline_set', 'in_progress', 'completed', 'rejected', 'cancelled'),
        allowNull: false,
        defaultValue: 'submitted'
      },
      timeline: { type: Sequelize.JSONB },
      rejection_reason: { type: Sequelize.TEXT },
      completion_notes: { type: Sequelize.TEXT },
      delivered_files: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      ...timestamps({ paranoid: true })
    });

    await queryInterface.createTable('marketing_request_comments', {
      ...idColumn(),
      marketing_request_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'marketing_requests', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      },
      at: { type: Sequelize.DATE },
      by: { type: Sequelize.STRING },
      text: { type: Sequelize.TEXT },
      ...timestamps({ paranoid: false })
    });

    // -----------------------------------------------------------------
    // 2. audit_logs.entity_type: ENUM -> STRING
    // -----------------------------------------------------------------
    await queryInterface.sequelize.query(
      'ALTER TABLE "audit_logs" ALTER COLUMN "entity_type" TYPE VARCHAR(255) USING "entity_type"::text;'
    );
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_audit_logs_entity_type";');

    // -----------------------------------------------------------------
    // 3. users.departmentId
    // -----------------------------------------------------------------
    await queryInterface.addColumn('users', 'departmentId', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'departments', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE'
    });

    // -----------------------------------------------------------------
    // 4. quotation_follow_ups.created_by: STRING -> UUID FK
    //    (table is empty at this point, safe to drop/recreate the column)
    // -----------------------------------------------------------------
    await queryInterface.removeColumn('quotation_follow_ups', 'created_by');
    await queryInterface.addColumn('quotation_follow_ups', 'created_by', userFk());
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('quotation_follow_ups', 'created_by');
    await queryInterface.addColumn('quotation_follow_ups', 'created_by', { type: Sequelize.STRING });

    await queryInterface.removeColumn('users', 'departmentId');

    await queryInterface.sequelize.query(
      "CREATE TYPE \"enum_audit_logs_entity_type\" AS ENUM('demo', 'delivery_challan', 'custom_module', 'lead', 'quotation');"
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE "audit_logs" ALTER COLUMN "entity_type" TYPE "enum_audit_logs_entity_type" USING "entity_type"::"enum_audit_logs_entity_type";'
    );

    await queryInterface.dropTable('marketing_request_comments');
    await queryInterface.dropTable('marketing_requests');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_marketing_requests_request_type";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_marketing_requests_priority";');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_marketing_requests_status";');
  }
};
