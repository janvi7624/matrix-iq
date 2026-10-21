'use strict';

// Response and resolution targets, per priority.
//
// Configuration rather than constants, because these are a commercial
// commitment that changes: an AMC renegotiation moves critical resolution
// from 4 hours to 2, and that must be an admin edit, not a deploy.
//
// pause_on_awaiting_partner is the documented business rule the requirement
// asks for. When a ticket is waiting on information only the partner can
// supply, the clock stops — otherwise every slow customer reply would read
// as our SLA failure, and the metric would measure their responsiveness
// instead of ours. It is per-policy rather than global so a critical-outage
// policy can be set to keep running regardless, which is a defensible
// position for a production-down ticket.
//
// Seeded with four policies so the module works the moment it is migrated;
// all four are editable and none is special-cased in code.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('support_sla_policies', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      name: { type: Sequelize.STRING(80), allowNull: false },
      // One policy per priority — the lookup is always "which policy applies
      // to a critical ticket", never a free-form selection.
      priority: { type: Sequelize.STRING(10), allowNull: false },
      first_response_minutes: { type: Sequelize.INTEGER, allowNull: false },
      resolution_minutes: { type: Sequelize.INTEGER, allowNull: false },
      pause_on_awaiting_partner: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      // Reserved: honouring working hours needs a calendar (holidays, shift
      // patterns) this app does not have. Shipped false and read by
      // lib/supportSla.ts, which treats true as "not implemented" rather
      // than silently computing the wrong thing.
      business_hours_only: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      escalate_after_minutes: { type: Sequelize.INTEGER, allowNull: true },
      escalate_to_user_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'active' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX support_sla_policies_priority_unique ON support_sla_policies (priority)'
    );

    await queryInterface.bulkInsert('support_sla_policies', [
      { name: 'Critical', priority: 'critical', first_response_minutes: 30, resolution_minutes: 240, pause_on_awaiting_partner: true, business_hours_only: false, status: 'active' },
      { name: 'High', priority: 'high', first_response_minutes: 120, resolution_minutes: 480, pause_on_awaiting_partner: true, business_hours_only: false, status: 'active' },
      { name: 'Medium', priority: 'medium', first_response_minutes: 240, resolution_minutes: 1440, pause_on_awaiting_partner: true, business_hours_only: false, status: 'active' },
      { name: 'Low', priority: 'low', first_response_minutes: 480, resolution_minutes: 4320, pause_on_awaiting_partner: true, business_hours_only: false, status: 'active' }
    ]);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS support_sla_policies_priority_unique');
    await queryInterface.dropTable('support_sla_policies');
  }
};
