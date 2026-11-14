module.exports = (sequelize, DataTypes) => {
  const ManualClient = sequelize.define('ManualClient', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    client_name: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
    company: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
    phone: { type: DataTypes.STRING(40), allowNull: false, defaultValue: '' },
    email: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
    address: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    notes: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    created_by: { type: DataTypes.UUID }
  }, {
    tableName: 'manual_clients',
    underscored: true,
    paranoid: false
  });

  ManualClient.associate = (models) => {
    ManualClient.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return ManualClient;
};
