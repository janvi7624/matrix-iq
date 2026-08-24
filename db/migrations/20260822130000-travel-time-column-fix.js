'use strict';

/**
 * Changes required_arrival_time and expected_departure_time from TIMESTAMP
 * to VARCHAR — these now store time-only strings (e.g. "14:30") since the
 * date is already captured in start_date / end_date.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('travel_schedule', 'required_arrival_time', { type: Sequelize.STRING });
    await queryInterface.changeColumn('travel_schedule', 'expected_departure_time', { type: Sequelize.STRING });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('travel_schedule', 'required_arrival_time', { type: Sequelize.DATE });
    await queryInterface.changeColumn('travel_schedule', 'expected_departure_time', { type: Sequelize.DATE });
  }
};
