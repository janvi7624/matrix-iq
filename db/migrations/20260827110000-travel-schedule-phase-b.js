'use strict';

// Mode of Travel, real structured co-travellers, an optional hotel-
// accommodation ask, and an optional advance-request ask — plus a sibling
// column for the Purpose-of-Travel dropdown's "Others" freeform text (the
// `purpose` column itself is reused as-is, still a plain string, just
// app-level constrained to a fixed option list now). Expense Note is
// removed — confirmed self-contained to Travel Schedule, no other model or
// export references it.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('travel_schedule', 'mode_of_travel', { type: Sequelize.STRING });
    await queryInterface.addColumn('travel_schedule', 'purpose_other', { type: Sequelize.STRING });
    await queryInterface.addColumn('travel_schedule', 'co_travellers', { type: Sequelize.JSONB, allowNull: false, defaultValue: [] });
    await queryInterface.addColumn('travel_schedule', 'hotel_accommodation', { type: Sequelize.JSONB });
    await queryInterface.addColumn('travel_schedule', 'advance_request', { type: Sequelize.JSONB });
    await queryInterface.removeColumn('travel_schedule', 'expense_note');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('travel_schedule', 'expense_note', { type: Sequelize.TEXT });
    await queryInterface.removeColumn('travel_schedule', 'advance_request');
    await queryInterface.removeColumn('travel_schedule', 'hotel_accommodation');
    await queryInterface.removeColumn('travel_schedule', 'co_travellers');
    await queryInterface.removeColumn('travel_schedule', 'purpose_other');
    await queryInterface.removeColumn('travel_schedule', 'mode_of_travel');
  }
};
