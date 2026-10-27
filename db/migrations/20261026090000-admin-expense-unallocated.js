'use strict';

// Admin expenses that belong to nobody in particular.
//
// An admin expense row books its cost against a person through created_by.
// Some costs genuinely have no owner — a courier fee, a stall rental, a
// shared booking nobody is the beneficiary of — and the form previously
// insisted on at least one employee anyway. The result was the cost being
// pinned to whoever happened to be picked, or the entry not being recorded
// at all.
//
// Making created_by nullable lets such a row stand on its own and be
// labelled "Other / Unallocated" everywhere it is read. NOT NULL is not
// replaced by nothing: the ordinary reimbursement path still always sets a
// creator (lib/reimbursementStore.ts), and only the admin-entry path may
// leave it empty — the rule moves from the column to the one route that
// needs the exception.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('reimbursements', 'created_by', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    });
  },

  async down(queryInterface, Sequelize) {
    // Any unallocated rows must be adopted before the column can be
    // required again — failing loudly is better than inventing an owner.
    const [rows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*)::int AS n FROM reimbursements WHERE created_by IS NULL'
    );
    if (rows[0] && rows[0].n > 0) {
      throw new Error(`${rows[0].n} unallocated admin expense row(s) have no created_by — reassign them before rolling this back.`);
    }
    await queryInterface.changeColumn('reimbursements', 'created_by', {
      type: Sequelize.UUID,
      allowNull: false,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE'
    });
  }
};
