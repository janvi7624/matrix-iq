'use strict';

// After-sales technical support.
//
// The one genuinely new subsystem in the Partner Portal. It is deliberately
// NOT built on tms_tasks, despite the surface similarity: a TMS task is work
// assigned to an engineer inside a project plan, with no requester to talk
// to, no response/resolution targets, and no separation between notes the
// team writes for itself and messages the customer reads. A ticket is all
// four of those things. Reusing the task table would have meant bolting a
// conversation, an SLA clock and a visibility split onto a record whose
// status enum ('to_do', 'ready_for_review') describes something else.
//
// partner_id is NULLABLE on purpose: internal staff raise tickets too (a
// site engineer reporting a product failure), and forcing every ticket to
// belong to a partner would have meant a second table for internal ones.
//
// status is STRING, not ENUM. Thirteen values that encode a workflow are
// exactly the kind of list that gets revised, and Postgres cannot drop an
// enum value once added. lib/supportTicketWorkflow.ts is the real authority
// on which values exist and which transitions are legal.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('support_tickets', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      // Human reference — TKT-2026-0001. Generated in lib/supportTicketStore.ts.
      ticket_number: { type: Sequelize.STRING(32), allowNull: false },

      partner_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'partners', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      created_by_user_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },

      // Optional links to what the ticket is about.
      project_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'projects', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      quotation_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'quotations', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },

      title: { type: Sequelize.STRING(255), allowNull: false },
      category: { type: Sequelize.STRING(40), allowNull: true },
      // technical | installation | configuration | maintenance | warranty |
      // amc | product_failure | other
      issue_type: { type: Sequelize.STRING(40), allowNull: true },
      product: { type: Sequelize.STRING(255), allowNull: true },
      model_serial: { type: Sequelize.STRING(120), allowNull: true },
      customer_name: { type: Sequelize.STRING(255), allowNull: true },
      location: { type: Sequelize.STRING(255), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: false },
      // low | medium | high | critical — drives which SLA policy applies.
      priority: { type: Sequelize.STRING(10), allowNull: false, defaultValue: 'medium' },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'new' },

      department_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'departments', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      assigned_to_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      assigned_by_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      assigned_at: { type: Sequelize.DATE, allowNull: true },
      acknowledged_at: { type: Sequelize.DATE, allowNull: true },

      occurred_on: { type: Sequelize.DATEONLY, allowNull: true },

      // SLA timestamps. Stamped at triage from the priority's policy; the
      // BREACH itself is never stored — it is computed from these plus the
      // status history, so editing a policy re-evaluates consistently
      // instead of leaving old tickets judged by a stale rule.
      response_due_at: { type: Sequelize.DATE, allowNull: true },
      resolution_due_at: { type: Sequelize.DATE, allowNull: true },
      first_response_at: { type: Sequelize.DATE, allowNull: true },
      resolved_at: { type: Sequelize.DATE, allowNull: true },
      closed_at: { type: Sequelize.DATE, allowNull: true },
      reopened_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },

      resolution_summary: { type: Sequelize.TEXT, allowNull: true },
      root_cause: { type: Sequelize.TEXT, allowNull: true },
      corrective_action: { type: Sequelize.TEXT, allowNull: true },

      // Inline JSONB, matching the app-wide attachment convention (see
      // db/models/attachment.js's own comment on why the generic table is
      // unused).
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      contact_person: { type: Sequelize.STRING(255), allowNull: true },
      contact_method: { type: Sequelize.STRING(40), allowNull: true },

      escalated_at: { type: Sequelize.DATE, allowNull: true },
      escalated_to_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },

      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      deleted_at: { type: Sequelize.DATE, allowNull: true }
    });

    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX support_tickets_number_unique ON support_tickets (ticket_number) WHERE deleted_at IS NULL'
    );
    // The partner's own list, and the internal queues, are the two hot reads.
    await queryInterface.sequelize.query(
      'CREATE INDEX support_tickets_partner_idx ON support_tickets (partner_id, status) WHERE partner_id IS NOT NULL'
    );
    await queryInterface.addIndex('support_tickets', ['status'], { name: 'support_tickets_status_idx' });
    await queryInterface.addIndex('support_tickets', ['assigned_to_id', 'status'], { name: 'support_tickets_assignee_idx' });
    await queryInterface.addIndex('support_tickets', ['priority'], { name: 'support_tickets_priority_idx' });
    await queryInterface.addIndex('support_tickets', ['resolution_due_at'], { name: 'support_tickets_due_idx' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('support_tickets', 'support_tickets_due_idx');
    await queryInterface.removeIndex('support_tickets', 'support_tickets_priority_idx');
    await queryInterface.removeIndex('support_tickets', 'support_tickets_assignee_idx');
    await queryInterface.removeIndex('support_tickets', 'support_tickets_status_idx');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS support_tickets_partner_idx');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS support_tickets_number_unique');
    await queryInterface.dropTable('support_tickets');
  }
};
