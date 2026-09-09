'use strict';

// Sales-person's own gut-feel estimate of the chance this project actually
// closes — set at project creation, editable later from the detail page's
// Overview tab, surfaced on the Project Dashboard list. Purely additive,
// nullable (unset = the sales person hasn't given an estimate).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'closing_probability_percent', {
      type: Sequelize.INTEGER,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'closing_probability_percent');
  }
};
