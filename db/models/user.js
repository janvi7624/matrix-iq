module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    name: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING },
    roleId: { type: DataTypes.UUID, allowNull: false },
    employeeId: { type: DataTypes.STRING },
    // Free text per existing UserRecord.department — departments master exists
    // separately as the `departments` table but is not a FK here.
    department: { type: DataTypes.STRING },
    designation: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    lastLoginAt: { type: DataTypes.DATE }
  }, {
    tableName: 'users',
    underscored: false,
    paranoid: true
  });

  User.associate = (models) => {
    User.belongsTo(models.Role, { foreignKey: 'roleId', as: 'role' });
  };

  return User;
};
