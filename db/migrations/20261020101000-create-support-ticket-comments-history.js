'use strict';

// A ticket's conversation, and its status trail.
//
// TWO TABLES, because they answer different questions and have different
// visibility rules. Comments are what people wrote; history is what the
// system recorded. Merging them would mean every status change had to carry
// a visibility flag it does not need, and every comment a from/to status it
// does not have.
//
// support_ticket_comments.is_internal DEFAULTS TO TRUE. This is the single
// most important line in the file. An engineer typing diagnostic notes —
// "customer has clearly wired this wrong", "we've seen this failure on the
// whole batch" — must not have them published to the partner because
// somebody forgot a checkbox. Partner-visible is the deliberate act; the
// partner's OWN comments are written with is_internal = false explicitly by
// the partner route, which is the only place that may do so.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('support_ticket_comments', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      ticket_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'support_tickets', key: 'id' },
        onUpdate: 'CASCADE',
        // A deleted ticket's conversation is meaningless on its own.
        onDelete: 'CASCADE'
      },
      author_user_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      body: { type: Sequelize.TEXT, allowNull: false },
      // See the header comment. Internal by default, always.
      is_internal: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      attachments: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('support_ticket_comments', ['ticket_id', 'created_at'], {
      name: 'support_ticket_comments_ticket_idx'
    });

    await queryInterface.createTable('support_ticket_status_history', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      ticket_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'support_tickets', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      from_status: { type: Sequelize.STRING(30), allowNull: true },
      to_status: { type: Sequelize.STRING(30), allowNull: false },
      by_user_id: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      reason: { type: Sequelize.TEXT, allowNull: true },
      at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    // Ordered reads only — this is both the audit trail AND the input to the
    // SLA pause calculation (lib/supportSla.ts walks it to work out how long
    // the clock was stopped awaiting the partner).
    await queryInterface.addIndex('support_ticket_status_history', ['ticket_id', 'at'], {
      name: 'support_ticket_status_history_ticket_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('support_ticket_status_history', 'support_ticket_status_history_ticket_idx');
    await queryInterface.dropTable('support_ticket_status_history');
    await queryInterface.removeIndex('support_ticket_comments', 'support_ticket_comments_ticket_idx');
    await queryInterface.dropTable('support_ticket_comments');
  }
};
