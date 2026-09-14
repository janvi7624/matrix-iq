'use strict';

// Admin Expenses (Hotel/Visa/Ticket/Other batches on `reimbursements` where
// is_admin_entry = true) had no approval concept at all until now — anyone
// in ALLOWED_ROLES (superadmin/admin/hr) could create one and it went
// straight to Accounts. New requirement: any such batch not created by the
// designated approver (Hardik Acharya, see app/api/admin-expenses/route.ts)
// must wait for his approval before Accounts is notified. Existing rows are
// backfilled to 'approved' — this gate only applies going forward, it's not
// retroactive.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('reimbursements', 'approval_status', {
      type: Sequelize.STRING(20), allowNull: false, defaultValue: 'approved'
    });
    await queryInterface.addColumn('reimbursements', 'approved_by', {
      type: Sequelize.UUID, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL'
    });
    await queryInterface.addColumn('reimbursements', 'approved_at', {
      type: Sequelize.DATE, allowNull: true
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('reimbursements', 'approved_at');
    await queryInterface.removeColumn('reimbursements', 'approved_by');
    await queryInterface.removeColumn('reimbursements', 'approval_status');
  }
};
