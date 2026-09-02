'use strict';

// Two changes to the Office Operation Expense register:
//
// 1. Sr No. is no longer forced to be unique. It is still assigned
//    automatically from the same Postgres sequence, so entries keep arriving in
//    order — the database simply no longer refuses a duplicate. The index is
//    kept (non-unique) because it is still the register's lookup/sort key.
//
// 2. One entry can now carry SEVERAL sub-items, so item_sub_name (a single
//    value) becomes item_sub_names (a JSONB array). JSONB matches how the rest
//    of this schema stores lists — attachment_urls, employee_ids, and so on.
//    Existing single values are carried over as one-element arrays; nothing
//    recorded is lost.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS office_operation_expenses_sr_no`);
    await queryInterface.sequelize.query(
      `CREATE INDEX office_operation_expenses_sr_no ON office_operation_expenses (sr_no)`
    );

    await queryInterface.addColumn('office_operation_expenses', 'item_sub_names', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: '[]'
    });

    // Carry the existing single value across before the old column goes.
    await queryInterface.sequelize.query(
      `UPDATE office_operation_expenses
       SET item_sub_names = to_jsonb(ARRAY[item_sub_name])
       WHERE item_sub_name IS NOT NULL AND item_sub_name <> ''`
    );

    await queryInterface.removeColumn('office_operation_expenses', 'item_sub_name');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('office_operation_expenses', 'item_sub_name', { type: Sequelize.STRING });
    // Only the first selection survives going back to a single-value column.
    await queryInterface.sequelize.query(
      `UPDATE office_operation_expenses
       SET item_sub_name = item_sub_names->>0
       WHERE jsonb_array_length(item_sub_names) > 0`
    );
    await queryInterface.removeColumn('office_operation_expenses', 'item_sub_names');

    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS office_operation_expenses_sr_no`);
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX office_operation_expenses_sr_no ON office_operation_expenses (sr_no)`
    );
  }
};
