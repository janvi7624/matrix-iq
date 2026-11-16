module.exports = (sequelize, DataTypes) => {
  const CompanyCelebration = sequelize.define('CompanyCelebration', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    // One of CELEBRATION_CATEGORIES in lib/companyCelebrationStore.ts — plain
    // string, not a PG enum, so a renamed/added category never needs a
    // migration.
    category: { type: DataTypes.STRING(32), allowNull: false },
    // The subfolder inside a category — an employee's name under Birthday /
    // Anniversary / Employee Appreciation, or an event/festival title under
    // Event / Expo / Festival / Engagement Activities / Company Announcements.
    // Free text: HR types it once when the subfolder is first created.
    subfolder: { type: DataTypes.STRING(160), allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    // Wherever the photo/video actually lives — an /api/uploads/file/... URL
    // from the app's own attachment storage (lib/fileStorage.ts), same as
    // every other upload in the app.
    file_url: { type: DataTypes.TEXT, allowNull: false },
    mime_type: { type: DataTypes.STRING(128), allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true }
  }, {
    tableName: 'company_celebrations',
    underscored: true,
    paranoid: false
  });

  CompanyCelebration.associate = (models) => {
    CompanyCelebration.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return CompanyCelebration;
};
