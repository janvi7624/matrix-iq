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
    // Free text per existing UserRecord.department, kept for API compatibility.
    // departmentId (added in the 2026-08-06 migration) is the real FK; the
    // store layer keeps this string in sync with it on every read/write.
    department: { type: DataTypes.STRING },
    departmentId: { type: DataTypes.UUID },
    designation: { type: DataTypes.STRING },
    location: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    lastLoginAt: { type: DataTypes.DATE },
    // Set true only by the bulk employee import (lib/userImportStore.ts) —
    // cleared the moment the employee successfully changes their password.
    mustChangePassword: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  }, {
    tableName: 'users',
    underscored: false,
    paranoid: true
  });

  User.associate = (models) => {
    User.belongsTo(models.Role, { foreignKey: 'roleId', as: 'role' });
    User.belongsTo(models.Department, { foreignKey: 'departmentId', as: 'departmentRef' });
  };

  return User;
};
