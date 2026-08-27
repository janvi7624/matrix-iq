'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('reimbursements', 'is_admin_entry', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('reimbursements', 'admin_note', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('reimbursements', 'admin_total_amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('reimbursements', 'admin_split_count', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('reimbursements', 'is_admin_entry');
    await queryInterface.removeColumn('reimbursements', 'admin_note');
    await queryInterface.removeColumn('reimbursements', 'admin_total_amount');
    await queryInterface.removeColumn('reimbursements', 'admin_split_count');
  },
};
