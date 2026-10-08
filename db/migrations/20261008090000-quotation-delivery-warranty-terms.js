'use strict';

/**
 * quotations.delivery_period / quotations.warranty_terms — per-quotation
 * overrides for two lines in the standard Terms & Conditions block
 * (lib/pdf.ts) that commonly get negotiated per deal: "Standard delivery
 * period: 20-25 working days..." and "Warranty will be guided by the OEM
 * warranty terms...". Previously these two sentences were fixed for every
 * quotation (only editable org-wide, by an admin, via /admin/settings) —
 * a rep agreeing a different delivery window or warranty with one client had
 * no way to reflect that on this one quote without changing it for everyone.
 *
 * Both default to '' ("use the standard wording") so no already-issued
 * quotation changes meaning and a regenerated PDF of an old quotation still
 * reads as it did — same reasoning as the freight_included/
 * installation_included migration right before this one.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'delivery_period', {
      type: Sequelize.TEXT,
      allowNull: false,
      defaultValue: ''
    });
    await queryInterface.addColumn('quotations', 'warranty_terms', {
      type: Sequelize.TEXT,
      allowNull: false,
      defaultValue: ''
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'warranty_terms');
    await queryInterface.removeColumn('quotations', 'delivery_period');
  }
};
