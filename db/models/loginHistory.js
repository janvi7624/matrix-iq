module.exports = (sequelize, DataTypes) => {
  const LoginHistory = sequelize.define('LoginHistory', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
    username: { type: DataTypes.STRING },
    userId: { type: DataTypes.UUID },
    at: { type: DataTypes.DATE },
    success: { type: DataTypes.BOOLEAN },
    ip: { type: DataTypes.STRING }
  }, {
    tableName: 'login_history',
    underscored: false,
    paranoid: false
  });

  LoginHistory.associate = (models) => {
    LoginHistory.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
  };

  return LoginHistory;
};
