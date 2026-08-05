module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define('Role', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    key: { type: DataTypes.STRING, allowNull: false, unique: true },
    label: { type: DataTypes.STRING },
    description: { type: DataTypes.TEXT },
    isSystem: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isPrivileged: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    permissions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    createdBy: { type: DataTypes.UUID },
    updatedBy: { type: DataTypes.UUID }
  }, {
    tableName: 'roles',
    underscored: false,
    paranoid: true
  });

  Role.associate = (models) => {
    Role.hasMany(models.User, { foreignKey: 'roleId', as: 'users' });
    Role.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
    Role.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
  };

  return Role;
};
