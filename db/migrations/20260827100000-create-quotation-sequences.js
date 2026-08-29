'use strict';

// One row per calendar day, incremented via a single atomic upsert (see
// lib/quotationStore.ts's nextSequenceForDay) — replaces the old "scan every
// quotation_number and take max+1" logic, which reset independently per
// domain prefix and had no concurrency protection. sequence_date as the
// primary key doubles as the ON CONFLICT target, no separate index needed.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('quotation_sequences', {
      sequence_date: { type: Sequelize.DATEONLY, primaryKey: true, allowNull: false },
      last_value: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('quotation_sequences');
  }
};
