module.exports = (sequelize, DataTypes) => {
  const Department = sequelize.define('Department', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    description: { type: DataTypes.TEXT },
    order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    createdBy: { type: DataTypes.UUID },
    updatedBy: { type: DataTypes.UUID }
  }, {
    tableName: 'departments',
    underscored: false,
    paranoid: true
  });

  Department.associate = (models) => {
    Department.belongsTo(models.User, { foreignKey: 'createdBy', as: 'creator' });
    Department.belongsTo(models.User, { foreignKey: 'updatedBy', as: 'updater' });
  };

  return Department;
};
