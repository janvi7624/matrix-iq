'use strict';

// Office Operation Expense Management (HR section) — the HR/Admin department's
// own running expense register: office/electricity/guest/director/salary/
// pantry spend, one row per line item.
//
// sr_no is a real Postgres sequence rather than a "max(sr_no) + 1" read in the
// store, so two HR users saving at the same moment can't be handed the same
// serial (the same concurrency reasoning as quotation_sequences). It's a
// SEPARATE column from the UUID primary key: `id` is what routes/foreign keys
// use, `sr_no` is only the human-facing serial HR reads off the register. The
// sequence is declared OWNED BY the column so `down`'s DROP TABLE takes it
// with it and re-running this migration doesn't hit a leftover sequence.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('office_operation_expenses', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      sr_no: { type: Sequelize.INTEGER, allowNull: false },
      created_by: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      // 'Office' | 'Electricity' | 'Guest' | 'Director' | 'Salary' | 'Other'
      // (pantry spend is an item_name, not a usecase — see
      // lib/officeOperationExpenseOptions.ts, the source of truth)
      usecase: { type: Sequelize.STRING, allowNull: false },
      // The second level of `usecase` where one exists — which salary under
      // 'Salary' (Sweeper Salary / Office Boy), or the free-typed label under
      // 'Other'. Stored as plain text rather than its own lookup table so a
      // new sub-option is a code change in lib/officeOperationExpenseOptions.ts
      // and never a data migration.
      usecase_detail: { type: Sequelize.STRING },
      expense_head: { type: Sequelize.STRING, allowNull: false },
      item_name: { type: Sequelize.STRING, allowNull: false },
      // Reserved for the per-item sub-item list (not yet supplied) — already
      // persisted and rendered so filling in ITEM_SUB_OPTIONS later needs no
      // schema change. For item_name = 'Department' it holds the department
      // name, resolved live from Department Master.
      item_sub_name: { type: Sequelize.STRING },
      item_qty: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 1 },
      description: { type: Sequelize.TEXT },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      remarks: { type: Sequelize.TEXT },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.sequelize.query(
      'CREATE SEQUENCE office_operation_expenses_sr_no_seq OWNED BY office_operation_expenses.sr_no'
    );
    await queryInterface.sequelize.query(
      "ALTER TABLE office_operation_expenses ALTER COLUMN sr_no SET DEFAULT nextval('office_operation_expenses_sr_no_seq')"
    );

    await queryInterface.addIndex('office_operation_expenses', ['sr_no'], { unique: true });
    await queryInterface.addIndex('office_operation_expenses', ['date']);
    await queryInterface.addIndex('office_operation_expenses', ['created_by']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('office_operation_expenses');
  }
};
