'use strict';

/**
 * Adds an assignment-acceptance gate to Marketing Requests: when the
 * Marketing Manager assigns/reassigns a request to a marketing member, that
 * member must accept before they can act on it. Plain string columns (the
 * status column here is a STRING, not a Postgres ENUM, so no ALTER TYPE is
 * needed).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('marketing_requests', 'assignment_status', { type: Sequelize.STRING, allowNull: false, defaultValue: '' });
    await queryInterface.addColumn('marketing_requests', 'assignment_decline_reason', { type: Sequelize.TEXT, allowNull: false, defaultValue: '' });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('marketing_requests', 'assignment_decline_reason');
    await queryInterface.removeColumn('marketing_requests', 'assignment_status');
  }
};
