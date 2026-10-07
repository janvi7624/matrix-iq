'use strict';

/**
 * quotations.freight_included / quotations.installation_included — does the
 * quoted price already cover delivery, and does it already cover installation?
 *
 * Some supplier prices arrive delivered, or installed, or both, but the PDF
 * said the same thing on every quotation regardless: "Freight/transportation
 * charges, if applicable, will be extra" (lib/pdf.ts). On a quote whose price
 * already included either, that line contradicted the figure above it.
 *
 * Two independent columns rather than one combined flag, because the four
 * combinations are all real commercial positions — notably "delivered, but
 * installation is chargeable", which a single flag cannot express.
 *
 * Both default to FALSE deliberately: that is exactly what every existing
 * quotation was issued with, so no already-sent document changes meaning and
 * a regenerated PDF of an old quotation still reads as it did.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('quotations', 'freight_included', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await queryInterface.addColumn('quotations', 'installation_included', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('quotations', 'installation_included');
    await queryInterface.removeColumn('quotations', 'freight_included');
  }
};
