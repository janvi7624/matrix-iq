module.exports = (sequelize, DataTypes) => {
  const CustomModuleRecord = sequelize.define('CustomModuleRecord', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    customModuleId: { type: DataTypes.UUID, allowNull: false },
    createdBy: { type: DataTypes.UUID },
    status: { type: DataTypes.ENUM('active', 'pending_approval', 'approved', 'rejected'), allowNull: false, defaultValue: 'active' },
    values: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    attachments: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] }
  }, {
    tableName: 'custom_module_records',
    underscored: false,
    paranoid: true
  });

  CustomModuleRecord.associate = (models) => {
    CustomModuleRecord.belongsTo(models.CustomModule, { foreignKey: 'customModuleId', as: 'customModule' });
    CustomModuleRecord.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
  };

  return CustomModuleRecord;
};
