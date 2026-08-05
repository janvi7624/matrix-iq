module.exports = (sequelize, DataTypes) => {
  const CustomModule = sequelize.define('CustomModule', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    key: { type: DataTypes.STRING, unique: true },
    name: { type: DataTypes.STRING },
    icon: { type: DataTypes.STRING },
    section: { type: DataTypes.STRING },
    createdBy: { type: DataTypes.UUID },
    requiresApproval: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Dynamic admin-managed master (role key) — free text, not ENUM/FK.
    approverRole: { type: DataTypes.STRING },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, {
    tableName: 'custom_modules',
    underscored: false,
    paranoid: true
  });

  CustomModule.associate = (models) => {
    CustomModule.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
    CustomModule.hasMany(models.CustomModuleField, { foreignKey: 'customModuleId', as: 'fields' });
    CustomModule.hasMany(models.CustomModuleRecord, { foreignKey: 'customModuleId', as: 'records' });
  };

  return CustomModule;
};
