'use strict';

// Accounts Payment Queue — a Hold is deliberately an overlay on top of the
// source record's own status, not a new value threaded into each of the 4
// sources' own state machines (ReimbursementSheet/Reimbursement/
// OfficeOperationExpense/TmsBomRequest/TravelSchedule). Holding/resuming a
// payment therefore never touches any existing status column — the unified
// queue just checks for an active row here and displays "On Hold" instead of
// the source's real status, which is the safest possible design against
// breaking any of those already-working workflows.
//
// source_id is a plain STRING (not UUID) because the Admin Expense source
// isn't a single row — it's a batch of Reimbursement rows sharing one
// `admin_note` (a free-text batch id, not a UUID) — see
// app/api/admin-expenses/route.ts.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('payment_holds', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      source: { type: Sequelize.STRING(30), allowNull: false },
      source_id: { type: Sequelize.STRING, allowNull: false },
      reason: { type: Sequelize.TEXT, allowNull: false },
      held_by: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      held_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      resumed_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      resumed_at: { type: Sequelize.DATE, allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    // DB-level duplicate-hold guard: at most one ACTIVE hold per (source,
    // source_id) at a time — enforced by Postgres itself, not just app code,
    // so two concurrent "Put On Hold" clicks on the same payment can't both
    // succeed.
    await queryInterface.sequelize.query(
      'CREATE UNIQUE INDEX payment_holds_active_unique ON payment_holds (source, source_id) WHERE active = true'
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payment_holds');
  }
};
