'use strict';

// Company Celebration (HR). Albums of photos/videos the HR team curates:
// Birthday, Anniversary, Event / Expo, Festival, Engagement Activities,
// Company Announcements, Employee Appreciation. Each category holds
// free-named subfolders (an employee's name, or an event/festival title) and
// each subfolder holds the uploaded media — same two-level shape as the
// Marketing Materials library, but with a fixed set of top-level categories
// instead of an admin-built folder tree, since HR never needs to nest
// deeper than "category -> who/what it's about -> the photos".
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('company_celebrations', {
      id: { type: Sequelize.UUID, defaultValue: Sequelize.literal('gen_random_uuid()'), primaryKey: true, allowNull: false },
      category: { type: Sequelize.STRING(32), allowNull: false },
      subfolder: { type: Sequelize.STRING(160), allowNull: false },
      title: { type: Sequelize.STRING(255), allowNull: true },
      description: { type: Sequelize.TEXT, allowNull: true },
      file_url: { type: Sequelize.TEXT, allowNull: false },
      mime_type: { type: Sequelize.STRING(128), allowNull: true },
      created_by: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL'
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
    });

    await queryInterface.addIndex('company_celebrations', ['category', 'subfolder'], {
      name: 'company_celebrations_category_subfolder_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('company_celebrations');
  }
};
