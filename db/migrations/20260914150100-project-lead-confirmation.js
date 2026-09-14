'use strict';

// Lead -> Project automation — a confirmation overlay layered on top of the
// existing `status` enum (active/on_hold/won/lost), which stays completely
// untouched by this feature (an auto-created project still starts 'active',
// exactly like the pre-existing manual Convert-to-Project flow). Every
// normal, manually-created project has these columns NULL forever;
// `lead_confirmation_status` only ever gets set on a project that was
// auto-created by app/api/leads/assign's new hook (lib/leadProjectAutomation.ts).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'lead_confirmation_status', { type: Sequelize.STRING(30), allowNull: true });
    await queryInterface.addColumn('projects', 'confirmed_by', {
      type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('projects', 'confirmed_at', { type: Sequelize.DATE, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'confirmed_at');
    await queryInterface.removeColumn('projects', 'confirmed_by');
    await queryInterface.removeColumn('projects', 'lead_confirmation_status');
  }
};
