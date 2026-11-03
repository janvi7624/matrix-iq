'use strict';

/**
 * PAN number, bank details and website for a partner company, plus who
 * maintains them.
 *
 * financial_details_scope decides where these six fields are filled in:
 * 'internal' (the default — today's behaviour, unchanged for every existing
 * partner) means only an admin/RM enters them, on the Partner Detail page.
 * 'partner' means the partner company fills/edits them itself, on a new
 * self-service page in its own portal login (app/partner/profile) — chosen
 * once on PartnerCreateView's checkbox, but editable later like any other
 * partner field.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('partners', 'website', { type: Sequelize.STRING(255) });
    await queryInterface.addColumn('partners', 'pan_number', { type: Sequelize.STRING(20) });
    await queryInterface.addColumn('partners', 'bank_account_name', { type: Sequelize.STRING(255) });
    await queryInterface.addColumn('partners', 'bank_account_number', { type: Sequelize.STRING(40) });
    await queryInterface.addColumn('partners', 'bank_ifsc_code', { type: Sequelize.STRING(20) });
    await queryInterface.addColumn('partners', 'bank_name', { type: Sequelize.STRING(255) });
    await queryInterface.addColumn('partners', 'financial_details_scope', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'internal'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('partners', 'financial_details_scope');
    await queryInterface.removeColumn('partners', 'bank_name');
    await queryInterface.removeColumn('partners', 'bank_ifsc_code');
    await queryInterface.removeColumn('partners', 'bank_account_number');
    await queryInterface.removeColumn('partners', 'bank_account_name');
    await queryInterface.removeColumn('partners', 'pan_number');
    await queryInterface.removeColumn('partners', 'website');
  }
};
