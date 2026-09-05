'use strict';

// Admin-configurable reimbursement submission deadline, replacing the
// previously hardcoded "1st-5th of the month" rule in
// app/api/reimbursement/sheet/[id]/submit/route.ts. `reimbursement_deadline_day`
// on app_configs is the global default (null = no deadline enforced at all).
// A specific (year, month) can be extended past that default without
// changing the default itself — same "immutable history row, never an
// overwrite" pattern as tms_project_deadline_extensions
// (20260907110000-tms-project-deadline-extension.js): the effective
// deadline for a period is whichever extension row for it was created most
// recently, so nothing is ever destructively updated in place.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('app_config', 'reimbursementDeadlineDay', { type: Sequelize.INTEGER, allowNull: true, defaultValue: 5 });

    await queryInterface.createTable('reimbursement_deadline_extensions', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      year: { type: Sequelize.INTEGER, allowNull: false },
      month: { type: Sequelize.INTEGER, allowNull: false },
      extended_to_day: { type: Sequelize.INTEGER, allowNull: false },
      extended_by: { type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });
    await queryInterface.addIndex('reimbursement_deadline_extensions', ['year', 'month'], { name: 'reimbursement_deadline_extensions_period_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('reimbursement_deadline_extensions');
    await queryInterface.removeColumn('app_configs', 'reimbursement_deadline_day');
  }
};
