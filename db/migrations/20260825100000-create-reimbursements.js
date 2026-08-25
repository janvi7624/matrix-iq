'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('reimbursements', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      created_by: { type: Sequelize.UUID, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      description: { type: Sequelize.TEXT },
      employee_ids: { type: Sequelize.JSONB, allowNull: false, defaultValue: '[]' },
      from_location: { type: Sequelize.STRING },
      to_location: { type: Sequelize.STRING },
      kilometers: { type: Sequelize.DECIMAL(10, 2) },
      amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      mode_of_payment: { type: Sequelize.STRING },
      amount_in_words: { type: Sequelize.STRING(500) },
      attachment_urls: { type: Sequelize.JSONB, allowNull: false, defaultValue: '[]' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.addIndex('reimbursements', ['created_by']);
    await queryInterface.addIndex('reimbursements', ['date']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('reimbursements');
  }
};
