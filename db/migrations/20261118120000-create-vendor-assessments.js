'use strict';

// Vendor Assessment module. One row per vendor/partner company assessed.
// Contacts, attachments and the approval trail are JSONB — they are read
// and written only as a whole by lib/vendorAssessmentStore.ts.
//
// Approval chain: VP/GM Sales (Sales dept manager) -> Finance (Accounts dept
// manager) -> MD (Management dept manager). Approvers resolve from
// Department Master, never hard-coded.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('vendor_assessments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      company_name: { type: Sequelize.STRING(255), allowNull: false },
      address: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      contacts: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      business_purpose: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      categories: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      relation_type: { type: Sequelize.STRING(40), allowNull: false },
      collaboration_date: { type: Sequelize.DATEONLY, allowNull: true },
      agreement_period: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      documents: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      project_deal_details: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      initiated_by_ids: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      overview_remarks: { type: Sequelize.TEXT, allowNull: false, defaultValue: '' },
      approval_stage: { type: Sequelize.STRING(20), allowNull: true, defaultValue: 'sales' },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
      approval_trail: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      created_by: { type: Sequelize.UUID, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_by_name: { type: Sequelize.STRING(255), allowNull: false, defaultValue: '' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('vendor_assessments', ['status']);
    await queryInterface.addIndex('vendor_assessments', ['created_by']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('vendor_assessments');
  }
};
