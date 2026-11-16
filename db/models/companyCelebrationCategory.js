module.exports = (sequelize, DataTypes) => {
  const CompanyCelebrationCategory = sequelize.define('CompanyCelebrationCategory', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    // Slug used as CompanyCelebration.category for rows filed under this
    // custom folder — generated once at creation (lib/companyCelebrationStore.ts),
    // never re-derived from label, so renaming the label later can't orphan
    // existing items.
    key: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    label: { type: DataTypes.STRING(160), allowNull: false },
    // A single emoji HR picked when creating this folder — null means the
    // generic folder icon (CUSTOM_CATEGORY_ICON in CompanyCelebrationsView).
    icon: { type: DataTypes.STRING(8), allowNull: true },
    created_by: { type: DataTypes.UUID, allowNull: true }
  }, {
    tableName: 'company_celebration_categories',
    underscored: true,
    paranoid: false
  });

  CompanyCelebrationCategory.associate = (models) => {
    CompanyCelebrationCategory.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return CompanyCelebrationCategory;
};
