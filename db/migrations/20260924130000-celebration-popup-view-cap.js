'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'celebrationPopupViewDate', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
    await queryInterface.addColumn('users', 'celebrationPopupViewCount', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'celebrationPopupViewCount');
    await queryInterface.removeColumn('users', 'celebrationPopupViewDate');
  },
};
