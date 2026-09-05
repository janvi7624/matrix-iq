'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('reimbursements', 'guest_names', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('reimbursements', 'guest_names');
  }
};
