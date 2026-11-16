'use strict';

// Lets HR add an extra top-level folder to Company Celebration beyond the
// fixed seven (Birthday, Anniversary, Event/Expo, Festival, Engagement
// Activities, Company Announcements, Employee Appreciation). The fixed set
// stays hardcoded (lib/companyCelebrationStore.ts's CELEBRATION_CATEGORIES)
// — this table only ever holds ones HR added on top of it.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('company_celebration_categories', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      key: { type: Sequelize.STRING(64), allowNull: false },
      label: { type: Sequelize.STRING(160), allowNull: false },
      created_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL'
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.addIndex('company_celebration_categories', ['key'], {
      unique: true,
      name: 'company_celebration_categories_key_unique'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('company_celebration_categories');
  }
};
