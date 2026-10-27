'use strict';

// Corrects 20261026090000.
//
// queryInterface.changeColumn on Postgres rebuilt the foreign key but left
// the NOT NULL in place, so the column never actually became nullable — and
// it added a SECOND identical constraint (reimbursements_created_by_fkey1)
// alongside the original. Raw SQL here because the nullability change is
// precisely the part changeColumn did not perform.
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      'ALTER TABLE "reimbursements" DROP CONSTRAINT IF EXISTS "reimbursements_created_by_fkey1"'
    );
    await queryInterface.sequelize.query(
      'ALTER TABLE "reimbursements" ALTER COLUMN "created_by" DROP NOT NULL'
    );
  },

  async down(queryInterface) {
    const [rows] = await queryInterface.sequelize.query(
      'SELECT COUNT(*)::int AS n FROM reimbursements WHERE created_by IS NULL'
    );
    if (rows[0] && rows[0].n > 0) {
      throw new Error(`${rows[0].n} unallocated admin expense row(s) have no created_by — reassign them before rolling this back.`);
    }
    await queryInterface.sequelize.query(
      'ALTER TABLE "reimbursements" ALTER COLUMN "created_by" SET NOT NULL'
    );
  }
};
