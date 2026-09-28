'use strict';

// Some business cards list two numbers (a direct line and a mobile, or two
// people's numbers on a shared card) — the scan/manual capture form only had
// room for one. Optional, no format constraint, same as the existing
// `mobile` column.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('leads', 'alt_mobile', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('leads', 'alt_mobile');
  },
};
