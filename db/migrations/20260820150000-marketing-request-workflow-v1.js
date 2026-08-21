'use strict';

/**
 * Migration for Marketing Request Workflow — Final V1:
 *   1. Widen `status` to VARCHAR(255) to support the full V1 workflow statuses:
 *      submitted, marketing_in_progress, pending_technical_review,
 *      technical_approved, tech_changes_requested, marketing_final_review,
 *      completed, rejected, cancelled.
 *   2. Widen `product_category` to VARCHAR(255) to support the requested categories:
 *      CCTV, VMS, Robotics, AI, IoT, Networking, Other.
 *   3. Add supporting workflow columns:
 *      - additional_info (TEXT)
 *      - technical_assigned_to_id (UUID FK to users)
 *      - technical_assigned_to (TEXT)
 *      - marketing_prepared_content (TEXT)
 *      - marketing_attachments (JSONB)
 *      - marketing_remarks (TEXT)
 *      - technical_instructions (TEXT)
 *      - technical_review_decision (VARCHAR)
 *      - technical_remarks (TEXT)
 *      - technical_reviewed_at (TIMESTAMPTZ)
 *      - technical_reviewed_by (VARCHAR)
 *      - final_submission_notes (TEXT)
 *      - final_submission_files (JSONB)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Widen status column to VARCHAR(255) if it is still an ENUM
    try {
      await queryInterface.sequelize.query(
        'ALTER TABLE "marketing_requests" ALTER COLUMN "status" TYPE VARCHAR(255) USING "status"::text;'
      );
    } catch {
      // Ignore if already VARCHAR
    }

    // 2. Widen product_category column to VARCHAR(255)
    try {
      await queryInterface.sequelize.query(
        'ALTER TABLE "marketing_requests" ALTER COLUMN "product_category" TYPE VARCHAR(255) USING "product_category"::text;'
      );
    } catch {
      // If column doesn't exist yet, we add it below
    }

    const tableDesc = await queryInterface.describeTable('marketing_requests');

    // Add product_category column if not existing
    if (!tableDesc.product_category) {
      await queryInterface.addColumn('marketing_requests', 'product_category', {
        type: Sequelize.STRING,
        allowNull: true
      });
    }

    // Add additional_info
    if (!tableDesc.additional_info) {
      await queryInterface.addColumn('marketing_requests', 'additional_info', {
        type: Sequelize.TEXT,
        allowNull: true
      });
    }

    // Add technical_assigned_to_id
    if (!tableDesc.technical_assigned_to_id) {
      await queryInterface.addColumn('marketing_requests', 'technical_assigned_to_id', {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE'
      });
    }

    // Add technical_assigned_to display name string
    if (!tableDesc.technical_assigned_to) {
      await queryInterface.addColumn('marketing_requests', 'technical_assigned_to', {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: ''
      });
    }

    // Add marketing workspace columns
    if (!tableDesc.marketing_prepared_content) {
      await queryInterface.addColumn('marketing_requests', 'marketing_prepared_content', {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: ''
      });
    }

    if (!tableDesc.marketing_attachments) {
      await queryInterface.addColumn('marketing_requests', 'marketing_attachments', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      });
    }

    if (!tableDesc.marketing_remarks) {
      await queryInterface.addColumn('marketing_requests', 'marketing_remarks', {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: ''
      });
    }

    if (!tableDesc.technical_instructions) {
      await queryInterface.addColumn('marketing_requests', 'technical_instructions', {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: ''
      });
    }

    // Add technical review columns
    if (!tableDesc.technical_review_decision) {
      await queryInterface.addColumn('marketing_requests', 'technical_review_decision', {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: ''
      });
    }

    if (!tableDesc.technical_remarks) {
      await queryInterface.addColumn('marketing_requests', 'technical_remarks', {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: ''
      });
    }

    if (!tableDesc.technical_reviewed_at) {
      await queryInterface.addColumn('marketing_requests', 'technical_reviewed_at', {
        type: Sequelize.DATE,
        allowNull: true
      });
    }

    if (!tableDesc.technical_reviewed_by) {
      await queryInterface.addColumn('marketing_requests', 'technical_reviewed_by', {
        type: Sequelize.STRING,
        allowNull: true,
        defaultValue: ''
      });
    }

    // Add final submission columns
    if (!tableDesc.final_submission_notes) {
      await queryInterface.addColumn('marketing_requests', 'final_submission_notes', {
        type: Sequelize.TEXT,
        allowNull: true,
        defaultValue: ''
      });
    }

    if (!tableDesc.final_submission_files) {
      await queryInterface.addColumn('marketing_requests', 'final_submission_files', {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      });
    }
  },

  async down(queryInterface) {
    const tableDesc = await queryInterface.describeTable('marketing_requests');
    if (tableDesc.final_submission_files) await queryInterface.removeColumn('marketing_requests', 'final_submission_files');
    if (tableDesc.final_submission_notes) await queryInterface.removeColumn('marketing_requests', 'final_submission_notes');
    if (tableDesc.technical_reviewed_by) await queryInterface.removeColumn('marketing_requests', 'technical_reviewed_by');
    if (tableDesc.technical_reviewed_at) await queryInterface.removeColumn('marketing_requests', 'technical_reviewed_at');
    if (tableDesc.technical_review_decision) await queryInterface.removeColumn('marketing_requests', 'technical_review_decision');
    if (tableDesc.technical_instructions) await queryInterface.removeColumn('marketing_requests', 'technical_instructions');
    if (tableDesc.marketing_remarks) await queryInterface.removeColumn('marketing_requests', 'marketing_remarks');
    if (tableDesc.marketing_attachments) await queryInterface.removeColumn('marketing_requests', 'marketing_attachments');
    if (tableDesc.marketing_prepared_content) await queryInterface.removeColumn('marketing_requests', 'marketing_prepared_content');
    if (tableDesc.additional_info) await queryInterface.removeColumn('marketing_requests', 'additional_info');
  }
};
