'use strict';

/**
 * The project form used to have two separate primary-contact fields
 * (Client Name, Contact Person) that were used interchangeably in practice.
 * `client_name` is now the single "Client Representative Name" field, and
 * `contact_person` is repurposed as an optional alternate contact's name —
 * this migration adds the matching phone number for that alternate contact.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('projects', 'alt_contact_phone', {
      type: Sequelize.STRING,
      allowNull: true
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('projects', 'alt_contact_phone');
  }
};
